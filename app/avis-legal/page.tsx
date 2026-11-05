import type { Metadata } from "next";
import { COMPANY } from "@/core/capture";
import { LegalShell } from "@/ui/LegalShell";

export const metadata: Metadata = { title: "Avís legal · Assessoria 3.0" };

export default function Legal() {
  return (
    <LegalShell title="Avís legal">
      <h2>Titular del web</h2>
      <p>{COMPANY.legalName}{COMPANY.taxId ? ` · ${COMPANY.taxId}` : ""} · {COMPANY.address} · Telèfon {COMPANY.phone} · {COMPANY.web}</p>
      <h2>Informació comercial</h2>
      <p>Els estudis i les propostes es basen en les dades de la factura facilitada i en les tarifes vigents de les comercialitzadores amb què treballem en la data del càlcul. Són estimacions: no garanteixen un estalvi concret, que depèn del consum real i de les condicions de cada comercialitzadora.</p>
      <h2>Propietat intel·lectual</h2>
      <p>Els continguts, la marca i el logotip d&apos;Assessoria 3.0 són propietat del titular o s&apos;utilitzen amb autorització.</p>
    </LegalShell>
  );
}
