import type { Metadata } from "next";

import "@/app/globals.css";
import { APP_DISPLAY_TITLE } from "@/lib/app-version";

export const metadata: Metadata = {
  title: APP_DISPLAY_TITLE,
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
