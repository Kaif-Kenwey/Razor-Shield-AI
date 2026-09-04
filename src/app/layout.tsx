import type { Metadata, Viewport } from "next";
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
  title: "RazorShield AI — Payment Risk Investigation",
  description:
    "AI-powered payment risk detection & investigation agent. Detect anomalies, investigate evidence, act with confidence.",
  keywords: [
    "RazorShield",
    "payment risk",
    "fraud investigation",
    "AI risk engine",
    "fintech security",
  ],
  icons: {
    icon: "/shield-mark.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#05070b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-surface-0 text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
