import type { Metadata } from "next";
import { NewsletterEditor } from "@/features/newsletters/newsletter-editor";

export const metadata: Metadata = { title: "Edit newsletter" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NewsletterEditor id={id} />;
}
