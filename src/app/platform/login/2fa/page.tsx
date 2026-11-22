import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { readPlatformPending } from "@/lib/platform-mfa";
import { BrandMark } from "@/components/BrandMark";
import TwoStepPanel from "@/components/auth/TwoStepPanel";

/** The console's second step (lib/platform-mfa.ts). Mandatory for every console login. */
export default async function PlatformTwoStepPage() {
  if (await getTenant()) redirect("/platform/login");
  const pending = await readPlatformPending();
  if (!pending) redirect("/platform/login");
  const u = await prisma.platformUser.findUnique({ where: { id: pending.platformUserId }, select: { active: true, totpEnabledAt: true } });
  if (!u?.active) redirect("/platform/login");
  const mode = u.totpEnabledAt ? "verify" : "setup";

  return (
    <div className="mx-auto max-w-sm pt-6 sm:pt-16 space-y-5">
      <div className="flex items-center gap-3">
        <BrandMark size={40} />
        <div>
          <p className="page-kick">Two-step sign-in</p>
          <h1 className="page-title !mt-0.5">{mode === "setup" ? "Set up your authenticator" : "Enter your code"}</h1>
        </div>
      </div>
      <div className="card p-5 space-y-3">
        <p className="text-sm text-[var(--muted)]">
          {mode === "setup"
            ? "Every console login needs a code from an authenticator app. Set it up once; after that, sign-in asks for the current code."
            : "Open your authenticator app and type the code for VBiz Pro console, or use a recovery code."}
        </p>
        <TwoStepPanel endpoint="/api/platform/auth/mfa" mode={mode} restartHref="/platform/login" />
      </div>
      <p className="text-xs text-[var(--muted)]">Lost the phone and the recovery codes? On the server: npm run platform:user -- --email you@… --reset-2fa</p>
    </div>
  );
}
