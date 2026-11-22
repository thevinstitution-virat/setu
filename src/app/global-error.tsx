"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/error-report-client";

/**
 * Last-resort page when the root layout itself fails. It replaces the whole
 * document, so it brings its own <html>, <body> and inline styles (no global
 * CSS, fonts or language setting reach it) and shows both languages.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : "";

  useEffect(() => {
    if (!digest) reportClientError(error, { kind: "global-error" });
  }, [error, digest]);

  const button: React.CSSProperties = {
    font: "inherit",
    fontWeight: 600,
    padding: "12px 20px",
    borderRadius: 12,
    border: "1px solid #DB5C17",
    cursor: "pointer",
    textDecoration: "none",
  };

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#F7F5F0", color: "#0F2A2A", fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans Devanagari', sans-serif" }}>
        <title>Something went wrong · VBiz Pro</title>
        <div style={{ maxWidth: 420, margin: 16, padding: 28, background: "#fff", borderRadius: 20, boxShadow: "0 10px 30px rgba(15,42,42,.08)", textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 4px", color: "#4b5b5b" }}>The app didn&apos;t load properly. Please try again.</p>
          <p style={{ margin: 0, color: "#4b5b5b" }}>ऐप ठीक से नहीं खुला। कृपया फिर से कोशिश करें।</p>
          <div style={{ marginTop: 22, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => retry()} style={{ ...button, background: "#DB5C17", color: "#fff" }}>
              Try again · फिर से
            </button>
            {/* A full page load on purpose: the app itself failed to start. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ ...button, background: "#fff", color: "#DB5C17" }}>
              Home · होम
            </a>
          </div>
          {digest && <p style={{ marginTop: 18, fontSize: 12, color: "#6b7280" }}>Reference: <span style={{ fontFamily: "monospace" }}>{digest}</span></p>}
        </div>
      </body>
    </html>
  );
}
