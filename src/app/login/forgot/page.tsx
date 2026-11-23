import { redirect } from "next/navigation";
import { currentBrand } from "@/lib/branding-server";
import { appNameOf } from "@/lib/branding";
import { ForgotPassword } from "@/components/auth/PasswordReset";

/** "Forgot password?" on a business address: a reset link to the login's confirmed email. */
export default async function ForgotPasswordPage() {
  const { tenant, brand } = await currentBrand();
  if (!tenant) redirect("/login");
  return <ForgotPassword appName={appNameOf(brand, tenant.name)} logoUrl={brand.logoKey ? "/brand/logo" : null} endpoint="/api/auth/password-reset/request" backHref="/login" field="login" />;
}
