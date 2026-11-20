/** Announcement shape from GET /api/admin/announcements, and its list state. */

export type Audience = "RETAILERS" | "STAFF" | "ALL";
export type Announcement = {
  id: string;
  title: string;
  body: string;
  audience: Audience;
  areaIds: string[];
  groupIds: string[];
  roles: string[];
  link: string | null;
  imageKey: string | null;
  pinned: boolean;
  startsAt: string;
  endsAt: string | null;
  channels: string[];
  publishedAt: string | null;
  sentCount: number;
  createdAt: string;
  createdBy: { name: string } | null;
};

export type AnnState = "draft" | "scheduled" | "live" | "ended";

export function announcementState(a: Pick<Announcement, "publishedAt" | "startsAt" | "endsAt">, now: number): AnnState {
  if (a.endsAt && new Date(a.endsAt).getTime() <= now) return a.publishedAt ? "ended" : "draft";
  if (!a.publishedAt) return "draft";
  if (new Date(a.startsAt).getTime() > now) return "scheduled";
  return "live";
}

export const AUDIENCE_TEXT: Record<Audience, string> = { RETAILERS: "Shops", STAFF: "Staff", ALL: "Shops and staff" };

export const STAFF_ROLES = [
  { key: "ADMIN", label: "Office admins" },
  { key: "SUPERVISOR", label: "Supervisors" },
  { key: "SALES_AGENT", label: "Sales agents" },
  { key: "DELIVERY_AGENT", label: "Drivers" },
] as const;

export const CHANNEL_TEXT: Record<string, string> = { push: "Push", whatsapp: "WhatsApp", sms: "SMS" };
