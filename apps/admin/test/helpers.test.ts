import { ApiError } from "@blog/shared/client";
import { describe, expect, it } from "vitest";
import { errorMessage, fieldErrorsFromApi, fieldErrorsFromZod } from "../src/lib/errors";
import { formatBytes, formatRelative, plural, timeZoneLabel, toLocalInputValue } from "../src/lib/format";
import { loginUrl, safeNext } from "../src/lib/safe-next";
import { slugify } from "../src/lib/slug";

describe("safeNext (open-redirect safety)", () => {
  it("allows app-relative paths", () => {
    expect(safeNext("/posts")).toBe("/posts");
    expect(safeNext("/posts/abc?x=1#y")).toBe("/posts/abc?x=1#y");
    expect(safeNext(["/media", "/evil"])).toBe("/media");
  });
  it("strips a leading base path", () => {
    expect(safeNext("/admin/posts")).toBe("/posts");
    expect(safeNext("/admin")).toBe("/");
    expect(safeNext("/administrator")).toBe("/administrator");
  });
  it.each([
    "https://evil.example",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "evil",
    "",
    "/%2F%2Fevil.example",
    "/.//evil.example",
    "/admin/..//evil.example",
    "/\u0000x",
    "/login",
    "/login?next=/x",
  ])("rejects %j", (v) => {
    expect(safeNext(v)).toBe("/");
  });
  it("handles missing values and custom fallbacks", () => {
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext(null, "/x")).toBe("/x");
  });
  it("builds login urls", () => {
    expect(loginUrl("/posts")).toBe("/login?next=%2Fposts");
    expect(loginUrl("/")).toBe("/login");
    expect(loginUrl("https://evil.example")).toBe("/login");
    expect(loginUrl("/users", { expired: "1" })).toBe("/login?next=%2Fusers&expired=1");
  });
});

describe("slugify", () => {
  it("mirrors the server slug rule", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("  Crème brûlée & Co.  ")).toBe("creme-brulee-and-co");
    expect(slugify("It's 100% fine")).toBe("its-100-fine");
    expect(slugify("---")).toBe("");
    expect(slugify("a".repeat(300)).length).toBe(120);
    expect(slugify("x".repeat(119) + " y")).toBe("x".repeat(119));
  });
});

describe("errors", () => {
  const zodDetails = [
    { path: ["title"], message: "Too small" },
    { path: ["tags", 2], message: "Too long" },
    { path: ["title"], message: "second" },
    { path: [], message: "form-level" },
  ];
  it("maps validation details to fields (first message wins, tags.2 -> tags)", () => {
    const err = new ApiError({ status: 422, code: "validation_error", message: "Invalid", details: zodDetails });
    expect(fieldErrorsFromApi(err)).toEqual({ title: "Too small", tags: "Too long", _form: "form-level" });
    expect(fieldErrorsFromApi(new Error("x"))).toEqual({});
    expect(fieldErrorsFromApi(new ApiError({ status: 400, code: "validation_error", message: "m", details: { issues: zodDetails } })).title).toBe("Too small");
  });
  it("maps zod issues", () => {
    expect(fieldErrorsFromZod([{ path: ["email"], message: "bad" }])).toEqual({ email: "bad" });
  });
  it("produces friendly messages", () => {
    expect(errorMessage(new ApiError({ status: 413, code: "internal", message: "Payload Too Large" }))).toMatch(/too large/i);
    expect(errorMessage(new ApiError({ status: 0, code: "network_error", message: "fetch failed" }))).toMatch(/reach the server/i);
    expect(errorMessage(new ApiError({ status: 409, code: "conflict", message: "Slug already in use" }))).toBe("Slug already in use");
    expect(errorMessage(undefined)).toMatch(/went wrong/i);
  });
});

describe("format", () => {
  it("formats bytes and plurals", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(plural(1, "post")).toBe("1 post");
    expect(plural(1234, "post")).toBe("1,234 posts");
  });
  it("formats relative times", () => {
    const now = Date.parse("2026-01-10T12:00:00Z");
    expect(formatRelative("2026-01-10T11:59:50Z", now)).toBe("just now");
    expect(formatRelative("2026-01-10T11:00:00Z", now)).toBe("1 hour ago");
    expect(formatRelative("2026-01-08T12:00:00Z", now)).toBe("2 days ago");
    expect(formatRelative(null)).toBe("—");
  });
  it("datetime-local values and zone labels", () => {
    const d = new Date(2026, 0, 5, 9, 7);
    expect(toLocalInputValue(d)).toBe("2026-01-05T09:07");
    expect(timeZoneLabel(d)).toMatch(/\(UTC[+-]\d\d:\d\d\)$/);
  });
});
