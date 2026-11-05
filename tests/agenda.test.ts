/** Fase 10 · Agenda: zona horària, recurrències, coincidències, disponibilitat i recordatoris (dades inventades). */
import { describe, expect, it } from "vitest";
import { availabilityOf, describeRecurrence, dueReminders, expandEvent, findConflicts, localParts, suggestSlots, zonedToUtc, type AgendaEventRow, type Busy } from "@/core/agenda";

const ev = (p: Partial<AgendaEventRow>): AgendaEventRow => ({
  id: "e1", owner_id: "u1", title: "Visita de prova", kind: "visita", scope: "personal", starts_at: "2026-11-02T09:00:00.000Z", ends_at: "2026-11-02T10:00:00.000Z",
  all_day: false, status: "programada", priority: "normal", recurrence: null, exdates: [], reminders: [15], ...p,
});

describe("zona horària Europe/Madrid", () => {
  it("converteix hora local a UTC a l'hivern i a l'estiu", () => {
    expect(zonedToUtc(2026, 1, 15, 10, 0).toISOString()).toBe("2026-01-15T09:00:00.000Z"); // UTC+1
    expect(zonedToUtc(2026, 7, 15, 10, 0).toISOString()).toBe("2026-07-15T08:00:00.000Z"); // UTC+2
  });
  it("una reunió setmanal manté les 10:00 locals després del canvi d'hora", () => {
    const e = ev({ starts_at: zonedToUtc(2026, 10, 19, 10, 0).toISOString(), ends_at: zonedToUtc(2026, 10, 19, 11, 0).toISOString(), recurrence: { freq: "weekly" } });
    const occ = expandEvent(e, new Date("2026-10-18T00:00:00Z"), new Date("2026-11-05T00:00:00Z"));
    expect(occ).toHaveLength(3); // 19/10 (estiu), 26/10 i 2/11 (hivern)
    for (const o of occ) expect(localParts(o.start).h).toBe(10);
    expect(occ[0].start).toBe("2026-10-19T08:00:00.000Z");
    expect(occ[1].start).toBe("2026-10-26T09:00:00.000Z");
  });
});

describe("recurrències", () => {
  it("dies concrets de la setmana, fins a una data i amb excepcions", () => {
    const s = zonedToUtc(2026, 11, 2, 9, 0); // dilluns
    const e = ev({ starts_at: s.toISOString(), ends_at: new Date(s.getTime() + 1800e3).toISOString(), recurrence: { freq: "weekly", byweekday: [1, 3], until: "2026-11-13" }, exdates: [zonedToUtc(2026, 11, 4, 9, 0).toISOString()] });
    const occ = expandEvent(e, new Date("2026-11-01T00:00:00Z"), new Date("2026-12-01T00:00:00Z"));
    expect(occ.map((o) => o.start.slice(0, 10))).toEqual(["2026-11-02", "2026-11-09", "2026-11-11"]); // el 4 és una excepció
    expect(occ[0].occurrenceId).toContain("e1@");
  });
  it("mensual que salta els mesos sense aquell dia i límit de vegades", () => {
    const s = zonedToUtc(2026, 1, 31, 12, 0);
    const e = ev({ starts_at: s.toISOString(), ends_at: s.toISOString(), recurrence: { freq: "monthly", count: 3 } });
    const occ = expandEvent(e, new Date("2026-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z"));
    expect(occ.map((o) => o.start.slice(0, 7))).toEqual(["2026-01", "2026-03", "2026-05"]);
  });
  it("cada dia amb salt endavant (anys enrere) dóna només el rang demanat", () => {
    const e = ev({ starts_at: "2020-01-01T08:00:00.000Z", ends_at: "2020-01-01T08:30:00.000Z", recurrence: { freq: "daily" } });
    expect(expandEvent(e, new Date("2026-11-02T00:00:00Z"), new Date("2026-11-05T00:00:00Z"))).toHaveLength(3);
  });
  it("descripció en català", () => {
    expect(describeRecurrence({ freq: "weekly", byweekday: [1, 5], until: "2026-12-31" })).toBe("Cada setmana (dl, dv) fins al 31/12/2026");
    expect(describeRecurrence({ freq: "daily", interval: 2, count: 4 })).toBe("Cada 2 dies, 4 vegades");
  });
});

describe("coincidències i disponibilitat", () => {
  const busy: Busy[] = [{ userId: "u1", start: "2026-11-03T09:00:00.000Z", end: "2026-11-03T10:00:00.000Z", eventId: "x" }, { userId: "u2", start: "2026-11-03T11:00:00.000Z", end: "2026-11-03T12:00:00.000Z", eventId: "y", private: true }];
  it("detecta la coincidència d'una visita i ignora la que s'està editant", () => {
    const slot = { start: "2026-11-03T09:30:00.000Z", end: "2026-11-03T10:30:00.000Z" };
    expect(findConflicts(slot, ["u1", "u2"], busy)).toHaveLength(1);
    expect(findConflicts(slot, ["u1"], busy, "x")).toHaveLength(0);
  });
  it("distingeix disponible, ocupat i sense informació", () => {
    const known = new Set(["u1", "u2"]);
    expect(availabilityOf("u1", { start: "2026-11-03T09:15:00.000Z", end: "2026-11-03T09:45:00.000Z" }, busy, known)).toBe("ocupat");
    expect(availabilityOf("u2", { start: "2026-11-03T09:15:00.000Z", end: "2026-11-03T09:45:00.000Z" }, busy, known)).toBe("disponible");
    expect(availabilityOf("u3", { start: "2026-11-03T09:15:00.000Z", end: "2026-11-03T09:45:00.000Z" }, busy, known)).toBe("sense_informacio");
  });
  it("proposa franges lliures comunes en horari laboral", () => {
    const s = suggestSlots({ userIds: ["u1", "u2"], busy, known: new Set(["u1"]), durationMin: 60, fromIso: zonedToUtc(2026, 11, 3, 9, 0).toISOString(), max: 3 });
    expect(s).toHaveLength(3);
    expect(s[0].start).toBe(zonedToUtc(2026, 11, 3, 9, 0).toISOString()); // 9:00 local lliure
    expect(s.map((x) => x.start)).not.toContain(zonedToUtc(2026, 11, 3, 10, 0).toISOString()); // 10:00 local: u1 ocupat
    expect(s.every((x) => x.uncertain.includes("u2"))).toBe(true);
    expect(s.some((x) => findConflicts(x, ["u1", "u2"], busy).length)).toBe(false);
  });
});

describe("recordatoris", () => {
  it("genera l'avís a l'hora (15 min abans) per al propietari i els participants, sense els que rebutgen", () => {
    const e = ev({ reminders: [15, 1440], participants: [{ user_id: "u2", response: "accepta" }, { user_id: "u3", response: "rebutja" }] });
    const due = dueReminders([e], "2026-11-02T08:46:00.000Z");
    expect(due.map((d) => `${d.userId}:${d.minutes}`).sort()).toEqual(["u1:1440", "u1:15", "u2:1440", "u2:15"]);
    expect(new Set(due.map((d) => d.ruleKey)).size).toBe(2); // clau estable per ocurrència i antelació (sense duplicats)
    expect(dueReminders([e], "2026-11-02T08:40:00.000Z").filter((d) => d.minutes === 15)).toHaveLength(0); // encara no
    expect(dueReminders([{ ...e, status: "cancellada" }], "2026-11-02T08:50:00.000Z")).toHaveLength(0);
  });
});
