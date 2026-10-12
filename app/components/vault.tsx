"use client";

import { useRef, type PointerEvent } from "react";
import { IconLock, UsdcIcon, UsdtIcon } from "./icons";
import { usePauseOffscreen } from "./motion";

const COIN_LAYERS = 9;

/**
 * Hero illustration of the product: SOL locked in a glass escrow cube, stablecoins
 * streaming out. Pure CSS 3D (no WebGL), tilts toward the pointer, pauses off screen.
 */
export function Vault() {
  const sceneRef = usePauseOffscreen<HTMLDivElement>();
  const tiltRef = useRef<HTMLDivElement>(null);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const tilt = tiltRef.current;
    if (!tilt || e.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    tilt.style.setProperty("--ty", `${x * 24}deg`);
    tilt.style.setProperty("--tx", `${-y * 16}deg`);
  };
  const onLeave = () => {
    tiltRef.current?.style.setProperty("--ty", "0deg");
    tiltRef.current?.style.setProperty("--tx", "0deg");
  };

  return (
    <div
      ref={sceneRef}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className="vault-scene relative mx-auto flex h-[380px] w-full max-w-[520px] items-center justify-center select-none sm:h-[460px]"
      role="img"
      aria-label="Illustration: SOL locked in an on-chain escrow vault while USDC and USDT flow out to the borrower"
    >
      <div className="vault-glow absolute top-1/2 left-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2" aria-hidden />
      <div className="vault-shadow absolute bottom-6 left-1/2 h-10 w-72 -translate-x-1/2 sm:bottom-8" aria-hidden />

      <div className="vault relative" aria-hidden>
        <div ref={tiltRef} className="vault-tilt">
          <div className="vault-spin">
            {["f1", "f2", "f3", "f4", "f5", "f6"].map((f) => (
              <div key={f} className={`vault-face ${f}`} />
            ))}
          </div>
          <div className="vault-coin">
            {Array.from({ length: COIN_LAYERS }, (_, i) => (
              <div key={i} className="vault-coin-layer" style={{ transform: `translateZ(${(i - (COIN_LAYERS - 1) / 2) * 1.4}px)` }} />
            ))}
            <div className="vault-coin-face" style={{ transform: `translateZ(${((COIN_LAYERS - 1) / 2) * 1.4 + 0.5}px)` }}>
              <SolMark />
            </div>
            <div className="vault-coin-face" style={{ transform: `rotateY(180deg) translateZ(${((COIN_LAYERS - 1) / 2) * 1.4 + 0.5}px)` }}>
              <SolMark />
            </div>
          </div>
        </div>
      </div>

      {/* Stablecoins leaving the vault for the borrower's wallet */}
      <div className="pointer-events-none absolute top-[56%] left-[56%]" aria-hidden>
        {[
          { icon: <UsdcIcon size={34} />, d: "0s", x: "150px", y: "110px" },
          { icon: <UsdtIcon size={30} />, d: "1.4s", x: "175px", y: "40px" },
          { icon: <UsdcIcon size={26} />, d: "2.8s", x: "120px", y: "150px" },
        ].map((c, i) => (
          <span key={i} className="flow-coin drop-shadow-[0_6px_14px_#0b122040]" style={{ ["--d" as string]: c.d, ["--x" as string]: c.x, ["--y" as string]: c.y }}>
            {c.icon}
          </span>
        ))}
      </div>

      <div className="float-chip absolute top-6 left-0 sm:top-10 sm:left-2" aria-hidden>
        <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-surface/90 px-3.5 py-2.5 shadow-[0_12px_32px_-12px_#0b122040] backdrop-blur">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <IconLock width={16} height={16} />
          </span>
          <span>
            <span className="block text-xs font-semibold">Escrow PDA</span>
            <span className="block text-[11px] text-muted">Owned by the Loomzk program</span>
          </span>
        </div>
      </div>
      <div className="float-chip absolute right-0 bottom-10 sm:right-2 sm:bottom-14" style={{ ["--d" as string]: "-3s" }} aria-hidden>
        <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-surface/90 px-3.5 py-2.5 shadow-[0_12px_32px_-12px_#0b122040] backdrop-blur">
          <span className="flex -space-x-1.5">
            <UsdcIcon size={22} />
            <UsdtIcon size={22} />
          </span>
          <span>
            <span className="block text-xs font-semibold">Sent in the same transaction</span>
            <span className="block text-[11px] text-muted">To your wallet, or any wallet</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Solana's three bars, sized to the coin face. */
function SolMark() {
  return (
    <svg viewBox="0 0 32 32" className="h-[62%] w-[62%] drop-shadow-[0_0_12px_#14f19555]" aria-hidden>
      <defs>
        <linearGradient id="vault-sol" x1="6" y1="24" x2="26" y2="8" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9945ff" />
          <stop offset="1" stopColor="#14f195" />
        </linearGradient>
      </defs>
      <path d="M8.5 21.5h14l-2.5 3H6zM8.5 14.5h14l-2.5 3H6zM11 7.5h15l-2.5 3H8.5z" fill="url(#vault-sol)" />
    </svg>
  );
}
