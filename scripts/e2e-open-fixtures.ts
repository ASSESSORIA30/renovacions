/** Genera les respostes del lector Open per a les proves Playwright a partir dels PDF reals (tests/fixtures/endesa). */
import { readFileSync, writeFileSync } from "node:fs";
import { pdfText } from "../src/server/doc-text";
import { parseEndesaOpen } from "../src/comparator/endesa-open";

(async () => {
  for (const [f, out] of [["20261030_3.0TD_OPEN_07_V1.pdf", "open-3.0TD.json"], ["20261030_6.1TD_OPEN_07_V1.pdf", "open-6.1TD.json"]]) {
    const t = await pdfText(new Uint8Array(readFileSync(`tests/fixtures/endesa/${f}`)));
    writeFileSync(`e2e/${out}`, JSON.stringify(parseEndesaOpen(t.pages, f)));
  }
  console.log("fixtures Open generades");
})();
