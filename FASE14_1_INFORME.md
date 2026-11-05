# Fase 14.1 · Excel de tarifes de Naturgy al catàleg i conversió automàtica d'unitats

Branca: `fix/naturgy-tarifes-unitats`. Surt de `feature/fase14-auditor-comissions`, així que inclou també la Fase 14. **No cal cap migració nova.**

> **Com s'ha provat.**
> - **Provat de debò:** l'Excel real `NC-Productos-Captacion-PYMES-20261029-VP.xlsx`, a les proves automàtiques.
> - **Provat amb simulació:** les pantalles al navegador, amb un servidor simulat i sense IA.
> - **No s'ha provat res contra el Supabase real.**

## 1. Per què no funcionava

A **Catàleg → «Llegir fitxer de tarifes»**, l'Excel de Naturgy només es llegia sense IA si a Supabase hi havia una plantilla de lectura desada. Hi havia tres problemes:

| Problema | Conseqüència |
|---|---|
| Sense plantilla desada, o amb la migració de plantilles pendent | L'Excel s'enviava sencer a la IA. Amb 61 tarifes la resposta no hi cabia i sortia «El document té massa tarifes…». Sense clau d'IA, ni això. |
| L'API de plantilles fallava | Es perdia l'Excel ja llegit i també s'enviava a la IA. |
| Les tarifes ja desades | Cap no es podia activar automàticament: totes portaven l'avís «Sense data de fi de vigència», que bloquejava l'activació. |

## 2. Què he canviat

**Lector integrat de Naturgy (`src/comparator/known-reader.ts`)**
- Llegeix l'Excel sencer al navegador, sense IA, sense límit de tarifes i sense que calgui cap plantilla desada.
- Si Direcció té una plantilla verificada compatible, fa servir les seves regles.

| Element | Resultat |
|---|---|
| Comercialitzadora i plantilla | Naturgy · Captación PYMES |
| Pestanyes | `OCT26_3_VP` (preus) i «Seguimiento info» (metadades) |
| Famílies | 7. Temporada/Obra es marca «no publicat (#N/A)». |
| Serveis | 4, a part. No són tarifes. |
| Tarifes | 61. Les variants M, ONE i SUPRA es mantenen separades. |

**Valors comprovats amb l'Excel real**

| Tarifa | Valor |
|---|---|
| Plan Fijo Luz 24h 2.0TD, potència | P1 = 0,12297297534246576 · P2 = 0,04397602191780822 €/kW·dia |
| Plan Fijo Luz 24h 2.0TD, energia | 0,2099 (principal) · 0,192 (ONE) · 0,2278 (SUPRA) |
| Plan Fijo Luz 2.0TD trihorari | P1 0,2797 · P2 0,2068 · P3 0,1722 |
| Plan Variable Gas RL.1 | Terme fix 0,0772908493150685 €/client·dia i preus variables 0,103811 · 0,100811 · 0,09793 |

**Pantalla de revisió**
- Mostra «Fitxer reconegut», «Plantilla detectada» i l'estat.
- Té una barra de progrés per a cada família.
- Mostra les novetats i els canvis respecte del catàleg.

**Famílies «Variable»**
- Queden **pendents**: no s'activen mentre no se sàpiga si són fixes o indexades.
- Es confirmen amb un desplegable, i les tarifes es tornen a validar a l'instant.

| Situació | Tarifes |
|---|---|
| Abans de confirmar | 37 completes i 24 pendents |
| Després de confirmar-les com a fixes | 54 noves, 1 per revisar i 6 incompletes |

Les 6 incompletes són Plan Variable Luz 3.0 i 6.1, que al document no tenen preu de P1 a P3. Queden en esborrany.

**Activació**
- «Sense data de fi de vigència» ara és informatiu i ja no impedeix activar.
- Les tarifes amb avisos es desen en esborrany encara que es marqui «Activa directament les completes».

**Reimportar el mateix Excel** no crea duplicats: totes les tarifes surten com a «Sense canvis».

**Lector amb IA (altres comercialitzadores)**
- Els fulls grans es parteixen automàticament en fragments. Cada fragment porta les capçaleres com a context.
- Si un fragment no hi cap, es torna a partir.
- Ja no es demana mai a l'usuari que divideixi el document.

## 3. Conversió automàtica d'unitats (`src/comparator/units.ts`)

**Com funciona**
- **És determinista:** la IA només diu quina unitat surt al document; el càlcul el fa el CRM, amb aritmètica decimal.
- **Base de 365 dies:** la quota mensual es converteix com × 12 ÷ 365.

**Unitats que fa servir el CRM per dins**

| Concepte | Unitat |
|---|---|
| Potència | €/kW·dia |
| Energia | €/kWh |
| Terme fix del gas | €/client·dia |

He revisat el model de dades: el camp del gas ja era per client i dia, no per kW. No calia corregir-lo.

**Conversions comprovades**

| De | A |
|---|---|
| 120 €/client/any | 0,3287671233 €/client·dia |
| 35 €/kW/any | 0,0958904110 €/kW·dia, a cada període P1–P6 |
| 150 €/MWh | 0,15 €/kWh |
| 15 c€/kWh | 0,15 €/kWh |

**Casos que no converteix**
- Un terme fix del gas en €/kW/any **no** es converteix: cal la potència de referència i la fórmula contractual.
- Les unitats desconegudes tampoc. En tots dos casos la tarifa queda pendent i s'explica el motiu; mai no s'hi posa un zero.

**Unitat original**
- Es conserva a la tarifa, al camp `units`, i la conversió es mostra a la revisió.
- No es converteix mai dues vegades.

**Formulari de tarifes**
- **Energia:** selector d'unitat (€/kWh, €/MWh o c€/kWh).
- **Terme fix del gas:** selector d'unitat (€/client per dia, per mes o per any).
- **Potència:** es veu l'equivalent en €/kW·dia, amb el botó «Converteix a €/kW·dia».
- **Com es desa:** sempre en les unitats del CRM; el selector només canvia com s'escriu.
- **Classificació pendent:** si una tarifa la té, el formulari demana confirmar-la.

**Comparatives i preus històrics**
- El cost és idèntic amb la unitat original i amb la convertida, tant en comparatives anuals com mensuals.
- Els preus històrics i les comparatives ja emeses no es toquen.

## 4. Proves

| Prova | Tipus | Resultat |
|---|---|---|
| `tests/naturgy-lector-integrat.test.ts` | Excel real i unitats | 25 correctes |
| `e2e/naturgy-cataleg.e2e.cjs` | Navegador amb servidor simulat, sense plantilla i sense IA | 3 de 3 |
| `e2e/plantilles.e2e.cjs`, `e2e/iberdrola.e2e.cjs` i `e2e/auditor.e2e.cjs` | Navegador, servidor simulat | Correctes. He adaptat una prova al comportament nou: amb plantilla verificada, la lectura es fa al catàleg. |
| `npm run typecheck` | | Correcte |
| `npm run lint` | | 0 errors i 4 avisos que ja hi eren |
| `npm run test` | | 849 proves en 55 fitxers, totes correctes |
| `npm run build` | | Correcte, amb l'avís de `unpdf` que ja hi era |
