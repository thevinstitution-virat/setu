import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withTenantTx } from "@/lib/db";
import { moneyFail } from "@/lib/money-api";
import { MoneyError } from "@/lib/ledger";
import { decide, type AuditNote } from "@/lib/automation";
import type { CatalogueEdit } from "@/lib/catalogue-assist";

type Decision = { id: string; accept: boolean; edit?: CatalogueEdit };

function parse(v: unknown): Decision[] | string {
  if (!Array.isArray(v) || !v.length || v.length > 200) return "Send 1 to 200 decisions";
  const out: Decision[] = [];
  for (const d of v as Record<string, unknown>[]) {
    if (!d || typeof d.id !== "string" || typeof d.accept !== "boolean") return "Each decision needs an id and accept";
    let edit: CatalogueEdit | undefined;
    if (d.edit !== undefined && d.edit !== null) {
      const e = d.edit as Record<string, unknown>;
      if (typeof e !== "object") return "Edits must be an object";
      edit = {};
      if (e.nameHi !== undefined) {
        if (typeof e.nameHi !== "string") return "The Hindi name must be text";
        edit.nameHi = e.nameHi;
      }
      if (e.hsnCode !== undefined) {
        if (typeof e.hsnCode !== "string") return "The HSN code must be text";
        edit.hsnCode = e.hsnCode;
      }
      if (e.gstRate !== undefined) {
        if (typeof e.gstRate !== "number") return "The GST rate must be a number";
        edit.gstRate = e.gstRate;
      }
    }
    out.push({ id: d.id, accept: d.accept, edit });
  }
  return out;
}

/** POST { decisions: [{ id, accept, edit? }] } → accept (with edits) or reject catalogue suggestions, all or nothing. */
export async function POST(req: Request) {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const b = (await req.json().catch(() => null)) as { decisions?: unknown } | null;
  const decisions = parse(b?.decisions);
  if (typeof decisions === "string") return NextResponse.json({ error: decisions }, { status: 400 });
  const who = { userId: auth.session.userId, role: auth.session.role };
  try {
    const audits = await withTenantTx(
      auth.tenant.id,
      async (tx) => {
        const notes: AuditNote[] = [];
        for (const d of decisions) {
          const s = await tx.suggestion.findUnique({ where: { id: d.id }, select: { kind: true } });
          if (!s || s.kind !== "catalogue") throw new MoneyError("Not a catalogue suggestion", 400);
          const r = await decide({ tx, tenantId: auth.tenant.id, actorId: who.userId }, who, d.id, { accept: d.accept, edit: d.edit });
          if (r.status === "ACCEPTED") notes.push(...r.audits);
          else notes.push({ action: "suggestion.reject", entity: "Suggestion", entityId: d.id });
        }
        return notes;
      },
      { timeout: 60_000 }
    );
    const ip = requestIp(req);
    for (const a of audits) await audit(auth.db, { actorId: who.userId, ...a, ip });
    return NextResponse.json({ accepted: decisions.filter((d) => d.accept).length, rejected: decisions.filter((d) => !d.accept).length });
  } catch (e) {
    return moneyFail(e);
  }
}
