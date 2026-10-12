"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { explorerUrl } from "@/lib/env";

type Toast = { id: number; kind: "success" | "error" | "info"; title: string; body?: string; tx?: string };

const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.kind === "error" ? 12_000 : 7_000);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-50 flex flex-col gap-2 sm:w-96" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`rounded-xl border px-4 py-3 shadow-xl shadow-[#0b1220]/10 bg-surface text-sm ${
              t.kind === "error" ? "border-bad/40" : t.kind === "success" ? "border-good/40" : "border-border"
            }`}
          >
            <div className={`font-medium ${t.kind === "error" ? "text-bad" : t.kind === "success" ? "text-good" : ""}`}>{t.title}</div>
            {t.body && <div className="mt-1 text-muted break-words">{t.body}</div>}
            {t.tx && (
              <a className="mt-1 inline-block text-accent underline" href={explorerUrl("tx", t.tx)} target="_blank" rel="noreferrer">
                View transaction ↗
              </a>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
