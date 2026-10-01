import { describe, expect, it } from "vitest";
import {
  AdminListCommentsQuerySchema,
  CreateApiKeyInputSchema,
  CreateCommentInputSchema,
  CreatePostInputSchema,
  ErrorEnvelopeSchema,
  ListPostsQuerySchema,
  MAX_PAGE_SIZE,
  PaginationQuerySchema,
  PostSummarySchema,
  ReportCommentInputSchema,
  SearchQuerySchema,
  SubscribeInputSchema,
  UpdateMeInputSchema,
  UpdatePostInputSchema,
  paginationMeta,
} from "../src/index";

const emptyDoc = { root: { type: "root", children: [] } };

describe("pagination", () => {
  it("coerces strings and applies defaults", () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 10 });
    expect(PaginationQuerySchema.parse({ page: "3", pageSize: "25" })).toEqual({ page: 3, pageSize: 25 });
  });
  it("rejects out-of-range values", () => {
    expect(PaginationQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(PaginationQuerySchema.safeParse({ pageSize: String(MAX_PAGE_SIZE + 1) }).success).toBe(false);
    expect(PaginationQuerySchema.safeParse({ page: "1.5" }).success).toBe(false);
    expect(PaginationQuerySchema.safeParse({ page: "abc" }).success).toBe(false);
  });
  it("computes meta", () => {
    expect(paginationMeta(42, 1, 10)).toEqual({ page: 1, pageSize: 10, total: 42, totalPages: 5 });
    expect(paginationMeta(0, 1, 10).totalPages).toBe(0);
  });
});

describe("query schemas", () => {
  it("list posts: defaults sort and drops empty strings", () => {
    const q = ListPostsQuerySchema.parse({ section: "engineering", tag: "", q: " hi " });
    expect(q).toMatchObject({ section: "engineering", sort: "newest", page: 1, pageSize: 10, q: "hi" });
    expect(q.tag).toBeUndefined();
    expect(ListPostsQuerySchema.safeParse({ section: "nope" }).success).toBe(false);
    expect(ListPostsQuerySchema.safeParse({ sort: "random" }).success).toBe(false);
  });
  it("search requires q of at least 2 chars", () => {
    expect(SearchQuerySchema.safeParse({ q: "a" }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({}).success).toBe(false);
    expect(SearchQuerySchema.parse({ q: " ab " }).q).toBe("ab");
  });
  it("coerces booleans in admin queries", () => {
    expect(AdminListCommentsQuerySchema.parse({ reported: "true" }).reported).toBe(true);
    expect(AdminListCommentsQuerySchema.parse({ reported: "false" }).reported).toBe(false);
    expect(AdminListCommentsQuerySchema.parse({}).reported).toBeUndefined();
  });
});

describe("inputs", () => {
  it("comment body is trimmed and bounded", () => {
    expect(CreateCommentInputSchema.parse({ body: "  hi  " }).body).toBe("hi");
    expect(CreateCommentInputSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(CreateCommentInputSchema.safeParse({ body: "x".repeat(4001) }).success).toBe(false);
    expect(CreateCommentInputSchema.safeParse({ body: "x".repeat(4000) }).success).toBe(true);
    expect(CreateCommentInputSchema.safeParse({ body: "ok", parentId: "not-a-uuid" }).success).toBe(false);
  });
  it("report reason 3-500", () => {
    expect(ReportCommentInputSchema.safeParse({ reason: "ab" }).success).toBe(false);
    expect(ReportCommentInputSchema.safeParse({ reason: "abc" }).success).toBe(true);
    expect(ReportCommentInputSchema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
  });
  it("subscribe lowercases + validates email", () => {
    expect(SubscribeInputSchema.parse({ email: "  Foo@Example.COM " }).email).toBe("foo@example.com");
    expect(SubscribeInputSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
  it("create post requires title/section/content, defaults tags", () => {
    const ok = CreatePostInputSchema.parse({ title: " T ", section: "personal", content: emptyDoc });
    expect(ok).toMatchObject({ title: "T", tags: [] });
    expect(CreatePostInputSchema.safeParse({ title: "T", section: "home", content: emptyDoc }).success).toBe(false);
    expect(CreatePostInputSchema.safeParse({ title: "T", section: "personal", content: { nope: 1 } }).success).toBe(false);
    expect(CreatePostInputSchema.safeParse({ title: "T", section: "personal", content: emptyDoc, slug: "Bad Slug" }).success).toBe(false);
    expect(CreatePostInputSchema.safeParse({ title: "T", section: "personal", content: emptyDoc, coverImageUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(CreatePostInputSchema.safeParse({ title: "T", section: "personal", content: emptyDoc, coverImageUrl: "/api/media/files/x.png" }).success).toBe(true);
  });
  it("update post is fully partial (but still validated); tags default does not leak in", () => {
    expect(UpdatePostInputSchema.parse({})).toEqual({});
    expect(UpdatePostInputSchema.safeParse({ title: "" }).success).toBe(false);
  });
  it("me update needs at least one field", () => {
    expect(UpdateMeInputSchema.safeParse({}).success).toBe(false);
    expect(UpdateMeInputSchema.safeParse({ name: "A" }).success).toBe(true);
  });
  it("api key scopes are an allow-list", () => {
    expect(CreateApiKeyInputSchema.parse({ name: "n" }).scopes).toEqual([]);
    expect(CreateApiKeyInputSchema.safeParse({ name: "n", scopes: ["admin"] }).success).toBe(false);
  });
});

describe("responses", () => {
  it("error envelope", () => {
    expect(ErrorEnvelopeSchema.safeParse({ error: { code: "not_found", message: "x" } }).success).toBe(true);
    expect(ErrorEnvelopeSchema.safeParse({ error: { code: "teapot", message: "x" } }).success).toBe(false);
  });
  it("post summary", () => {
    const ok = {
      id: "6f1e8a1e-3a1f-4c5e-9d0b-1f2a3b4c5d6e",
      slug: "a",
      title: "A",
      excerpt: "",
      section: "personal",
      tags: [{ slug: "x", name: "X" }],
      coverImageUrl: null,
      coverImageAlt: null,
      author: { name: "N", image: null },
      publishedAt: new Date().toISOString(),
      readingMinutes: 3,
    };
    expect(PostSummarySchema.safeParse(ok).success).toBe(true);
    expect(PostSummarySchema.safeParse({ ...ok, publishedAt: "yesterday" }).success).toBe(false);
  });
});
