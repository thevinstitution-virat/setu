import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import type { Scope } from "@/lib/api-keys";
import { stockLevels } from "@/lib/stock";

/**
 * The shapes the public API (/api/v1) and outbound webhooks send. snake_case,
 * money in paise (integers) with the field name saying so, times in ISO UTC.
 * These are a contract with other people's software: add fields, never rename.
 */

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const retailerSelect = {
  id: true,
  outletName: true,
  legalName: true,
  gstin: true,
  stateCode: true,
  shopNumber: true,
  complexName: true,
  pinCode: true,
  creditLimit: true,
  creditDays: true,
  lat: true,
  lng: true,
  createdAt: true,
  updatedAt: true,
  area: { select: { name: true, region: { select: { name: true } } } },
  user: { select: { name: true, phone: true, active: true } },
} satisfies Prisma.RetailerProfileSelect;
type RetailerRow = Prisma.RetailerProfileGetPayload<{ select: typeof retailerSelect }>;

export const retailerDto = (r: RetailerRow) => ({
  id: r.id,
  outlet_name: r.outletName,
  legal_name: r.legalName,
  owner_name: r.user.name,
  phone: r.user.phone,
  active: r.user.active,
  gstin: r.gstin,
  state_code: r.stateCode,
  address: [r.shopNumber, r.complexName].filter(Boolean).join(", "),
  pin_code: r.pinCode,
  area: r.area.name,
  region: r.area.region.name,
  credit_limit_paise: r.creditLimit,
  credit_days: r.creditDays,
  lat: r.lat,
  lng: r.lng,
  created_at: iso(r.createdAt),
  updated_at: iso(r.updatedAt),
});

export const productSelect = {
  id: true,
  name: true,
  sku: true,
  hsnCode: true,
  unit: true,
  caseUnit: true,
  caseSize: true,
  moq: true,
  price: true,
  mrp: true,
  gstRate: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { name: true } },
  brand: { select: { name: true } },
} satisfies Prisma.ProductSelect;
type ProductRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

export const productDto = (p: ProductRow) => ({
  id: p.id,
  name: p.name,
  sku: p.sku,
  hsn_code: p.hsnCode,
  category: p.category.name,
  brand: p.brand?.name ?? null,
  unit: p.unit,
  case_unit: p.caseUnit,
  case_size: p.caseSize,
  min_order_qty: p.moq,
  price_paise: p.price,
  mrp_paise: p.mrp,
  gst_rate: p.gstRate,
  active: p.active,
  created_at: iso(p.createdAt),
  updated_at: iso(p.updatedAt),
});

export const orderSelect = {
  id: true,
  orderNumber: true,
  retailerId: true,
  status: true,
  subtotal: true,
  gstAmount: true,
  discountAmount: true,
  deliveryCharge: true,
  totalAmount: true,
  deliveryDate: true,
  notes: true,
  spot: true,
  createdAt: true,
  updatedAt: true,
  retailer: { select: { outletName: true } },
  items: { select: { productId: true, quantity: true, deliveredQty: true, price: true, gstRate: true, discount: true, product: { select: { sku: true, name: true } } } },
} satisfies Prisma.OrderSelect;
type OrderRow = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

export const orderDto = (o: OrderRow) => ({
  id: o.id,
  number: o.orderNumber,
  retailer_id: o.retailerId,
  outlet_name: o.retailer.outletName,
  status: o.status,
  subtotal_paise: o.subtotal,
  gst_paise: o.gstAmount,
  discount_paise: o.discountAmount,
  delivery_charge_paise: o.deliveryCharge,
  total_paise: o.totalAmount,
  delivery_date: iso(o.deliveryDate),
  notes: o.notes,
  spot_sale: o.spot,
  created_at: iso(o.createdAt),
  updated_at: iso(o.updatedAt),
  lines: o.items.map((i) => ({
    product_id: i.productId,
    sku: i.product.sku,
    name: i.product.name,
    quantity: i.quantity,
    delivered_quantity: i.deliveredQty,
    price_paise: i.price,
    discount_paise: i.discount,
    gst_rate: i.gstRate,
  })),
});

