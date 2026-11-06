import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { TITLE_TEMPLATE } from "@/lib/page-title";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://talib.annisaasekolahku.com"),
  title: {
    default: "Talib — by An Nisaa' Sekolahku",
    template: TITLE_TEMPLATE,
  },
  description:
    "Talib adalah platform manajemen sekolah An Nisaa' Sekolahku — kehadiran, jurnal harian, tagihan, dan komunikasi orang tua dalam satu tempat.",
  applicationName: "Talib",
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    locale: "id_ID",
    siteName: "Talib by An Nisaa' Sekolahku",
    title: "Talib — Platform Sekolah An Nisaa'",
    description:
      "Kehadiran, jurnal harian, tagihan, komunikasi orang tua dalam satu tempat.",
    url: "https://talib.annisaasekolahku.com",
  },
  twitter: {
    card: "summary_large_image",
    title: "Talib — Platform Sekolah An Nisaa'",
    description:
      "Kehadiran, jurnal harian, tagihan, komunikasi orang tua dalam satu tempat.",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport = {
  themeColor: "#0F172A",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      className={`${plusJakarta.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider>
          {children}
        </TooltipProvider>
        <Toaster />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
