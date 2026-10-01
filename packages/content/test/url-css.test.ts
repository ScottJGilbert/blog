import { describe, expect, it } from "vitest";
import { escapeHtml, sanitizeStyle, sanitizeUrl } from "../src/index";
import { isDangerousScheme } from "../src/url";
import { escapeText } from "../src/escape";
import { isSafeColor, safeFontFamily, safeFontSize, safeGridTemplateColumns, safePx, splitDeclarations } from "../src/css";

describe("escapeHtml / escapeText", () => {
  it("escapes the five dangerous characters plus backtick", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&\``)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;");
  });
  it("strips control characters", () => {
    expect(escapeHtml("a\u0000b\u0008c\u007fd")).toBe("abcd");
    expect(escapeHtml("tab\tnl\nok")).toBe("tab\tnl\nok");
  });
  it("preserves visible spaces and converts newlines in flow text", () => {
    expect(escapeText("a  b")).toBe("a&nbsp; b");
    expect(escapeText("a\r\nb\nc")).toBe("a<br>b<br>c");
    expect(escapeText("a\tb")).toBe("a&nbsp;&nbsp;&nbsp;&nbsp;b");
  });
});

describe("sanitizeUrl", () => {
  it("classifies urls", () => {
    expect(sanitizeUrl("https://a.example/x", { baseUrl: "https://a.example" })).toEqual({ href: "https://a.example/x", kind: "absolute", external: false });
    expect(sanitizeUrl("https://b.example/x", { baseUrl: "https://a.example" })?.external).toBe(true);
    expect(sanitizeUrl("https://b.example/x")?.external).toBe(true);
    expect(sanitizeUrl("/x")).toEqual({ href: "/x", kind: "relative", external: false });
    expect(sanitizeUrl("#a")?.kind).toBe("fragment");
    expect(sanitizeUrl("mailto:a@b.c")?.kind).toBe("mailto");
    expect(sanitizeUrl("tel:+123")?.kind).toBe("tel");
  });

  it("resolves relative URLs when asked", () => {
    expect(sanitizeUrl("/x/y", { baseUrl: "https://a.example/blog/", absolute: true })?.href).toBe("https://a.example/x/y");
    expect(sanitizeUrl("y", { baseUrl: "https://a.example/blog/", absolute: true })?.href).toBe("https://a.example/blog/y");
    expect(sanitizeUrl("#f", { baseUrl: "https://a.example/blog/", absolute: true })?.href).toBe("#f");
    expect(sanitizeUrl("/x", { absolute: true })?.href).toBe("/x");
  });

  it("allows only inline raster data URIs for images", () => {
    expect(sanitizeUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(sanitizeUrl("data:image/png;base64,AAAA", { allowDataImage: true })?.kind).toBe("data-image");
    expect(sanitizeUrl("data:image/svg+xml;base64,AAAA", { allowDataImage: true })).toBeNull();
    expect(sanitizeUrl("data:image/png;base64,AA AA", { allowDataImage: true })).toBeNull();
  });

  it("rejects non strings, empties, over-long URLs", () => {
    for (const v of [undefined, null, 5, {}, "", "   "]) expect(sanitizeUrl(v)).toBeNull();
    expect(sanitizeUrl("https://a.example/" + "x".repeat(5000))).toBeNull();
  });

  it("can restrict schemes", () => {
    expect(sanitizeUrl("mailto:a@b.c", { schemes: ["https"] })).toBeNull();
  });

  it("flags dangerous schemes", () => {
    expect(isDangerousScheme("JavaScript:alert(1)")).toBe(true);
    expect(isDangerousScheme(" \tjava\nscript:x")).toBe(true);
    expect(isDangerousScheme("sms:123")).toBe(false);
    expect(isDangerousScheme("https://x")).toBe(false);
    expect(isDangerousScheme(5)).toBe(false);
  });
});

describe("css helpers", () => {
  it("validates colours", () => {
    for (const ok of ["#fff", "#FFFFFF", "#ffffff80", "rgb(1,2,3)", "rgb(1, 2, 3)", "rgba(1, 2, 3, 0.5)", "hsl(120, 50%, 50%)", "red", "transparent", "rgb(0 0 0 / 50%)"]) {
      expect(isSafeColor(ok), ok).toBe(true);
    }
    for (const bad of ["", "#ggg", "#12345", "url(x)", "rgb(1,2)", "red;", "var(--x)", "inherit", "expression(1)", "a".repeat(100), "red blue"]) {
      expect(isSafeColor(bad), bad).toBe(false);
    }
  });
  it("validates font sizes, families, px, grid columns", () => {
    expect(safeFontSize("15px")).toBe("15px");
    expect(safeFontSize("1.5REM")).toBe("1.5rem");
    expect(safeFontSize("0px")).toBeNull();
    expect(safeFontSize("500px")).toBeNull();
    expect(safeFontSize("12")).toBeNull();
    expect(safeFontFamily("Arial, Helvetica, sans-serif")).toBe("'Arial', 'Helvetica', sans-serif");
    expect(safeFontFamily('"Times New Roman", serif')).toBe("'Times New Roman', serif");
    expect(safeFontFamily("Arial; x")).toBeNull();
    expect(safeFontFamily("a,b,c,d,e,f,g,h,i")).toBeNull();
    expect(safePx(10)).toBe(10);
    expect(safePx(-1)).toBeNull();
    expect(safePx(Infinity)).toBeNull();
    expect(safePx("10")).toBeNull();
    expect(safeGridTemplateColumns("1fr 1fr")).toBe("1fr 1fr");
    expect(safeGridTemplateColumns("repeat(3, minmax(0, 1fr))")).toBe("repeat(3, minmax(0, 1fr))");
    expect(safeGridTemplateColumns("100px auto 20%")).toBe("100px auto 20%");
    expect(safeGridTemplateColumns("1fr; color:red")).toBeNull();
    expect(safeGridTemplateColumns("url(x)")).toBeNull();
    expect(safeGridTemplateColumns("repeat(2, 1fr")).toBeNull();
  });
  it("splits declarations respecting quotes and parentheses", () => {
    expect(splitDeclarations('font-family: "A;B", serif; color: rgb(1, 2, 3); x:y')).toEqual([
      ["font-family", '"A;B", serif'],
      ["color", "rgb(1, 2, 3)"],
      ["x", "y"],
    ]);
    expect(splitDeclarations("garbage; ; :; a:")).toEqual([]);
  });
  it("sanitizeStyle reports rejected properties and ignores non-strings", () => {
    expect(sanitizeStyle(undefined)).toEqual({ declarations: [], rejected: [] });
    const r = sanitizeStyle("color: red; position: fixed; font-size: 99999px");
    expect(r.declarations).toEqual([["color", "red"]]);
    expect(r.rejected.sort()).toEqual(["font-size", "position"]);
  });
});