export const invoiceSelect = {
  id: true,
  type: true,
  number: true,
  fy: true,
  date: true,
  orderId: true,
  retailerId: true,
  originalId: true,
  b2b: true,
  placeOfSupply: true,
  taxable: true,
  cgst: true,
  sgst: true,
  igst: true,
  total: true,
  irn: true,
  ewbNo: true,
  createdAt: true,
  updatedAt: true,
  buyer: true,
  lines: { select: { sl: true, productId: true, description: true, hsnCode: true, unit: true, quantity: true, freeQty: true, rate: true, discount: true, taxable: true, gstRate: true, cgst: true, sgst: true, igst: true, total: true }, orderBy: { sl: "asc" } },
} satisfies Prisma.InvoiceSelect;
type InvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>;

export const invoiceDto = (i: InvoiceRow) => ({
  id: i.id,
  type: i.type,
  number: i.number,
  financial_year: i.fy,
  date: iso(i.date),
  order_id: i.orderId,
  retailer_id: i.retailerId,
  original_invoice_id: i.originalId,
  b2b: i.b2b,
  buyer: i.buyer,
  place_of_supply: i.placeOfSupply,
  taxable_paise: i.taxable,
  cgst_paise: i.cgst,
  sgst_paise: i.sgst,
  igst_paise: i.igst,
  total_paise: i.total,
  irn: i.irn,
  eway_bill_no: i.ewbNo,
  created_at: iso(i.createdAt),
  updated_at: iso(i.updatedAt),
  lines: i.lines.map((l) => ({
    sl: l.sl,
    product_id: l.productId,
    description: l.description,
    hsn_code: l.hsnCode,
    unit: l.unit,
    quantity: l.quantity,
    free_quantity: l.freeQty,
    rate_paise: l.rate,
    discount_paise: l.discount,
    taxable_paise: l.taxable,
    gst_rate: l.gstRate,
    cgst_paise: l.cgst,
    sgst_paise: l.sgst,
    igst_paise: l.igst,
    total_paise: l.total,
  })),
});

export const paymentSelect = {
  id: true,
  number: true,
  retailerId: true,
  purpose: true,
  method: true,
  state: true,
  amount: true,
  reference: true,
  orderId: true,
  collectedAt: true,
  createdAt: true,
  gatewayPaymentId: true,
  retailer: { select: { outletName: true } },
} satisfies Prisma.PaymentSelect;
type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;

export const paymentDto = (p: PaymentRow) => ({
  id: p.id,
  number: p.number,
  retailer_id: p.retailerId,
  outlet_name: p.retailer.outletName,
  purpose: p.purpose,
  method: p.method,
  state: p.state,
  amount_paise: p.amount,
  reference: p.reference,
  order_id: p.orderId,
  gateway_payment_id: p.gatewayPaymentId,
  received_at: iso(p.collectedAt),
  created_at: iso(p.createdAt),
});

// ───────────────────────────── listing ─────────────────────────────

export const RESOURCES: Record<string, Scope> = {
  retailers: "retailers:read",
  products: "products:read",
  orders: "orders:read",
  invoices: "invoices:read",
  payments: "payments:read",
  stock: "stock:read",
};

export type ListResult = { data: unknown[]; next_cursor: string | null } | { error: string; status: number };

/** ?limit=1..200 (50) &cursor=<id from next_cursor> &updated_since=<ISO> (created_since for payments). */
function paging(sp: URLSearchParams) {
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 200);
  const cursor = sp.get("cursor");
  const sinceRaw = sp.get("updated_since") ?? sp.get("created_since");
  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (since && Number.isNaN(since.getTime())) return { error: "updated_since must be an ISO date-time" } as const;
  return { limit, cursor, since } as const;
}

const page = <T extends { id: string }>(rows: T[], limit: number) => ({ rows: rows.slice(0, limit), next: rows.length > limit ? rows[limit - 1].id : null });

