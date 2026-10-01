"use client";

import { useCallback } from "react";
import { useSWRConfig } from "swr";

/** Revalidate every cached SWR entry whose key is `[group, ...]` (keys are arrays: `["posts", query]`). */
export function useGroupMutate() {
  const { mutate } = useSWRConfig();
  return useCallback(
    (...groups: string[]) =>
      mutate((key) => Array.isArray(key) && typeof key[0] === "string" && groups.includes(key[0]), undefined, { revalidate: true }),
    [mutate],
  );
}
