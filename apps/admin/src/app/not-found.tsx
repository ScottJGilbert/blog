import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-md rounded-xl border border-edge bg-panel p-6 text-center">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted">That page does not exist or has been moved.</p>
        <Link href="/" className="mt-4 inline-flex min-h-10 items-center rounded-ctl bg-brand px-4 text-sm font-medium text-brand-ink">
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
