import type { Metadata } from "next";
import SimPay from "./SimPay";

/**
 * Practice payment page (the "simulator" gateway). Open without sign-in, like
 * a real payment link: a tester pays here and no real money moves.
 */

export const metadata: Metadata = {
  title: "Practice payment",
  robots: { index: false, follow: false },
};

export default async function SimPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="w-full max-w-md mx-auto px-4 py-6">
      <SimPay id={id} />
    </main>
  );
}
