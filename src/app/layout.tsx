import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "next-themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CaptionHarvest — YouTube Playlist Transcript Extractor",
  description: "Paste a YouTube playlist URL and download every video's captions as a tidy ZIP of SRT + TXT files, with a CSV manifest. No API key, no quota.",
  keywords: ["YouTube", "playlist", "transcript", "captions", "subtitles", "SRT", "extractor"],
  authors: [{ name: "CaptionHarvest" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "CaptionHarvest",
    description: "YouTube Playlist → Captions in minutes",
    siteName: "CaptionHarvest",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "CaptionHarvest",
    description: "YouTube Playlist → Captions in minutes",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
