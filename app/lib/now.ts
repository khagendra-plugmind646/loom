"use client";

import { useSyncExternalStore } from "react";

// Wall-clock seconds, quantized to 15s so snapshots are stable between renders.
// Returns 0 during server prerendering; callers treat 0 as "unknown yet".
const STEP = 15;
const subscribe = (cb: () => void) => {
  const id = setInterval(cb, STEP * 1000);
  return () => clearInterval(id);
};
const getSnapshot = () => Math.floor(Date.now() / 1000 / STEP) * STEP;
const getServerSnapshot = () => 0;

export const useNow = () => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
