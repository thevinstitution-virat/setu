"use client";

import { useState } from "react";
import Icon from "@/components/Icon";

type Result = {
  mode: "preview" | "commit";
  committed: boolean;
  rows: number;
  created: number;
  updated: number;
  newRegions: number;
  newAreas: number;
  errorCount: number;
  errors: { row: number; message: string }[];
  tidy?: { changes: { row: number; field: string; from: string; to: string }[]; changeCount: number; duplicates: { row: number; name: string; kind: "sheet" | "catalogue"; with: string }[] } | null;
};

const TYPES = {
  retailers: {
    label: "Retailers",
    hint: "outlet_name, phone, shop_number, complex_name, pin_code, region, area, sales_agent (login id). Existing phones are updated; new regions and areas are created.",
  },
  products: {
    label: "Products",
    hint: "name, sku, category, unit, price (₹ before GST), mrp (₹), gst_rate (%), special_offer, brand, hsn_code, name_hi (Hindi name), case_unit + case_size (e.g. box of 24), moq. New categories and brands are created; a known HSN code sets the GST rate. Existing SKUs are updated.",
  },
  balances: {
    label: "Opening balances",
    hint: "phone, amount (₹; positive = retailer owes you, negative = advance you hold), as_of (2026-03-31 or 31/03/2026), note. One opening balance per retailer; import retailers first.",
  },
  prices: {
    label: "Prices",
    hint: "price_list or phone, sku, price (₹ before GST). With price_list: the rate in that list (new lists are created). With phone: that retailer's special rate. Import products first.",
  },
} as const;

type ImportType = keyof typeof TYPES;

export default function ImportPage() {
  const [type, setType] = useState<ImportType>("retailers");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tidy, setTidy] = useState(true);

  async function run(mode: "preview" | "commit") {
    if (!file) return;
    setError(null);
    setBusy(mode);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("type", type);
      form.append("mode", mode);
      if (type === "products" && tidy) form.append("tidy", "1");
      const res = await fetch("/api/admin/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  function pickType(t: ImportType) {
    setType(t);
    setResult(null);
  }

  const canCommit = result?.mode === "preview" && result.errorCount === 0 && result.rows > 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="page-kick">Bulk import</p>
        <h1 className="page-title">Import from Excel or CSV</h1>
        <p className="page-sub">Check the file first. Nothing is saved until you confirm, and a file with any error saves nothing.</p>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex rounded-2xl p-1 bg-ink/5 max-w-sm" role="tablist">
          {(Object.keys(TYPES) as ImportType[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={type === t}
              onClick={() => pickType(t)}
              className={`flex-1 rounded-xl py-2 text-sm font-bold transition ${
                type === t ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "text-[var(--ink-2)]"
              }`}
            >
              {TYPES[t].label}
            </button>
          ))}
        </div>

        <p className="text-sm text-[var(--muted)]">
          Columns: {TYPES[type].hint}{" "}
          <a className="font-bold text-[var(--kesar-text)] underline" href={`/api/admin/import?type=${type}`}>
            Download template
          </a>
        </p>

        <label className="block">
          <span className="block text-sm font-medium text-foreground/70 mb-1">File (.xlsx or .csv, up to 5,000 rows)</span>
          <input
            type="file"
            accept=".csv,.xlsx"
            className="input"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
            }}
          />
        </label>

        {type === "products" && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--mor)]"
              checked={tidy}
              onChange={(e) => {
                setTidy(e.target.checked);
                setResult(null);
              }}
            />
            <span>
              Tidy the sheet first
              <span className="block text-xs text-[var(--muted)]">Extra spaces, ALL CAPS names, sizes like 250GM → 250 g, GST 18% → 18, HSN digits only, category names matched to yours; likely duplicates are listed.</span>
            </span>
          </label>
        )}

        <div className="flex flex-wrap gap-2">
          <button className="btn btn-soft btn-sm" disabled={!file || !!busy} onClick={() => run("preview")}>
            {busy === "preview" ? "Checking…" : "Check file"}
          </button>
          <button className="btn btn-kesar btn-sm" disabled={!canCommit || !!busy} onClick={() => run("commit")}>
            <Icon name="upload" className="h-4 w-4" />
            {busy === "commit" ? "Importing…" : "Import now"}
          </button>
        </div>
        {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      </div>

      {result && (
        <div className="card p-5 space-y-4">
          <p className="font-heading font-bold text-lg">
            {result.committed
              ? "Import complete"
              : result.errorCount
                ? `${result.errorCount} row${result.errorCount > 1 ? "s" : ""} need fixing`
                : "Ready to import"}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Rows in file" value={result.rows} />
            <Stat label={result.committed ? "Created" : "Will create"} value={result.created} />
            <Stat label={result.committed ? "Updated" : "Will update"} value={result.updated} />
            {type === "retailers" && <Stat label="New areas" value={result.newAreas} />}
          </div>
          {result.tidy && (result.tidy.changeCount > 0 || result.tidy.duplicates.length > 0) && (
            <div className="space-y-2">
              {result.tidy.changeCount > 0 && (
                <details className="rounded-xl bg-ink/5 p-3 text-sm">
                  <summary className="cursor-pointer font-bold">
                    Tidied {result.tidy.changeCount} cell{result.tidy.changeCount === 1 ? "" : "s"}
                  </summary>
                  <ul className="mt-2 max-h-60 space-y-1 overflow-auto">
                    {result.tidy.changes.map((c, i) => (
                      <li key={i}>
                        <span className="font-bold">Row {c.row}</span> {c.field}: “{c.from}” → “{c.to}”
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {result.tidy.duplicates.length > 0 && (
                <div className="rounded-xl bg-[var(--kesar-tint)] p-3 text-sm">
                  <p className="font-bold">Possible duplicates (imported as they are; check them):</p>
                  <ul className="mt-1 space-y-1">
                    {result.tidy.duplicates.map((d, i) => (
                      <li key={i}>
                        <span className="font-bold">Row {d.row}</span> {d.name}: sounds like {d.kind === "sheet" ? d.with : `${d.with} in your catalogue`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {result.errorCount > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-bold">Fix these rows in your file, then check again:</p>
              <ul className="text-sm max-h-80 overflow-auto rounded-xl bg-ink/5 p-3 space-y-1">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    <span className="font-bold">Row {e.row}:</span> {e.message}
                  </li>
                ))}
              </ul>
              {result.errorCount > result.errors.length && (
                <p className="text-xs text-[var(--muted)]">Showing the first {result.errors.length}.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-ink/5 p-3">
      <p className="stat-num">{value.toLocaleString("en-IN")}</p>
      <p className="stat-lbl">{label}</p>
    </div>
  );
}
