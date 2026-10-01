/**
 * Typed API client for the blog API (SPEC §5). Works in Server Components (pass `requestInit.next` for caching,
 * `headers: () => ({ cookie })` to forward a session) and in the browser (cookies via `credentials: "include"`).
 *
 *   const api = createApiClient({ baseUrl: process.env.API_INTERNAL_URL! });
 *   const { data, meta } = await api.publicPosts({ section: "engineering", page: 2 }, { next: { revalidate: 300 } });
 *   const post = await api.post("hello-world");
 *
 * Every method's LAST parameter is an optional `requestInit` (`RequestInit` + `next: { revalidate, tags }`).
 * Public cacheable reads set default Next cache tags matching what the API's revalidation hook invalidates
 * (`posts`, `post:<slug>`, `section:<section>`); override with `requestInit.next.tags`.
 */
import { z } from "zod";
import * as S from "../schemas/index";
import type {
  AdminListCommentsQueryInput,
  AdminListPostsQueryInput,
  BanUserInput,
  Comment,
  CreateApiKeyInputInput,
  CreateCommentInputInput,
  CreateNewsletterInputInput,
  CreatePostInputInput,
  ListCommentsQueryInput,
  ListMediaQueryInput,
  ListNewslettersQueryInput,
  ListPostsQueryInput,
  ListSubscribersQueryInput,
  ListUsersQueryInput,
  RelatedPostsQueryInput,
  ReportCommentInput,
  ScheduleNewsletterInput,
  SchedulePostInput,
  SearchQueryInput,
  SubscribeInputInput,
  TestNewsletterInput,
  UpdateCommentInput,
  UpdateCommentStatusInput,
  UpdateMeInput,
  UpdateMediaInput,
  UpdateNewsletterInputInput,
  UpdatePostInputInput,
  UpdateUserInput,
  V1ListCommentsQueryInput,
} from "../schemas/index";
import { HttpClient, type ApiClientOptions, type ApiRequestInit } from "./http";

export { ApiError, isApiError, codeForStatus, type ClientErrorCode } from "./errors";
export type { ApiClientOptions, ApiRequestInit, NextFetchOptions, HeadersSource } from "./http";
export * from "../schemas/index";

type Init = ApiRequestInit | undefined;
const enc = encodeURIComponent;

