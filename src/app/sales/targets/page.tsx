import TargetsCard from "@/components/field/TargetsCard";

/** Sales agent: this month's targets, incentive and the leaderboard. */
export default function SalesTargetsPage() {
  return (
    <div className="space-y-5">
      <div>
        <p className="page-kick">This month</p>
        <h1 className="page-title">Targets</h1>
      </div>
      <TargetsCard />
    </div>
  );
}
