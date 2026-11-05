/**
 * Detector d'ambigüitats d'incrustació PostgREST (Fase 8.1).
 *
 * Origen: el Centre de Control i la Supervisió fallaven amb
 *   «Could not embed because more than one relationship was found for 'crm_contracts' and 'crm_supplies'»
 * perquè entre aquestes dues taules hi ha DUES claus foranes reals:
 *   - crm_contracts.supply_id           → crm_supplies  [crm_contracts_supply_id_fkey]
 *   - crm_supplies.current_contract_id  → crm_contracts [crm_supplies_current_contract_fk]
 *
 * Aquest test:
 *   1. aplica TOTES les migracions a un PostgreSQL real (PGlite) i llegeix les claus foranes de pg_constraint;
 *   2. escaneja el codi (app/ i src/) buscant `.from("taula")…select("…embed(…)…")`;
 *   3. per a cada incrustació, resol les relacions candidates tal com ho fa PostgREST (FK directes en
 *      qualsevol sentit, filtrades pel `!hint` si n'hi ha) i exigeix que n'hi hagi EXACTAMENT UNA.
 * Si algú afegeix una nova FK que fa ambigua una consulta existent, o una consulta nova sense `!hint`,
 * aquest test falla abans d'arribar a producció.
 */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { dir, setup } from "./harness";

type Fk = { conname: string; src: string; cols: string[]; tgt: string };
type Embed = { file: string; line: number; parent: string; child: string; hint: string | null; text: string };

const ROOT = path.resolve(__dirname, "../..");
let FKS: Fk[] = [];
let TABLES = new Set<string>();
let VIEWS = new Set<string>();

beforeAll(async () => {
  const files = fs.readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.includes("_down")).sort();
  const { db } = await setup(files);
  const r = await db.query<{ conname: string; src: string; cols: string; tgt: string }>(`
    select c.conname, s.relname as src, t.relname as tgt,
      (select string_agg(a.attname, ',' order by k.ord) from unnest(c.conkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) as cols
    from pg_constraint c
    join pg_class s on s.oid = c.conrelid join pg_namespace sn on sn.oid = s.relnamespace
    join pg_class t on t.oid = c.confrelid join pg_namespace tn on tn.oid = t.relnamespace
    where c.contype = 'f' and sn.nspname = 'public' and tn.nspname = 'public'`);
  FKS = r.rows.map((x) => ({ ...x, cols: x.cols.split(",") }));
  const rel = await db.query<{ relname: string; relkind: string }>(`select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','v','m','p')`);
  TABLES = new Set(rel.rows.filter((x) => x.relkind !== "v" && x.relkind !== "m").map((x) => x.relname));
  VIEWS = new Set(rel.rows.filter((x) => x.relkind === "v" || x.relkind === "m").map((x) => x.relname));
}, 180_000);

/* ------------------------------------------------------------------ resolució de relacions (com PostgREST) */

/** Relacions directes entre `parent` i `child` (molts-a-un i un-a-molts), filtrades pel hint. */
export function candidates(fks: Fk[], parent: string, child: string, hint: string | null): Fk[] {
  const all = fks.filter((f) => (f.src === parent && f.tgt === child) || (f.src === child && f.tgt === parent));
  if (!hint) return all;
  return all.filter((f) => f.conname === hint || (f.cols.length === 1 && f.cols[0] === hint));
}

/* ------------------------------------------------------------------ parser de `select` de PostgREST */

/** Retorna les incrustacions (nom de taula, hint) d'una cadena `select`, recursivament, amb la taula pare. */
export function parseEmbeds(parent: string, sel: string): { parent: string; child: string; hint: string | null }[] {
  const out: { parent: string; child: string; hint: string | null }[] = [];
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of sel) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (const raw of parts) {
    const p = raw.trim();
    const open = p.indexOf("(");
    if (open < 0 || !p.endsWith(")")) continue; // columna simple (o funció d'agregat com count())
    let head = p.slice(0, open).trim();
    const inner = p.slice(open + 1, -1);
    if (head.includes(":")) head = head.slice(head.lastIndexOf(":") + 1); // àlies
    const [name, ...mods] = head.split("!").map((s) => s.trim());
    if (!name || /^(count|sum|avg|min|max)$/.test(name)) continue;
    const hint = mods.find((m) => m !== "inner" && m !== "left") ?? null;
    out.push({ parent, child: name, hint });
    out.push(...parseEmbeds(name, inner));
  }
  return out;
}

