"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { api, errText, ErrorBox, Flash, readRupees, SearchPick, send, TabBar, type Option } from "@/components/admin/AdminKit";

// ───────────────────────────── types (API JSON) ─────────────────────────────

type LineStatus = "UNMATCHED" | "SUGGESTED" | "MATCHED" | "IGNORED";
type MatchKind = "VERIFY" | "UPI_CLEAR" | "BANK_LINK" | "CHEQUE_CLEAR" | "SETTLEMENT" | "CASH_DEPOSIT" | "NEW_PAYMENT" | "SUPPLIER_PAY" | "ISSUED_CHEQUE" | "NEW_SUPPLIER_PAYMENT";

type Suggestion = { kind: MatchKind; ref: string | null; retailerId?: string | null; supplierId?: string | null; label: string; amount: number; date?: string | null; exact: boolean };

type Line = {
  id: string;
  statementId: string;
  account: string;
  date: string;
  narration: string;
  reference: string | null;
  debit: number;
  credit: number;
  balance: number | null;
  status: LineStatus;
  matchKind: MatchKind | null;
  matchRef: string | null;
  suggestions: Suggestion[] | null;
  entryId: string | null;
  note: string | null;
  matchedAt: string | null;
};

type LinesData = {
  lines: Line[];
  counts: Partial<Record<LineStatus, { count: number; credit: number }>>;
  labels: Record<string, string>;
};

type Statement = {
  id: string;
  fileName: string;
  account: string;
  fromDate: string | null;
  toDate: string | null;
  lineCount: number;
  skipped: number;
  uploadedBy: string;
  createdAt: string;
  counts: Partial<Record<LineStatus, number>>;
};

type UploadResult = {
  statement: Statement;
  duplicates: number;
  moneyOut?: number;
  skipped: number;
  columns: Record<string, string>;
  matched: number;
  suggested: number;
  unmatched: number;
};

type Bank = { id: string; name: string; isDefault: boolean };
type ShopRow = { retailerId: string; outletName: string; ownerName: string; phone: string | null; areaName: string };

