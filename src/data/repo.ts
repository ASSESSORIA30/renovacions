import type { ImportReport } from "@/core/importer";
import type { Activity, CrmState, Integrations, Offer, ProposalDoc, Settings, SourceContract, Task, Template, User } from "@/core/types";

export interface Snapshot {
  source: SourceContract[];
  states: Record<string, CrmState>;
  activities: Activity[];
  tasks: Task[];
  docs: ProposalDoc[];
  offers: Offer[];
  templates: Template[];
  settings: Settings;
  users: User[];
  me: User;
  lastSync: { at: string; report: ImportReport | null; origin: string; error?: string | null; errorAt?: string | null } | null;
}

export class ConflictError extends Error {
  constructor(public current: CrmState) {
    super("Una altra persona ha modificat el contracte. S'han carregat les dades més recents.");
  }
}

export interface EmailPayload { to: string; subject: string; body: string; contractId: string; attachment?: { fileName: string; base64: string } }
export interface AiPayload { kind: "analysis" | "message" | "chat"; contractId: string; tone?: string; channel?: "whatsapp" | "email"; goal?: string; question?: string; lang?: "ca" | "es"; context: unknown }

export interface ManagedUser extends User { lastSignIn?: string | null; invited?: boolean; suspended?: boolean; mfa?: boolean; link?: string | null; emailSent?: boolean; emailError?: string | null }
export interface NewUser { name: string; email: string; role: User["role"]; code: string | null; password?: string }

export interface Repo {
  mode: "demo" | "supabase";
  /** demo = single-file demo; unconfigured = Next.js deployed without Supabase */
  variant?: "demo" | "unconfigured";
  load(): Promise<Snapshot>;
  saveState(next: CrmState, expectedVersion: number): Promise<CrmState>;
  addActivity(a: Activity): Promise<void>;
  updateActivity(a: Activity): Promise<void>;
  upsertTask(t: Task): Promise<void>;
  addDoc(d: ProposalDoc, pdf: Blob): Promise<ProposalDoc>;
  getDocUrl(d: ProposalDoc): Promise<string | null>;
  saveTemplates(t: Template[]): Promise<void>;
  saveSettings(s: Settings): Promise<void>;
  /** Replace source data (sync). CRM state is preserved. */
  importSource(contracts: SourceContract[], report: ImportReport, origin: string): Promise<{ added: number; updated: number; unchanged: number }>;
  /** Server-side sync from Google Drive/Sheets (only when configured). */
  syncRemote?(): Promise<{ added: number; updated: number; unchanged: number; report: ImportReport }>;
  integrations(): Promise<Integrations>;
  sendEmail?(p: EmailPayload): Promise<{ id: string; accepted: boolean }>;
  ai?(p: AiPayload): Promise<string>;
  switchUser?(id: string): Promise<User>;
  listUsers?(): Promise<ManagedUser[]>;
  createUser?(u: NewUser): Promise<ManagedUser>;
  updateUser?(id: string, patch: Partial<NewUser> & { suspended?: boolean }): Promise<void>;
  deleteUser?(id: string): Promise<void>;
  reset?(): Promise<void>;
}
