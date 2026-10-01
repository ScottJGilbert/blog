import {
  MAX_PAGE_SIZE,
  PaginationMetaSchema,
  PostDetailSchema,
  PostSummarySchema,
  SearchResultSchema,
  TagWithCountSchema,
  V1CommentSchema,
  ErrorBodySchema,
  SECTIONS,
  API_KEY_SCOPES,
} from "@blog/shared";
import { z } from "zod";
import type { Config } from "../../config";

type Json = Record<string, unknown>;

/** Component schemas are generated from the very zod schemas the API validates/serialises with, so they cannot drift. */
function schemaOf(schema: z.ZodType): Json {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { target: "draft-2020-12", io: "output", unrepresentable: "any" }) as Json;
  return rest;
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonContent = (schema: unknown) => ({ "application/json": { schema } });

const pageParam = { name: "page", in: "query", description: "1-based page number", schema: { type: "integer", minimum: 1, default: 1 } };
const pageSizeParam = { name: "pageSize", in: "query", description: `Items per page (max ${MAX_PAGE_SIZE})`, schema: { type: "integer", minimum: 1, maximum: MAX_PAGE_SIZE, default: 10 } };
const sectionParam = { name: "section", in: "query", schema: { type: "string", enum: [...SECTIONS] } };

const commonResponses = {
  "304": { description: "Not modified (the `If-None-Match` ETag matched)" },
  "400": { description: "Invalid query parameters", content: jsonContent(ref("ErrorEnvelope")) },
  "429": {
    description: "Rate limit exceeded",
    headers: { "Retry-After": { schema: { type: "integer" }, description: "seconds until the limit resets" } },
    content: jsonContent(ref("ErrorEnvelope")),
  },
};

const cacheHeaders = {
  ETag: { schema: { type: "string" }, description: "Weak validator; send it back as `If-None-Match` to get a 304" },
  "Cache-Control": { schema: { type: "string" }, description: "`public, s-maxage=60, stale-while-revalidate=300`" },
  "X-RateLimit-Limit": { schema: { type: "integer" }, description: "Requests allowed per window (present when rate limiting is enabled)" },
  "X-RateLimit-Remaining": { schema: { type: "integer" } },
  "X-RateLimit-Reset": { schema: { type: "integer" }, description: "Unix time (seconds) when the window resets" },
};

const listOf = (item: string) => ({
  type: "object",
  required: ["data", "meta"],
  properties: { data: { type: "array", items: ref(item) }, meta: ref("PaginationMeta") },
});

/** The documented paths (also used by the tests to assert every documented route exists). */
export const V1_PATHS = ["/v1/posts", "/v1/posts/{slug}", "/v1/tags", "/v1/search", "/v1/comments", "/v1/openapi.json"] as const;

