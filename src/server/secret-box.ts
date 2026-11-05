/**
 * Xifrat de secrets desats a la base de dades (AES-256-GCM, autenticat).
 * Clau: SETTINGS_ENCRYPTION_KEY si existeix; si no, derivada (HKDF-SHA256) de SUPABASE_SERVICE_ROLE_KEY.
 * Tots dos valors són només del servidor. Si la clau canvia, els secrets antics no es poden desxifrar
 * i cal tornar-los a introduir (es detecta i s'avisa; mai es retorna un valor erroni).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";

function keyFrom(material: string, purpose: string): Buffer {
  if (!material || material.length < 16) throw new Error("No hi ha clau de xifrat al servidor (SETTINGS_ENCRYPTION_KEY o SUPABASE_SERVICE_ROLE_KEY).");
  return Buffer.from(hkdfSync("sha256", Buffer.from(material, "utf8"), Buffer.from("assessoria30-settings", "utf8"), Buffer.from(purpose, "utf8"), 32));
}

export function seal(plain: string, material: string, purpose: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFrom(material, purpose), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [VERSION, iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

/** Retorna null si el valor no es pot desxifrar (clau canviada o dades alterades). */
export function open(sealed: string, material: string, purpose: string): string | null {
  try {
    const [v, iv, tag, ct] = sealed.split(":");
    if (v !== VERSION || !iv || !tag || !ct) return null;
    const d = createDecipheriv("aes-256-gcm", keyFrom(material, purpose), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
