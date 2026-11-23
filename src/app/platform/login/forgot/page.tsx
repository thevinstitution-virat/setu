import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { ForgotPassword } from "@/components/auth/PasswordReset";

/** Console "forgot password": a reset link to the console login's email. */
export default async function PlatformForgotPage() {
  if (await getTenant()) redirect("/platform/login");
  return <ForgotPassword endpoint="/api/platform/auth/password-reset/request" backHref="/platform/login" field="email" />;
}
