/**
 * EXPORTACIONS A EXCEL (definició compartida per la pantalla i el servidor).
 * Cada conjunt de dades indica la taula, el mòdul de permisos que el governa, les columnes amb el seu format i els
 * filtres disponibles (estat, dates, cerca, comercialitzadora, responsable, col·laborador i camps concrets).
 * El servidor llegeix SEMPRE amb la sessió de l'usuari: la RLS decideix quines files pot exportar cadascú.
 */
export type ColType = "text" | "date" | "datetime" | "money" | "num" | "bool" | "person" | "client" | "supply" | "list" | "pct" | "product" | "statement" | "contract" | "invoice";
export interface ExportCol { key: string; header: string; type?: ColType; width?: number }
export interface ExportDef {
  id: string; label: string; group: string; module: string; adminOnly?: boolean; staffOnly?: boolean;
  table: string; statusCol?: string; statusLabel?: string;
  dates: { col: string; label: string }[]; search: string[];
  retailerCol?: string; ownerCol?: string; collaboratorCol?: string;
  /** camps amb valors limitats que es poden filtrar (es llegeixen els valors existents) */
  facets?: { col: string; label: string }[];
  base?: Record<string, string>;          // filtre fix (p. ex. només els càlculs vigents)
  order: { col: string; asc?: boolean };
  columns: ExportCol[];
  /** columnes JSON que s'expandeixen (p. ex. les dades del contracte de renovacions) */
  expandJson?: string;
  /** columna identificadora per exportar només les files seleccionades a la pantalla */
  idCol?: string;
  /** columnes per les quals una pantalla pot filtrar per valor exacte (p. ex. el client de la fitxa) */
  links?: string[];
  /** filtres propis d'una pantalla: valor rebut → condicions (mateixa lògica que el llistat de la pantalla) */
  extras?: Record<string, Record<string, Cond[]>>;
}
/** Condició simple sobre una columna de la definició (mai SQL lliure). */
export type Cond = ["eq" | "neq" | "gt" | "lt" | "ilike", string, string | number] | ["in" | "not_in", string, string[]] | ["is_null" | "not_null", string] | ["lt_now", string];

