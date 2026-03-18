import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Capucinne Inquiry Atelier",
  description: "Internal jewelry inquiry workspace backed by Google Sheets or local mock data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
