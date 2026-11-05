import type { Metadata } from "next";
import { COMPANY, CONSENT_VERSION } from "@/core/capture";
import { LegalShell } from "@/ui/LegalShell";

export const metadata: Metadata = { title: "Informació de privacitat · Assessoria 3.0", robots: { index: true, follow: true } };

export default function Privacy() {
  const contact = COMPANY.privacyEmail || COMPANY.email;
  return (
    <LegalShell title="Informació de privacitat">
      <p className="mt-2 text-[13px] text-zinc-500">Versió {CONSENT_VERSION}</p>
      <h2>Responsable</h2>
      <p>{COMPANY.legalName}{COMPANY.taxId ? ` (${COMPANY.taxId})` : ""}, {COMPANY.address}. Telèfon {COMPANY.phone}{contact ? ` · ${contact}` : ""}.</p>
      <h2>Per a què fem servir les dades</h2>
      <ul>
        <li>Estudiar la factura que ens envies i respondre la teva sol·licitud (comparativa i, si ho vols, proposta).</li>
        <li>Contactar-te per telèfon, correu o, si ho acceptes, per WhatsApp en relació amb aquesta sol·licitud.</li>
        <li>Enviar-te comunicacions comercials només si ho has acceptat expressament (és opcional i independent de l&apos;estudi).</li>
        <li>Si un col·laborador d&apos;Assessoria 3.0 t&apos;ha recomanat, registrar-ho per gestionar la relació amb aquest col·laborador.</li>
      </ul>
      <h2>Base jurídica</h2>
      <ul>
        <li>Aplicació de mesures precontractuals a petició teva (estudi de la factura).</li>
        <li>El teu consentiment, per a les comunicacions comercials i el contacte per WhatsApp. El pots retirar quan vulguis sense que afecti l&apos;estudi.</li>
      </ul>
      <h2>Quines dades tractem</h2>
      <p>Les que ens facilites (nom, telèfon, correu, tipus de client i comentaris) i les que consten a la factura (titular, NIF, adreça i CUPS del subministrament, comercialitzadora, tarifa, potències, consums, preus i imports). No les fem servir per crear audiències publicitàries ni les cedim a plataformes de publicitat.</p>
      <h2>Lectura automàtica de la factura</h2>
      <p>Per agilitzar l&apos;estudi, la factura es pot llegir de manera automatitzada (també amb un servei d&apos;intel·ligència artificial que actua com a encarregat del tractament). Una persona de l&apos;equip revisa les dades abans de preparar cap proposta. No es prenen decisions amb efectes jurídics de manera exclusivament automatitzada.</p>
      <h2>Destinataris</h2>
      <p>Proveïdors tecnològics que actuen per compte nostre (allotjament i base de dades, servidors web, correu, missatgeria i lectura de documents), amb contracte d&apos;encàrrec de tractament. Si decideixes contractar, la comercialitzadora escollida rebrà les dades necessàries per formalitzar el contracte. Quan algun proveïdor estigui fora de l&apos;Espai Econòmic Europeu, les transferències es fan amb les garanties previstes al RGPD.</p>
      <h2>Durant quant de temps</h2>
      <p>Les sol·licituds que no acaben en contracte es conserven com a màxim dos anys i després s&apos;anonimitzen o s&apos;esborren. Si et fas client, les dades es conserven mentre duri la relació i els terminis legals posteriors. Els registres de consentiment es conserven com a prova mentre siguin necessaris.</p>
      <h2>Els teus drets</h2>
      <p>Pots demanar l&apos;accés, la rectificació, la supressió, l&apos;oposició, la limitació i la portabilitat de les teves dades, i retirar el consentiment, adreçant-te a {COMPANY.legalName}{contact ? ` (${contact})` : ""} o a l&apos;oficina. També pots reclamar davant l&apos;Agència Espanyola de Protecció de Dades (aepd.es).</p>
    </LegalShell>
  );
}
