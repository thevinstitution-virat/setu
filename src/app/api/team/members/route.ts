import { fieldRead } from "@/lib/field-api";
import { fieldMembers, teamScope } from "@/lib/field";

/** GET → active field staff in my team (admins: all), for pickers. Excludes nobody's private data beyond name, role and phone. */
export async function GET() {
  return fieldRead("team.supervise", async (ctx, who) => {
    const members = await fieldMembers(ctx.tx, await teamScope(ctx.tx, who));
    return { members: members.map((m) => ({ id: m.id, name: m.name, role: m.role, phone: m.phone, supervisorId: m.supervisorId, salesAgentId: m.salesAgentProfile?.id ?? null })) };
  });
}
