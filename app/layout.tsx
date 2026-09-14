import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SIMKA — SIM и eSIM для путешествий",
  description: "Купить eSIM или физическую SIM для поездки. Тарифы проверенных операторов в 120+ странах.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
