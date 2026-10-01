import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, linkClass } from "@/components/auth/AuthCard";
import { SignupForm } from "@/components/auth/SignupForm";
import { safeNext } from "@/lib/safe-redirect";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create an account to comment on posts and subscribe to the newsletter.",
  alternates: { canonical: "/signup" },
  robots: { index: false, follow: true },
};

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const nextQuery = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  return (
    <AuthCard
      title="Create an account"
      description="Comment on posts and get new ones by email. We'll send a link to verify your address."
      footer={
        <p>
          Already have an account?{" "}
          <Link href={`/login${nextQuery}`} className={linkClass}>
            Sign in
          </Link>
        </p>
      }
    >
      <SignupForm next={next} />
    </AuthCard>
  );
}
