import type { ReactNode, SVGProps } from "react";

/* Token marks: simplified, drawn here so the app needs no external images. */

export function SolIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="sol-mark" x1="4" y1="26" x2="28" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9945ff" />
          <stop offset="1" stopColor="#14f195" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15.5" fill="#0b1220" stroke="var(--border-strong)" />
      <path d="M10 20.5h11.5l-1.8 2H8.2zM10 15h11.5l-1.8 2H8.2zM12.3 9.5h11.5l-1.8 2H10.5z" fill="url(#sol-mark)" />
    </svg>
  );
}

export function ChainlinkIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="16" fill="#375bd2" />
      <path d="M16 7.5l7.4 4.25v8.5L16 24.5l-7.4-4.25v-8.5z" fill="none" stroke="white" strokeWidth="2.6" strokeLinejoin="miter" />
    </svg>
  );
}

export function UsdcIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="16" fill="#2775ca" />
      <text x="16" y="21.5" textAnchor="middle" fontSize="15" fontWeight="700" fill="white" fontFamily="system-ui">$</text>
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="white" strokeWidth="1.6" strokeDasharray="15 5" />
    </svg>
  );
}

export function UsdtIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="16" fill="#26a17b" />
      <path d="M9.5 9h13v3h-5v2.2c3 .2 5 .8 5 1.6s-2 1.4-5 1.6V24h-3v-6.6c-3-.2-5-.8-5-1.6s2-1.4 5-1.6V12h-5z" fill="white" />
    </svg>
  );
}

/* Line icons (24px grid, 1.6 stroke) */

function Line({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      {children}
    </svg>
  );
}

export const IconShield = (p: SVGProps<SVGSVGElement>) => (
  <Line {...p}>
    <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z" />
    <path d="m9 12 2 2 4-4" />
  </Line>
);
export const IconLock = (p: SVGProps<SVGSVGElement>) => (
  <Line {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Line>
);
export const IconEye = (p: SVGProps<SVGSVGElement>) => (
  <Line {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Line>
);
export const IconBolt = (p: SVGProps<SVGSVGElement>) => (
  <Line {...p}>
    <path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z" />
  </Line>
);
export const IconChart = (p: SVGProps<SVGSVGElement>) => (
  <Line {...p}>
    <path d="M4 19.5h16M7 16v-4M11.5 16V8M16 16v-6.5" />
  </Line>
);
export const IconKey = (p: SVGProps<SVGSVGElement>) => (
  <Line {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 8.5-8.5M16.5 6l2 2M14.5 8l1.5 1.5" />
  </Line>
);
export const IconFile = (p: SVGProps<SVGSVGElement>) => (
  <Line {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Line>
);
export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <Line {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Line>
);
export const IconAlert = (p: SVGProps<SVGSVGElement>) => (
  <Line {...p}>
    <path d="M12 3.5 2.5 20h19z" />
    <path d="M12 10v4M12 17h.01" />
  </Line>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <Line {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Line>
);
export const IconX = (p: SVGProps<SVGSVGElement>) => (
  <Line {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Line>
);
export const IconArrow = (p: SVGProps<SVGSVGElement>) => (
  <Line width="16" height="16" {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Line>
);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <Line {...p}>
    <path d="M12 5v14M5 12h14" />
  </Line>
);
