import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { authConfigured } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Interview Copilot",
  description: "AI mock interviews tailored to the company, with proctoring, evaluation and learning sessions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const body = <body className="min-h-full font-sans">{children}</body>;
  if (!authConfigured()) return <html lang="en">{body}</html>;
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/sign-in">
      <html lang="en">{body}</html>
    </ClerkProvider>
  );
}
