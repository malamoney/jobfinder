import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // `data-theme="dark"` is static here — dark is the default and the only
    // theme until #79 adds the cookie-driven toggle. Setting the light values
    // by hand on this attribute is enough to preview them.
    <html
      lang="en"
      data-theme="dark"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="bg-bg font-sans text-text antialiased">{children}</body>
    </html>
  );
}
