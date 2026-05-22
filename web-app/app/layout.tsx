import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "LinkedIn Referral Assistant",
  description: "Personal-use referral planner for LinkedIn job postings.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
            <Link href="/" className="font-semibold text-brand-dark">
              LinkedIn Referral Assistant
            </Link>
            <nav className="flex gap-2 text-sm">
              <Link href="/referral" className="btn-ghost">Referral</Link>
              <Link href="/history" className="btn-ghost">History</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
