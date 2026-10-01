import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, linkClass } from "@/components/auth/AuthCard";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Forgot your password?",
  alternates: { canonical: "/forgot-password" },
  robots: { index: false, follow: true },
};

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Forgot your password?"
      description="Enter your email address and we'll send you a link to choose a new one."
      footer={
        <Link href="/login" className={linkClass}>
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
