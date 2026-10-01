import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server-session";
import { safeNext } from "@/lib/safe-next";
import { LoginForm } from "./login-form";
import { NotAuthorised } from "./not-authorised";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; reason?: string; expired?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const session = await getSession();

  if (session.status === "ok") {
    if (session.me.role === "admin") redirect(next);
    return <NotAuthorised name={session.me.name} email={session.me.email} />;
  }

  const notice =
    session.status === "suspended"
      ? session.message || "This account has been suspended."
      : sp.expired
        ? "Your session has expired. Please sign in again."
        : sp.reason === "suspended"
          ? "This account has been suspended."
          : null;

  return <LoginForm next={next} notice={notice} />;
}
