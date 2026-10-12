/** A message a borrower sends to the admin, e.g. when the payout wallet can't fund their loan. */
export interface SupportMessage {
  id: string;
  createdAt: number;
  kind: "insufficient-funds" | "general";
  wallet: string | null;
  coin: string | null;
  /** Requested amount, in whole stablecoin units as typed by the user. */
  amount: string | null;
  contact: string;
  message: string;
  handled: boolean;
}

export const SUPPORT_LIMITS = { contact: 200, message: 2_000 } as const;

