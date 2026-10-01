/**
 * Inline styles for the `email` target. Mail clients ignore (or strip) <style> blocks and classes, so every
 * element carries what it needs. Values are deliberately conservative (no flex/grid/calc/var, px units).
 */
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "Menlo,Consolas,Monaco,'Courier New',monospace";

export const EMAIL = {
  font: FONT,
  mono: MONO,
  p: "margin:0 0 16px 0;line-height:1.6",
  pCell: "margin:0 0 4px 0;line-height:1.5",
  heading: {
    h1: "margin:0 0 16px 0;font-size:28px;line-height:1.25;font-weight:700",
    h2: "margin:24px 0 12px 0;font-size:24px;line-height:1.3;font-weight:700",
    h3: "margin:20px 0 10px 0;font-size:20px;line-height:1.3;font-weight:700",
    h4: "margin:18px 0 8px 0;font-size:18px;line-height:1.35;font-weight:700",
    h5: "margin:16px 0 8px 0;font-size:16px;line-height:1.4;font-weight:700",
    h6: "margin:16px 0 8px 0;font-size:14px;line-height:1.4;font-weight:700;text-transform:uppercase",
  },
  quote: "margin:0 0 16px 0;padding:0 0 0 16px;border-left:4px solid #ced0d4;color:#65676b;line-height:1.6",
  link: "color:#216fdb;text-decoration:underline",
  hr: "border:none;border-top:1px solid #cccccc;margin:24px 0",
  list: "margin:0 0 16px 0;padding:0 0 0 24px;line-height:1.6",
  ulCheck: "margin:0 0 16px 0;padding:0 0 0 24px;line-height:1.6;list-style-type:none",
  li: "margin:0 0 4px 0",
  liCheck: "margin:0 0 4px -1.4em;list-style-type:none",
  liNested: "margin:0;list-style-type:none",
  pre: `margin:0 0 16px 0;padding:12px 14px;background-color:#f0f2f5;border-radius:6px;font-family:${MONO};font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;overflow:auto`,
  code: `font-family:${MONO};font-size:94%;background-color:#f0f2f5;padding:1px 4px;border-radius:3px`,
  mark: "background-color:#fff3b0;color:inherit",
  table: "border-collapse:collapse;width:100%;margin:0 0 16px 0",
  th: "border:1px solid #bbbbbb;padding:6px 8px;vertical-align:top;text-align:left;background-color:#f2f3f5;font-weight:700",
  td: "border:1px solid #bbbbbb;padding:6px 8px;vertical-align:top;text-align:left",
  img: "display:inline-block;max-width:100%;height:auto;border:0;outline:none;text-decoration:none",
  figure: "margin:0 0 16px 0;text-align:center",
  figcaption: "margin:6px 0 0 0;font-size:13px;line-height:1.4;color:#65676b",
  layoutTable: "width:100%;margin:0 0 16px 0;border-collapse:collapse",
  layoutCell: "padding:0 8px;vertical-align:top;",
  collapsible: "margin:0 0 16px 0;padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px",
  collapsibleTitle: "margin:0 0 8px 0;font-weight:700;line-height:1.5",
} as const;
