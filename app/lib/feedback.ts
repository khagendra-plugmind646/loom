/** Tester feedback, sent from the Feedback button on any page. */
export interface Feedback {
  id: string;
  createdAt: number;
  /** 1–5, or null if skipped. */
  rating: number | null;
  area: FeedbackArea;
  message: string;
  contact: string | null;
  wallet: string | null;
  /** Page the tester was on. */
  page: string | null;
}

export const FEEDBACK_AREAS = ["Borrowing", "Repaying", "Earn (lending pool)", "ZK certificate", "Website / design", "Other"] as const;
export type FeedbackArea = (typeof FEEDBACK_AREAS)[number];
export const FEEDBACK_LIMITS = { message: 2_000, contact: 200 } as const;
