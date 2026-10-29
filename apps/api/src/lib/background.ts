import { waitUntil } from "@vercel/functions";
import type { Logger } from "../logger";

/**
 * Keep working AFTER the response was sent. On Vercel (Fluid compute) the instance is frozen as soon as the response is
 * done, so a bare `void promise` silently stalls (or dies mid-write). `waitUntil` tells the platform to keep the instance
 * alive until the promise settles. Elsewhere (dev server, tests) it is a plain fire-and-forget: the promise has already
 * started and the process stays alive. Never throws and never leaves an unhandled rejection.
 *
 * Inject a collecting fake through `Deps.background` in tests (`test/helpers.ts`), then `await Promise.all(fake.pending)`.
 */
export type Background = (task: Promise<unknown>, what?: string) => void;

export function createBackground(logger: Logger): Background {
  return (task, what = "background task") => {
    const guarded = task.catch((err) => {
      logger.warn({ err: err instanceof Error ? err.message : String(err), what }, "background task failed");
    });
    try {
      waitUntil(guarded);
    } catch {
      // not on Vercel / no request context: the promise simply runs to completion in this process
    }
  };
}
