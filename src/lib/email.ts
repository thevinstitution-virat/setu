import { devOrTest } from "@/lib/app-secret";

/**
 * Email through Resend (https://resend.com): RESEND_API_KEY and EMAIL_FROM
 * (e.g. "VBiz Pro <no-reply@vpd.ceo>", on a domain verified in Resend).
 *
 * Without a key, development and the tests keep the mail in devOutbox and
 * log one line, so flows can be tried locally; anywhere else sending fails
 * with an EmailError instead of pretending it went. Addresses and contents
 * are never logged outside development.
 */

export type Mail = { to: string; subject: string; text: string; html: string };

export class EmailError extends Error {
  constructor(message: string, public status = 503) {
    super(message);
  }
}

/** Mail "sent" without a key in development and the tests (newest last, 50 kept). */
export const devOutbox: Mail[] = [];

/** True when mail is kept locally instead of sent (dev / tests without a key). */
export const emailDevMode = () => !process.env.RESEND_API_KEY && devOrTest();

/** Real sending is set up (both settings present). */
export const emailConfigured = () => !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;

const RESEND_URL = "https://api.resend.com/emails";

export async function sendEmail(mail: Mail, fetcher: typeof fetch = fetch): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (devOrTest()) {
      devOutbox.push(mail);
      if (devOutbox.length > 50) devOutbox.shift();
      if (process.env.NODE_ENV === "development") console.info(`[email:dev] to ${mail.to}: ${mail.subject}\n${mail.text}`);
      return;
    }
    throw new EmailError("Email isn't set up yet. Please try another way to sign in, or contact support.");
  }
  const from = process.env.EMAIL_FROM;
  if (!from) throw new EmailError("Email isn't set up yet (no sender address). Please contact support.");

  let res: Response;
  try {
    res = await fetcher(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new EmailError("We couldn't reach the email service. Please try again in a minute.");
  }
  if (!res.ok) {
    // The status and Resend's own message only (it never echoes the key); not the address.
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    console.error(`[email] Resend refused the message: ${res.status} ${detail}`);
    throw new EmailError("We couldn't send the email. Please try again in a minute.");
  }
}

// ---- A plain, readable message ------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type MailBody = {
  /** Shown as the heading and the first line of the plain text. */
  title: string;
  lines: string[];
  /** A one-time code, shown large. */
  code?: string;
  /** A button (and the same link written out, for mail apps that hide buttons). */
  link?: { label: string; url: string };
  /** Several buttons (one per business, for sign-in links). */
  links?: { label: string; url: string }[];
  /** Small print at the end ("didn't ask for this?"). */
  footer?: string;
  /** Who it's from, e.g. the business name. */
  brand: string;
};

export function renderMail(b: MailBody): { text: string; html: string } {
  const links = [...(b.link ? [b.link] : []), ...(b.links ?? [])];
  const text = [
    b.title,
    "",
    ...b.lines,
    ...(b.code ? ["", b.code, ""] : []),
    ...links.flatMap((l) => ["", `${l.label}: ${l.url}`]),
    ...(links.length ? [""] : []),
    ...(b.footer ? ["", b.footer] : []),
    "",
    `— ${b.brand}`,
  ].join("\n");

  const p = (s: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#22302f">${esc(s)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f1ea;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px">
<p style="margin:0 0 16px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#db5c17">${esc(b.brand)}</p>
<h1 style="margin:0 0 16px;font-size:20px;color:#0f2a2a">${esc(b.title)}</h1>
${b.lines.map(p).join("\n")}
${b.code ? `<p style="margin:20px 0;font-size:32px;font-weight:700;letter-spacing:.3em;color:#0f2a2a;font-family:Menlo,Consolas,monospace">${esc(b.code)}</p>` : ""}
${links
  .map(
    (l) => `<p style="margin:20px 0 6px"><a href="${esc(l.url)}" style="display:inline-block;background:#db5c17;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">${esc(l.label)}</a></p>
<p style="margin:0 0 12px;font-size:12px;color:#5b6b6a;word-break:break-all">${esc(l.url)}</p>`
  )
  .join("\n")}
${b.footer ? `<p style="margin:20px 0 0;font-size:12px;color:#5b6b6a">${esc(b.footer)}</p>` : ""}
</div></body></html>`;
  return { text, html };
}
