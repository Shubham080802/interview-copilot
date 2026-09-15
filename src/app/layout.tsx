import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Interview Copilot",
  description: "AI mock interviews tailored to the company, with proctoring, evaluation and learning sessions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
