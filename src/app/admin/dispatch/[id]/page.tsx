import TripView from "@/components/dispatch/TripView";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TripView id={id} />;
}