export async function listResource(tx: Tx, resource: string, sp: URLSearchParams): Promise<ListResult> {
  const p = paging(sp);
  if ("error" in p) return { error: p.error!, status: 400 };
  const { limit, cursor, since } = p;
  const after = cursor ? { id: { gt: cursor } } : {};
  const take = limit + 1;
  switch (resource) {
    case "retailers": {
      const rows = await tx.retailerProfile.findMany({ where: { ...after, ...(since ? { updatedAt: { gte: since } } : {}) }, orderBy: { id: "asc" }, take, select: retailerSelect });
      const r = page(rows, limit);
      return { data: r.rows.map(retailerDto), next_cursor: r.next };
    }
    case "products": {
      const rows = await tx.product.findMany({ where: { ...after, ...(since ? { updatedAt: { gte: since } } : {}) }, orderBy: { id: "asc" }, take, select: productSelect });
      const r = page(rows, limit);
      return { data: r.rows.map(productDto), next_cursor: r.next };
    }
    case "orders": {
      const status = sp.get("status");
      if (status && !["PLACED", "CONFIRMED", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"].includes(status)) return { error: "Unknown status", status: 400 };
      const rows = await tx.order.findMany({
        where: { ...after, ...(since ? { updatedAt: { gte: since } } : {}), ...(status ? { status: status as never } : {}), ...(sp.get("retailer_id") ? { retailerId: sp.get("retailer_id")! } : {}) },
        orderBy: { id: "asc" },
        take,
        select: orderSelect,
      });
      const r = page(rows, limit);
      return { data: r.rows.map(orderDto), next_cursor: r.next };
    }
    case "invoices": {
      const rows = await tx.invoice.findMany({
        where: { ...after, ...(since ? { updatedAt: { gte: since } } : {}), ...(sp.get("retailer_id") ? { retailerId: sp.get("retailer_id")! } : {}) },
        orderBy: { id: "asc" },
        take,
        select: invoiceSelect,
      });
      const r = page(rows, limit);
      return { data: r.rows.map(invoiceDto), next_cursor: r.next };
    }
    case "payments": {
      const rows = await tx.payment.findMany({
        where: { ...after, ...(since ? { createdAt: { gte: since } } : {}), ...(sp.get("retailer_id") ? { retailerId: sp.get("retailer_id")! } : {}) },
        orderBy: { id: "asc" },
        take,
        select: paymentSelect,
      });
      const r = page(rows, limit);
      return { data: r.rows.map(paymentDto), next_cursor: r.next };
    }
    case "stock": {
      const products = await tx.product.findMany({ where: { ...after, active: true }, orderBy: { id: "asc" }, take, select: { id: true, sku: true, name: true } });
      const r = page(products, limit);
      const levels = await stockLevels(tx, r.rows.map((x) => x.id));
      return {
        data: r.rows.map((x) => {
          const l = levels.get(x.id);
          return { product_id: x.id, sku: x.sku, name: x.name, warehouse: l?.warehouse ?? 0, van: l?.van ?? 0, damaged: l?.damaged ?? 0, expired: l?.expired ?? 0, reserved: l?.reserved ?? 0, available: l?.available ?? 0 };
        }),
        next_cursor: r.next,
      };
    }
  }
  return { error: "Not found", status: 404 };
}

export async function getResource(tx: Tx, resource: string, id: string) {
  switch (resource) {
    case "retailers":
      return tx.retailerProfile.findUnique({ where: { id }, select: retailerSelect }).then((r) => r && retailerDto(r));
    case "products":
      return tx.product.findUnique({ where: { id }, select: productSelect }).then((r) => r && productDto(r));
    case "orders":
      return tx.order.findUnique({ where: { id }, select: orderSelect }).then((r) => r && orderDto(r));
    case "invoices":
      return tx.invoice.findUnique({ where: { id }, select: invoiceSelect }).then((r) => r && invoiceDto(r));
    case "payments":
      return tx.payment.findUnique({ where: { id }, select: paymentSelect }).then((r) => r && paymentDto(r));
  }
  return null;
}
