export default function AboutPage() {
  return (
    <div className="relative isolate overflow-hidden rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 p-12 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
      {/* Engineering-style background grid accent (optional) */}
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-size-[14px_24px]" />
      <div className="mx-auto max-w-md">
        {/* Simple Terminal-like Icon */}
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-100 font-mono text-xl font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          &lt;/&gt;
        </div>
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          About The Author
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          This blog is maintained by Scott, a computer engineer passionate about
          technology and the making miracles at the same time. Check back soon
          for more information about the author and the blog&apos;s mission.
        </p>
      </div>
    </div>
  );
}
