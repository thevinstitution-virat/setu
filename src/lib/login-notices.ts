/**
 * Messages the sign-in page can show after a redirect (?notice= / ?error=).
 * Only these codes are read: text in the address is never shown, so nobody
 * can send a link that makes our page say "call this number" or similar.
 */
export const LOGIN_NOTICES = {
  "support-reason": "Write why you need access (at least 5 characters)",
  "support-business": "Business not found",
  "support-expired": "This support link has expired. Start a new session from the console.",
  "support-wrong": "This link is not for this business.",
  "support-used": "This support link was already used or the session ended.",
  "welcome-expired": "This link has expired. Sign in with your login id and password.",
  "welcome-wrong": "This link is not for this business.",
  "welcome-gone": "This link can't be used any more.",
  "welcome-used": "This link was already used. Sign in with your login id and password.",
  "switch-expired": "This link has expired. Switch again from the other business.",
  "switch-wrong": "This link is not for this business.",
  "switch-no-login": "You don't have an active login in this business.",
  "switch-used": "This link was already used. Switch again from the other business.",
} as const;

export type LoginNotice = keyof typeof LOGIN_NOTICES;

/** The code for one of our messages (the redirect side), or a general one. */
export function noticeCode(message: string, prefix: "support" | "welcome" | "switch"): LoginNotice | "link-failed" {
  const hit = (Object.entries(LOGIN_NOTICES) as [LoginNotice, string][]).find(([k, v]) => k.startsWith(`${prefix}-`) && v === message);
  return hit ? hit[0] : "link-failed";
}

/** The text for a code (the page side); anything else shows nothing. */
export function noticeText(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code === "link-failed") return "That link didn't work. Sign in below.";
  return (LOGIN_NOTICES as Record<string, string>)[code] ?? null;
}
