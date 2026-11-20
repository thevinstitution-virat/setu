import { redirect } from "next/navigation";
import { getPlatformSession } from "@/lib/platform-auth";
import { PlatformRoleProvider } from "@/components/platform/kit";

/** Every console page needs a platform sign-in (the login page sits outside this group). */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getPlatformSession();
  if (!session) redirect("/platform/login");
  return <PlatformRoleProvider role={session.role}>{children}</PlatformRoleProvider>;
}