const audit: ExportCol[] = [{ key: "created_at", header: "Creat", type: "datetime" }];
export const EXPORTS: ExportDef[] = [
  {
    id: "clients", label: "Clients", group: "Clients", module: "clients", table: "crm_clients_list", statusCol: "status",
    dates: [{ col: "created_at", label: "Alta al CRM" }, { col: "registered_at", label: "Data de registre" }, { col: "next_follow_up", label: "Proper seguiment" }],
    search: ["search", "cups_list"], ownerCol: "owner_id", collaboratorCol: "collaborator_id",
    facets: [{ col: "kind", label: "Tipus" }, { col: "origin", label: "Origen" }, { col: "province", label: "Província" }, { col: "priority", label: "Prioritat" }, { col: "sector", label: "Sector" }],
    extras: {
      service: { luz: [["gt", "luz_count", 0]], gas: [["gt", "gas_count", 0]], cap: [["eq", "supplies_count", 0]] },
      city: {}, province: {}, sector: {},
    },
    order: { col: "name", asc: true },
    columns: [
      { key: "name", header: "Nom / raó social", width: 34 }, { key: "trade_name", header: "Nom comercial" }, { key: "kind", header: "Tipus" }, { key: "tax_id", header: "NIF/CIF" },
      { key: "status", header: "Estat" }, { key: "contact_name", header: "Contacte" }, { key: "phone", header: "Telèfon" }, { key: "phone2", header: "Telèfon 2" }, { key: "email", header: "Correu", width: 28 },
      { key: "address", header: "Adreça", width: 30 }, { key: "postal_code", header: "CP" }, { key: "city", header: "Població" }, { key: "province", header: "Província" }, { key: "sector", header: "Sector" },
      { key: "origin", header: "Origen" }, { key: "priority", header: "Prioritat" }, { key: "tags", header: "Etiquetes", type: "list" }, { key: "owner_id", header: "Comercial", type: "person" },
      { key: "collaborator_id", header: "Col·laborador", type: "person" }, { key: "supplies_count", header: "Subministraments", type: "num" }, { key: "luz_count", header: "Llum", type: "num" },
      { key: "gas_count", header: "Gas", type: "num" }, { key: "active_contracts", header: "Contractes actius", type: "num" }, { key: "next_renewal", header: "Propera renovació", type: "date" },
      { key: "cups_list", header: "CUPS", width: 30 }, { key: "last_activity_at", header: "Última activitat", type: "datetime" },
      { key: "next_follow_up", header: "Proper seguiment", type: "date" }, { key: "registered_at", header: "Registre", type: "date" },
      { key: "archived_at", header: "Arxivat", type: "datetime" }, ...audit,
    ],
  },
  {
    id: "subministraments", label: "Subministraments (CUPS)", group: "Clients", module: "clients", table: "crm_supplies", statusCol: "status",
    dates: [{ col: "created_at", label: "Alta" }, { col: "data_updated_at", label: "Dades actualitzades" }], search: ["cups", "holder_name", "address", "city"],
    retailerCol: "current_retailer", links: ["client_id"], facets: [{ col: "energy_type", label: "Energia" }, { col: "access_tariff", label: "Tarifa d'accés" }, { col: "province", label: "Província" }],
    order: { col: "cups", asc: true },
    columns: [
      { key: "cups", header: "CUPS", width: 24 }, { key: "client_id", header: "Client", type: "client", width: 30 }, { key: "holder_name", header: "Titular" }, { key: "energy_type", header: "Energia" },
      { key: "status", header: "Estat" }, { key: "current_retailer", header: "Comercialitzadora actual" }, { key: "access_tariff", header: "Tarifa d'accés" }, { key: "power_kw", header: "Potències (kW)", type: "list" },
      { key: "annual_kwh", header: "Consum anual (kWh)", type: "num" }, { key: "address", header: "Adreça", width: 30 }, { key: "postal_code", header: "CP" }, { key: "city", header: "Població" }, { key: "province", header: "Província" },
      { key: "data_source", header: "Origen de les dades" }, { key: "data_updated_at", header: "Dades actualitzades", type: "datetime" }, { key: "archived_at", header: "Arxivat", type: "datetime" }, ...audit,
    ],
  },
  {
    id: "contractes", label: "Contractes", group: "Clients", module: "clients", table: "crm_contracts", statusCol: "status",
    dates: [{ col: "signed_at", label: "Signatura" }, { col: "start_date", label: "Inici" }, { col: "end_date", label: "Venciment" }, { col: "created_at", label: "Alta al CRM" }],
    search: ["retailer", "product", "access_tariff", "legacy_contract_id"], retailerCol: "retailer", ownerCol: "owner_id", links: ["client_id", "supply_id"],
    facets: [{ col: "price_type", label: "Tipus de preu" }, { col: "access_tariff", label: "Tarifa d'accés" }], order: { col: "start_date" },
    columns: [
      { key: "client_id", header: "Client", type: "client", width: 30 }, { key: "supply_id", header: "CUPS", type: "supply", width: 24 }, { key: "retailer", header: "Comercialitzadora" }, { key: "product", header: "Producte", width: 24 },
      { key: "price_type", header: "Tipus de preu" }, { key: "access_tariff", header: "Tarifa d'accés" }, { key: "status", header: "Estat" }, { key: "signed_at", header: "Signatura", type: "date" },
      { key: "start_date", header: "Inici", type: "date" }, { key: "end_date", header: "Venciment", type: "date" }, { key: "owner_id", header: "Comercial", type: "person" },
      { key: "previous_contract_id", header: "Renovació d'un anterior", type: "bool" }, { key: "legacy_contract_id", header: "Ref. renovacions" }, { key: "notes", header: "Notes", width: 30 }, ...audit,
    ],
  },
  {
    id: "renovacions", label: "Renovacions (full de contractes)", group: "Clients", module: "renovacions", table: "contracts", links: ["comercial"],
    dates: [{ col: "first_seen_at", label: "Primera vegada vist" }, { col: "updated_at", label: "Actualitzat" }], search: ["cups", "comercial", "colaborador"],
    facets: [{ col: "comercial", label: "Comercial (full)" }], order: { col: "updated_at" }, expandJson: "data",
    columns: [{ key: "cups", header: "CUPS", width: 24 }, { key: "comercial", header: "Comercial" }, { key: "colaborador", header: "Col·laborador" }, { key: "removed_from_source", header: "Ja no és al full", type: "bool" }, { key: "updated_at", header: "Actualitzat", type: "datetime" }],
  },
  {
    id: "expedients", label: "Expedients de contractació", group: "Comercial", module: "contractacio", table: "crm_expedients", statusCol: "status",
    dates: [{ col: "created_at", label: "Creació" }, { col: "signed_at", label: "Signatura" }, { col: "activated_at", label: "Activació" }, { col: "start_date", label: "Inici" }],
    search: ["code", "retailer", "product", "external_ref"], retailerCol: "retailer", ownerCol: "owner_id", collaboratorCol: "collaborator_id", links: ["client_id"],
    facets: [{ col: "service", label: "Servei" }, { col: "procedure_type", label: "Tràmit" }, { col: "customer_type", label: "Tipus de client" }, { col: "priority", label: "Prioritat" }], order: { col: "created_at" },
    columns: [
      { key: "code", header: "Codi" }, { key: "client_id", header: "Client", type: "client", width: 30 }, { key: "supply_id", header: "CUPS", type: "supply", width: 24 }, { key: "service", header: "Servei" },
      { key: "procedure_type", header: "Tràmit" }, { key: "customer_type", header: "Tipus de client" }, { key: "retailer", header: "Comercialitzadora" }, { key: "product", header: "Producte" }, { key: "status", header: "Estat" },
      { key: "priority", header: "Prioritat" }, { key: "owner_id", header: "Comercial", type: "person" }, { key: "collaborator_id", header: "Col·laborador", type: "person" }, { key: "signed_at", header: "Signat", type: "datetime" },
      { key: "sent_at", header: "Enviat", type: "datetime" }, { key: "external_ref", header: "Ref. comercialitzadora" }, { key: "activated_at", header: "Activat", type: "date" }, { key: "start_date", header: "Inici", type: "date" },
      { key: "end_date", header: "Final", type: "date" }, { key: "rejection_reason", header: "Motiu de rebuig" }, { key: "next_action", header: "Propera acció" }, ...audit,
    ],
  },
  {
    id: "leads", label: "Leads", group: "Comercial", module: "comercial", table: "crm_leads", statusCol: "status",
    dates: [{ col: "created_at", label: "Entrada" }, { col: "converted_at", label: "Conversió" }, { col: "first_contact_at", label: "Primer contacte" }],
    search: ["search"], ownerCol: "owner_id", collaboratorCol: "collaborator_id", extras: { open: { "1": [["in", "status", ["nou", "contactat", "qualificat"]]] } },
    facets: [{ col: "kind", label: "Tipus" }, { col: "origin", label: "Origen" }, { col: "capture_channel", label: "Canal" }, { col: "energy_type", label: "Energia" }, { col: "province", label: "Província" }], order: { col: "created_at" },
    columns: [
      { key: "name", header: "Nom", width: 28 }, { key: "company", header: "Empresa" }, { key: "kind", header: "Tipus" }, { key: "tax_id", header: "NIF/CIF" }, { key: "contact_name", header: "Contacte" }, { key: "phone", header: "Telèfon" },
      { key: "email", header: "Correu", width: 26 }, { key: "city", header: "Població" }, { key: "province", header: "Província" }, { key: "origin", header: "Origen" }, { key: "capture_channel", header: "Canal" },
      { key: "services", header: "Serveis", type: "list" }, { key: "energy_type", header: "Energia" }, { key: "cups", header: "CUPS" }, { key: "status", header: "Estat" }, { key: "discard_reason", header: "Motiu de descart" },
      { key: "owner_id", header: "Comercial", type: "person" }, { key: "collaborator_id", header: "Col·laborador", type: "person" }, { key: "converted_at", header: "Convertit", type: "datetime" }, ...audit,
    ],
  },
  {
    id: "oportunitats", label: "Oportunitats", group: "Comercial", module: "comercial", table: "crm_opportunities", statusCol: "stage", statusLabel: "Etapa",
    dates: [{ col: "created_at", label: "Creació" }, { col: "expected_close", label: "Tancament previst" }, { col: "won_at", label: "Guanyada" }, { col: "lost_at", label: "Perduda" }],
    search: ["title", "province", "notes"], ownerCol: "owner_id", collaboratorCol: "collaborator_id", links: ["client_id", "lead_id"], facets: [{ col: "service", label: "Servei" }, { col: "priority", label: "Prioritat" }, { col: "province", label: "Província" }], order: { col: "created_at" },
    columns: [
      { key: "title", header: "Oportunitat", width: 30 }, { key: "client_id", header: "Client", type: "client", width: 28 }, { key: "service", header: "Servei" }, { key: "stage", header: "Etapa" }, { key: "priority", header: "Prioritat" },
      { key: "probability", header: "Probabilitat (%)", type: "num" }, { key: "annual_kwh", header: "Consum anual (kWh)", type: "num" }, { key: "commission_eur", header: "Comissió estimada", type: "money" },
      { key: "expected_close", header: "Tancament previst", type: "date" }, { key: "owner_id", header: "Comercial", type: "person" }, { key: "collaborator_id", header: "Col·laborador", type: "person" },
      { key: "won_at", header: "Guanyada", type: "datetime" }, { key: "lost_at", header: "Perduda", type: "datetime" }, { key: "lost_reason", header: "Motiu de pèrdua" }, ...audit,
    ],
  },
  {
    id: "collaboradors", label: "Col·laboradors", group: "Col·laboradors", module: "colaboradors", adminOnly: true, table: "cap_partners", statusCol: "status",
    dates: [{ col: "created_at", label: "Alta" }, { col: "source_created_at", label: "Alta a l'origen" }], search: ["name", "company", "tax_id", "email", "phone", "city"], ownerCol: "manager_id",
    facets: [{ col: "classification", label: "Classificació" }, { col: "kind", label: "Tipus" }, { col: "person_kind", label: "Persona" }, { col: "source_label", label: "Etiqueta d'origen" }, { col: "province", label: "Província" }], order: { col: "name", asc: true },
    columns: [
      { key: "name", header: "Nom", width: 28 }, { key: "company", header: "Empresa" }, { key: "tax_id", header: "DNI/CIF" }, { key: "person_kind", header: "Persona" }, { key: "kind", header: "Tipus" },
      { key: "classification", header: "Classificació" }, { key: "status", header: "Estat" }, { key: "email", header: "Correu", width: 26 }, { key: "phone", header: "Telèfon" }, { key: "address", header: "Adreça", width: 28 },
      { key: "postal_code", header: "CP" }, { key: "city", header: "Població" }, { key: "province", header: "Província" }, { key: "source_label", header: "Etiqueta d'origen" }, { key: "manager_id", header: "Responsable", type: "person" },
      { key: "user_id", header: "Habilitat per a comissions", type: "bool" }, ...audit,
    ],
  },
  {
    id: "comercialitzadores", label: "Comercialitzadores", group: "Comercialitzadores i tarifes", module: "comercialitzadores", staffOnly: true, table: "retailers", statusCol: "status",
    dates: [{ col: "created_at", label: "Alta" }, { col: "status_changed_at", label: "Canvi d'estat" }], search: ["trade_name", "legal_name", "tax_id", "email"], order: { col: "trade_name", asc: true },
    columns: [
      { key: "trade_name", header: "Nom comercial", width: 26 }, { key: "legal_name", header: "Raó social", width: 30 }, { key: "tax_id", header: "CIF" }, { key: "status", header: "Estat" }, { key: "services", header: "Serveis", type: "list" },
      { key: "aliases", header: "Àlies", type: "list" }, { key: "contact_name", header: "Contacte" }, { key: "phone", header: "Telèfon" }, { key: "email", header: "Correu" }, { key: "website", header: "Web" },
      { key: "status_note", header: "Nota d'estat" }, { key: "notes", header: "Notes", width: 30 }, ...audit,
    ],
  },
  {
    id: "tarifes", label: "Tarifes (versions de preus)", group: "Comercialitzadores i tarifes", module: "comparatives", table: "tariff_versions", statusCol: "status",
    dates: [{ col: "valid_from", label: "Vigent des de" }, { col: "valid_to", label: "Vigent fins a" }, { col: "created_at", label: "Creació" }], search: ["source", "created_by_name"],
    facets: [{ col: "origin", label: "Origen" }], order: { col: "created_at" }, expandJson: "data",
    columns: [
      { key: "product_id", header: "Producte", type: "product", width: 40 }, { key: "version", header: "Versió", type: "num" }, { key: "status", header: "Estat" }, { key: "origin", header: "Origen" },
      { key: "valid_from", header: "Vigent des de", type: "date" }, { key: "valid_to", header: "Vigent fins a", type: "date" }, { key: "source", header: "Font" }, { key: "used_at", header: "Usada en propostes", type: "datetime" },
      { key: "created_by_name", header: "Creada per" }, ...audit,
    ],
  },
  {
    id: "liquidacions_proveidor", label: "Liquidacions de comercialitzadores", group: "Economia", module: "economia", staffOnly: true, table: "fin_provider_statements", statusCol: "status",
    dates: [{ col: "received_at", label: "Rebuda" }, { col: "period_from", label: "Període (inici)" }, { col: "period_to", label: "Període (final)" }], search: ["retailer", "reference", "file_name"], retailerCol: "retailer",
    facets: [{ col: "source", label: "Origen" }], order: { col: "received_at" },
    columns: [
      { key: "retailer", header: "Comercialitzadora" }, { key: "reference", header: "Referència" }, { key: "period_from", header: "Des de", type: "date" }, { key: "period_to", header: "Fins a", type: "date" },
      { key: "received_at", header: "Rebuda", type: "date" }, { key: "declared_total", header: "Total declarat", type: "money" }, { key: "status", header: "Estat" }, { key: "source", header: "Origen" },
      { key: "file_name", header: "Fitxer" }, { key: "net_settlement", header: "Liquidació neta", type: "bool" }, { key: "notes", header: "Notes" }, ...audit,
    ],
  },
  {
    id: "linies_liquidacio", label: "Línies de liquidació (conciliació)", group: "Economia", module: "economia", staffOnly: true, table: "fin_statement_lines", statusCol: "match_status", statusLabel: "Estat de conciliació",
    dates: [{ col: "event_date", label: "Data del moviment" }, { col: "activation_date", label: "Activació" }], search: ["cups", "external_ref", "client_name", "concept", "product"], links: ["statement_id", "contract_id"],
    facets: [{ col: "kind", label: "Tipus" }, { col: "movement", label: "Moviment" }, { col: "energy", label: "Energia" }], order: { col: "line_no", asc: true },
    columns: [
      { key: "statement_id", header: "Liquidació", type: "statement", width: 30 }, { key: "line_no", header: "Línia", type: "num" }, { key: "cups", header: "CUPS", width: 24 }, { key: "external_ref", header: "Ref. / telèfon" },
      { key: "client_name", header: "Client (document)" }, { key: "concept", header: "Concepte", width: 34 }, { key: "movement", header: "Moviment" }, { key: "kind", header: "Tipus" }, { key: "energy", header: "Energia" },
      { key: "product", header: "Producte" }, { key: "amount", header: "Import", type: "money" }, { key: "expected_amount", header: "Esperat", type: "money" }, { key: "difference", header: "Diferència", type: "money" },
      { key: "match_status", header: "Estat" }, { key: "event_date", header: "Data", type: "date" }, { key: "activation_date", header: "Activació", type: "date" }, { key: "match_reason", header: "Motiu", width: 34 },
    ],
  },
  {
    id: "liquidacions_comissions", label: "Liquidacions a comercials i col·laboradors", group: "Economia", module: "comissions", table: "fin_settlements", statusCol: "status",
    dates: [{ col: "period_to", label: "Període (final)" }, { col: "approved_at", label: "Aprovació" }, { col: "paid_at", label: "Pagament" }], search: ["code", "notes"], collaboratorCol: "beneficiary_id",
    facets: [{ col: "kind", label: "Tipus" }], order: { col: "period_to" },
    columns: [
      { key: "code", header: "Codi" }, { key: "kind", header: "Tipus" }, { key: "beneficiary_id", header: "Beneficiari", type: "person" }, { key: "period_from", header: "Des de", type: "date" }, { key: "period_to", header: "Fins a", type: "date" },
      { key: "status", header: "Estat" }, { key: "total_fixed", header: "Fixes", type: "money" }, { key: "total_variable", header: "Variables", type: "money" }, { key: "total_bonus", header: "Bonificacions", type: "money" },
      { key: "total_cancellations", header: "Anul·lacions", type: "money" }, { key: "total_adjustments", header: "Ajustaments", type: "money" }, { key: "total_gross", header: "Total brut", type: "money" },
      { key: "approved_amount", header: "Aprovat", type: "money" }, { key: "paid_amount", header: "Pagat", type: "money" }, { key: "approved_at", header: "Aprovada", type: "datetime" }, { key: "paid_at", header: "Pagada", type: "datetime" },
    ],
  },
  {
    id: "comissions", label: "Comissions calculades", group: "Economia", module: "comissions", table: "fin_calculations", statusCol: "status", base: { is_current: "true" },
    dates: [{ col: "created_at", label: "Càlcul" }], search: ["formula", "rule_key"], collaboratorCol: "beneficiary_id", links: ["contract_id"], facets: [{ col: "layer", label: "Capa" }], order: { col: "created_at" },
    columns: [
      { key: "contract_id", header: "Contracte", type: "contract", width: 40 }, { key: "layer", header: "Capa" }, { key: "beneficiary_id", header: "Beneficiari", type: "person" }, { key: "status", header: "Estat" },
      { key: "amount", header: "Import", type: "money" }, { key: "formula", header: "Fórmula", width: 40 }, { key: "rule_key", header: "Regla" }, { key: "rule_version", header: "Versió", type: "num" }, { key: "created_at", header: "Calculat", type: "datetime" },
    ],
  },
  {
    id: "moviments_economics", label: "Moviments econòmics (llibre)", group: "Economia", module: "economia", staffOnly: true, table: "fin_ledger",
    dates: [{ col: "period", label: "Període" }, { col: "created_at", label: "Registre" }], search: ["description"], collaboratorCol: "beneficiary_id", links: ["contract_id", "client_id", "settlement_id"],
    facets: [{ col: "layer", label: "Capa" }, { col: "kind", label: "Tipus" }], order: { col: "period" },
    columns: [
      { key: "period", header: "Període", type: "date" }, { key: "layer", header: "Capa" }, { key: "kind", header: "Tipus" }, { key: "beneficiary_id", header: "Beneficiari", type: "person" }, { key: "client_id", header: "Client", type: "client" },
      { key: "amount", header: "Import", type: "money" }, { key: "description", header: "Descripció", width: 40 }, { key: "settlement_id", header: "Liquidat", type: "bool" }, { key: "created_by_name", header: "Registrat per" }, ...audit,
    ],
  },
  {
    id: "factures", label: "Factures emeses", group: "Facturació", module: "facturacio", table: "bill_invoices_v", statusCol: "display_status",
    dates: [{ col: "issue_date", label: "Emissió" }, { col: "due_date", label: "Venciment" }], search: ["invoice_no", "client_name", "client_nif", "concept", "period_label"], links: ["client_id"],
    facets: [{ col: "kind", label: "Tipus" }, { col: "origin", label: "Origen" }], order: { col: "issue_date" },
    columns: [
      { key: "invoice_no", header: "Número" }, { key: "issue_date", header: "Data", type: "date" }, { key: "due_date", header: "Venciment", type: "date" }, { key: "client_name", header: "Client", width: 32 },
      { key: "client_nif", header: "NIF/CIF" }, { key: "concept", header: "Concepte", width: 34 }, { key: "period_label", header: "Període" }, { key: "base", header: "Base", type: "money" }, { key: "vat", header: "IVA", type: "money" },
      { key: "total", header: "Total", type: "money" }, { key: "paid", header: "Cobrat", type: "money" }, { key: "pending", header: "Pendent", type: "money" }, { key: "display_status", header: "Estat" }, { key: "kind", header: "Tipus" },
      { key: "sent_at", header: "Enviada", type: "datetime" },
    ],
  },
  {
    id: "cobraments", label: "Cobraments de factures", group: "Facturació", module: "facturacio", table: "bill_payments",
    dates: [{ col: "paid_at", label: "Data de cobrament" }], search: ["reference", "notes"], links: ["invoice_id"], facets: [{ col: "method", label: "Forma de pagament" }], order: { col: "paid_at" },
    columns: [{ key: "invoice_id", header: "Factura", type: "invoice" }, { key: "paid_at", header: "Data", type: "date" }, { key: "amount", header: "Import", type: "money" }, { key: "method", header: "Forma" }, { key: "reference", header: "Referència" }, { key: "notes", header: "Notes" }, ...audit],
  },
  {
    id: "reclamacions", label: "Reclamacions a comercialitzadores", group: "Economia", module: "economia", staffOnly: true, table: "fin_claims", statusCol: "status",
    dates: [{ col: "created_at", label: "Creació" }, { col: "sent_at", label: "Enviament" }, { col: "resolved_at", label: "Resolució" }], search: ["code", "retailer", "notes"], retailerCol: "retailer", order: { col: "created_at" },
    columns: [
      { key: "code", header: "Codi" }, { key: "retailer", header: "Comercialitzadora" }, { key: "period_from", header: "Des de", type: "date" }, { key: "period_to", header: "Fins a", type: "date" }, { key: "status", header: "Estat" },
      { key: "items_count", header: "Línies", type: "num" }, { key: "total_claimed", header: "Reclamat", type: "money" }, { key: "total_recognized", header: "Reconegut", type: "money" }, { key: "total_recovered", header: "Recuperat", type: "money" },
      { key: "assigned_to", header: "Assignada a", type: "person" }, { key: "sent_at", header: "Enviada", type: "datetime" }, { key: "response_due", header: "Resposta abans de", type: "date" }, { key: "resolved_at", header: "Resolta", type: "datetime" }, ...audit,
    ],
  },
  {
    id: "tasques", label: "Tasques", group: "Gestió", module: "tasques", table: "crm_tasks", statusCol: "status",
    dates: [{ col: "due_at", label: "Venciment" }, { col: "created_at", label: "Creació" }, { col: "completed_at", label: "Feta" }], search: ["title"], ownerCol: "assigned_to", links: ["client_id", "created_by"],
    extras: { group: { obertes: [["in", "status", ["pendent", "en_curs", "bloquejada"]]], vencudes: [["in", "status", ["pendent", "en_curs", "bloquejada"]], ["lt_now", "due_at"]], bloquejades: [["eq", "status", "bloquejada"]], fetes: [["eq", "status", "feta"]] }, externes: { "1": [["eq", "partner_visible", "true"]] } },
    facets: [{ col: "kind", label: "Tipus" }, { col: "priority", label: "Prioritat" }, { col: "area", label: "Àrea" }], order: { col: "due_at" },
    columns: [
      { key: "title", header: "Tasca", width: 34 }, { key: "kind", header: "Tipus" }, { key: "status", header: "Estat" }, { key: "priority", header: "Prioritat" }, { key: "area", header: "Àrea" }, { key: "client_id", header: "Client", type: "client" },
      { key: "assigned_to", header: "Assignada a", type: "person" }, { key: "due_at", header: "Venciment", type: "datetime" }, { key: "completed_at", header: "Feta", type: "datetime" }, { key: "notes", header: "Notes", width: 30 }, ...audit,
    ],
  },
  {
    id: "incidencies", label: "Incidències", group: "Gestió", module: "incidencies", table: "crm_incidents", statusCol: "status",
    dates: [{ col: "opened_at", label: "Obertura" }, { col: "closed_at", label: "Tancament" }, { col: "due_at", label: "Venciment" }], search: ["title", "description", "external_ref"], ownerCol: "assigned_to", links: ["client_id"],
    extras: { group: { obertes: [["not_in", "status", ["resolta", "tancada"]]] } },
    facets: [{ col: "kind", label: "Tipus" }, { col: "category", label: "Categoria" }, { col: "priority", label: "Prioritat" }], order: { col: "opened_at" },
    columns: [
      { key: "title", header: "Incidència", width: 32 }, { key: "kind", header: "Tipus" }, { key: "category", header: "Categoria" }, { key: "status", header: "Estat" }, { key: "priority", header: "Prioritat" },
      { key: "client_id", header: "Client", type: "client" }, { key: "assigned_to", header: "Assignada a", type: "person" }, { key: "opened_at", header: "Oberta", type: "datetime" }, { key: "due_at", header: "Venciment", type: "datetime" },
      { key: "closed_at", header: "Tancada", type: "datetime" }, { key: "external_ref", header: "Ref. externa" }, { key: "resolution", header: "Resolució", width: 30 },
    ],
  },
];
export const exportDef = (id: string) => EXPORTS.find((e) => e.id === id) ?? null;

