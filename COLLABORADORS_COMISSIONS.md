# Col·laboradors: importació i percentatges de comissió

Ampliació del mòdul existent **Col·laboradors › Gestió** (`cap_partners`) i del motor de comissions existent (`fin_rules`). No s'ha creat cap mòdul, panell ni càlcul paral·lel.

## Què s'ha reutilitzat

| Necessitat | Peça existent |
|---|---|
| Fitxa del col·laborador | `cap_partners`, a la pantalla Col·laboradors › Gestió |
| Percentatge sobre la comissió d'Assessoria | Motor `fin_rules`, capa `collaborador`, tipus `pct_comissio_rebuda`. La base és la comissió confirmada per la comercialitzadora o, si encara no n'hi ha, l'estimada. |
| Excepcions i prioritat | Selecció de la regla més específica: producte > comercialitzadora > segment > servei, i persona per sobre de general. Admet tarifa d'accés i alta nova/renovació. |
| Històric | Versions de `fin_rules`: una versió nova tanca l'anterior el dia abans de la data d'efecte. Els càlculs (`fin_calculations`) no es poden modificar i conserven la versió aplicada. |
| Aprovació | Només Direcció aprova regles. La Cap administrativa autoritzada pot proposar canvis, que queden pendents. |
| Retrocessions | No es descompten automàticament al col·laborador. A la conciliació surten a part, marcades «cal revisió». |
| Portal del col·laborador | Ja mostra les comissions estimades, meritades, liquidades i pagades. No veu dades d'altres col·laboradors. |
| Jerarquia | Equips existents (`crm_teams`). Només s'hi afegeix un responsable opcional a la fitxa. No es creen comissions jeràrquiques. |

## Canvis (migració 027)

- **Columnes noves a `cap_partners`:**
  - DNI/CIF (normalitzat i únic);
  - persona física o jurídica;
  - adreça i codi postal;
  - etiqueta i data d'origen;
  - classificació: `collaborador`, `pendent_classificacio` o `descartat`;
  - responsable (`manager_id`);
  - lot d'importació.
- **Taula `cap_partner_imports`:** guarda cada lot d'importació perquè es pugui desfer.
- **`sec_settings.collab_levels`:** els nivells 70 / 50 / 30, editables per Direcció.

## Funcionament

1. **Importar col·laboradors** (Direcció):
   - Accepta XLSX, XLS o CSV i en reconeix les capçaleres.
   - Normalitza les dades i detecta duplicats dins del fitxer i contra Supabase: per DNI, per correu, per telèfon i amb els usuaris del CRM.
   - Mostra una previsualització amb una acció per fila: crear, completar l'existent, revisar o ignorar.
   - «Completar» només omple camps buits.
   - Un correu que ja és d'un usuari del CRM sempre queda «per revisar». No es modifica cap usuari existent.
   - Les etiquetes diferents de «Comercial» queden pendents de classificar, sense rol ni permís.
2. **Desfer** (fins a 30 dies): elimina només les fitxes creades que no s'han fet servir ni modificat.
3. **Habilitar per a comissions:**
   - És una acció expressa, individual o massiva.
   - Crea el compte **bloquejat**: sense contrasenya, sense invitació i sense poder entrar ni amb l'enllaç màgic.
   - Cal perquè el motor identifica el col·laborador pel seu compte.
4. **Donar accés al portal:** és una acció separada. Desbloqueja el compte i envia el correu per crear la contrasenya.
5. **Percentatge:**
   - Nivell 1, 2 o 3, o personalitzat (0–100 %, amb decimals).
   - Té una data d'efecte, que no pot ser anterior a avui, i un motiu.
   - Es pot assignar individualment o a diversos col·laboradors alhora des del llistat.
6. **Excepcions:** per comercialitzadora, producte, servei, segment, tarifa o tipus de contracte, amb vigència.
7. **Conciliació › liquidació › «Repartiment amb col·laboradors»:** per a cada línia mostra:
   - la comissió;
   - el col·laborador;
   - el percentatge aplicat;
   - la part del col·laborador i la resta per a Assessoria;
   - el previst, el meritat i el liquidat;
   - les retrocessions, a part.

   És una consulta: no desa res.

## Proves

- `tests/collaborators.test.ts` fa servir un fitxer fictici de 20 files (18 «Comercial», 1 «Usuario», 1 «Administrador») i comprova:
  - capçaleres i normalització;
  - duplicats;
  - reimportació sense duplicar;
  - nivells i personalitzats;
  - repartiments 70/30, 50/50 i 30/70;
  - prioritat de les excepcions;
  - històric 50 % → 70 %.
- `tests/db/collaboradors-rls.test.ts` prova, amb PGlite i les migracions 001-027:
  - que el DNI és únic;
  - els nivells per defecte;
  - les versions;
  - que només Direcció aprova;
  - que un col·laborador no veu les fitxes ni els percentatges d'altres.

## Pendent

- Provar la importació amb l'Excel real `Usuarios_2026-11-04.xlsx`, que no es va rebre.
- **Campanya com a criteri d'excepció:** els contractes no tenen campanya associada, així que no s'ha afegit per no inventar la relació.
- **Proves visuals amb Playwright** contra un Supabase de proves.
