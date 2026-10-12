"use client";

import { decodeNote, encodeNote, type CreditNote } from "@loom/sdk";

// Credit notes are the borrower's private ZK key material. They never leave the
// browser unless the user downloads them. Losing a note only means losing the
// ability to mint a privacy-preserving certificate — never funds.
const KEY = "loom.credit-notes.v1";

type Stored = Record<string, string>; // loan address -> encoded note

function read(): Stored {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function saveNote(loan: string, note: CreditNote) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [loan]: encodeNote(note) }));
  } catch {
    /* storage unavailable — the user still has the downloaded copy */
  }
}

export function loadNote(loan: string): CreditNote | null {
  const s = read()[loan];
  return s ? decodeNote(s) : null;
}

export function downloadNote(loan: string, note: CreditNote) {
  const blob = new Blob(
    [
      `Loom credit note — keep this private.\n` +
        `Loan: ${loan}\n` +
        `It lets you mint an anonymous ZK repayment certificate after you repay.\n\n` +
        `${encodeNote(note)}\n`,
    ],
    { type: "text/plain" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `loom-credit-note-${loan.slice(0, 8)}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Every note saved in this browser, by loan address. */
export function savedNotes(): { loan: string; note: CreditNote }[] {
  return Object.entries(read()).flatMap(([loan, s]) => {
    try {
      return [{ loan, note: decodeNote(s) }];
    } catch {
      return [];
    }
  });
}

/** Accepts either the raw note string or the downloaded .txt contents. */
export function extractNote(text: string): CreditNote {
  const line = text.split(/\s+/).find((l) => l.startsWith("loom-note-v1:"));
  if (!line) throw new Error("No Loom credit note found");
  return decodeNote(line);
}
