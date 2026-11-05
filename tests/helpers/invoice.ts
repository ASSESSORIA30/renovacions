/** Factura de prova (estructura del lector existent) per a la captació. */
import { emptyInvoice, type InvoiceData } from "@/comparator/invoice";

export const CUPS_OK = "ES0031405000000001ZV";
export const CUPS_OK2 = "ES0021000000000002RE";

const f = <T>(value: T, page = 1, confirm = false, method: "text" | "ia" | "manual" = "text") => ({ value, page, confirm, method });

/** Factura 2.0TD completa de 31 dies (preus sense impostos). */
export function invoice20(p: Partial<Record<keyof InvoiceData, unknown>> = {}): InvoiceData {
  const d = emptyInvoice();
  Object.assign(d, {
    holder: f("Forn Sant Jordi SL"), taxId: f("12345678Z"), address: f("C/ Major 1, Lleida"), cups: f(CUPS_OK), accessTariff: f("2.0TD"), retailer: f("Endesa"), energyType: f("luz"),
    periodFrom: f("2026-09-01"), periodTo: f("2026-10-02"), days: f(31),
    kwh: [f(100), f(80), f(120), ...Array.from({ length: 3 }, () => f(null))],
    kw: [f(4.6), f(4.6), ...Array.from({ length: 4 }, () => f(null))],
    energyPrice: [f(0.2), f(0.15), f(0.1), ...Array.from({ length: 3 }, () => f(null))],
    powerPrice: [f(0.1), f(0.05), ...Array.from({ length: 4 }, () => f(null))],
    vatEur: f(14.5), total: f(83.6), ieeEur: f(3.1),
  });
  return Object.assign(d, p) as InvoiceData;
}
export const field = f;
