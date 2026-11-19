/**
 * Google Maps link to one shop: its map pin when it has one, else the
 * address. Opens the phone's maps app. Pure, safe on server and client.
 */
export function shopMapUrl(shop: { lat: number | null; lng: number | null; address: string }) {
  const dest = shop.lat !== null && shop.lng !== null ? `${shop.lat},${shop.lng}` : shop.address;
  if (!dest.trim()) return null;
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", destination: dest, travelmode: "driving" }).toString()}`;
}

/** "9:12 am" in IST, with the day when it isn't today ("18 Nov, 9:12 am"). */
export function istTime(iso: string, now = Date.now()) {
  const IST = 19_800_000;
  const d = new Date(new Date(iso).getTime() + IST);
  const today = new Date(now + IST).toISOString().slice(0, 10);
  const h = d.getUTCHours();
  const time = `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
  if (d.toISOString().slice(0, 10) === today) return time;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${month}, ${time}`;
}
