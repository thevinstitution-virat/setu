import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTenant, platformDomain } from "@/lib/tenant";
import { APP_NAME } from "@/lib/brand";
import SignupWizard from "@/components/signup/SignupWizard";

export const metadata: Metadata = {
  title: `Start your free trial — ${APP_NAME}`,
  description: "Open your business on VBiz Pro: pick a web address, try it free, and set up from the checklist.",
};

/** Self-serve sign-up, on the platform address only. A business's own address sends you to its sign-in. */
export default async function StartPage() {
  if (await getTenant()) redirect("/login");
  return <SignupWizard domain={platformDomain()} />;
}
