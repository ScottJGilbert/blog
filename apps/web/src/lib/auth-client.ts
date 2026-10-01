"use client";

import { createAuthClient } from "better-auth/client";

let client: ReturnType<typeof createAuthClient> | undefined;

/** Better Auth client for the API hosted at `/api/auth/*` on the site's own origin. Browser only. */
export function getAuthClient() {
  client ??= createAuthClient({ baseURL: window.location.origin, basePath: "/api/auth" });
  return client;
}

/** Providers the API has credentials for. The API does not advertise them, so the site mirrors them in env flags. */
export const SOCIAL_PROVIDERS = [
  ...(isOn(process.env.NEXT_PUBLIC_AUTH_GOOGLE) ? (["google"] as const) : []),
  ...(isOn(process.env.NEXT_PUBLIC_AUTH_GITHUB) ? (["github"] as const) : []),
];

function isOn(v: string | undefined) {
  return v === "1" || v === "true";
}

export interface AuthFailure {
  code?: string;
  status?: number;
  message?: string;
}

/** Human message for a Better Auth error (never leaks internals, never distinguishes unknown email from wrong password). */
export function authErrorMessage(error: AuthFailure | null | undefined): string {
  if (!error) return "Something went wrong. Please try again.";
  switch (error.code) {
    case "EMAIL_NOT_VERIFIED":
      return "Please verify your email address first. We can send you a new verification link.";
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
      return "That email and password combination didn't work.";
    case "USER_BANNED":
      return "This account has been suspended.";
    case "PASSWORD_TOO_SHORT":
      return "Use at least 10 characters.";
    case "PASSWORD_TOO_LONG":
      return "That password is too long (128 characters maximum).";
    case "INVALID_TOKEN":
      return "This link is invalid or has expired. Please request a new one.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "We couldn't create that account. If you already have one, try signing in.";
    default:
      break;
  }
  if (error.status === 429) return "Too many attempts. Please wait a minute and try again.";
  if (error.status === 403) return "That wasn't allowed. Please reload the page and try again.";
  return "Something went wrong. Please try again.";
}