function walk(d: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** Totes les incrustacions del codi de l'aplicació. */
export function scanEmbeds(): Embed[] {
  const out: Embed[] = [];
  const files = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "src"))];
  const re = /\.from\(\s*["'`]([a-z_0-9]+)["'`]\s*\)((?:(?!\.from\()[\s\S]){0,400}?)\.select\(\s*(["'`])((?:(?!\3)[\s\S])*)\3/g;
  for (const f of files) {
    const txt = fs.readFileSync(f, "utf8");
    for (const m of txt.matchAll(re)) {
      const [, table, gap, , sel] = m;
      if (gap.includes(";") || sel.includes("${")) continue;
      const line = txt.slice(0, m.index).split("\n").length;
      for (const e of parseEmbeds(table, sel)) out.push({ ...e, file: path.relative(ROOT, f), line, text: sel });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ proves */

describe("Incrustacions PostgREST sense ambigüitats (Fase 8.1)", () => {
  it("l'esquema real té les dues FK entre crm_contracts i crm_supplies (no s'han eliminat)", () => {
    const names = candidates(FKS, "crm_contracts", "crm_supplies", null).map((f) => f.conname).sort();
    expect(names).toEqual(["crm_contracts_supply_id_fkey", "crm_supplies_current_contract_fk"]);
  });

  it("el detector reconeix la consulta original com a ambigua i la corregida com a única", () => {
    const before = parseEmbeds("crm_contracts", "id,status,crm_supplies(annual_kwh)");
    expect(candidates(FKS, before[0].parent, before[0].child, before[0].hint)).toHaveLength(2);
    const after = parseEmbeds("crm_contracts", "id,status,crm_supplies!crm_contracts_supply_id_fkey(annual_kwh)");
    const c = candidates(FKS, after[0].parent, after[0].child, after[0].hint);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ src: "crm_contracts", cols: ["supply_id"], tgt: "crm_supplies" });
  });

  it("el parser entén àlies, !inner i incrustacions niuades", () => {
    expect(parseEmbeds("a", "id,x:crm_clients!inner(name,crm_supplies!crm_supplies_client_id_fkey(cups))")).toEqual([
      { parent: "a", child: "crm_clients", hint: null },
      { parent: "crm_clients", child: "crm_supplies", hint: "crm_supplies_client_id_fkey" },
    ]);
  });

  it("el codi conté incrustacions per analitzar (l'escàner funciona)", () => {
    const e = scanEmbeds();
    expect(e.length).toBeGreaterThan(20);
    expect(e.some((x) => x.file.endsWith("control.ts") && x.child === "crm_supplies")).toBe(true);
  });

  it("CAP incrustació del codi és ambigua ni apunta a una relació inexistent", () => {
    const problems: string[] = [];
    for (const e of scanEmbeds()) {
      if (VIEWS.has(e.parent) || VIEWS.has(e.child)) continue; // les vistes hereten relacions; fora d'abast
      if (!TABLES.has(e.parent) || !TABLES.has(e.child)) { problems.push(`${e.file}:${e.line} taula desconeguda ${e.parent} → ${e.child}`); continue; }
      const c = candidates(FKS, e.parent, e.child, e.hint);
      if (c.length !== 1) problems.push(`${e.file}:${e.line} ${e.parent} → ${e.child}${e.hint ? "!" + e.hint : ""}: ${c.length} relacions [${candidates(FKS, e.parent, e.child, null).map((f) => f.conname).join(", ")}]`);
    }
    expect(problems).toEqual([]);
  });

  it("totes les incrustacions crm_contracts → crm_supplies fan servir el subministrament DEL CONTRACTE", () => {
    const bad = scanEmbeds().filter((e) => e.parent === "crm_contracts" && e.child === "crm_supplies" && e.hint !== "crm_contracts_supply_id_fkey");
    expect(bad.map((e) => `${e.file}:${e.line}`)).toEqual([]);
  });
});
