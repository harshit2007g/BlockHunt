import type { Metadata, Viewport } from "next";
import { Pixelify_Sans } from "next/font/google";
import "./globals.css";

const pixelify = Pixelify_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BlockHunt '26",
  description:
    "A beginner-friendly blockchain puzzle hunt by the Blockchain Division, Cyber Labs, IIT (ISM) Dhanbad.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={pixelify.variable}>{children}</body>
    </html>
  );
}
