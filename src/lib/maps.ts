import type { Prisma } from "@/generated/prisma/client";
import { withTenantTx } from "@/lib/db";
import { km } from "@/lib/trips";

/**
 * Maps provider, pluggable. MAPS_PROVIDER=google with GOOGLE_MAPS_API_KEY uses
 * Google's Geocoding (address → pin) and Directions (road distance and time
 * along a route); otherwise "none": no address lookup, and distances are the
 * straight line × 1.3 at 20 km/h. Answers are cached per business (GeoCache)
 * so the same address or route is not paid for twice. Only the shop's address
 * is sent, never the owner's name or phone.
 */

export type LatLng = { lat: number; lng: number };
export type Leg = { km: number; minutes: number };
export type RouteEstimate = { provider: "google" | "none"; legs: Leg[]; totalKm: number; totalMinutes: number };

export const ROAD_FACTOR = 1.3;
export const CITY_KMPH = 20;
const GEOCODE_TTL = 180 * 24 * 3600_000;
const ROUTE_TTL = 30 * 24 * 3600_000;
const MAX_WAYPOINTS = 23; // Directions: origin + 23 waypoints + destination

export function mapsProvider(): "google" | "none" {
  return process.env.MAPS_PROVIDER === "google" && process.env.GOOGLE_MAPS_API_KEY ? "google" : "none";
}

export const mapsStatus = () => ({ provider: mapsProvider(), roadFactor: ROAD_FACTOR, cityKmph: CITY_KMPH });

const r5 = (n: number) => n.toFixed(5);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function straightLeg(a: LatLng, b: LatLng): Leg {
  const d = km(a, b) * ROAD_FACTOR;
  return { km: round1(d), minutes: Math.round((d / CITY_KMPH) * 60) };
}

async function cached<T>(tenantId: string, kind: "geocode" | "route", key: string, ttl: number, fetcher: () => Promise<T | null>): Promise<T | null> {
  const hit = await withTenantTx(tenantId, (tx) => tx.geoCache.findFirst({ where: { kind, key } }));
  if (hit && Date.now() - hit.createdAt.getTime() < ttl) return hit.result as T;
  const fresh = await fetcher();
  if (fresh !== null) {
    await withTenantTx(tenantId, (tx) =>
      tx.geoCache.upsert({
        where: { tenantId_kind_key: { tenantId, kind, key } },
        create: { kind, key, result: fresh as Prisma.InputJsonValue, provider: mapsProvider() },
        update: { result: fresh as Prisma.InputJsonValue, provider: mapsProvider(), createdAt: new Date() },
      })
    );
  }
  return fresh;
}

async function google<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ ...params, key: process.env.GOOGLE_MAPS_API_KEY ?? "" });
  const res = await fetch(`https://maps.googleapis.com/maps/api/${path}/json?${qs}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Maps answered ${res.status}`);
  return (await res.json()) as T;
}

type GeocodeAnswer = { status: string; results: { geometry: { location: LatLng; location_type: string }; formatted_address: string }[] };
export type Geocoded = LatLng & { precision: string; address: string };

/** Address → pin. Null when there is no provider, nothing found, or only a rough area. */
export async function geocode(tenantId: string, address: string): Promise<Geocoded | null> {
  if (mapsProvider() === "none") return null;
  const key = address.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 300);
  if (key.length < 6) return null;
  return cached<Geocoded>(tenantId, "geocode", key, GEOCODE_TTL, async () => {
    const a = await google<GeocodeAnswer>("geocode", { address, region: "in", components: "country:IN" });
    if (a.status === "ZERO_RESULTS") return null;
    if (a.status !== "OK") throw new Error(`Maps said ${a.status}`);
    const best = a.results[0];
    // APPROXIMATE is a whole locality: worse than no pin for route order.
    if (!best || best.geometry.location_type === "APPROXIMATE") return null;
    return { ...best.geometry.location, precision: best.geometry.location_type, address: best.formatted_address };
  });
}

type DirectionsAnswer = { status: string; routes: { legs: { distance: { value: number }; duration: { value: number } }[] }[] };

/** Road distance and time for each leg of a route, in order. Falls back to straight lines. */
export async function estimateRoute(tenantId: string, points: LatLng[]): Promise<RouteEstimate> {
  const legs: Leg[] = [];
  let provider: RouteEstimate["provider"] = mapsProvider();
  if (points.length >= 2 && provider === "google") {
    try {
      // Long routes go in chunks that share their end points.
      for (let i = 0; i < points.length - 1; i += MAX_WAYPOINTS + 1) {
        const chunk = points.slice(i, i + MAX_WAYPOINTS + 2);
        const key = chunk.map((p) => `${r5(p.lat)},${r5(p.lng)}`).join(";");
        const got = await cached<Leg[]>(tenantId, "route", key, ROUTE_TTL, async () => {
          const a = await google<DirectionsAnswer>("directions", {
            origin: `${chunk[0].lat},${chunk[0].lng}`,
            destination: `${chunk[chunk.length - 1].lat},${chunk[chunk.length - 1].lng}`,
            ...(chunk.length > 2 ? { waypoints: chunk.slice(1, -1).map((p) => `${p.lat},${p.lng}`).join("|") } : {}),
            region: "in",
          });
          if (a.status !== "OK" || !a.routes[0]) return null;
          return a.routes[0].legs.map((l) => ({ km: round1(l.distance.value / 1000), minutes: Math.round(l.duration.value / 60) }));
        });
        if (!got || got.length !== chunk.length - 1) throw new Error("no route");
        legs.push(...got);
      }
    } catch {
      legs.length = 0;
      provider = "none";
    }
  }
  if (!legs.length) {
    provider = "none";
    for (let i = 1; i < points.length; i++) legs.push(straightLeg(points[i - 1], points[i]));
  }
  return { provider, legs, totalKm: round1(legs.reduce((s, l) => s + l.km, 0)), totalMinutes: legs.reduce((s, l) => s + l.minutes, 0) };
}

/** Find pins for shops that have none (after sign-up, approval, import, or the office's button). */
export async function locateShops(tenantId: string, retailerIds?: string[], limit = 100) {
  if (mapsProvider() === "none") return { provider: "none" as const, tried: 0, found: 0 };
  const shops = await withTenantTx(tenantId, (tx) =>
    tx.retailerProfile.findMany({
      where: { lat: null, ...(retailerIds ? { id: { in: retailerIds } } : {}) },
      select: { id: true, outletName: true, shopNumber: true, complexName: true, pinCode: true, area: { select: { name: true, region: { select: { name: true } } } } },
      take: limit,
    })
  );
  let found = 0;
  for (const s of shops) {
    const address = [s.outletName, s.shopNumber, s.complexName, s.area.name, s.area.region.name, s.pinCode, "India"].filter(Boolean).join(", ");
    try {
      const g = await geocode(tenantId, address);
      if (!g) continue;
      const r = await withTenantTx(tenantId, (tx) => tx.retailerProfile.updateMany({ where: { id: s.id, lat: null }, data: { lat: g.lat, lng: g.lng, locationSource: "address" } }));
      found += r.count;
    } catch (e) {
      console.error("[maps] geocode failed", s.id, (e as Error).message);
    }
  }
  return { provider: "google" as const, tried: shops.length, found };
}
