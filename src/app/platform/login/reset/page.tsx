import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { NewPassword } from "@/components/auth/PasswordReset";

/** The page a console reset link opens: a new password (12+ characters). */
export default async function PlatformResetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await getTenant()) redirect("/platform/login");
  const q = await searchParams;
  return (
    <NewPassword
      endpoint="/api/platform/auth/password-reset/confirm"
      token={typeof q.t === "string" ? q.t : ""}
      min={12}
      forgotHref="/platform/login/forgot"
      backHref="/platform/login"
    />
  );
}
