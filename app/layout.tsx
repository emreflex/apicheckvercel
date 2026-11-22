import type { Metadata } from "next";
import "@fontsource-variable/geist";
import "./globals.css";
import "./forms.css";

export const metadata: Metadata = {
  title: "Takip Defteri",
  description: "Instagram takip isteklerini arşivlerinden incele.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
