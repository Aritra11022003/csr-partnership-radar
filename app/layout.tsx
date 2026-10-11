import type { Metadata } from "next";
import Link from "next/link";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Fraunces({ subsets: ["latin"], variable: "--font-display", display: "swap", weight: ["500", "600", "700"] });

export const metadata: Metadata = {
  title: "CSR Partnership Radar",
  description: "Weekly AI digest of CSR partnership opportunities in education and skilling — built for a Pune NGO.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body>
        <nav className="nav">
          <div className="wrap">
            <Link href="/" className="brand">
              <span className="radar" aria-hidden /> CSR Partnership Radar
            </Link>
            <div className="links">
              <Link href="/">This week</Link>
              <Link href="/digest">Archive</Link>
              <Link href="/settings">Settings</Link>
              <Link href="/how-it-works">How it works</Link>
            </div>
          </div>
        </nav>
        <main>{children}</main>
        <footer>
          <div className="wrap">
            AI-generated with Gemini Flash from live public news. Every item links to its source and quotes it verbatim, so verify before outreach.
            The radar never contacts companies. Delivered every Monday at 07:00 IST.
          </div>
        </footer>
      </body>
    </html>
  );
}
