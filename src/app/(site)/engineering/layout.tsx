import { ReactNode } from "react";

export default function BlogLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-auto max-w-4xl px-4 py-8 antialiased">
      {/* Blog Section Header */}
      <header className="mb-8 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Engineering Insights
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Deep dives, architectural reviews, and lessons learned from both
          development and (regrettably) production.
        </p>
      </header>

      {/* Blog Content */}
      <main>{children}</main>
    </div>
  );
}
