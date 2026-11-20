import { requireTenant } from "@/lib/tenant";
import { deliverySettings } from "@/lib/delivery-settings";
import SpotSale from "./SpotSale";

/**
 * Spot sale: sell free van stock to a shop on the route and deliver it at
 * once. Everything loads on the client; only the photo rule is read here.
 */
export default async function SpotSalePage() {
  const tenant = await requireTenant();
  const { photoRequired } = deliverySettings(tenant.settings);
  return <SpotSale photoRequired={photoRequired} />;
}
