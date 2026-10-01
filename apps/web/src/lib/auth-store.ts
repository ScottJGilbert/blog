"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { Me } from "@blog/shared";
import { isApiError } from "./api-error";
import { getBrowserApi } from "./browser-api";

/**
 * Tiny client-side session store shared by the header, comments and account pages.
 *
 * The session cookie is HttpOnly (JS can't see it) and Better Auth answers anonymous calls with 401/null, which would
 * spam every page view of every anonymous visitor (and the console). So the site keeps a non-sensitive hint cookie
 * (`blog-auth=1`) next to the session: set after sign-in, cleared on sign-out or when `/api/me` says 401. Without the
 * hint nothing is fetched. The header renders the same 44px "Sign in" control on the server, in the first client
 * render and after the lookup, so nothing shifts.
 */
export type AuthState =
  | { status: "unknown"; me: null }
  | { status: "anonymous"; me: null }
  | { status: "authenticated"; me: Me };

const HINT_COOKIE = "blog-auth";
const UNKNOWN: AuthState = { status: "unknown", me: null };
const ANONYMOUS: AuthState = { status: "anonymous", me: null };

let state: AuthState = UNKNOWN;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: AuthState) {
  state = next;
  listeners.forEach((l) => l());
}

export function hasAuthHint(): boolean {
  try {
    return document.cookie.split("; ").some((c) => c === `${HINT_COOKIE}=1`);
  } catch {
    return false;
  }
}

function setHint(on: boolean) {
  try {
    document.cookie = on
      ? `${HINT_COOKIE}=1; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`
      : `${HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {
    /* cookies blocked: the header just stays on "Sign in" until the next explicit check */
  }
}

/** Look the session up now (deduplicated). `force` skips the hint check (sign-in/account pages). */
export function refreshAuth({ force = false }: { force?: boolean } = {}): Promise<void> {
  if (!force && !hasAuthHint()) {
    if (state.status === "unknown") emit(ANONYMOUS);
    return Promise.resolve();
  }
  inflight ??= getBrowserApi()
    .then((api) => api.me({ cache: "no-store" }))
    .then((me) => {
      setHint(true);
      emit({ status: "authenticated", me });
    })
    .catch((err: unknown) => {
      if (isApiError(err) && (err.status === 401 || err.status === 403)) {
        setHint(false);
        emit(ANONYMOUS);
      } else if (state.status === "unknown") {
        emit(ANONYMOUS); // API unreachable: behave as signed out, retry on next navigation
      }
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Call after a successful sign-in / verification so every island updates. */
export function markSignedIn(): Promise<void> {
  setHint(true);
  return refreshAuth({ force: true });
}

export function markSignedOut() {
  setHint(false);
  emit(ANONYMOUS);
}

/** Update the cached profile after PATCH /api/me or a subscription change. */
export function setMe(me: Me) {
  emit({ status: "authenticated", me });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useAuth({ force = false }: { force?: boolean } = {}): AuthState & { refresh: () => Promise<void> } {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => UNKNOWN,
  );
  useEffect(() => {
    if (state.status === "unknown" || force) void refreshAuth({ force });
  }, [force]);
  const refresh = useCallback(() => refreshAuth({ force: true }), []);
  return { ...snapshot, refresh };
}
