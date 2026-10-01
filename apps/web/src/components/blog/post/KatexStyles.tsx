import { version } from "katex/package.json";

/**
 * KaTeX stylesheet, linked only for posts that contain equations (see PostContent). The file is published by
 * scripts/copy-katex.mjs (woff2 only) as a static asset; React hoists the <link> into <head> and holds first paint
 * until it has loaded, so equations never flash unstyled. Not imported as CSS on purpose: a CSS import would be added
 * to every post route by the bundler.
 */
export const KATEX_CSS_HREF = `/katex/${version}/katex.css`;

export default function KatexStyles() {
  return <link rel="stylesheet" href={KATEX_CSS_HREF} precedence="katex" />;
}
