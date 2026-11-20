import type { Metadata } from "next";
import { getPlatformSession } from "@/lib/platform-auth";
import PlatformNav from "@/components/platform/PlatformNav";

export const metadata: Metadata = {
  title: "VBiz Pro console",
  robots: { index: false, follow: false },
};

/** Platform console (us, not tenants). The nav shows only when signed in. */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getPlatformSession();
  return (
    <div className="flex-1 flex flex-col min-h-full">
      {session && <PlatformNav name={session.name} role={session.role} />}
      <main className="flex-1 w-full mx-auto max-w-6xl px-4 py-5 sm:py-7">{children}</main>
    </div>
  );
}
