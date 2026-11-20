import type { PlatformInvoice } from "./InvoiceList";

export type Module = { code: string; label: string; on: boolean; override: boolean | null };

export type SupportRow = {
  id: string;
  reason: string;
  mode: "READ" | "WRITE";
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  usedAt: string | null;
  by: string;
};

export type ExportRow = { id: string; status: string; createdAt: string; rows: number | null; bytes: number | null; forDeletion: boolean };

export type TenantData = {
  tenant: {
    id: string;
    slug: string;
    name: string;
    legalName: string | null;
    gstin: string | null;
    stateCode: string | null;
    address: string | null;
    phone: string | null;
    status: "TRIAL" | "ACTIVE" | "SUSPENDED" | "CLOSED";
    plan: string;
    overrides: { features?: Record<string, boolean>; limits?: { staff?: number; retailers?: number } } | null;
    suspendedAt: string | null;
    suspendReason: string | null;
    deleteRequestedAt: string | null;
    deleteAfter: string | null;
    closedAt: string | null;
    createdAt: string;
  };
  subscription: {
    planCode: string;
    status: string;
    trialEndsAt: string | null;
    periodStart: string;
    periodEnd: string;
    nextPlanCode: string | null;
    billingEmail: string | null;
    cancelAt: string | null;
    plan: { name: string };
  } | null;
  modules: Module[];
  limits: { staff: { limit: number | null; used: number }; retailers: { limit: number | null; used: number } };
  usage: { id: string; period: string; metric: string; value: number; costPaise: number }[];
  thisPeriod: string;
  domains: { id: string; host: string; verifiedAt: string | null; tlsStatus: string | null; lastError: string | null }[];
  invoices: PlatformInvoice[];
  supportSessions: SupportRow[];
  exports: ExportRow[];
  health: { orders30d: number; lastOrderAt: string | null; messagesFailed24h: number; webhooksDead24h: number; einvoiceFailed: number };
};

export type PlanRow = {
  code: string;
  name: string;
  basePaise: number;
  seatPaise: number;
  retailerPaise: number;
  aiCredits: number;
  aiCreditPaise: number;
  features: string[];
  limits: { staff?: number; retailers?: number } | null;
  trialDays: number;
  public: boolean;
  active: boolean;
  sortOrder: number;
  _count: { subscriptions: number };
};
