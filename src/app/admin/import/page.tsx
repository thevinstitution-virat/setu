import ImportTool from "@/components/admin/ImportTool";
import { getTenant } from "@/lib/tenant";
import { inventorySettings } from "@/lib/inventory-settings";

export default async function ImportPage() {
  const tenant = await getTenant();
  return <ImportTool purchaseCases={inventorySettings(tenant?.settings).purchaseCases} />;
}
