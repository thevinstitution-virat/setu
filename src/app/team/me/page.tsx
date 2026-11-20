import { redirect } from "next/navigation";
import { pageSession } from "@/lib/guard";
import WorkspaceSwitcher from "@/components/field/WorkspaceSwitcher";
import MyAttendance from "@/components/field/MyAttendance";

/** A supervisor's own attendance and leave (admins do not check in). */
export default async function MyAttendancePage() {
  const session = await pageSession();
  if (!session) redirect("/login");
  if (session.role !== "SUPERVISOR") redirect("/team");

  return (
    <div className="space-y-5">
      <WorkspaceSwitcher />
      <div>
        <p className="page-kick">Your days</p>
        <h1 className="page-title">My attendance</h1>
      </div>
      <MyAttendance />
    </div>
  );
}
