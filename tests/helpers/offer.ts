import { emptySheet, type OfferVersion } from "@/comparator/types";

export function blankOfferForTest(p: Partial<OfferVersion>): OfferVersion {
  return {
    ...emptySheet(),
    id: "x", supplierId: "s", supplierName: "S", productId: "p", productName: "P", version: 1,
    energyType: "luz", accessTariff: "2.0TD", segments: ["residencial"],
    permanenceMonths: null, penalty: null, durationMonths: null, priceGuaranteeMonths: null,
    eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null },
    validFrom: null, validTo: null, source: "test", publishedAt: null, status: "activa", conditions: null, origin: "manual",
    ...p,
  };
}
