import Icon from "@/components/Icon";

/** A tampered, old or foreign share link (the page calls notFound(), so the status is 404). */
export default function InvalidShareLink() {
  return (
    <main className="w-full max-w-md mx-auto px-4 py-16">
      <div className="card p-6 text-center space-y-3">
        <span className="icon-tile mx-auto bg-[var(--accent-tint)] text-[var(--accent-text)]">
          <Icon name="alert" />
        </span>
        <h1 className="page-title !text-xl">This link is not valid</h1>
        <p className="text-sm text-[var(--ink-2)]">
          The invoice link may be incomplete or changed. Please ask the business to send it again.
        </p>
      </div>
    </main>
  );
}
