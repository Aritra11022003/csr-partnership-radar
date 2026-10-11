import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "CSR Partnership Radar",
  description: "Weekly AI digest of CSR partnership opportunities in education and skilling — built for a Pune NGO.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div className="wrap">
            <Link href="/" className="brand">
              <span className="dot" /> CSR Partnership Radar
            </Link>
            <div className="links">
              <Link href="/">Latest</Link>
              <Link href="/digest">Archive</Link>
              <Link href="/settings">Settings</Link>
              <Link href="/how-it-works">How it works</Link>
            </div>
          </div>
        </nav>
        <main>
          <div className="wrap">{children}</div>
        </main>
        <footer>
          <div className="wrap">
            AI-generated with Gemini Flash from live public news — every item links to its source and quotes it verbatim; verify before outreach.
            The radar never contacts companies. Delivered every Monday 07:00 IST.
          </div>
        </footer>
      </body>
    </html>
  );
}
