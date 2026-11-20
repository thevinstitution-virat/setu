/**
 * Operational alerts to a Telegram chat (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID).
 * Without those env vars, alerts go to the server log only. Same-message
 * alerts are throttled to one per 10 minutes so an outage doesn't flood.
 */

const recent = new Map<string, number>();
const THROTTLE_MS = 10 * 60 * 1000;

export async function sendAlert(title: string, detail = ""): Promise<void> {
  const key = `${title}|${detail.slice(0, 200)}`;
  const last = recent.get(key);
  if (last && Date.now() - last < THROTTLE_MS) return;
  recent.set(key, Date.now());

  console.error(`[alert] ${title}${detail ? `\n${detail}` : ""}`);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;

  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "dev";
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text: `🚨 VBiz Pro [${env}] ${title}\n${detail}`.slice(0, 3900),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.error("[alert] Telegram send failed", e);
  }
}
