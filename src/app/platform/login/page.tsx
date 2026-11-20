import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { getPlatformSession } from "@/lib/platform-auth";
import { BrandMark } from "@/components/BrandMark";
import LoginForm from "@/components/platform/LoginForm";

export default async function PlatformLoginPage() {
  const tenant = await getTenant();
  if (!tenant && (await getPlatformSession())) redirect("/platform");

  return (
    <div className="mx-auto max-w-sm pt-6 sm:pt-16 space-y-5">
      <div className="flex items-center gap-3">
        <BrandMark size={40} />
        <div>
          <p className="page-kick">Platform</p>
          <h1 className="page-title !mt-0.5">Setu console</h1>
        </div>
      </div>
      {tenant ? (
        <div className="card p-5 space-y-2">
          <p className="font-semibold">The console is only on the platform address</p>
          <p className="text-sm text-[var(--muted)]">This address belongs to a business. Open the console on the platform&apos;s own address, without a business name in front.</p>
        </div>
      ) : (
        <LoginForm />
      )}
    </div>
  );
}
