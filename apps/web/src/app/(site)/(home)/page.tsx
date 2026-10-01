import type { Metadata } from "next";
import Hero from "./components/Hero";
import LatestPosts from "./components/LatestPosts";
import NewsletterCta from "./components/NewsletterCta";
import WritingHub from "./components/WritingHub";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <>
      <Hero />
      <LatestPosts />
      <WritingHub />
      <NewsletterCta />
    </>
  );
}
