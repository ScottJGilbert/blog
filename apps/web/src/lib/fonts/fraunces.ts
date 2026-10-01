import { Fraunces } from "next/font/google";

/** Self-hosted via next/font; one module per family so a route only preloads what it imports.
 * display: "optional" => the font is used only if it is ready almost immediately (preloaded);
 * otherwise the size-adjusted fallback stays for that page view, so a late font swap can never
 * re-wrap text and shift layout (CLS stays 0). */
export const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["600"],
  display: "optional",
  variable: "--font-fraunces",
});
