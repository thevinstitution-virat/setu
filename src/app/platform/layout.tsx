import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "VBiz Pro console",
  robots: { index: false, follow: false },
};

/** Platform console (us, not tenants). Signed-in pages get the app shell in (console)/layout.tsx. */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