export function createApiClient(options: ApiClientOptions) {
  const http = new HttpClient(options);

  const unknownSchema = z.unknown();

  const admin = {
    stats: (init?: Init) => http.data("GET", "/admin/stats", S.StatsSchema, { init }),
    /** Environment health: db, mailer, storage, embeddings, newsletter provider, version. */
    system: (init?: Init) => http.data("GET", "/admin/system", S.SystemInfoSchema, { init }),

    posts: {
      list: (query: AdminListPostsQueryInput = {}, init?: Init) =>
        http.page("/admin/posts", S.AdminPostSummarySchema, { query, init }),
      get: (id: string, init?: Init) => http.data("GET", `/admin/posts/${enc(id)}`, S.AdminPostDetailSchema, { init }),
      create: (input: CreatePostInputInput, init?: Init) =>
        http.data("POST", "/admin/posts", S.AdminPostDetailSchema, { body: input, init }),
      update: (id: string, input: UpdatePostInputInput, init?: Init) =>
        http.data("PATCH", `/admin/posts/${enc(id)}`, S.AdminPostDetailSchema, { body: input, init }),
      remove: (id: string, init?: Init) => http.void("DELETE", `/admin/posts/${enc(id)}`, { init }),
      publish: (id: string, init?: Init) =>
        http.data("POST", `/admin/posts/${enc(id)}/publish`, S.AdminPostDetailSchema, { init }),
      unpublish: (id: string, init?: Init) =>
        http.data("POST", `/admin/posts/${enc(id)}/unpublish`, S.AdminPostDetailSchema, { init }),
      schedule: (id: string, input: SchedulePostInput, init?: Init) =>
        http.data("POST", `/admin/posts/${enc(id)}/schedule`, S.AdminPostDetailSchema, { body: input, init }),
    },

    media: {
      list: (query: ListMediaQueryInput = {}, init?: Init) => http.page("/admin/media", S.MediaSchema, { query, init }),
      /** Upload an image (`File`/`Blob`). Sent as multipart/form-data. */
      upload: (file: Blob, opts: { alt?: string; filename?: string } = {}, init?: Init) => {
        const form = new FormData();
        if (opts.filename) form.append("file", file, opts.filename);
        else form.append("file", file);
        if (opts.alt) form.append("alt", opts.alt);
        return http.data("POST", "/admin/media", S.MediaSchema, { body: form, init });
      },
      update: (id: string, input: UpdateMediaInput, init?: Init) =>
        http.data("PATCH", `/admin/media/${enc(id)}`, S.MediaSchema, { body: input, init }),
      remove: (id: string, init?: Init) => http.void("DELETE", `/admin/media/${enc(id)}`, { init }),
    },

    users: {
      list: (query: ListUsersQueryInput = {}, init?: Init) => http.page("/admin/users", S.AdminUserSchema, { query, init }),
      get: (id: string, init?: Init) => http.data("GET", `/admin/users/${enc(id)}`, S.AdminUserSchema, { init }),
      update: (id: string, input: UpdateUserInput, init?: Init) =>
        http.data("PATCH", `/admin/users/${enc(id)}`, S.AdminUserSchema, { body: input, init }),
      ban: (id: string, input: BanUserInput, init?: Init) =>
        http.data("POST", `/admin/users/${enc(id)}/ban`, S.AdminUserSchema, { body: input, init }),
      unban: (id: string, init?: Init) => http.data("POST", `/admin/users/${enc(id)}/unban`, S.AdminUserSchema, { init }),
      remove: (id: string, init?: Init) => http.void("DELETE", `/admin/users/${enc(id)}`, { init }),
    },

    comments: {
      list: (query: AdminListCommentsQueryInput = {}, init?: Init) =>
        http.page("/admin/comments", S.AdminCommentSchema, { query, init }),
      setStatus: (id: string, input: UpdateCommentStatusInput, init?: Init) =>
        http.data("PATCH", `/admin/comments/${enc(id)}`, S.AdminCommentSchema, { body: input, init }),
      resolveReports: (id: string, init?: Init) =>
        http.data("POST", `/admin/comments/${enc(id)}/resolve-reports`, S.AdminCommentSchema, { init }),
    },

    newsletters: {
      list: (query: ListNewslettersQueryInput = {}, init?: Init) =>
        http.page("/admin/newsletters", S.NewsletterSummarySchema, { query, init }),
      create: (input: CreateNewsletterInputInput, init?: Init) =>
        http.data("POST", "/admin/newsletters", S.NewsletterSchema, { body: input, init }),
      get: (id: string, init?: Init) => http.data("GET", `/admin/newsletters/${enc(id)}`, S.NewsletterSchema, { init }),
      update: (id: string, input: UpdateNewsletterInputInput, init?: Init) =>
        http.data("PATCH", `/admin/newsletters/${enc(id)}`, S.NewsletterSchema, { body: input, init }),
      remove: (id: string, init?: Init) => http.void("DELETE", `/admin/newsletters/${enc(id)}`, { init }),
      preview: (id: string, init?: Init) =>
        http.data("POST", `/admin/newsletters/${enc(id)}/preview`, S.NewsletterPreviewSchema, { init }),
      test: (id: string, input: TestNewsletterInput, init?: Init) =>
        http.void("POST", `/admin/newsletters/${enc(id)}/test`, { body: input, init }),
      send: (id: string, init?: Init) =>
        http.data("POST", `/admin/newsletters/${enc(id)}/send`, S.SendNewsletterResultSchema, { init }),
      schedule: (id: string, input: ScheduleNewsletterInput, init?: Init) =>
        http.data("POST", `/admin/newsletters/${enc(id)}/schedule`, S.NewsletterSchema, { body: input, init }),
      stats: (id: string, init?: Init) =>
        http.data("GET", `/admin/newsletters/${enc(id)}/stats`, S.NewsletterStatsSchema, { init }),
    },

    subscribers: {
      list: (query: ListSubscribersQueryInput = {}, init?: Init) =>
        http.page("/admin/subscribers", S.SubscriberSchema, { query, init }),
      remove: (id: string, init?: Init) => http.void("DELETE", `/admin/subscribers/${enc(id)}`, { init }),
      sync: (init?: Init) => http.data("POST", "/admin/subscribers/sync", S.SubscriberSyncResultSchema, { init }),
    },

    apiKeys: {
      list: (init?: Init) =>
        http.data("GET", "/admin/api-keys", z.array(S.ApiKeySchema), { init }),
      /** The returned `key` is shown once; store it immediately. */
      create: (input: CreateApiKeyInputInput, init?: Init) =>
        http.data("POST", "/admin/api-keys", S.ApiKeyCreatedSchema, { body: input, init }),
      revoke: (id: string, init?: Init) => http.void("DELETE", `/admin/api-keys/${enc(id)}`, { init }),
    },

    embeddings: {
      reindex: (init?: Init) => http.data("POST", "/admin/embeddings/reindex", S.ReindexResultSchema, { init }),
    },
  };

  /** `/api/v1` — stable read-only public API (use `apiKey` option for higher limits / `comments:read`). */
  const v1 = {
    posts: (query: ListPostsQueryInput = {}, init?: Init) =>
      http.page("/v1/posts", S.PostSummarySchema, { query, init, tags: tagsForList(query.section) }),
    post: (slug: string, init?: Init) =>
      http.data("GET", `/v1/posts/${enc(slug)}`, S.PostDetailSchema, { init, tags: ["posts", `post:${slug}`] }),
    tags: (init?: Init) => http.data("GET", "/v1/tags", z.array(S.TagWithCountSchema), { init, tags: ["posts", "tags"] }),
    search: (query: SearchQueryInput, init?: Init) => http.page("/v1/search", S.SearchResultSchema, { query, init }),
    comments: (query: V1ListCommentsQueryInput, init?: Init) => http.page("/v1/comments", S.V1CommentSchema, { query, init }),
    /** OpenAPI 3.1 document (raw JSON, not enveloped). */
    openapi: async (init?: Init) => (await http.raw("GET", "/v1/openapi.json", { init }, unknownSchema)).data as Record<string, unknown>,
  };

  return {
    /** Resolve an API URL (e.g. for `<a href>` / `<link rel=alternate>`). */
    url: (path: string, query?: object) => http.url(path, query),
    feedUrl: (section?: S.Section) => http.url("/feed.xml", { section }),

    health: (init?: Init) => http.data("GET", "/health", S.HealthSchema, { init }),

    // ----- session / account (sign-in/up themselves go through Better Auth at /api/auth/*) ---------------------------
    me: (init?: Init) => http.data("GET", "/me", S.MeSchema, { init }),
    updateMe: (input: UpdateMeInput, init?: Init) => http.data("PATCH", "/me", S.MeSchema, { body: input, init }),
    /** Anonymises the account. */
    deleteMe: (init?: Init) => http.void("DELETE", "/me", { init }),

    // ----- public content -------------------------------------------------------------------------------------------
    publicPosts: (query: ListPostsQueryInput = {}, init?: Init) =>
      http.page("/posts", S.PostSummarySchema, { query, init, tags: tagsForList(query.section) }),
    post: (slug: string, init?: Init) =>
      http.data("GET", `/posts/${enc(slug)}`, S.PostDetailSchema, { init, tags: ["posts", `post:${slug}`] }),
    related: (slug: string, query: RelatedPostsQueryInput = {}, init?: Init) =>
      http.data("GET", `/posts/${enc(slug)}/related`, z.array(S.PostSummarySchema), {
        query,
        init,
        tags: ["posts", `post:${slug}`],
      }),
    search: (query: SearchQueryInput, init?: Init) => http.page("/search", S.SearchResultSchema, { query, init }),
    tags: (init?: Init) => http.data("GET", "/tags", z.array(S.TagWithCountSchema), { init, tags: ["posts", "tags"] }),
    sitemap: (init?: Init) => http.data("GET", "/sitemap", z.array(S.SitemapEntrySchema), { init, tags: ["posts"] }),

    // ----- comments -------------------------------------------------------------------------------------------------
    comments: (slug: string, query: ListCommentsQueryInput = {}, init?: Init) =>
      http.page(`/posts/${enc(slug)}/comments`, S.CommentSchema, { query, init }),
    createComment: (slug: string, input: CreateCommentInputInput, init?: Init): Promise<Comment> =>
      http.data("POST", `/posts/${enc(slug)}/comments`, S.CommentSchema, { body: input, init }),
    updateComment: (id: string, input: UpdateCommentInput, init?: Init) =>
      http.data("PATCH", `/comments/${enc(id)}`, S.CommentReplySchema, { body: input, init }),
    deleteComment: (id: string, init?: Init) => http.void("DELETE", `/comments/${enc(id)}`, { init }),
    reportComment: (id: string, input: ReportCommentInput, init?: Init) =>
      http.void("POST", `/comments/${enc(id)}/report`, { body: input, init }),

    // ----- newsletter -----------------------------------------------------------------------------------------------
    newsletter: {
      /** Always resolves (202) — no account enumeration. */
      subscribe: (input: SubscribeInputInput, init?: Init) => http.void("POST", "/newsletter/subscribe", { body: input, init }),
      confirm: (token: string, init?: Init) =>
        http.data("POST", "/newsletter/confirm", S.ConfirmSubscriptionResultSchema, { body: { token }, init }),
      unsubscribe: (token: string, init?: Init) =>
        http.data("POST", "/newsletter/unsubscribe", S.UnsubscribeResultSchema, { body: { token }, init }),
    },
    /** Signed-in user's own subscription. */
    subscription: {
      get: (init?: Init) => http.data("GET", "/me/subscription", S.SubscriptionSchema.nullable(), { init }),
      set: (subscribed: boolean, init?: Init) =>
        http.data("PUT", "/me/subscription", S.SubscriptionSchema.nullable(), { body: { subscribed }, init }),
      remove: (init?: Init) => http.void("DELETE", "/me/subscription", { init }),
    },

    admin,
    v1,
  };
}

function tagsForList(section: S.Section | undefined): string[] {
  return section ? ["posts", `section:${section}`] : ["posts"];
}

export type ApiClient = ReturnType<typeof createApiClient>;
