import type { Metadata } from "next";
import { headers } from "next/headers";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const baseMetadata: Metadata = {
  title: {
    default: "OENG ISOXML Studio",
    template: "%s · OENG ISOXML Studio",
  },
  description:
    "A browser-first engineering workspace for inspecting ISOXML task data, multi-PDV grids, references, values and validation evidence.",
  applicationName: "OENG ISOXML Studio",
  keywords: [
    "ISOXML",
    "ISO 11783",
    "precision agriculture",
    "geospatial",
    "task data",
  ],
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    shortcut: "/favicon.ico",
  },
  openGraph: {
    type: "website",
    title: "OENG ISOXML Studio",
    description:
      "Inspect ISOXML tasks, multi-PDV prescription grids and validation evidence locally in your browser.",
  },
  twitter: {
    card: "summary_large_image",
    title: "OENG ISOXML Studio",
    description:
      "A map-first ISOXML engineering and agronomy diagnostics workspace.",
  },
};

function metadataBaseFromHeaders(requestHeaders: {
  get(name: string): string | null;
}): URL {
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = (forwardedHost ?? requestHeaders.get("host") ?? "localhost:3000")
    .split(",")[0]
    .trim();
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    .trim();
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https";
  try {
    const url = new URL(`${protocol}://${host}`);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url
      : new URL("http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const metadataBase = metadataBaseFromHeaders(requestHeaders);
  const imageUrl = new URL("/og.png", metadataBase).toString();
  return {
    ...baseMetadata,
    metadataBase,
    openGraph: {
      ...baseMetadata.openGraph,
      images: [
        {
          url: imageUrl,
          width: 1733,
          height: 909,
          alt: "OENG ISOXML Studio map-first engineering workspace",
        },
      ],
    },
    twitter: {
      ...baseMetadata.twitter,
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