const TABS = [
  { key: "open", label: "Needs a look" },
  { key: "MATCHED", label: "Matched" },
  { key: "IGNORED", label: "Set aside" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const COLUMN_LABEL: Record<string, string> = {
  date: "Date",
  narration: "Narration",
  credit: "Money in",
  debit: "Money out",
  amount: "Amount",
  drcr: "Dr / Cr",
  balance: "Balance",
  ref: "Reference",
};

const MAX_BYTES = 5 * 1024 * 1024;

// ───────────────────────────── helpers ─────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function when(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

const plural = (n: number, w: string) => `${n.toLocaleString("en-IN")} ${w}${n === 1 ? "" : "s"}`;

const openCount = (c: Partial<Record<LineStatus, number>>) => (c.UNMATCHED ?? 0) + (c.SUGGESTED ?? 0);

// ───────────────────────────── page ─────────────────────────────

export default function BankPage() {
  const [statements, setStatements] = useState<Statement[] | null>(null);
  const [stError, setStError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("open");
  const [statementId, setStatementId] = useState("");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<(LinesData & { tab: Tab }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [rematching, setRematching] = useState(false);
  const [shops, setShops] = useState<Option[] | null>(null);
  const [shopsError, setShopsError] = useState<string | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [suppliers, setSuppliers] = useState<Option[]>([]);

  const loadStatements = useCallback(async () => {
    try {
      const d = await api<{ statements: Statement[]; banks?: Bank[]; suppliers?: { id: string; name: string }[] }>("/api/bank/statements");
      setStatements(d.statements);
      setBanks(d.banks ?? []);
      setSuppliers((d.suppliers ?? []).map((x) => ({ id: x.id, label: x.name })));
      setStError(null);
    } catch (e) {
      setStError(errText(e));
    }
  }, []);

  const loadLines = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ status: tab });
    if (statementId) qs.set("statementId", statementId);
    if (q) qs.set("q", q);
    try {
      setData({ ...(await api<LinesData>(`/api/bank/lines?${qs}`)), tab });
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [tab, statementId, q]);

  useEffect(() => {
    loadStatements();
  }, [loadStatements]);

  useEffect(() => {
    loadLines();
  }, [loadLines]);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const loadShops = useCallback(async () => {
    if (shops) return;
    try {
      const d = await api<{ rows: ShopRow[] }>("/api/admin/khata?filter=all");
      setShops(
        d.rows.map((r) => ({
          id: r.retailerId,
          label: r.outletName,
          sub: [r.ownerName !== r.outletName ? r.ownerName : null, r.phone, r.areaName].filter(Boolean).join(" · "),
        }))
      );
      setShopsError(null);
    } catch (e) {
      setShopsError(errText(e));
    }
  }, [shops]);

  const refresh = useCallback(
    async (message?: string) => {
      await Promise.all([loadLines(), loadStatements()]);
      if (message) {
        setFlash(message);
        setTimeout(() => setFlash(null), 5000);
      }
    },
    [loadLines, loadStatements]
  );

  async function rematch() {
    setRematching(true);
    setError(null);
    try {
      const r = await send<{ matched: number; suggested: number; unmatched: number }>("/api/bank/lines", "POST", statementId ? { statementId } : {});
      const left = r.suggested + r.unmatched;
      await refresh(
        r.matched
          ? `Matched ${plural(r.matched, "more line")}. ${left ? `${plural(left, "line")} still need a look.` : "Nothing left to check."}`
          : left
            ? `No new sure matches. ${plural(left, "line")} still need a look.`
            : "Nothing left to check."
      );
    } catch (e) {
      setError(errText(e));
    } finally {
      setRematching(false);
    }
  }

  const counts = data?.counts ?? {};
  const tabCount: Record<Tab, number> = {
    open: (counts.UNMATCHED?.count ?? 0) + (counts.SUGGESTED?.count ?? 0),
    MATCHED: counts.MATCHED?.count ?? 0,
    IGNORED: counts.IGNORED?.count ?? 0,
  };
  const tabs = TABS.map((t) => ({ key: t.key, label: data ? `${t.label} (${tabCount[t.key]})` : t.label }));
  const accounts = useMemo(() => [...new Set((statements ?? []).map((s) => s.account))], [statements]);

  return (
    <div className="space-y-5">
      <div>
        <p className="page-kick">Money</p>
        <h1 className="page-title">Bank</h1>
        <p className="page-sub">Upload your bank statement. Match money in to shop payments, cheques, payouts or cash deposits, and money out to supplier payments and our cheques.</p>
      </div>

      <UploadCard
        accounts={accounts}
        banks={banks}
        onDone={async (r) => {
          setTab("open");
          setQuery("");
          setQ("");
          setStatementId(r.statement.id);
          await loadStatements();
        }}
      />

      <div className="space-y-3">
        <TabBar tabs={tabs} value={tab} onChange={setTab} />

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="input sm:flex-1"
            type="search"
            placeholder="Search narration or reference"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="input sm:!w-64" value={statementId} onChange={(e) => setStatementId(e.target.value)} aria-label="Statement">
            <option value="">All statements</option>
            {(statements ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.account} · {fmtDate(s.fromDate)} to {fmtDate(s.toDate)}
              </option>
            ))}
          </select>
          <button className="btn btn-soft btn-sm shrink-0" disabled={rematching} onClick={rematch}>
            <Icon name="check" className="h-4 w-4" />
            {rematching ? "Matching…" : "Match again"}
          </button>
        </div>
        {tab === "open" && (
          <p className="text-xs text-[var(--muted)]">
            Recorded a payment after uploading? Tap Match again and sure matches are done for you.
          </p>
        )}

        <Flash text={flash} />
        {error && <ErrorBox message={error} onRetry={loadLines} />}
        {data?.tab !== tab && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

        {data?.tab === tab && (
          <LineList
            tab={tab}
            data={data}
            loading={loading}
            searching={!!q}
            shops={shops}
            shopsError={shopsError}
            loadShops={loadShops}
            suppliers={suppliers}
            onDone={refresh}
          />
        )}
      </div>

      <StatementList
        statements={statements}
        error={stError}
        onRetry={loadStatements}
        current={statementId}
        onPick={(id) => {
          setStatementId(id);
          setTab("open");
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
    </div>
  );
}

// ───────────────────────────── upload ─────────────────────────────

function UploadCard({ accounts, banks, onDone }: { accounts: string[]; banks: Bank[]; onDone: (r: UploadResult) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [account, setAccount] = useState("");
  const [bankId, setBankId] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [inputKey, setInputKey] = useState(0);

  // Start with the account used last time.
  const shownAccount = touched ? account : account || accounts[0] || "";

  async function upload() {
    if (!file) return setError("Choose the statement file");
    if (file.size > MAX_BYTES) return setError("The file is larger than 5 MB");
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (banks.length) form.append("bankAccountId", bankId || banks[0].id);
      else form.append("account", shownAccount.trim());
      const r = await api<UploadResult>("/api/bank/statements", { method: "POST", body: form });
      setResult(r);
      setFile(null);
      setInputKey((k) => k + 1);
      await onDone(r);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 sm:p-5 space-y-4">
      <div className="flex items-start gap-3">
        <span className="icon-tile bg-[var(--mint-tint)] text-[var(--mint-text)]">
          <Icon name="upload" />
        </span>
        <div className="min-w-0">
          <p className="font-heading font-bold">Upload a statement</p>
          <p className="text-sm text-[var(--muted)]">
            Export the statement from net banking as CSV or Excel, one bank account at a time. Lines already uploaded are skipped.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Bank account</span>
          {banks.length ? (
            <select className="input" value={bankId || banks[0].id} onChange={(e) => setBankId(e.target.value)}>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          ) : (
          <input
            className="input"
            list="bank-accounts"
            maxLength={60}
            placeholder="e.g. HDFC current"
            value={shownAccount}
            onChange={(e) => {
              setTouched(true);
              setAccount(e.target.value);
            }}
          />
          )}
          {!banks.length && (
            <datalist id="bank-accounts">
              {accounts.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          )}
        </label>
        <label className="block min-w-0">
          <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">File (.csv or .xlsx, up to 5 MB)</span>
          <input
            key={inputKey}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="input"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError(null);
            }}
          />
        </label>
      </div>

      <button className="btn btn-kesar btn-sm w-full sm:w-auto" disabled={!file || busy} onClick={upload}>
        <Icon name="upload" className="h-4 w-4" />
        {busy ? "Uploading…" : "Upload and match"}
      </button>
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}

      {result && <UploadSummary r={result} />}
    </div>
  );
}

function UploadSummary({ r }: { r: UploadResult }) {
  const total = r.statement.lineCount + r.duplicates;
  const look = r.suggested + r.unmatched;
  const parts = [
    `${plural(r.matched, "line")} matched automatically`,
    look ? `${look} need${look === 1 ? "s" : ""} a look` : null,
    r.moneyOut ? `${r.moneyOut} of them money out` : null,
    r.duplicates ? `${r.duplicates} already imported` : null,
  ].filter(Boolean);
  const cols = Object.entries(r.columns).filter(([, v]) => v);

  return (
    <div className="rounded-xl bg-[var(--mint-tint)] p-3 space-y-2">
      <p className="text-sm font-bold text-[var(--mint-text)] flex items-start gap-1.5">
        <Icon name="check" className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          {plural(total, "line")}: {parts.join(", ")}.
        </span>
      </p>
      {r.skipped > 0 && (
        <p className="text-xs text-[var(--ink-2)]">
          {plural(r.skipped, "row")} had no date or amount and {r.skipped === 1 ? "was" : "were"} skipped (headings, totals, blank rows).
        </p>
      )}
      {cols.length > 0 && (
        <p className="text-xs text-[var(--muted)] break-words">
          Columns read:{" "}
          {cols.map(([k, v], i) => (
            <span key={k}>
              {i > 0 && " · "}
              {COLUMN_LABEL[k] ?? k} = <b className="text-[var(--ink-2)]">{v}</b>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

// ───────────────────────────── lines ─────────────────────────────

type Open = { id: string; mode: "fee" | "shop" | "supplier" | "ignore"; retailerId?: string | null; supplierId?: string | null };

function LineList({
  tab,
  data,
  loading,
  searching,
  shops,
  shopsError,
  loadShops,
  suppliers,
  onDone,
}: {
  tab: Tab;
  data: LinesData;
  loading: boolean;
  searching: boolean;
  shops: Option[] | null;
  shopsError: string | null;
  loadShops: () => Promise<void>;
  suppliers: Option[];
  onDone: (msg?: string) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  async function act(line: Line, body: Record<string, unknown>, message: string) {
    setBusyId(line.id);
    setRowError(null);
    try {
      await send(`/api/bank/lines/${line.id}`, "POST", body);
      setOpen(null);
      await onDone(message);
    } catch (e) {
      setRowError({ id: line.id, message: errText(e) });
    } finally {
      setBusyId(null);
    }
  }

  function pick(line: Line, s: Suggestion) {
    if (s.kind === "SETTLEMENT" && !s.ref) return setOpen({ id: line.id, mode: "fee" });
    if (s.kind === "NEW_PAYMENT") return setOpen({ id: line.id, mode: "shop", retailerId: s.retailerId });
    if (s.kind === "NEW_SUPPLIER_PAYMENT") return setOpen({ id: line.id, mode: "supplier", supplierId: s.supplierId });
    if (s.kind === "CASH_DEPOSIT") return cashDeposit(line);
    act(line, { action: "match", kind: s.kind, ref: s.ref }, `${formatINR(line.credit || line.debit)} matched: ${data.labels[s.kind] ?? s.kind}`);
  }

  function cashDeposit(line: Line) {
    if (!window.confirm(`Book ${formatINR(line.credit)} as office cash paid into the bank? This can't be undone here.`)) return;
    act(line, { action: "match", kind: "CASH_DEPOSIT" }, `${formatINR(line.credit)} booked as cash deposited`);
  }

  const lines = data.lines;
  const total = lines.reduce((t, l) => t + l.credit, 0);
  const totalOut = lines.reduce((t, l) => t + l.debit, 0);

  if (lines.length === 0) {
    return (
      <div className="card p-6 text-center text-sm text-[var(--muted)]">
        {searching
          ? "No lines match this search."
          : tab === "open"
            ? "All caught up. Every line is matched or set aside."
            : tab === "MATCHED"
              ? "Nothing matched yet."
              : "Nothing set aside."}
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${loading ? "opacity-60" : ""}`}>
      <p className="text-sm text-[var(--ink-2)]">
        <span className="font-bold">{plural(lines.length, "line")}</span>
        {total > 0 && ` · ${formatINR(total)} in`}
        {totalOut > 0 && ` · ${formatINR(totalOut)} out`}
        {lines.length >= 200 && " · showing the latest 200, search or pick a statement to see others"}
      </p>

      {lines.map((l) => (
        <div key={l.id} className="card p-4 space-y-3">
          <LineHead line={l} />

          {tab === "open" && (
            <>
              <Suggestions line={l} busy={busyId === l.id} onPick={(s) => pick(l, s)} />

              {open?.id === l.id && open.mode === "fee" && (
                <FeeForm
                  amount={l.credit}
                  busy={busyId === l.id}
                  onCancel={() => setOpen(null)}
                  onSubmit={(fees, note) =>
                    act(l, { action: "match", kind: "SETTLEMENT", fees, note }, `${formatINR(l.credit)} booked as a gateway payout`)
                  }
                />
              )}
              {open?.id === l.id && open.mode === "shop" && (
                <ShopForm
                  amount={l.credit}
                  initial={open.retailerId ?? null}
                  shops={shops}
                  shopsError={shopsError}
                  loadShops={loadShops}
                  busy={busyId === l.id}
                  onCancel={() => setOpen(null)}
                  onSubmit={(retailerId, purpose, note, name) =>
                    act(
                      l,
                      { action: "match", kind: "NEW_PAYMENT", retailerId, purpose, note },
                      `${formatINR(l.credit)} recorded as a bank payment from ${name}`
                    )
                  }
                />
              )}
              {open?.id === l.id && open.mode === "supplier" && (
                <SupplierForm
                  amount={l.debit}
                  initial={open.supplierId ?? null}
                  suppliers={suppliers}
                  busy={busyId === l.id}
                  onCancel={() => setOpen(null)}
                  onSubmit={(supplierId, note, name) =>
                    act(l, { action: "match", kind: "NEW_SUPPLIER_PAYMENT", supplierId, note }, `${formatINR(l.debit)} entered as a payment to ${name}`)
                  }
                />
              )}
              {open?.id === l.id && open.mode === "ignore" && (
                <IgnoreForm
                  busy={busyId === l.id}
                  onCancel={() => setOpen(null)}
                  onSubmit={(note) => act(l, { action: "ignore", note }, "Line set aside")}
                />
              )}

              {open?.id !== l.id && l.debit > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-outline btn-xs" disabled={busyId === l.id} onClick={() => setOpen({ id: l.id, mode: "supplier" })}>
                    <Icon name="truck" className="h-4 w-4" /> Payment to a supplier
                  </button>
                  <button className="btn btn-quiet btn-xs" disabled={busyId === l.id} onClick={() => setOpen({ id: l.id, mode: "ignore" })}>
                    Set aside
                  </button>
                </div>
              )}
              {open?.id !== l.id && l.debit === 0 && (
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-outline btn-xs" disabled={busyId === l.id} onClick={() => cashDeposit(l)}>
                    <Icon name="cash" className="h-4 w-4" /> Cash deposited
                  </button>
                  <button className="btn btn-outline btn-xs" disabled={busyId === l.id} onClick={() => setOpen({ id: l.id, mode: "shop" })}>
                    <Icon name="user" className="h-4 w-4" /> New payment from a shop
                  </button>
                  <button className="btn btn-quiet btn-xs" disabled={busyId === l.id} onClick={() => setOpen({ id: l.id, mode: "ignore" })}>
                    Set aside
                  </button>
                </div>
              )}
            </>
          )}

          {tab === "MATCHED" && (
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 text-sm">
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="chip chip-mint">Matched</span>
                  <span className="font-bold">{(l.matchKind && data.labels[l.matchKind]) ?? l.matchKind ?? "Matched"}</span>
                </p>
                {(l.note || l.matchedAt) && (
                  <p className="text-xs text-[var(--muted)] mt-1">
                    {l.note}
                    {l.note && l.matchedAt && " · "}
                    {l.matchedAt && when(l.matchedAt)}
                  </p>
                )}
              </div>
              <button
                className="btn btn-quiet btn-xs shrink-0"
                disabled={busyId === l.id}
                onClick={() => act(l, { action: "unmatch" }, "Match undone. The line needs a look again.")}
              >
                {busyId === l.id ? "Undoing…" : "Undo"}
              </button>
            </div>
          )}

          {tab === "IGNORED" && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-[var(--muted)] min-w-0">
                <span className="chip">{l.debit > 0 ? "Money out" : "Set aside"}</span>
                {l.note && l.note !== "Money out" && <span className="ml-1.5">{l.note}</span>}
              </p>
              {(
                <button
                  className="btn btn-quiet btn-xs shrink-0"
                  disabled={busyId === l.id}
                  onClick={() => act(l, { action: "unignore" }, "Line brought back to Needs a look")}
                >
                  {busyId === l.id ? "Saving…" : "Bring back"}
                </button>
              )}
            </div>
          )}

          {rowError?.id === l.id && <p className="text-sm text-[#a8281e]">{rowError.message}</p>}
        </div>
      ))}
    </div>
  );
}

function LineHead({ line }: { line: Line }) {
  const out = line.debit > 0;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-[var(--muted)]">
          {fmtDate(line.date)} · {line.account}
        </p>
        <p className="text-sm font-semibold break-words mt-0.5">{line.narration}</p>
        {line.reference && <span className="chip font-mono select-all mt-1.5 !text-[11.5px] break-all">Ref {line.reference}</span>}
      </div>
      <div className="text-right shrink-0">
        <p className={`font-heading font-bold text-lg leading-none ${out ? "text-[var(--muted)]" : ""}`}>
          {out ? `−${formatINR(line.debit)}` : formatINR(line.credit)}
        </p>
        <p className="text-[11px] text-[var(--muted)] mt-1">{out ? "Money out" : "Money in"}</p>
      </div>
    </div>
  );
}

function Suggestions({ line, busy, onPick }: { line: Line; busy: boolean; onPick: (s: Suggestion) => void }) {
  const list = line.suggestions ?? [];
  if (list.length === 0) {
    return <p className="text-xs text-[var(--muted)]">No likely match found. Pick what this money is below, or set it aside.</p>;
  }
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-bold text-[var(--ink-2)]">Could be</p>
      {list.map((s, i) => (
        <div
          key={`${s.kind}-${s.ref ?? s.retailerId ?? i}`}
          className={`flex flex-wrap items-center gap-2 rounded-xl p-2.5 ${s.exact ? "bg-[var(--mint-tint)]" : "bg-ink/5"}`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium break-words">
              {s.exact && <span className="chip chip-mint !py-0 !px-1.5 !text-[11px] mr-1.5 align-middle">Sure match</span>}
              {s.label}
            </p>
            <p className="text-xs text-[var(--muted)]">
              {formatINR(s.amount)}
              {s.date && ` · ${fmtDate(s.date)}`}
            </p>
          </div>
          <button className={`btn btn-xs shrink-0 ${s.exact ? "btn-mor" : "btn-soft"}`} disabled={busy} onClick={() => onPick(s)}>
            {busy ? "Saving…" : s.kind === "SETTLEMENT" && !s.ref ? "Enter fee" : s.kind === "NEW_PAYMENT" || s.kind === "NEW_SUPPLIER_PAYMENT" ? "Choose" : "Match"}
          </button>
        </div>
      ))}
    </div>
  );
}

function FormBox({ children, onSubmit }: { children: React.ReactNode; onSubmit: () => void }) {
  return (
    <form
      className="rounded-xl bg-ink/5 p-3 space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

function NoteInput({ value, onChange, placeholder = "Note (optional)" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className="input" maxLength={200} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function FeeForm({
  amount,
  busy,
  onCancel,
  onSubmit,
}: {
  amount: number;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (fees: number, note: string | undefined) => void;
}) {
  const [fee, setFee] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const p = readRupees(fee);
    if (p === null) return setError("Enter the gateway fee (₹0 if none)");
    if (p === "bad") return setError("Enter the fee in rupees, e.g. 42.50");
    if (p > amount) return setError("The fee can't be more than the payout");
    setError(null);
    onSubmit(p, note.trim() || undefined);
  }

  return (
    <FormBox onSubmit={submit}>
      <p className="text-xs text-[var(--ink-2)]">
        A gateway payout of {formatINR(amount)} that is not recorded yet. Enter the fee the gateway kept; it is booked as a charge.
      </p>
      <label className="block">
        <span className="block text-xs font-bold text-[var(--ink-2)] mb-1">Gateway fee (₹)</span>
        <input className="input" inputMode="decimal" autoFocus placeholder="0" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^\d.,]/g, ""))} />
      </label>
      <NoteInput value={note} onChange={setNote} />
      {error && <p className="text-xs text-[#a8281e]">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-mor btn-sm" disabled={busy}>
          {busy ? "Saving…" : "Book payout"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </FormBox>
  );
}

function ShopForm({
  amount,
  initial,
  shops,
  shopsError,
  loadShops,
  busy,
  onCancel,
  onSubmit,
}: {
  amount: number;
  initial: string | null;
  shops: Option[] | null;
  shopsError: string | null;
  loadShops: () => Promise<void>;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (retailerId: string, purpose: "DUES" | "WALLET", note: string | undefined, name: string) => void;
}) {
  const [shopId, setShopId] = useState<string | null>(initial);
  const [purpose, setPurpose] = useState<"DUES" | "WALLET">("DUES");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadShops();
  }, [loadShops]);

  function submit() {
    const shop = shops?.find((s) => s.id === shopId);
    if (!shopId || !shop) return setError("Choose the shop");
    setError(null);
    onSubmit(shopId, purpose, note.trim() || undefined, shop.label);
  }

  return (
    <FormBox onSubmit={submit}>
      <p className="text-xs text-[var(--ink-2)]">Records a bank payment of {formatINR(amount)} from the shop you choose.</p>
      {shopsError ? (
        <p className="text-xs text-[#a8281e]">{shopsError}</p>
      ) : !shops ? (
        <p className="text-xs text-[var(--muted)]">Loading shops…</p>
      ) : (
        <SearchPick options={shops} value={shopId} onChange={setShopId} placeholder="Search shop, owner, phone or area" />
      )}
      <div className="flex rounded-2xl p-1 bg-white" role="radiogroup">
        {(
          [
            { key: "DUES", label: "Pays dues" },
            { key: "WALLET", label: "Wallet top-up" },
          ] as const
        ).map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={purpose === o.key}
            onClick={() => setPurpose(o.key)}
            className={`flex-1 rounded-xl py-1.5 text-xs font-bold transition ${
              purpose === o.key ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "text-[var(--ink-2)]"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <NoteInput value={note} onChange={setNote} />
      {error && <p className="text-xs text-[#a8281e]">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-mor btn-sm" disabled={busy || !shops}>
          {busy ? "Saving…" : "Record payment"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </FormBox>
  );
}

function SupplierForm({
  amount,
  initial,
  suppliers,
  busy,
  onCancel,
  onSubmit,
}: {
  amount: number;
  initial: string | null;
  suppliers: Option[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (supplierId: string, note: string | undefined, name: string) => void;
}) {
  const [supplierId, setSupplierId] = useState<string | null>(initial);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const sup = suppliers.find((x) => x.id === supplierId);
    if (!supplierId || !sup) return setError("Choose the supplier");
    setError(null);
    onSubmit(supplierId, note.trim() || undefined, sup.label);
  }

  return (
    <FormBox onSubmit={submit}>
      <p className="text-xs text-[var(--ink-2)]">
        Enters a bank payment of {formatINR(amount)} to the supplier you choose, from this statement&apos;s bank, on the line&apos;s date. It pays their oldest bills; any extra is an advance.
      </p>
      {suppliers.length ? (
        <SearchPick options={suppliers} value={supplierId} onChange={setSupplierId} placeholder="Search suppliers" />
      ) : (
        <p className="text-xs text-[var(--muted)]">No suppliers yet. Add them in Books, Suppliers.</p>
      )}
      <NoteInput value={note} onChange={setNote} />
      {error && <p className="text-xs text-[#a8281e]">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-mor btn-sm" disabled={busy || !suppliers.length}>
          {busy ? "Saving…" : "Enter payment"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </FormBox>
  );
}

function IgnoreForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (note: string | undefined) => void }) {
  const [note, setNote] = useState("");
  return (
    <FormBox onSubmit={() => onSubmit(note.trim() || undefined)}>
      <p className="text-xs text-[var(--ink-2)]">Set aside a line that is nothing to match (interest, charges, a transfer between our accounts), so it stops showing here.</p>
      <div className="flex flex-wrap gap-1.5">
        {["Not from a shop", "Interest", "Refund", "Transfer between our accounts"].map((t) => (
          <button key={t} type="button" className="chip" onClick={() => setNote(t)}>
            {t}
          </button>
        ))}
      </div>
      <NoteInput value={note} onChange={setNote} placeholder="Why? (optional)" />
      <div className="flex gap-2">
        <button type="submit" className="btn btn-outline btn-sm" disabled={busy}>
          {busy ? "Saving…" : "Set aside"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </FormBox>
  );
}

// ───────────────────────────── statements ─────────────────────────────

function StatementList({
  statements,
  error,
  onRetry,
  current,
  onPick,
}: {
  statements: Statement[] | null;
  error: string | null;
  onRetry: () => void;
  current: string;
  onPick: (id: string) => void;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 border-b border-[var(--line)]">
        <h2 className="font-heading font-bold">Uploaded statements</h2>
        {statements && statements.length >= 50 && <span className="text-xs text-[var(--muted)]">Latest 50</span>}
      </div>
      {error ? (
        <div className="p-4">
          <ErrorBox message={error} onRetry={onRetry} />
        </div>
      ) : !statements ? (
        <p className="px-4 py-5 text-sm text-[var(--muted)]">Loading…</p>
      ) : statements.length === 0 ? (
        <p className="px-4 py-5 text-sm text-[var(--muted)]">No statements yet. Upload one above.</p>
      ) : (
        <div className="divide-y divide-[var(--line)]">
          {statements.map((s) => {
            const look = openCount(s.counts);
            return (
              <div key={s.id} className={`px-4 py-3 space-y-2 ${current === s.id ? "bg-black/[0.03]" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold break-words">{s.account}</p>
                    <p className="text-xs text-[var(--muted)] break-all">{s.fileName}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {fmtDate(s.fromDate)} to {fmtDate(s.toDate)} · uploaded {when(s.createdAt)} by {s.uploadedBy}
                    </p>
                  </div>
                  <button className="btn btn-quiet btn-xs shrink-0" onClick={() => onPick(s.id)} disabled={current === s.id}>
                    {current === s.id ? "Showing" : "Show lines"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="chip">{plural(s.lineCount, "line")}</span>
                  {look > 0 ? <span className="chip chip-genda">{look} need a look</span> : <span className="chip chip-mint">All done</span>}
                  {(s.counts.MATCHED ?? 0) > 0 && <span className="chip">{s.counts.MATCHED} matched</span>}
                  {(s.counts.IGNORED ?? 0) > 0 && <span className="chip">{s.counts.IGNORED} set aside</span>}
                  {s.skipped > 0 && <span className="chip">{s.skipped} rows skipped</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
