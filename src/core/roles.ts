/**
 * Roles and permissions.
 *  - admin, cap_administrativa, administrativa: full access to every contract, offers and templates.
 *  - admin: also manages users and integrations.
 *  - admin, cap_administrativa: can assign tasks to anyone from "El teu pla d'avui".
 *  - comercial: only contracts where they are the responsible person (ADMIN GESTIONO = code).
 *  - colaborador: only contracts captured by them (column admin = code, "COL." prefix ignored)
 *    or whose CRM owner ("Usuario propietario") is their email.
 */
import type { Role, SourceContract, User } from "./types";

export const ROLES: Role[] = ["admin", "cap_administrativa", "cap_equip", "administrativa", "comercial", "colaborador"];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Direcció",
  cap_administrativa: "Cap administrativa",
  cap_equip: "Cap d'equip",
  administrativa: "Administrativa",
  comercial: "Comercial",
  colaborador: "Col·laborador",
};

export const isStaff = (r: Role) => r === "admin" || r === "cap_administrativa" || r === "administrativa";
export const canManageUsers = (r: Role) => r === "admin";
export const canAssignTasks = (r: Role) => r === "admin" || r === "cap_administrativa";
export const needsCode = (r: Role) => r === "comercial";

/** Strip the "COL." prefix used for collaborators in the daily log. */
export const collabKey = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/^COL\.?\s*/, "").trim();

export function canSee(me: Pick<User, "role" | "code" | "email">, c: Pick<SourceContract, "comercial" | "captador" | "colaborador">) {
  if (isStaff(me.role)) return true;
  if (me.role === "comercial") return !!me.code && c.comercial === me.code;
  if (me.role === "colaborador") {
    const byCode = !!me.code && !!c.captador && collabKey(c.captador) === collabKey(me.code);
    const byEmail = !!me.email && !!c.colaborador && c.colaborador.toLowerCase() === me.email.toLowerCase();
    return byCode || byEmail;
  }
  return false;
}

/** Identifier stored in tasks.assignee for a user (code if they have one, otherwise email). */
export const assigneeKey = (u: Pick<User, "code" | "email">) => u.code || u.email.toLowerCase();
