import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ThermalOps Agent — Autonomous Heat-Safety Decisions",
  description:
    "Autonomous AI agent that monitors hyperlocal heat at outdoor worksites, fuses FortyGuard Temperature API with CDC SVI data, and decides whether to issue worker safety alerts. Built for the FortyGuard Global AI Hackathon 2026.",
  keywords: [
    "FortyGuard",
    "heat safety",
    "agentic AI",
    "Gemini",
    "CDC SVI",
    "OSHA",
    "wet-bulb temperature",
  ],
  authors: [{ name: "ThermalOps Agent" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
