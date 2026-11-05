/** Errors del proveïdor d'IA: es mostra el motiu real (abans només «Proveïdor d'IA: 400»). */
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { aiFailure } from "@/server/ai";

const res = (status: number, type: string, message: string) => new Response(JSON.stringify({ type: "error", error: { type, message } }), { status });
describe("aiFailure", () => {
  it("tradueix els errors habituals", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await aiFailure(res(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."))).toMatch(/no té saldo/);
    expect(await aiFailure(res(401, "authentication_error", "invalid x-api-key"))).toMatch(/ANTHROPIC_API_KEY no és vàlida/);
    expect(await aiFailure(res(404, "not_found_error", "model: claude-x"))).toMatch(/model configurat/);
    expect(await aiFailure(res(400, "invalid_request_error", "max_tokens: 16000 > 8192, which is the maximum allowed"))).toMatch(/respostes tan llargues/);
    expect(await aiFailure(res(400, "invalid_request_error", "A maximum of 100 PDF pages may be provided."))).toMatch(/massa pàgines/);
    expect(await aiFailure(res(400, "invalid_request_error", "messages.0: something else"))).toBe("Proveïdor d'IA: 400 · messages.0: something else");
  });
});
