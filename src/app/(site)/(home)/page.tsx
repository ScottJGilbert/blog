export default function Home() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-linear-to-br from-amber-50 via-orange-50 to-rose-100 px-6 py-16 font-sans dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950">
      <div className="pointer-events-none absolute -top-20 -left-20 h-72 w-72 rounded-full bg-amber-300/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-rose-300/30 blur-3xl" />

      <main className="relative w-full max-w-2xl rounded-3xl border border-orange-200/60 bg-white/80 p-10 text-center shadow-xl backdrop-blur-sm dark:border-orange-400/20 dark:bg-zinc-900/70">
        <p className="mb-4 inline-flex rounded-full bg-amber-100 px-4 py-1 text-sm font-medium text-amber-800 dark:bg-amber-300/10 dark:text-amber-200">
          ✨ Something new is on the way
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-5xl">
          Coming Soon
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-zinc-700 dark:text-zinc-300 sm:text-lg">
          We&apos;re crafting something special here —  can&apos;t wait to
          share it with you!
        </p>
      </main>
    </div>
  );
}
