import { mutate } from "swr";

/**
 * Revalidate every cached SWR entry whose key is `[group, ...]` (keys are arrays: `["posts", query]`). Cached data stays
 * on screen while it refetches. There is no custom SWRConfig cache provider, so the global `mutate` reaches the same cache.
 */
export const mutateGroups = (...groups: string[]) =>
  mutate((key) => Array.isArray(key) && typeof key[0] === "string" && groups.includes(key[0]));
