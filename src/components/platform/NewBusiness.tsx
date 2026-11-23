"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { Field, errText, send } from "@/components/admin/AdminKit";
import { AdminFields, EMPTY_ADMIN, LinkCard } from "./TenantAdmins";
import { ErrLine, useIsOwner } from "./kit";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);

/** Super-admin: make a business with its owner admin, on a free trial; shows the owner's set-password link. */
export default function NewBusiness({ onMade }: { onMade: () => void }) {
  const owner = useIsOwner();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [admin, setAdmin] = useState(EMPTY_ADMIN);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{
    id: string;
    name: string;
    who: string;
    url: string;
    emailed: boolean;
  } | null>(null);

  if (!owner) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await send<{
        tenant: { id: string; name: string };
        url: string;
        emailed: boolean;
      }>("/api/platform/tenants", "POST", { name, slug, admin });
      setMade({
        id: r.tenant.id,
        name: r.tenant.name,
        who: admin.name.trim(),
        url: r.url,
        emailed: r.emailed,
      });
      setOpen(false);
      setName("");
      setSlug("");
      setSlugTouched(false);
      setAdmin(EMPTY_ADMIN);
      onMade();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {made && (
        <div className="space-y-2">
          <p className="text-sm">
            <Link href={`/platform/tenants/${made.id}`} className="font-semibold underline">
              {made.name}
            </Link>{" "}
            is ready on a free trial. Its address starts working within a minute.
          </p>
          <LinkCard who={`${made.who} (owner)`} url={made.url} emailed={made.emailed} onDone={() => setMade(null)} />
        </div>
      )}
      {!open ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
          <Icon name="plus" className="h-4 w-4" /> Add business
        </button>
      ) : (
        <form onSubmit={submit} className="card p-4 sm:p-5 space-y-4">
          <p className="font-heading font-bold">New business</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Business name">
              <input
                className="input"
                value={name}
                maxLength={120}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
              />
            </Field>
            <Field label="Address" hint={slug ? `${slug}.${typeof window === "undefined" ? "" : window.location.host.replace(/^platform\./, "")}` : "Lower-case letters, numbers and dashes."}>
              <input
                className="input font-mono"
                autoCapitalize="none"
                value={slug}
                maxLength={30}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                }}
              />
            </Field>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">Owner (first admin)</p>
            <AdminFields value={admin} onChange={setAdmin} />
          </div>
          <ErrLine text={error} />
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !name.trim() || !slug || !admin.name.trim() || !admin.loginId.trim()}>
              {busy ? "Making…" : "Make business"}
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