/** OpenAPI 3.1 description of `/api/v1`. */
export function buildOpenApiDocument(config: Pick<Config, "siteUrl" | "siteName" | "basePath" | "version">): Json {
  return {
    openapi: "3.1.0",
    info: {
      title: `${config.siteName} blog API`,
      version: "1",
      summary: "Read-only public API for published blog posts, tags, search and comments.",
      description:
        "Versioned, stable, read-only. Responses are wrapped as `{ data, meta? }`; errors as `{ error: { code, message, details? } }`. " +
        "Anonymous access is rate limited (120 requests/minute/IP); send an API key (`Authorization: Bearer blg_…` or `x-api-key`) for a higher limit. " +
        "`GET /v1/comments` requires a key with the `comments:read` scope. CORS is open (`*`) for GET requests. " +
        "Responses are cacheable (`Cache-Control: public, s-maxage=60, stale-while-revalidate=300`) and carry an `ETag`.",
    },
    servers: [{ url: `${config.siteUrl}${config.basePath}`, description: "Production" }],
    tags: [
      { name: "Posts", description: "Published blog posts" },
      { name: "Tags" },
      { name: "Search" },
      { name: "Comments", description: "Visible comments (API key with `comments:read` required)" },
    ],
    paths: {
      "/v1/posts": {
        get: {
          operationId: "listPosts",
          tags: ["Posts"],
          summary: "List published posts",
          security: [{}, { bearerAuth: [] }, { apiKeyHeader: [] }],
          parameters: [
            pageParam,
            pageSizeParam,
            sectionParam,
            { name: "tag", in: "query", description: "Tag slug", schema: { type: "string", maxLength: 100 } },
            { name: "q", in: "query", description: "Full-text filter", schema: { type: "string", maxLength: 200 } },
            { name: "sort", in: "query", schema: { type: "string", enum: ["newest", "oldest"], default: "newest" } },
          ],
          responses: { "200": { description: "A page of post summaries", headers: cacheHeaders, content: jsonContent(listOf("PostSummary")) }, ...commonResponses },
        },
      },
      "/v1/posts/{slug}": {
        get: {
          operationId: "getPost",
          tags: ["Posts"],
          summary: "Get one published post (Lexical JSON + rendered HTML)",
          security: [{}, { bearerAuth: [] }, { apiKeyHeader: [] }],
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "The post",
              headers: cacheHeaders,
              content: jsonContent({ type: "object", required: ["data"], properties: { data: ref("PostDetail") } }),
            },
            "304": commonResponses["304"],
            "404": { description: "No published post with that slug", content: jsonContent(ref("ErrorEnvelope")) },
            "429": commonResponses["429"],
          },
        },
      },
      "/v1/tags": {
        get: {
          operationId: "listTags",
          tags: ["Tags"],
          summary: "Tags of published posts with post counts",
          security: [{}, { bearerAuth: [] }, { apiKeyHeader: [] }],
          responses: {
            "200": {
              description: "All tags that have at least one published post",
              headers: cacheHeaders,
              content: jsonContent({ type: "object", required: ["data"], properties: { data: { type: "array", items: ref("TagWithCount") } } }),
            },
            "304": commonResponses["304"],
            "429": commonResponses["429"],
          },
        },
      },
      "/v1/search": {
        get: {
          operationId: "searchPosts",
          tags: ["Search"],
          summary: "Hybrid (full-text + semantic) search over published posts",
          security: [{}, { bearerAuth: [] }, { apiKeyHeader: [] }],
          parameters: [
            { name: "q", in: "query", required: true, description: "Query, at least 2 characters", schema: { type: "string", minLength: 2, maxLength: 200 } },
            sectionParam,
            pageParam,
            pageSizeParam,
          ],
          responses: { "200": { description: "Ranked results; `snippet` contains only `<mark>` tags, everything else is escaped", headers: cacheHeaders, content: jsonContent(listOf("SearchResult")) }, ...commonResponses },
        },
      },
      "/v1/comments": {
        get: {
          operationId: "listComments",
          tags: ["Comments"],
          summary: "Visible comments of a post (top level newest first, replies oldest first)",
          security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
          parameters: [{ name: "postSlug", in: "query", required: true, schema: { type: "string", minLength: 1, maxLength: 200 } }, pageParam, pageSizeParam],
          responses: {
            "200": {
              description: "A page of top-level comments with their replies (not cached by shared caches)",
              headers: { ...cacheHeaders, "Cache-Control": { schema: { type: "string" }, description: "`private, max-age=60`" } },
              content: jsonContent(listOf("V1Comment")),
            },
            "304": commonResponses["304"],
            "400": commonResponses["400"],
            "401": { description: "Missing or invalid API key", content: jsonContent(ref("ErrorEnvelope")) },
            "403": { description: "The API key lacks the `comments:read` scope", content: jsonContent(ref("ErrorEnvelope")) },
            "404": { description: "No published post with that slug", content: jsonContent(ref("ErrorEnvelope")) },
            "429": commonResponses["429"],
          },
        },
      },
      "/v1/openapi.json": {
        get: {
          operationId: "getOpenApiDocument",
          summary: "This document",
          security: [{}],
          responses: { "200": { description: "OpenAPI 3.1 document", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "blg_<43 url-safe characters>", description: `API key. Scopes: ${API_KEY_SCOPES.join(", ")}` },
        apiKeyHeader: { type: "apiKey", in: "header", name: "x-api-key", description: "The same API key as an alternative to the Bearer header" },
      },
      schemas: {
        PostSummary: schemaOf(PostSummarySchema),
        PostDetail: schemaOf(PostDetailSchema),
        SearchResult: schemaOf(SearchResultSchema),
        TagWithCount: schemaOf(TagWithCountSchema),
        V1Comment: schemaOf(V1CommentSchema),
        PaginationMeta: schemaOf(PaginationMetaSchema),
        ErrorEnvelope: { type: "object", required: ["error"], properties: { error: schemaOf(ErrorBodySchema) } },
      },
    },
  };
}
