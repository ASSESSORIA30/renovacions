# Integració SIPS — càlcul d'energia activa per períodes

## Implementat
- Normalitzador de decimals i sumatori de registres datats de consum d'energia activa (P1-P3 / P1-P6).
- 12 mesos naturals complets, verificació de continuïtat, exclusions de duplicats exactes i solapaments.
- Finestra, últim consum, diferència respecte a E.A. Anual, avís de dades incompletes.
- Resultat `annualConsumptions` en la resposta `/api/sips/search`, disponible per a futures integracions del comparador.
- Visualització al cercador SIPS quan el portal adjunta l'històric al registre de PuntoSuministro.
- Proves de regressió amb l'exemple històric 3.0TD subministrat (12.881 kWh).

## Limitació pendent — bloqueja dades reals P1-P6
La integració existent només crida `POST /Services/Core/PuntoSuministro/List`.
No consta en el codi del projecte cap URL verificada, schema de consulta, ni resposta d'exemple del servei `Consumo Punto Suministro`.
No s'ha inventat cap endpoint. Cal inspeccionar en sessió autoritzada (DevTools → Network) la consulta real
que fa el portal en obrir un CUPS i la pestanya `Consumo Punto Suministro`, i revisar la resposta
(sense cookies, contrasenyes ni dades de client). Després es pot implementar la consulta paginada
al servidor amb les credencials ja configurades. Fins llavors, la cerca SIPS continua mostrant
el total anual del llistat; mostrarà «Històric incomplet» si no arriba el desglossament.

## Verificació
- Proves de l'algorisme amb dates i imports aportats: superades en un test local compilat.
- No hi ha verificació contra EAS real en aquest entorn (sense connectivitat DNS).
- No s'ha fet cap canvi a les dades de SIPS ni a Supabase. No s'ha implementat la transferència automàtica
  dels períodes cap a les ofertes perquè falta la resposta real de l'històric.
