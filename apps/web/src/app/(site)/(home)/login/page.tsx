import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, linkClass } from "@/components/auth/AuthCard";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeNext } from "@/lib/safe-redirect";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to comment and manage your newsletter subscription.",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: true },
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const nextQuery = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  return (
    <AuthCard
      title="Sign in"
      description="Welcome back. Sign in to join the conversation."
      footer={
        <p>
          New here?{" "}
          <Link href={`/signup${nextQuery}`} className={linkClass}>
            Create an account
          </Link>
        </p>
      }
    >
      <LoginForm next={next} initialError={error} />
    </AuthCard>
  );
}
