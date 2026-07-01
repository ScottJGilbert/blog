export default function BlogPlaceholderPage() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 p-12 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
      {/* Engineering-style background grid accent (optional) */}
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-size-[14px_24px]" />

      <div className="mx-auto max-w-md">
        {/* Simple Terminal-like Icon */}
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-100 font-mono text-xl font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          &lt;/&gt;
        </div>

        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Under Construction
        </h2>

        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Check back soon for the first publication.
        </p>

        <div className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1 text-xs font-mono text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          <span>status: compilation_in_progress</span>
        </div>
      </div>
    </div>
  );
}
