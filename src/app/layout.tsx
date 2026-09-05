import type { Metadata, Viewport } from "next";
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

/* Type system for the command center: Space Grotesk carries headings and
 * the wordmark (technical without being sci-fi), IBM Plex Sans is the
 * body face (built for dense enterprise screens), and IBM Plex Mono does
 * everything terminal — metrics, IDs and the uppercase HUD labels. */
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
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
        className={`${spaceGrotesk.variable} ${plexSans.variable} ${plexMono.variable} antialiased bg-surface-0 text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
