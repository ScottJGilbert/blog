import { timingSafeEqual, createHash } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

/**
 * POST /internal/revalidate: called by the API after publish/unpublish/delete (SPEC §5.5).
 *   header  x-revalidate-secret: <REVALIDATE_SECRET>
 *   body    { "tags": ["posts", "post:<slug>", "section:<section>"] }
 * Answers 404 (as if the route did not exist) when REVALIDATE_SECRET is not configured, and 401 on a wrong secret.
 */
export const dynamic = "force-dynamic";

const MAX_TAGS = 64;
const MAX_TAG_LENGTH = 256; // Next's limit
const TAG_RE = /^[A-Za-z0-9:_\-./]+$/;

function secretMatches(provided: string, expected: string): boolean {
  // Hash first so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected) return new NextResponse(null, { status: 404 });

  const provided = request.headers.get("x-revalidate-secret") ?? "";
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const tags = (body as { tags?: unknown } | null)?.tags;
  if (
    !Array.isArray(tags) ||
    tags.length === 0 ||
    tags.length > MAX_TAGS ||
    !tags.every((t): t is string => typeof t === "string" && t.length <= MAX_TAG_LENGTH && TAG_RE.test(t))
  ) {
    return NextResponse.json({ error: "invalid_tags" }, { status: 400 });
  }

  const unique = [...new Set(tags)];
  // { expire: 0 }: webhook-style immediate expiry, so the very next visitor gets fresh content.
  for (const tag of unique) revalidateTag(tag, { expire: 0 });
  return NextResponse.json({ revalidated: true, tags: unique, now: Date.now() });
}

// Anything else is not part of the contract.
export function GET() {
  return new NextResponse(null, { status: 404 });
}
