import { redirect } from "next/navigation";
import { getPlatformSession } from "@/lib/platform-auth";
import { prisma } from "@/lib/prisma";
import { googleConfigured } from "@/lib/google";
import { noticeText } from "@/lib/login-notices";
import SecurityPanel from "@/components/auth/SecurityPanel";

/** The console login's own two-step sign-in and Google link. */
export default async function PlatformSecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [s, q] = await Promise.all([getPlatformSession(), searchParams]);
  if (!s) redirect("/platform/login");
  const u = await prisma.platformUser.findUnique({ where: { id: s.platformUserId }, select: { totpEnabledAt: true, recoveryCodes: true, googleEmail: true } });
  if (!u) redirect("/platform/login");
  return (
    <>
      <div className="w-full max-w-lg">
        <SecurityPanel
          status={{ required: true, enabled: !!u.totpEnabledAt, recoveryLeft: u.recoveryCodes.length, googleEmail: u.googleEmail, googleAvailable: googleConfigured() }}
          endpoint="/api/platform/auth/security"
          googleStart="/api/platform/auth/google/start"
          homeHref="/platform"
          selfHref="/platform/security"
          notice={noticeText(typeof q.notice === "string" ? q.notice : null)}
        />
      </div>
    </>
  );
}
