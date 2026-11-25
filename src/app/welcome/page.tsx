import { redirect } from "next/navigation";
import { pageSession } from "@/lib/guard";
import { roleHome } from "@/lib/auth";
import { getTenant, getDb } from "@/lib/tenant";
import { currentBrand } from "@/lib/branding-server";
import { appNameOf } from "@/lib/branding";
import { ROLE_LABEL } from "@/lib/email-messages";
import OnboardingForm from "@/components/auth/OnboardingForm";

export const metadata = { title: "Welcome" };

/**
 * The first-sign-in form for the person's role. Shown once: while the form is due every
 * sign-in lands here; after it, signing in goes straight to the role's own dashboard, and
 * anyone who opens this page again is sent there too.
 */
export default async function WelcomePage() {
  const session = await pageSession();
  if (!session) redirect("/login");
  const [tenant, db, { brand }] = await Promise.all([getTenant(), getDb(), currentBrand()]);
  const user = await db.user.findUnique({ where: { id: session.userId }, select: { name: true, email: true, phone: true, role: true, onboardingDue: true } });
  if (!user || !tenant) redirect("/login");
  if (!user.onboardingDue) redirect(roleHome(user.role));

  return (
    <OnboardingForm
      role={user.role}
      roleLabel={ROLE_LABEL[user.role] ?? user.role}
      business={appNameOf(brand, tenant.name)}
      email={user.email ?? ""}
      initialName={user.name}
      initialPhone={user.phone ?? ""}
    />
  );
}
