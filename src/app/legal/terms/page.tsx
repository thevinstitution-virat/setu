import type { Metadata } from "next";
import LegalDoc from "@/components/legal/LegalDoc";
import { APP_NAME } from "@/lib/brand";
import { operator } from "@/lib/legal";
import { getTenant } from "@/lib/tenant";

export const metadata: Metadata = { title: `Terms of service — ${APP_NAME}` };

/** Draft terms (owner's final text replaces the wording; see src/lib/legal.ts). */
export default async function TermsPage() {
  const op = operator();
  const tenant = await getTenant();
  return (
    <LegalDoc title="Terms of service">
      <p>
        {APP_NAME} is run by {op.name}
        {op.address ? `, ${op.address}` : ""}. It lets a distribution business take orders, deliver, bill and collect money from
        the shops it supplies.{tenant ? ` This address belongs to ${tenant.name}, which uses ${APP_NAME} for its own shops and staff.` : ""}
      </p>

      <h2>Who these terms are for</h2>
      <ul>
        <li>A business that opens an account (&ldquo;the business&rdquo;) agrees to these terms with {op.name}.</li>
        <li>Shops and staff use the app on behalf of, and under the rules of, the business that invited them. Questions about an order, a price or a balance go to that business.</li>
      </ul>

      <h2>The business&rsquo;s duties</h2>
      <ul>
        <li>Keep its sign-ins private and give staff only the roles they need.</li>
        <li>Enter true prices, taxes and balances. Invoices and GST returns made from the app are the business&rsquo;s own responsibility.</li>
        <li>Tell its shops and staff what data it keeps about them and why (the privacy notice helps), and turn on position tracking only after telling staff.</li>
        <li>Not use the app for anything unlawful, and not send messages people did not agree to receive.</li>
      </ul>

      <h2>Trial, plans and payment</h2>
      <ul>
        <li>A new business starts on a free trial. After it, the chosen plan is billed monthly with GST, as shown under Billing.</li>
        <li>Unpaid bills past the due date can pause the account; nothing is deleted while it is paused.</li>
      </ul>

      <h2>Your data</h2>
      <ul>
        <li>The business owns its data. It can download all of it at any time, and close the account: it gets a final download and everything is deleted 7 days later. Keeping invoices for the 8 years GST law asks is the business&rsquo;s duty.</li>
        <li>How we handle personal data is in the privacy notice.</li>
      </ul>

      <h2>The service</h2>
      <ul>
        <li>We work to keep the service running and backed up, but it is provided as it is, and can be down for upkeep. Suggestions made by the app (including AI features) are help, not advice; staff decide.</li>
        <li>Our liability is limited to the fees the business paid in the last three months.</li>
        <li>We may change these terms; we tell businesses at least 30 days before a change that affects them.</li>
      </ul>

      <h2>Law</h2>
      <p>These terms follow the laws of India.</p>
    </LegalDoc>
  );
}
