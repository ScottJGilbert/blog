import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getSession } from "@/lib/server-session";
import { loginUrl } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

/** Authoritative server-side gate: valid session AND role === "admin", else redirect to `/login?next=`. */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session.status !== "ok") {
    const path = (await headers()).get("x-admin-path") ?? "/";
    redirect(loginUrl(path, session.status === "suspended" ? { reason: "suspended" } : undefined));
  }
  if (session.me.role !== "admin") {
    redirect("/login?reason=forbidden");
  }
  return <AppShell me={session.me}>{children}</AppShell>;
}
