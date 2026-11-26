import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { getPlatformSession } from "@/lib/platform-auth";
import LoginForm from "@/components/platform/LoginForm";
import EmailCodeForm from "@/components/auth/EmailCodeForm";
import ConsoleAuthFrame from "@/components/platform/ConsoleAuthFrame";
import GoogleButton from "@/components/auth/GoogleButton";
import { googleConfigured } from "@/lib/google";
import { noticeText } from "@/lib/login-notices";

/** The console signs in by an emailed one-time code (or Google); the password form comes back by setting this to true. */
const SHOW_PASSWORD = false;

export default async function PlatformLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const notice = noticeText(typeof q.notice === "string" ? q.notice : null);
  const tenant = await getTenant();
  if (!tenant && (await getPlatformSession())) redirect("/platform");

  if (tenant) {
    return (
      <ConsoleAuthFrame kick="Platform" title="Wrong address" sub="The console is only on the platform's own address, without a business name in front.">
        <p className="text-sm text-[var(--muted)]">This address belongs to a business.</p>
      </ConsoleAuthFrame>
    );
  }

  return (
    <ConsoleAuthFrame kick="Platform" title="Sign in to the console" sub="For the VBiz Pro team: businesses, plans, invoices and health." below="No password and no link: just the code we email you.">
      {notice && (
        <p role="status" className="text-sm rounded-lg bg-[var(--scheme-tint)] text-[var(--scheme-text)] px-3 py-2 mb-4 break-words">
          {notice}
        </p>
      )}
      <div className="space-y-4">
        {googleConfigured() && (
          <>
            <GoogleButton href="/api/platform/auth/google/start" label="Continue with Google" />
            <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              <span className="h-px flex-1 bg-[var(--line)]" aria-hidden />
              or
              <span className="h-px flex-1 bg-[var(--line)]" aria-hidden />
            </div>
          </>
        )}
        {SHOW_PASSWORD ? <LoginForm /> : <EmailCodeForm hint="We email a one-time code to the console login with this address. It works once, for 10 minutes." />}
      </div>
    </ConsoleAuthFrame>
  );
}
