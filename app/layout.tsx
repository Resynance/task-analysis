import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

const sans = IBM_Plex_Sans({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Task Analysis",
  description:
    "Score prompts with an LLM against your rubric, explore task quality and coaching signals, and export reports.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full`}
    >
      <body className="min-h-full font-[family-name:var(--font-sans)] text-zinc-100 antialiased">
        <div className="min-h-full bg-zinc-950 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(251,191,36,0.12),transparent),radial-gradient(ellipse_80%_50%_at_100%_0%,rgba(59,130,246,0.06),transparent)]">
          <SiteHeader />
          <main className="flex min-h-[calc(100vh-4rem)] flex-col">{children}</main>
        </div>
      </body>
    </html>
  );
}
