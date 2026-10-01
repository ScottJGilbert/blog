import type { Metadata } from "next";
import Hero from "./components/Hero";
import WritingHub from "./components/WritingHub";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <>
      <Hero />
      <WritingHub />
    </>
  );
}
