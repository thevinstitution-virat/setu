import { redirect } from "next/navigation";
import { currentBrand } from "@/lib/branding-server";
import { appNameOf } from "@/lib/branding";
import { NewPassword } from "@/components/auth/PasswordReset";

/** The page a reset link opens (?t=…): choose a new password. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ tenant, brand }, q] = await Promise.all([currentBrand(), searchParams]);
  if (!tenant) redirect("/login");
  const token = typeof q.t === "string" ? q.t : "";
  return (
    <NewPassword
      appName={appNameOf(brand, tenant.name)}
      logoUrl={brand.logoKey ? "/brand/logo" : null}
      endpoint="/api/auth/password-reset/confirm"
      token={token}
      min={10}
      forgotHref="/login/forgot"
      backHref="/login"
    />
  );
}
