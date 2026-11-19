import { Suspense, type ReactNode } from "react";
import ReportNav from "@/components/reports/ReportNav";

export default function ReportsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <p className="page-kick">Owner&apos;s reports</p>
          <h1 className="page-title">How the business is doing</h1>
          <p className="page-sub">Sales, money, stock, delivery, team, shops, schemes, routes and returns, compared with the period before.</p>
        </div>
      </div>
      <Suspense fallback={<div className="h-20" />}>
        <ReportNav />
      </Suspense>
      {children}
    </div>
  );
}
