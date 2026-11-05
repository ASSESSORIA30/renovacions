"use client";
/**
 * Captura els errors de renderitzat d'una part de la pantalla perquè no facin caure tot el CRM.
 * Mostra un avís amb «Torna-ho a provar» i registra l'error a la consola (amb l'etiqueta de la zona).
 * Canviar `resetKey` (p. ex. la pestanya o el contracte obert) restableix l'estat automàticament.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

type Props = { children: ReactNode; label: string; resetKey?: unknown; fallback?: (retry: () => void, error: Error) => ReactNode };
type State = { error: Error | null; key: unknown };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info.componentStack);
  }

  retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.retry, error);
    return (
      <div role="alert" className="flex flex-col items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-5 py-8 text-center text-[13px] text-amber-900 dark:text-amber-100">
        <AlertTriangle size={20} />
        <p className="font-medium">No s&apos;ha pogut mostrar «{this.props.label}».</p>
        <p className="text-[12px] opacity-80">La resta del CRM continua funcionant. Si torna a passar, avisa l&apos;administrador.</p>
        <button type="button" onClick={this.retry} className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-current/30 px-3 py-1.5 text-[12px] font-medium hover:bg-black/5">
          <RotateCcw size={13} /> Torna-ho a provar
        </button>
      </div>
    );
  }
}
