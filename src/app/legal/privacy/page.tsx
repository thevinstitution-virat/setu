import type { Metadata } from "next";
import LegalDoc from "@/components/legal/LegalDoc";
import { APP_NAME } from "@/lib/brand";
import { DATA_WE_KEEP, PROCESSORS, operator } from "@/lib/legal";
import { getTenant } from "@/lib/tenant";

export const metadata: Metadata = { title: `Privacy notice — ${APP_NAME}` };

/** Draft privacy notice (DPDP Act 2023). The table is facts from the data model (src/lib/legal.ts). */
export default async function PrivacyPage() {
  const op = operator();
  const tenant = await getTenant();
  const who = tenant ? tenant.name : "the business that invited you";
  return (
    <LegalDoc title="Privacy notice">
      <p>
        This notice says what personal data {APP_NAME} keeps, why, and what you can ask for. {tenant ? `${tenant.name}` : "Each business"} decides
        why its shops&rsquo; and staff&rsquo;s data is used (under the Digital Personal Data Protection Act, 2023 it is the data fiduciary);{" "}
        {op.name} runs the app for it. For your own business account, {op.name} is the data fiduciary.
      </p>

      <h2>What is kept and why</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b border-[var(--line)]">
              <th className="py-2 pr-3">What</th>
              <th className="py-2 pr-3">About whom</th>
              <th className="py-2">Why</th>
            </tr>
          </thead>
          <tbody>
            {DATA_WE_KEEP.map((d) => (
              <tr key={d.what} className="border-b border-[var(--line)] align-top">
                <td className="py-2 pr-3">{d.what}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{d.who}</td>
                <td className="py-2">{d.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>Nothing is sold, and nothing is used for advertising.</p>

      <h2>Position and selfies</h2>
      <ul>
        <li>Field staff&rsquo;s position is recorded when they start and end the day, and with a delivery or a visit. Recording between those times happens only if the business turns it on and only while on duty.</li>
        <li>Selfies are taken only at check-in and check-out, for attendance.</li>
      </ul>

      <h2>Who else handles it</h2>
      <ul>
        {PROCESSORS.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>

      <h2>How long it is kept</h2>
      <ul>
        <li>As long as the business&rsquo;s account is open. The business keeps invoices and the ledger for 8 years, as GST law asks.</li>
        <li>When a business closes its account, it gets a full download, and everything is deleted 7 days later. Only our own bills to the business stay with us.</li>
        <li>Sign-in codes and sign-in tries are deleted within a day.</li>
      </ul>

      <h2>Your rights</h2>
      <ul>
        <li>Ask {who} to see, correct or delete your data, or to stop messages. You can withdraw consent at any time; past use stays lawful.</li>
        <li>
          Complaints: {op.grievance ? <>our grievance officer, {op.grievance}</> : "our grievance officer (contact to be added)"}. If not resolved, you can approach the Data Protection Board of India.
        </li>
        <li>If your data is ever exposed, we tell the affected business and the Board as the law asks.</li>
      </ul>
    </LegalDoc>
  );
}
