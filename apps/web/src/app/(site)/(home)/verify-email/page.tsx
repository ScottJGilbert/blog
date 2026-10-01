import type { Metadata } from "next";
import Link from "next/link";
import { LuCircleCheck, LuMailQuestion } from "react-icons/lu";
import { AuthCard, linkClass } from "@/components/auth/AuthCard";
import { AuthSync } from "@/components/auth/AuthSync";
import { ResendVerification } from "@/components/auth/ResendVerification";
import { ButtonLink } from "@/components/ui/Button";
import { safeNext } from "@/lib/safe-redirect";

export const metadata: Metadata = {
  title: "Verify your email",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Landing page for the verification link (Better Auth redirects here with `?verified=1`, or `?error=…`),
 * and the "check your email / resend" page.
 */
export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const email = typeof sp.email === "string" ? sp.email.slice(0, 254) : "";
  const failed = typeof sp.error === "string";
  const verified = !failed && sp.verified === "1";

  if (verified) {
    return (
      <AuthCard title="Email verified" description="Thanks, your address is confirmed.">
        <AuthSync />
        <div role="status" className="flex items-start gap-3 text-accent-soft-fg">
          <LuCircleCheck aria-hidden className="mt-0.5 size-6 shrink-0 text-accent" />
          <p className="text-fg">You can now comment on posts and manage your newsletter subscription.</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href={next} size="lg">
            Continue
          </ButtonLink>
          <ButtonLink href="/login" variant="secondary" size="lg">
            Sign in
          </ButtonLink>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={failed ? "That link didn't work" : "Check your email"}
      description={
        failed
          ? "Verification links expire after an hour and work once. Request a fresh one below."
          : "We sent you a link to verify your address. Open it to finish setting up your account."
      }
      footer={
        <Link prefetch={false} href="/login" className={linkClass}>
          Back to sign in
        </Link>
      }
    >
      <div className="mb-6 flex items-start gap-3">
        <LuMailQuestion aria-hidden className="mt-0.5 size-6 shrink-0 text-accent" />
        <p className="text-muted">Can&rsquo;t find it? Check your spam folder, or request a new link.</p>
      </div>
      <ResendVerification initialEmail={email} next={next} />
    </AuthCard>
  );
}
