import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { readTheme } from "./theme-server";

// Self-hosted at build time by `next/font` (no request to Google from the
// browser). Inter is the prose face; JetBrains Mono carries anything numeric or
// structural — salaries, counts, source names. Both are exposed as CSS
// variables that `globals.css` reads into `--font-sans` / `--font-mono`.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Jobfinder",
  description:
    "Fetches job openings on a schedule, filters them against your stated criteria, and presents the matches for review.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Read the theme cookie and set `data-theme` here, server-side, so the first
  // paint is already in the visitor's palette — no white flash (#79). A visitor
  // who has never touched the toggle gets dark. This opts the app out of static
  // prerendering, which costs nothing here: every page is already dynamic
  // (auth, headers, the database).
  const theme = await readTheme();

  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="bg-bg font-sans text-text antialiased">{children}</body>
    </html>
  );
}
