import cors from "cors";

/** CORS for the public read-only `/api/v1` API only: any origin, GET/HEAD, no credentials. */
export const v1Cors = cors({
  origin: "*",
  methods: ["GET", "HEAD", "OPTIONS"],
  allowedHeaders: ["authorization", "x-api-key", "if-none-match", "content-type"],
  exposedHeaders: ["etag", "x-request-id", "retry-after", "ratelimit", "ratelimit-policy"],
  credentials: false,
  maxAge: 86_400,
});
