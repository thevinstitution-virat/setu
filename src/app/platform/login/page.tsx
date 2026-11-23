import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { getPlatformSession } from "@/lib/platform-auth";
import { BrandMark } from "@/components/BrandMark";
import LoginForm from "@/components/platform/LoginForm";
import EmailLinkForm from "@/components/auth/EmailLinkForm";

/** For now the console signs in by emailed link (or Google); the password form comes back by setting this to true. */
const SHOW_PASSWORD = false;
import GoogleButton from "@/components/auth/GoogleButton";
import { googleConfigured } from "@/lib/google";
import { noticeText } from "@/lib/login-notices";

export default async function PlatformLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const notice = noticeText(typeof q.notice === "string" ? q.notice : null);
  const tenant = await getTenant();
  if (!tenant && (await getPlatformSession())) redirect("/platform");

  return (
    <div className="mx-auto max-w-sm pt-6 sm:pt-16 space-y-5">
      <div className="flex items-center gap-3">
        <BrandMark size={40} />
        <div>
          <p className="page-kick">Platform</p>
          <h1 className="page-title !mt-0.5">VBiz Pro console</h1>
        </div>
      </div>
      {tenant ? (
        <div className="card p-5 space-y-2">
          <p className="font-semibold">The console is only on the platform address</p>
          <p className="text-sm text-[var(--muted)]">This address belongs to a business. Open the console on the platform&apos;s own address, without a business name in front.</p>
        </div>
      ) : (
        <>
          {notice && <p role="status" className="text-sm rounded-lg bg-ink/5 text-[var(--ink-2)] px-3 py-2 break-words">{notice}</p>}
          {googleConfigured() && <GoogleButton href="/api/platform/auth/google/start" label="Continue with Google" />}
          {SHOW_PASSWORD ? (
            <LoginForm />
          ) : (
            <div className="card p-5 space-y-3">
              <EmailLinkForm />
              <p className="text-xs text-[var(--muted)]">After the link, the console asks for the code from your authenticator app.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
