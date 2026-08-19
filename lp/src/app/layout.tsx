import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import "./globals.css";

const title = "Mac Classic Player";
const description =
  "A lightweight, keyboard-friendly media player for macOS — inspired by Media Player Classic.";

export const metadata: Metadata = {
  metadataBase: new URL("https://mcp.kkweb.io"),
  alternates: { canonical: "/" },
  title,
  description,
  openGraph: {
    title,
    description,
    url: "https://mcp.kkweb.io",
    siteName: title,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
