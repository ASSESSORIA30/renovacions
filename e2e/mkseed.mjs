// Dades INVENTADES per a les proves de navegació (cap client, CUPS ni NIF real). Escriu e2e/seed.e2e.json.
import { writeFileSync } from "node:fs";
const base = (i, extra = {}) => ({ id: `demo-${i}`, cups: `ES000000000000${String(i).padStart(4, "0")}XX${i === 1 ? "0F" : ""}`, cif: `B0000000${i}`, cliente: `CLIENT FICTICI ${i} SL`, direccion: "Carrer Inventat 1", poblacion: "Lleida", provincia: "Lleida", cp: "25001", telefono: "600000000", email: `client${i}@exemple.test`, tipo: "luz", comercializadora: "Nufri", tarifa: "3.0TD", consumoAnual: 28930, comercial: "Comercial Demo", vencimiento: "2026-12-01", status: "pendiente", source: "demo", contratosPrevios: 0, registrosDiarios: 0, renovacionTacita: false, ...extra });
const report = { filasCRM: 30, filasDiario: 0, contratosUnicos: 30, conDiario: 0, sinCups: 0, fechasEstimadas: 0, tacitas: 0, sinTelefono: 0, sinEmail: 0, sinConsumo: 0, mappingCRM: {}, mappingDiario: {} };
const contracts = Array.from({ length: 30 }, (_, k) => base(k + 1, k % 3 === 2 ? { comercializadora: "Naturgy" } : {}));
writeFileSync(new URL("./seed.e2e.json", import.meta.url), JSON.stringify({ importedAt: "2026-11-01T00:00:00Z", today: "2026-11-02", report, contracts }));
console.log("seed:", contracts.length, "contractes inventats");
