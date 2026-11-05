import { describe, it, expect } from "vitest";
import { annualFromEasHistory, easNumber } from "../../src/energy/lib/sips-consumption";

const expected = [1629, 1958.168, 1377.043, 1324, 750, 5842.789];
const sample = Array.from({ length: 12 }, (_, i) => {
  const s = new Date(Date.UTC(2025, i + 6, 1));
  const e = new Date(Date.UTC(2025, i + 7, 0));
  return Object.fromEntries([
    ["FechaInicio", s.toISOString().slice(0, 10)],
    ["FechaFin", e.toISOString().slice(0, 10)],
    ...expected.map((v, j) => [`E.A. P${j + 1} (kWh)`, (v / 12).toFixed(6)]),
  ]);
});

describe("historical EAS annual electricity", () => {
  it("matches the supplied 3.0TD fixture for July 2025 - June 2026", () => {
    const result = annualFromEasHistory(sample, 6, "12.881");
    expect(result.status).toBe("complete");
    expect(result.from).toBe("2025-07-01");
    expect(result.to).toBe("2026-06-30");
    expect(result.periods).toEqual(expected);
    expect(result.total).toBe(12881);
  });
  it("deduplicates exact duplicate rows", () => expect(annualFromEasHistory([sample[0], ...sample], 6, null).status).toBe("complete"));
  it("rejects gaps", () => expect(annualFromEasHistory(sample.slice(1), 6, null).status).toBe("incomplete"));
  it("rejects nonidentical overlaps", () => expect(annualFromEasHistory([...sample, { ...sample[0], FechaFin: "2025-07-02" }], 6, null).status).toBe("incomplete"));
  it("parses Spanish decimal commas", () => expect(easNumber("1.958,168")).toBe(1958.168));
});
