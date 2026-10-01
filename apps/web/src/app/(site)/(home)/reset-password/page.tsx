import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, linkClass } from "@/components/auth/AuthCard";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const invalid = !token || typeof sp.error === "string";
  return (
    <AuthCard
      title={invalid ? "This link has expired" : "Choose a new password"}
      description={invalid ? "Reset links work once and for one hour." : "Pick something at least 10 characters long."}
    >
      {invalid ? (
        <p>
          <Link prefetch={false} href="/forgot-password" className={linkClass}>
            Request a new reset link
          </Link>
        </p>
      ) : (
        <ResetPasswordForm token={token} />
      )}
    </AuthCard>
  );
}
