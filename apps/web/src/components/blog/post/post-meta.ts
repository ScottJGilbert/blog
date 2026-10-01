import type { Metadata } from "next";
import type { PostDetail, Section } from "@blog/shared";
import { getPost } from "@/lib/api";
import { imageSource } from "@/lib/media-hosts";
import { postHref } from "@/lib/paths";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import { SITE_URL } from "@/lib/site-url";

/** Absolute URL for a (possibly site-relative) image path. */
export function absoluteUrl(pathOrUrl: string): string {
  return /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${SITE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

export async function postMetadata(section: Section, slug: string): Promise<Metadata> {
  const post = await getPost(slug);
  if (!post) return { title: "Post not found", robots: { index: false } };
  // A post addressed under the wrong section is redirected by the page; canonicalise either way.
  const path = postHref(post.section, post.slug);
  const description = post.excerpt || SITE_DESCRIPTION;
  const cover = post.coverImageUrl ? imageSource(post.coverImageUrl).src : null;
  const images = cover ? [{ url: absoluteUrl(cover), alt: post.coverImageAlt ?? post.title }] : undefined;
  return {
    title: post.title,
    description,
    alternates: { canonical: path },
    authors: [{ name: post.author.name }],
    keywords: post.tags.map((t) => t.name),
    openGraph: {
      type: "article",
      url: path,
      title: post.title,
      description,
      siteName: SITE_NAME,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      authors: [post.author.name],
      section: post.section,
      tags: post.tags.map((t) => t.name),
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: post.title,
      description,
      images: images?.map((i) => i.url),
    },
  };
}

export function blogPostingJsonLd(post: PostDetail) {
  const url = `${SITE_URL}${postHref(post.section, post.slug)}`;
  const cover = post.coverImageUrl ? imageSource(post.coverImageUrl).src : null;
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    author: { "@type": "Person", name: post.author.name },
    publisher: { "@type": "Person", name: SITE_NAME, url: SITE_URL },
    articleSection: post.section,
    keywords: post.tags.map((t) => t.name).join(", ") || undefined,
    image: cover ? [absoluteUrl(cover)] : undefined,
    inLanguage: "en",
  };
}

/** JSON for an inline <script type="application/ld+json">: `<` is escaped so content can never close the tag. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
