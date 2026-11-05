# Comparatives IA — comparador energètic intel·ligent

Mòdul integrat a ASSESSORIA 3.0 (mateixa autenticació Supabase, mateix menú, sense iframes).
Menú **Comparatives IA**: Nova comparativa · Comparatives · Catàleg de tarifes · Comparativa massiva · Comissions (només admin).
També s'obre des de la fitxa del contracte (botó «Comparativa IA (3 alternatives)»).

## 1. Modes d'entrada
| Mode | Origen | Què calcula |
|---|---|---|
| A | Factura PDF / escaneig / JPG / PNG / HEIC / TIFF | Extracció (text local + IA opcional) → pantalla de revisió amb pàgina d'origen de cada camp i camps «a confirmar» |
| B | Només CUPS (SIPS) | Consums i potències reals; **cost actual = null**, sense estalvis (no s'inventen preus) |
| C | CUPS + preus actuals manuals | Comparativa completa amb estalvi |
| D | Tot manual | Comparativa completa |

Les dades desconegudes es desen com a `null`. Les factures es guarden al bucket privat `invoices/<uid>/…` i es purguen als 90 dies.

## 2. Catàleg de tarifes
- Formulari manual amb tots els camps (P1–P6 energia i potència, unitats, impostos inclosos o no, SAS, permanència, vigència, descomptes, condicions, elegibilitat).
- Versions **immutables**: una versió usada en una comparativa no es pot modificar (trigger `protect_used_tariff`); «Duplicar com a nova versió». Estats: esborrany / activa / caducada / arxivada. El cron caduca automàticament les vençudes.
- Importador Excel/CSV en 10 passos: fitxer → full → fila de capçalera → mapatge automàtic → plantilla per comercialitzadora → validació → vista prèvia (nova / modificada / sense canvis / rebutjada / revisió / duplicada) → simulació (dry run) → importació → informe. Tot entra com a **esborrany**; res incomplet s'activa sol.
- **Lector amb IA** (pestanya «Llegir fitxer amb IA»): s'arrossega el fitxer que envia la comercialitzadora (PDF, Excel, CSV o imatge) i la IA en treu totes les tarifes (una per producte i peatge). Es mostren per revisar amb l'estat de cada una (nova, preus nous, revisar, incompleta, sense canvis, duplicada), la pàgina d'origen i els avisos; es poden corregir amb «Revisa» abans de desar. Tot entra com a esborrany (les completes es poden activar si es marca expressament). Els preus passen pels mateixos controls de rang i d'unitats que l'alta manual; la IA no pot activar res. El fitxer no es conserva després de llegir-lo. Només cal `ANTHROPIC_API_KEY` (els documents de tarifes no porten dades personals).
- **Filtres d'ofertes** (catàleg, selecció d'ofertes de la comparativa i Ofertes del CRM): cerca, comercialitzadora, tarifa d'accés, llum/gas, tipus de preu, estat, segment, permanència, vigència (vigents, caduquen en 30 dies, caducades, sense data), origen i ordenació (comercialitzadora, preu d'energia, preu de potència, caducitat, publicació). Es recorden al navegador de cada usuari.
- Connectors (`TariffProvider`): només APIs oficials o fitxers autoritzats configurats a `TARIFF_CONNECTORS`. Cap scraping.

## 3. Motor de càlcul (determinista)
`src/comparator/engine.ts` amb aritmètica decimal (decimal.js-light). Cada línia s'arrodoneix a cèntims (ROUND_HALF_UP) i el total és la suma de línies arrodonides, de manera que pantalla i PDF quadren al cèntim.
- Potència normalitzada a €/kW·dia; conversió de preus amb impostos inclosos.
- Impost elèctric 5,11269632 % (mínim 1 €/MWh); impost d'hidrocarburs gas 0,00234 €/kWh.
- IVA / IGIC / IPSI segons territori; lloguer d'equips; SAS inclòs / exclòs / variable; descomptes.
- Desglossament auditable per línia (fórmula + import) i versió del motor (`ENGINE_VERSION`).
- La IA **no** intervé en cap càlcul.

## 4. Recomanació
Híbrida: regles (rànquing amb pesos preu 0,7 / estabilitat 0,1 / permanència 0,1 / variabilitat 0,1, configurables per admin) + text explicatiu de la IA sobre dades sense dades personals. **La comissió no entra al rànquing.** El text es pot editar; es desa l'historial de canvis.

## 5. Snapshot i traçabilitat
Cada comparativa emesa desa una còpia congelada de: entrades, versions d'oferta usades, impostos, pesos i resultat. Una comparativa emesa no es pot modificar (trigger `protect_issued_comparison`); el PDF es regenera sempre des del snapshot.

## 6. Lliurament
- PDF corporatiu: resum executiu d'1 pàgina + versió detallada amb desglossament, en català o castellà, amb vista prèvia. No inclou comissions ni marges.
- Correu via SMTP existent: vista prèvia, edició i confirmació obligatòria; registre a `comparison_deliveries`.
- WhatsApp: enllaç `wa.me` amb el text preparat; es registra com a «obert», mai com a «enviat».
- Portal privat de proposta `/p/<token>`: enllaç amb caducitat i revocable (es desa només el hash del token); el client pot indicar interès o demanar aclariments (límit 10/h).

## 7. Comparativa massiva
Excel/CSV de CUPS → cua amb concurrència 2 i reintents amb espera davant de 429 → exportació Excel i PDFs individuals o en ZIP.

## 8. Seguretat
- Credencials (SIPS, SMTP, Anthropic, connectors) només al servidor. Cap `service_role` al navegador.
- Protecció davant prompt injection: el text de la factura es passa com a dades, la resposta es valida amb zod i qualsevol valor fora de rang queda «a confirmar».
- No es registren factures completes ni credencials als logs.
- Taula `offer_commissions` amb RLS només per a admin.

## 9. Migració
`supabase/migrations/006_comparatives_ia.sql` (additiva, idempotent, no toca taules existents) i `006_comparatives_ia_down.sql` per desfer-la. Validada amb PGlite: creació, segona execució, immutabilitat i rollback.

## 10. Variables d'entorn noves
`INVOICE_AI_ENABLED` (per defecte false) i `TARIFF_CONNECTORS` (JSON, opcional). Reutilitza `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` i `SMTP_*`.