export interface ExportQuery { ids?: string[]; links?: Record<string, string>; extras?: Cond[]; ownerNull?: boolean; ownerMe?: boolean; status?: string[]; dateCol?: string; from?: string; to?: string; q?: string; retailer?: string; owner?: string; collaborator?: string; facets?: Record<string, string>; columns?: string[]; archived?: boolean }

/** Valida i neteja els filtres rebuts contra la definició (només columnes permeses: mai SQL lliure). */
export function cleanQuery(def: ExportDef, raw: Record<string, string>): ExportQuery {
  const list = (s?: string) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 30) : undefined);
  const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const uuid = (s?: string) => (s && /^[0-9a-f-]{36}$/i.test(s) ? s : undefined);
  const facets: Record<string, string> = {};
  for (const f of def.facets ?? []) if (raw[`f_${f.col}`]) facets[f.col] = raw[`f_${f.col}`].slice(0, 120);
  const cols = list(raw.columns)?.filter((c) => def.columns.some((x) => x.key === c));
  // selecció de la pantalla (identificadors) i filtres de vincle (p. ex. el client de la fitxa)
  const ids = raw.ids ? raw.ids.split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z0-9:_.-]{1,80}$/.test(x)).slice(0, 5000) : undefined;
  const links: Record<string, string> = {};
  for (const c of def.links ?? []) if (raw[`l_${c}`] && raw[`l_${c}`].length <= 120) links[c] = raw[`l_${c}`];
  // filtres propis de pantalla: el valor ha d'estar a la definició; si la definició no en té, és un «ilike» sobre la columna homònima
  const extras: Cond[] = [];
  for (const [k, map] of Object.entries(def.extras ?? {})) {
    const v = raw[`x_${k}`];
    if (!v) continue;
    if (Object.keys(map).length) { if (map[v]) extras.push(...map[v]); }
    else extras.push(["ilike", k, v.replace(/[%_,()*\\]/g, " ").trim().slice(0, 80)]);
  }
  return {
    ids: ids?.length ? ids : undefined, links, extras,
    ownerNull: !!def.ownerCol && raw.owner === "cap", ownerMe: !!def.ownerCol && raw.owner === "me",
    status: def.statusCol ? list(raw.status) : undefined,
    dateCol: def.dates.some((d) => d.col === raw.dateCol) ? raw.dateCol : def.dates[0]?.col, from: day(raw.from), to: day(raw.to),
    q: raw.q ? raw.q.replace(/[%_,()*\\]/g, " ").trim().slice(0, 80) || undefined : undefined,
    retailer: def.retailerCol && raw.retailer ? raw.retailer.replace(/[%_,()*\\]/g, " ").trim().slice(0, 80) : undefined,
    owner: def.ownerCol ? uuid(raw.owner) : undefined, collaborator: def.collaboratorCol ? uuid(raw.collaborator) : undefined,
    facets, columns: cols?.length ? cols : undefined, archived: raw.archived === "1",
  };
}
