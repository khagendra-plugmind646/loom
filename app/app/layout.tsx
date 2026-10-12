import type { Metadata } from "next";
import Link from "next/link";
import { Inter, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { FeedbackButton } from "@/components/feedback-button";
import { Logo, Nav } from "@/components/nav";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Absolute base for link-preview images: the production domain on Vercel, localhost in development.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Loom — SOL-backed stablecoin loans",
  description:
    "Borrow USDC or USDT against SOL. Collateral sits in on-chain escrow, terms are enforced by a public Solana program, and repayments can be proven with zero-knowledge certificates.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <Providers>
          <Nav />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-12">{children}</main>
          <FeedbackButton />
          <footer className="border-t border-border bg-surface">
            <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
              <div>
                <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                  <Logo />
                  Loom
                </div>
                <p className="mt-3 max-w-xs text-sm text-muted">
                  Non-custodial, fixed-rate stablecoin loans backed by SOL. Every account is public and verifiable on Solana.
                </p>
              </div>
              <FooterCol title="Product" links={[["/borrow", "Borrow"], ["/loans", "My loans"], ["/earn", "Earn"], ["/wallet", "Wallet"]]} />
              <FooterCol title="Trust" links={[["/transparency", "Proof of reserves"], ["/certificate", "ZK certificates"]]} />
              <FooterCol title="Support" links={[["/test", "Help us test"], ["/help", "Help / contact us"]]} />
            </div>
            <div className="border-t border-border">
              <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-muted sm:flex-row sm:justify-between">
                <span>© Loom. Built on Solana.</span>
                <span>Loans carry risk: if SOL falls to 60% of its opening price, the collateral is seized.</span>
              </div>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div className="flex flex-col gap-2.5 text-sm">
      <span className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-fg">{title}</span>
      {links.map(([href, label]) => (
        <Link key={href} href={href} className="text-muted transition hover:text-fg">
          {label}
        </Link>
      ))}
    </div>
  );
}
