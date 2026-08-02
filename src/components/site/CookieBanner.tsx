"use client";

import { useState } from "react";

export default function CookieBanner() {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <div
      id="cookieBanner"
      className="fixed bottom-8 left-1/2 z-60 flex w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 translate-y-0 transform flex-col items-center gap-8 rounded-2xl bg-on-surface p-8 text-surface shadow-2xl transition-transform duration-500 ease-out md:flex-row dark:bg-surface-container-highest"
    >
      <div className="flex flex-1 items-start gap-4">
        <span
          className="material-symbols-outlined text-[32px] text-secondary-fixed"
          style={{ fontVariationSettings: '"FILL" 1' }}
        >
          cookie
        </span>
        <div className="space-y-1">
          <p className="font-title-lg text-title-lg text-surface-bright">
            Privacy Notice
          </p>
          <p className="font-body-md text-body-md leading-relaxed opacity-80">
            We use essential cookies to maintain system integrity and analyze
            growth patterns within the Arboretum. No data is harvested for third
            parties.
          </p>
        </div>
      </div>
      <div className="flex w-full gap-4 md:w-auto">
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="flex-1 rounded-lg bg-surface px-8 py-3 font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-dim md:flex-none"
        >
          ACCEPT
        </button>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="flex-1 rounded-lg border border-surface/20 px-8 py-3 font-label-md text-label-md text-surface transition-colors hover:bg-surface/10 md:flex-none"
        >
          DECLINE
        </button>
      </div>
    </div>
  );
}
