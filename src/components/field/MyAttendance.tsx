"use client";

import PunchCard from "./PunchCard";
import AttendanceMonth from "./AttendanceMonth";
import LeaveCard from "./LeaveCard";

/** The person's own attendance: today's punch, the month calendar and leave. Used by sales, delivery and supervisors. */
export default function MyAttendance() {
  return (
    <div className="space-y-4">
      <PunchCard />
      <AttendanceMonth />
      <LeaveCard />
    </div>
  );
}
