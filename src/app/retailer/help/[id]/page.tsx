import { STATUS_TEXT } from "@/lib/tickets";
import TicketThread from "./TicketThread";

/** One complaint and its messages (notification links point here). */
export default async function RetailerTicket({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TicketThread id={id} statusText={STATUS_TEXT} />;
}
