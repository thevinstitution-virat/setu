// Runs in the browser before the app becomes interactive (Next.js convention).
// Uncaught errors and unhandled promise rejections → GlitchTip (vbiz-frontend).
// Errors caught by error boundaries are reported from app/error.tsx and
// app/global-error.tsx instead.
import { reportClientError } from "@/lib/error-report-client";

try {
  window.addEventListener("error", (event) => {
    reportClientError(event.error ?? event.message, { kind: "window.onerror" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportClientError(event.reason, { kind: "unhandledrejection" });
  });
} catch {
  // Monitoring must never break the app.
}
