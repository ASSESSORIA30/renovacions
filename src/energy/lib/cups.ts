/**
 * Validación de CUPS (formato español): "ES" + 4 dígitos distribuidora +
 * 12 dígitos + 2 letras de control [+ 2 caracteres de frontera opcionales].
 * Letras de control: N(16 dígitos) mod 529 → (r div 23, r mod 23) sobre la tabla.
 */
const TABLE = "TRWAGMYFPDXBNJZSQVHLCKE";

export function normalizeCups(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[\s\-.]/g, "");
}

export function cupsControl(digits16: string): string {
  // 16 dígitos superan la precisión de Number: usar BigInt.
  const r = Number(BigInt(digits16) % BigInt(529));
  return TABLE[Math.floor(r / 23)] + TABLE[r % 23];
}

export function validateCups(raw: unknown): { valid: boolean; reason?: string } {
  const c = normalizeCups(raw);
  const m = /^ES(\d{16})([A-Z]{2})([0-9A-Z]{2})?$/.exec(c);
  if (!m) return { valid: false, reason: "Formato no válido (ES + 16 dígitos + 2 letras [+2])" };
  if (cupsControl(m[1]) !== m[2]) return { valid: false, reason: "Letras de control incorrectas" };
  return { valid: true };
}

/** Utilidad para generar CUPS válidos en datos de prueba. */
export function makeCups(digits16: string, suffix = "0F"): string {
  return `ES${digits16}${cupsControl(digits16)}${suffix}`;
}
