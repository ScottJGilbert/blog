import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AppProviders } from "@/providers/app-providers";
import { themeInitScript } from "@/lib/theme-script";
import "./globals.css";

/** `optional`: only used when it is ready almost immediately; never swaps late => zero layout shift. */
const inter = Inter({ subsets: ["latin"], display: "optional", variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  description: "Content administration dashboard.",
  robots: { index: false, follow: false, nocache: true },
  applicationName: "Blog Admin",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: the blocking script below sets the `dark` class before React hydrates.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
