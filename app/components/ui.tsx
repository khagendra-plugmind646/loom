import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { explorerUrl } from "@/lib/env";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_2px_#0b12200a] sm:p-6", className)}>{children}</section>;
}

export function CardTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="text-base font-semibold tracking-tight">{children}</h2>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-3 max-w-2xl text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** Shared button look, also used by links styled as buttons. */
export const buttonBase =
  "inline-flex h-10 items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

export const buttonVariant = {
  primary: "bg-ink text-ink-fg shadow-[0_1px_2px_#0b122033] hover:opacity-90",
  accent: "bg-accent text-accent-fg shadow-[0_1px_2px_#6142f540] hover:bg-accent-hover",
  secondary: "border border-border bg-surface text-fg shadow-[0_1px_2px_#0b12200a] hover:border-border-strong hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-fg",
  danger: "bg-bad text-white hover:opacity-90",
} as const;

export function Button({
  variant = "primary",
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonVariant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        buttonBase,
        buttonVariant[variant],
        className,
      )}
    >
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function Input({ className, suffix, ...props }: InputHTMLAttributes<HTMLInputElement> & { suffix?: ReactNode }) {
  return (
    <div className="flex h-11 items-center rounded-[10px] border border-border bg-surface px-3.5 transition hover:border-border-strong focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/10">
      <input {...props} className={cx("w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted", className)} />
      {suffix && <span className="ml-2 shrink-0 text-sm text-muted">{suffix}</span>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-[10px] bg-surface-2 p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("h-8 rounded-md px-3 text-sm transition", value === o.value ? "bg-surface font-semibold text-fg shadow-[0_1px_3px_#0b12201f]" : "text-muted hover:text-fg")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_2px_#0b12200a]">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cx("mt-1.5 text-2xl font-semibold tracking-tight tabular-nums", tone === "good" && "text-good", tone === "warn" && "text-warn", tone === "bad" && "text-bad")}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 text-sm last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium tabular-nums">{children}</span>
    </div>
  );
}

const badgeTone = {
  active: "bg-accent-soft text-accent",
  repaid: "bg-good-soft text-good",
  liquidated: "bg-bad-soft text-bad",
  defaulted: "bg-warn-soft text-warn",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  neutral: "bg-surface-2 text-muted",
} as const;

export function Badge({ tone, children }: { tone: keyof typeof badgeTone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", badgeTone[tone])}>{children}</span>;
}

export function Progress({ value, tone = "accent" }: { value: number; tone?: "accent" | "good" }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("h-full rounded-full", tone === "good" ? "bg-good" : "bg-accent")} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-lg bg-surface-2", className)} />;
}

export function Addr({ value, kind = "address" }: { value: string; kind?: "address" | "tx" }) {
  return (
    <a href={explorerUrl(kind, value)} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent hover:underline" title={value}>
      {value.slice(0, 4)}…{value.slice(-4)}
    </a>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: "neutral" | "warn" | "good" | "bad"; children: ReactNode }) {
  return (
    <div
      className={cx(
        "rounded-xl border px-4 py-3 text-sm",
        tone === "neutral" && "border-border bg-surface-2 text-muted",
        tone === "warn" && "border-warn/25 bg-warn-soft text-warn",
        tone === "good" && "border-good/25 bg-good-soft text-good",
        tone === "bad" && "border-bad/25 bg-bad-soft text-bad",
      )}
    >
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border-strong bg-surface p-12 text-center">
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}
