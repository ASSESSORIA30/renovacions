"use client";

import { useRef, useState, type ReactNode } from "react";
import { cn } from "./ui";

/**
 * Accessible file drop zone: drag & drop, click, and keyboard (Enter/Space).
 * Dropped files are filtered by `accept` (extensions and MIME types, incl. wildcards like image/*).
 */
export function DropZone({ accept, disabled, multiple, onFiles, onReject, children, className }: {
  accept?: string;
  disabled?: boolean;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  onReject?: (msg: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const accepts = (f: File) => {
    if (!accept) return true;
    const name = f.name.toLowerCase();
    return accept.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean).some((a) =>
      a.startsWith(".") ? name.endsWith(a) : a.endsWith("/*") ? f.type.toLowerCase().startsWith(a.slice(0, -1)) : f.type.toLowerCase() === a,
    );
  };

  const take = (list: FileList | null) => {
    const all = Array.from(list ?? []);
    if (!all.length) return;
    const ok = all.filter(accepts);
    if (!ok.length) { onReject?.(`Format no admès (${all.map((f) => f.name).join(", ")}).`); return; }
    onFiles(multiple ? ok : ok.slice(0, 1));
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); input.current?.click(); } }}
      onDragEnter={(e) => { e.preventDefault(); if (disabled) return; depth.current++; setOver(true); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = disabled ? "none" : "copy"; }}
      onDragLeave={(e) => { e.preventDefault(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); depth.current = 0; setOver(false); if (!disabled) take(e.dataTransfer.files); }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40",
        over ? "border-brand bg-brand/[0.06]" : "border-line hover:border-brand",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      {children}
      <input
        ref={input}
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => { take(e.target.files); e.target.value = ""; }}
      />
    </div>
  );
}

/** Filtra fitxers per `accept` (extensions i tipus MIME, també «image/*»). */
export function acceptsFile(f: File, accept?: string) {
  if (!accept) return true;
  const name = f.name.toLowerCase();
  return accept.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean).some((a) =>
    a.startsWith(".") ? name.endsWith(a) : a.endsWith("/*") ? f.type.toLowerCase().startsWith(a.slice(0, -1)) : f.type.toLowerCase() === a,
  );
}

/**
 * Zona d'arrossegar i deixar anar que EMBOLCALLA qualsevol contingut existent (un botó «Puja», una targeta, una
 * llista…) sense canviar-ne el disseny: en arrossegar-hi fitxers es ressalta i, en deixar-los, crida `onFiles`.
 * El clic continua fent el que feia el contingut (normalment obrir el selector de fitxers).
 */
export function DropArea({ accept, disabled, multiple, onFiles, onReject, children, className, label = "Deixa anar el fitxer aquí" }: {
  accept?: string;
  disabled?: boolean;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  onReject?: (msg: string) => void;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  return (
    <div
      className={cn("relative", className)}
      data-droparea=""
      onDragEnter={(e) => { if (!hasFiles(e)) return; e.preventDefault(); if (disabled) return; depth.current++; setOver(true); }}
      onDragOver={(e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = disabled ? "none" : "copy"; }}
      onDragLeave={(e) => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault(); depth.current = 0; setOver(false);
        if (disabled) return;
        const all = Array.from(e.dataTransfer.files ?? []);
        if (!all.length) return;
        const ok = all.filter((f) => acceptsFile(f, accept));
        if (!ok.length) { onReject?.(`Format no admès (${all.map((f) => f.name).join(", ")}).`); return; }
        onFiles(multiple ? ok : ok.slice(0, 1));
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-xl border-2 border-dashed border-brand bg-brand/[0.08] text-[12.5px] font-semibold text-brand" aria-hidden>
          {label}
        </div>
      )}
    </div>
  );
}
