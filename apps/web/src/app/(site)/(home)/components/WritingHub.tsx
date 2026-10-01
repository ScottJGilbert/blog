import Image from "next/image";

export default function WritingHub() {
  return (
    <section className="mx-auto max-w-7xl px-8 pb-32">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
        {/* Personal Card */}
        <div className="group relative flex min-h-100 flex-col justify-between overflow-hidden rounded-2xl bg-surface-container-lowest p-10 bento-card-hover md:col-span-8 dark:bg-surface-container-highest/5">
          <div className="z-10">
            <span className="rounded-full bg-secondary-container px-3 py-1 font-label-sm text-label-sm text-secondary dark:bg-secondary-container/20 dark:text-secondary-fixed-dim">
              Reflections
            </span>
            <h3 className="mb-3 mt-6 font-headline-md text-headline-md text-on-surface dark:text-surface-bright">
              Personal Growth &amp; Life Logs
            </h3>
            <p className="max-w-md font-body-md text-body-md text-on-surface-variant dark:text-on-surface-variant">
              Life updates, philosophical reflections, and what I&apos;m
              currently learning beyond the screen. An organic record of a
              digital life.
            </p>
          </div>
          <div className="absolute -bottom-5 -right-5 opacity-5 transition-opacity group-hover:opacity-10 dark:opacity-10">
            <span
              className="material-symbols-outlined text-[240px]"
              style={{ fontVariationSettings: '"FILL" 1' }}
            >
              person
            </span>
          </div>
          <div className="z-10 mt-8">
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg bg-primary-container px-8 py-3 font-label-md text-label-md text-on-primary shadow-sm transition-all hover:bg-primary dark:bg-primary-fixed dark:text-on-primary-fixed"
            >
              READ UPDATES
              <span className="material-symbols-outlined text-sm">
                arrow_forward
              </span>
            </button>
          </div>
        </div>

        {/* Engineering Card */}
        <div className="group relative flex min-h-100 flex-col justify-between overflow-hidden rounded-2xl bg-surface-container-lowest p-10 bento-card-hover md:col-span-4 dark:bg-surface-container-highest/5">
          <div className="z-10">
            <span className="rounded-full bg-secondary-container px-3 py-1 font-label-sm text-label-sm text-secondary dark:bg-secondary-container/20 dark:text-secondary-fixed-dim">
              Technical
            </span>
            <h3 className="mb-3 mt-6 font-headline-md text-headline-md text-on-surface dark:text-surface-bright">
              Engineering &amp; CAD
            </h3>
            <p className="font-body-md text-body-md text-on-surface-variant dark:text-on-surface-variant">
              Deep dives into software architecture, industrial CAD workflows,
              and systemic problem-solving.
            </p>
          </div>
          <div className="absolute -bottom-8 -right-8 opacity-5 transition-opacity group-hover:opacity-10 dark:opacity-10">
            <span className="material-symbols-outlined text-[180px]">
              precision_manufacturing
            </span>
          </div>
          <div className="z-10 mt-8">
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg bg-surface-container-high/50 px-8 py-3 font-label-md text-label-md text-primary transition-colors hover:bg-surface-container-high dark:bg-surface-container-highest/10 dark:text-primary-fixed-dim"
            >
              VIEW WORK
            </button>
          </div>
        </div>

        {/* Miracle Makers Card */}
        <div className="group relative flex min-h-87.5 flex-col items-center gap-12 overflow-hidden rounded-2xl bg-surface-container-lowest p-10 bento-card-hover md:col-span-12 md:flex-row dark:bg-surface-container-highest/5">
          <div className="z-10 flex-1">
            <span className="rounded-full bg-secondary-container px-3 py-1 font-label-sm text-label-sm text-secondary dark:bg-secondary-container/20 dark:text-secondary-fixed-dim">
              Impact
            </span>
            <h3 className="mb-3 mt-6 font-headline-md text-headline-md text-on-surface dark:text-surface-bright">
              Miracle Makers Blog (External)
            </h3>
            <p className="max-w-xl font-body-md text-body-md text-on-surface-variant dark:text-on-surface-variant">
              Dedicated service projects and volunteer work focused on creating
              tangible miracles for those who need them most. Building bridges
              between technology and charity.
            </p>
            <div className="mt-8 flex gap-4">
              <button
                type="button"
                className="flex items-center gap-2 rounded-lg bg-primary-container px-10 py-4 font-label-md text-label-md text-on-primary shadow-sm transition-all hover:bg-primary dark:bg-primary-fixed dark:text-on-primary-fixed"
              >
                GET INVOLVED
                <span className="material-symbols-outlined text-sm">
                  volunteer_activism
                </span>
              </button>
            </div>
          </div>
          <div className="relative h-full min-h-62.5 w-full flex-1 overflow-hidden rounded-xl grayscale transition-all duration-700 hover:grayscale-0">
            <Image
              fill
              className="object-cover"
              alt="Community service project in progress"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDYW1K9z8D6mBtjXat7I5hhZfjTDP4BqXnaiYTQ2r9-ubz5uLWSvag7ZfFTDEQh0bPq-lvTx5foKjJYhX4YHg9zONZwnZunRjdWJplKN5KaSdAgojVZqjts4NMOzZ5OI1UN1i3wffnOjBc4bpPpzImiZY7GuJvL9DfZcgxqNBSk20MlgerC-Hsga_JLf9GCTVwNuN5bZlkI14ukt-g25_iYQIO6VGFK3dTmMzEC9ilAMG3CeOkB-6gDYc-GbFnfvCDC1NEVTP8VEO4"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
