/**
 * Requisits de seguretat de les contrasenyes del CRM (es validen al navegador i al servidor).
 * Les contrasenyes mai es desen ni es registren: només les gestiona Supabase Auth (xifrades amb bcrypt).
 */
const COMMON = ["123456", "password", "contrasenya", "contraseña", "qwerty", "assessoria", "renovacio", "energia", "12345678", "111111", "abc123", "iloveyou", "admin"];

export interface PasswordCheck { ok: boolean; errors: string[]; score: 0 | 1 | 2 | 3 | 4 }

export function checkPassword(pw: string, ctx: { email?: string | null; name?: string | null; current?: string | null } = {}): PasswordCheck {
  const errors: string[] = [];
  const p = pw ?? "";
  if (p.length < 10) errors.push("Ha de tenir com a mínim 10 caràcters.");
  if (p.length > 72) errors.push("Pot tenir com a màxim 72 caràcters.");
  if (!/[a-zà-ÿ]/i.test(p)) errors.push("Ha de contenir alguna lletra.");
  if (!/\d/.test(p)) errors.push("Ha de contenir algun número.");
  if (/^\s|\s$/.test(p)) errors.push("No pot començar ni acabar amb un espai.");
  const low = p.toLowerCase();
  const local = (ctx.email ?? "").split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && low.includes(local)) errors.push("No pot contenir el teu usuari de correu.");
  const first = (ctx.name ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (first.length >= 4 && low.includes(first)) errors.push("No pot contenir el teu nom.");
  if (COMMON.some((c) => low.includes(c))) errors.push("És massa previsible (conté una paraula o seqüència habitual).");
  if (ctx.current && p === ctx.current) errors.push("Ha de ser diferent de l'actual.");
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  const score = (errors.length ? Math.min(1, classes - 1) : Math.min(4, (p.length >= 14 ? 2 : 1) + (classes >= 3 ? 1 : 0) + (classes === 4 ? 1 : 0))) as PasswordCheck["score"];
  return { ok: !errors.length, errors, score: Math.max(0, score) as PasswordCheck["score"] };
}
export const SCORE_LABEL = ["Molt feble", "Feble", "Acceptable", "Bona", "Molt bona"] as const;
