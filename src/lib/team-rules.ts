import type { Role } from "@/generated/prisma/client";

/**
 * Who may change whom on the Team page (pure, so it's tested on its own).
 *
 *  - Any admin adds and manages field staff (sales, delivery, supervisors).
 *  - Only the business owner, or VBiz Pro support working inside the
 *    business, adds, switches off or resets other admins.
 *  - Nobody inside the business changes the owner's login (the owner looks
 *    after their own sign-in under Security; the platform console can reset it).
 *  - The hidden support login is never touched from here.
 */
export type TeamActor = {
  userId: string;
  isOwner: boolean;
  isSupport: boolean;
};
export type TeamTarget = {
  id: string;
  role: Role;
  isOwner: boolean;
  isSupport: boolean;
};
export type TeamAction = "edit" | "deactivate" | "activate" | "password" | "resetMfa" | "signOut";

export const managesAdmins = (a: TeamActor) => a.isOwner || a.isSupport;

/** Why the actor may not add someone with this role, or null. */
export function addProblem(actor: TeamActor, role: Role): string | null {
  if (role === "ADMIN" && !managesAdmins(actor)) return "Only the business owner can add admins";
  return null;
}

/** Why the actor may not do this to the target, or null. */
export function changeProblem(actor: TeamActor, target: TeamTarget, action: TeamAction): string | null {
  if (target.isSupport) return "That login belongs to VBiz Pro support";
  const self = actor.userId === target.id;
  if (self && action === "deactivate") return "You can't deactivate yourself";
  if (target.isOwner) {
    if (self) return action === "edit" || action === "signOut" ? null : "Change your own sign-in under Sign-in and security";
    return "The business owner's login can't be changed by other admins";
  }
  if (target.role === "ADMIN" && !self && !managesAdmins(actor)) return "Only the business owner can change other admins";
  return null;
}
