import ImportTool, { type ImportType } from "@/components/admin/ImportTool";
import { getTenant } from "@/lib/tenant";
import { inventorySettings } from "@/lib/inventory-settings";
import { BOOKS_IMPORTS, IMPORT_TYPES } from "@/lib/importers";
import { hasFeature } from "@/lib/plans";

export default async function ImportPage() {
  const tenant = await getTenant();
  // Without the accounts module, the suppliers' and purchase sheets are left out.
  const books = tenant ? await hasFeature(tenant.id, "books") : false;
  const only = books ? undefined : (IMPORT_TYPES.filter((t) => !BOOKS_IMPORTS.includes(t)) as ImportType[]);
  return <ImportTool only={only} purchaseCases={inventorySettings(tenant?.settings).purchaseCases} />;
}
