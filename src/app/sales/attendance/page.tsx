import MyAttendance from "@/components/field/MyAttendance";

/** Sales agent: today's check in / out, the month calendar and leave. */
export default function SalesAttendancePage() {
  return (
    <div className="space-y-5">
      <div>
        <p className="page-kick">Your days</p>
        <h1 className="page-title">Attendance</h1>
      </div>
      <MyAttendance />
    </div>
  );
}
