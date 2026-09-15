import type { Metadata, Viewport } from "next";
import { AnalyticsProvider } from "@/app/components/analytics-provider";
import { DEFAULT_DESCRIPTION, SITE_NAME, SITE_ORIGIN } from "@/lib/seo";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  applicationName: SITE_NAME,
  title: "SIMKA — SIM и eSIM для путешествий",
  description: DEFAULT_DESCRIPTION,
  category: "travel",
  referrer: "strict-origin-when-cross-origin",
  formatDetection: { email: false, address: false, telephone: false },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: SITE_NAME,
    url: SITE_ORIGIN,
    title: "SIMKA — SIM и eSIM для путешествий",
    description: DEFAULT_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: "SIMKA — SIM и eSIM для путешествий",
    description: DEFAULT_DESCRIPTION,
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  ...(process.env.GOOGLE_SITE_VERIFICATION ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } } : {}),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased"><AnalyticsProvider />{children}</body>
    </html>
  );
}
