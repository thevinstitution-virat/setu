/**
 * Go-live readiness (roadmap §8 and §10): what is missing or unsafe on this
 * server before real businesses use it. `npm run golive:check` prints it (exit
 * code 1 when something fails); the platform console's Health shows it.
 *
 * envChecks is pure (tested); goLiveReport adds what only the database knows:
 * the app's role, migrations applied, and whether the worker is running.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { secretProblem } from "@/lib/security";
import { LEGAL_DRAFT } from "@/lib/legal";

export type CheckStatus = "ok" | "warn" | "fail";
export type Check = { id: string; label: string; status: CheckStatus; detail: string };
type Env = Record<string, string | undefined>;

const on = (v: string | undefined) => v === "1" || v === "true";
const set = (v: string | undefined) => !!v && v.trim() !== "";

export function envChecks(env: Env): Check[] {
  const out: Check[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string) => out.push({ id, label, status, detail });

  const sp = secretProblem(env.SESSION_SECRET);
  add("session_secret", "Session secret", sp ? "fail" : "ok", sp ?? "Set, 32+ characters");
  add("secrets_key", "Key for stored provider secrets", set(env.SECRETS_KEY) ? "ok" : "fail", set(env.SECRETS_KEY) ? "Set" : "SECRETS_KEY is not set: businesses' Razorpay and WhatsApp keys can't be stored");

  const domain = env.PLATFORM_DOMAIN?.trim() ?? "";
  add("platform_domain", "Platform domain", domain && !/localhost$/.test(domain) ? "ok" : "fail", domain ? (/localhost$/.test(domain) ? `${domain} is a local address` : domain) : "PLATFORM_DOMAIN is not set");
  add("default_tenant", "Default business", set(env.DEFAULT_TENANT_SLUG) ? "warn" : "ok", set(env.DEFAULT_TENANT_SLUG) ? `DEFAULT_TENANT_SLUG=${env.DEFAULT_TENANT_SLUG}: unknown addresses open that business; leave it empty in production` : "Empty");
  add("public_scheme", "Links use https", env.PUBLIC_SCHEME === "http" ? "warn" : "ok", env.PUBLIC_SCHEME === "http" ? "PUBLIC_SCHEME=http: links in messages won't be https" : "https");

  add("otp_dev", "Sign-in codes kept private", on(env.OTP_DEV_MODE) ? "fail" : "ok", on(env.OTP_DEV_MODE) ? "OTP_DEV_MODE is on: sign-in codes are shown on screen to anyone. Only for a demo server" : "Off");
  add("sms", "SMS for sign-in codes", set(env.SMS_PROVIDER) ? "warn" : "fail", set(env.SMS_PROVIDER) ? `SMS_PROVIDER=${env.SMS_PROVIDER}, but no SMS provider is built into the app yet` : "No SMS provider: shops can't get sign-in codes (owner decision §12.2)");

  const driver = env.STORAGE_DRIVER || "local";
  if (driver === "s3") {
    const missing = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !set(env[k]));
    add("storage", "File storage", missing.length ? "fail" : "ok", missing.length ? `S3 storage without ${missing.join(", ")}` : `S3 bucket ${env.S3_BUCKET}`);
  } else add("storage", "File storage", set(env.STORAGE_DIR) ? "warn" : "fail", set(env.STORAGE_DIR) ? `Local folder ${env.STORAGE_DIR}: it must be a persistent volume, and backed up` : "Local storage in the app folder: photos are lost on the next deploy. Set STORAGE_DIR to a volume or use S3");

  add("jobs", "Background jobs", on(env.JOBS_DISABLED) ? "fail" : "ok", on(env.JOBS_DISABLED) ? "JOBS_DISABLED=1: nothing is sent, no reminders or daily runs" : "On");
  add("simulator", "Payment simulator off", on(env.ALLOW_GATEWAY_SIMULATOR) ? "fail" : "ok", on(env.ALLOW_GATEWAY_SIMULATOR) ? "ALLOW_GATEWAY_SIMULATOR is on: payments can be marked paid without Razorpay" : "Off");
  add("private_webhooks", "Webhooks to private addresses blocked", on(env.ALLOW_PRIVATE_WEBHOOKS) ? "fail" : "ok", on(env.ALLOW_PRIVATE_WEBHOOKS) ? "ALLOW_PRIVATE_WEBHOOKS is on: businesses can make the server call its own network" : "Blocked");
  const ai = env.AI_PROVIDER ?? "none";
  add("ai", "AI provider", ai === "fake" ? "fail" : ai === "anthropic" && !set(env.ANTHROPIC_API_KEY) ? "warn" : "ok", ai === "fake" ? "AI_PROVIDER=fake is for tests only" : ai === "anthropic" ? (set(env.ANTHROPIC_API_KEY) ? "Anthropic" : "Anthropic without ANTHROPIC_API_KEY") : "None: every feature uses its rules");

  add("alerts", "Error alerts", set(env.TELEGRAM_BOT_TOKEN) && set(env.TELEGRAM_CHAT_ID) ? "ok" : "warn", set(env.TELEGRAM_BOT_TOKEN) && set(env.TELEGRAM_CHAT_ID) ? "Telegram" : "No Telegram bot: server errors only reach the logs");
  add("app_env", "Marked as production", env.APP_ENV === "prod" ? "ok" : "warn", env.APP_ENV === "prod" ? "APP_ENV=prod" : `APP_ENV=${env.APP_ENV || "(empty)"}: alerts aren't labelled as production`);
  add("push", "Phone notifications", set(env.VAPID_PUBLIC_KEY) && set(env.VAPID_PRIVATE_KEY) ? "ok" : "warn", set(env.VAPID_PUBLIC_KEY) ? "Web push keys set" : "No VAPID keys: staff get no push alerts");
  add("whatsapp", "WhatsApp messages", set(env.WHATSAPP_PROVIDER) ? "ok" : "warn", set(env.WHATSAPP_PROVIDER) ? `Provider ${env.WHATSAPP_PROVIDER}` : "No WhatsApp provider: order updates and reminders are only logged");
  add("maps", "Maps", set(env.GOOGLE_MAPS_API_KEY) ? "ok" : "warn", set(env.GOOGLE_MAPS_API_KEY) ? "Google key set" : "No maps key: distances are straight-line estimates");
  add("platform_billing", "Billing other businesses", set(env.PLATFORM_GSTIN) && set(env.PLATFORM_RAZORPAY_KEY_ID) ? "ok" : "warn", set(env.PLATFORM_GSTIN) ? (set(env.PLATFORM_RAZORPAY_KEY_ID) ? "GSTIN and Razorpay set" : "No platform Razorpay: invoices are paid by bank transfer") : "No PLATFORM_GSTIN: our invoices carry no GST (fine while we are the only business)");
  add("legal", "Terms and privacy text", LEGAL_DRAFT ? "warn" : "ok", LEGAL_DRAFT ? "Draft wording (src/lib/legal.ts LEGAL_DRAFT): fine for our own business, replace before other businesses sign up" : "Final");
  add("grievance", "Grievance contact on the privacy notice", set(env.GRIEVANCE_CONTACT) ? "ok" : "warn", set(env.GRIEVANCE_CONTACT) ? env.GRIEVANCE_CONTACT! : "GRIEVANCE_CONTACT is not set (DPDP Act asks for one)");
  return out;
}

/** Facts from the database, as checks. */
export function dbChecks(f: { superuser: boolean; bypassRls: boolean; migrationsApplied: number; migrationsInRepo: number; workerLastJobMin: number | null }): Check[] {
  return [
    {
      id: "db_role",
      label: "Database role respects row-level security",
      status: f.superuser || f.bypassRls ? "fail" : "ok",
      detail: f.superuser ? "The app connects as a superuser: tenant isolation is off" : f.bypassRls ? "The app's role has BYPASSRLS: tenant isolation is off" : "Non-superuser, no BYPASSRLS",
    },
    {
      id: "migrations",
      label: "Migrations applied",
      status: f.migrationsApplied >= f.migrationsInRepo ? "ok" : "fail",
      detail: `${f.migrationsApplied} of ${f.migrationsInRepo}${f.migrationsApplied < f.migrationsInRepo ? ": run npx prisma migrate deploy" : ""}`,
    },
    {
      id: "worker",
      label: "Worker running",
      status: f.workerLastJobMin !== null && f.workerLastJobMin <= 10 ? "ok" : "fail",
      detail: f.workerLastJobMin === null ? "No job has ever finished: start the worker (npm run worker)" : f.workerLastJobMin <= 10 ? `Last job ${f.workerLastJobMin} min ago` : `Last job ${f.workerLastJobMin} min ago: the worker seems stopped`,
    },
  ];
}

async function migrationsInRepo() {
  try {
    const dir = path.resolve("prisma/migrations");
    return (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).length;
  } catch {
    return 0;
  }
}

/** Everything, for the script and the console. */
export async function goLiveReport(env: Env = process.env) {
  const [role] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  const [mig] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  let workerLastJobMin: number | null = null;
  try {
    const [j] = await prisma.$queryRaw<{ last: Date | null }[]>`SELECT max(completed_on) AS last FROM pgboss.job WHERE state = 'completed'`;
    workerLastJobMin = j?.last ? Math.round((Date.now() - j.last.getTime()) / 60_000) : null;
  } catch {
    workerLastJobMin = null; // queue tables not created: the worker never ran
  }
  const checks = [...dbChecks({ superuser: role.rolsuper, bypassRls: role.rolbypassrls, migrationsApplied: Number(mig.n), migrationsInRepo: await migrationsInRepo(), workerLastJobMin }), ...envChecks(env)];
  return { checks, fails: checks.filter((c) => c.status === "fail").length, warnings: checks.filter((c) => c.status === "warn").length };
}
