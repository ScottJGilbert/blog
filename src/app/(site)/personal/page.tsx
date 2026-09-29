export default function PersonalPage() {
  return (
    <div className="relative isolate overflow-hidden rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 p-12 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-size-[14px_24px]" />
      <div className="mx-auto max-w-md">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Personal
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Check back soon for the first publication.
        </p>
      </div>
    </div>
  );
}
