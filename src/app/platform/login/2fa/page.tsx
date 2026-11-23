import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { readPlatformPending } from "@/lib/platform-mfa";
import TwoStepPanel from "@/components/auth/TwoStepPanel";
import ConsoleAuthFrame from "@/components/platform/ConsoleAuthFrame";

/** The console's second step (lib/platform-mfa.ts). Mandatory for every console login. */
export default async function PlatformTwoStepPage() {
  if (await getTenant()) redirect("/platform/login");
  const pending = await readPlatformPending();
  if (!pending) redirect("/platform/login");
  const u = await prisma.platformUser.findUnique({ where: { id: pending.platformUserId }, select: { active: true, totpEnabledAt: true } });
  if (!u?.active) redirect("/platform/login");
  const mode = u.totpEnabledAt ? "verify" : "setup";

  return (
    <ConsoleAuthFrame
      kick="Two-step sign-in"
      title={mode === "setup" ? "Set up your authenticator" : "Enter your code"}
      sub={
        mode === "setup"
          ? "Every console login needs a code from an authenticator app. Set it up once; after that, sign-in asks for the current code."
          : "Open your authenticator app and type the code for VBiz Pro console, or use a recovery code."
      }
      below="Lost the phone and the recovery codes? On the server: npm run platform:user -- --email you@… --reset-2fa"
    >
      <TwoStepPanel endpoint="/api/platform/auth/mfa" mode={mode} restartHref="/platform/login" />
    </ConsoleAuthFrame>
  );
}
