/** Text the admin wallet signs to open admin-only data (help inbox, database); `signedAt` (ms) keeps signatures short-lived. */
export const adminAuthMessage = (signedAt: number) => `Loom admin access\nSigned at: ${signedAt}`;

/** Request headers that carry the admin signature. */
export type AdminAuth = { wallet: string; signedAt: number; signature: string };
export const adminHeaders = (a: AdminAuth) => ({ "x-loom-wallet": a.wallet, "x-loom-signed-at": String(a.signedAt), "x-loom-signature": a.signature });
