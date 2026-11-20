import TenantDetail from "@/components/platform/TenantDetail";

export default async function PlatformTenantPage({ params }: PageProps<"/platform/tenants/[id]">) {
  const { id } = await params;
  return <TenantDetail id={id} />;
}
