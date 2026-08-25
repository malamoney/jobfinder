import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jobfinder",
  description:
    "Fetches job openings on a schedule, filters them against your stated criteria, and presents the matches for review.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
