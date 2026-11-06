import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Verdant — Smart Plant Watering",
  description:
    "Live soil moisture telemetry from an ESP32, with Supabase history and Telegram alerts.",
  applicationName: "Verdant",
  authors: [{ name: "Smart Plant Watering" }],
  keywords: [
    "ESP32",
    "IoT",
    "soil moisture",
    "Supabase",
    "Next.js",
    "Telegram",
  ],
  openGraph: {
    title: "Verdant — Smart Plant Watering",
    description:
      "A portfolio-grade IoT dashboard: ESP32 telemetry, Supabase history, and Telegram alerts.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#040b08",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
