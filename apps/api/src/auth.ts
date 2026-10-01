import { account, session, user, verification, type Database, eq } from "@blog/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import { UrlOrPathSchema } from "@blog/shared";
import type { Config } from "./config";
import { sanitizeDisplayName } from "./lib/text";
import type { Logger } from "./logger";
import { resetPasswordEmail, verifyEmail, type Mailer } from "./services/mailer";

/**
 * Better Auth, hosted in this API at `<basePath>/auth/*`.
 *
 * Design notes
 *  - Plain additionalFields (`role`, `banned`, `banReason`) instead of the `admin` plugin: no second admin API
 *    surface, no `banExpires`/`impersonatedBy`. Ban = `banned` flag + session-create hook (cannot sign in) +
 *    `getSessionUser` check (existing sessions stop working immediately) + `revokeUserSessions()` (deletes rows).
 *  - Roles can never be set by clients (`input: false`). `ADMIN_EMAILS` promotes an account to `admin` only once its
 *    email is VERIFIED (on social sign-up, or via `afterEmailVerification`) so nobody can claim an admin address.
 *  - Email verification is required to sign in unless REQUIRE_EMAIL_VERIFICATION=false. Sign-up is then
 *    enumeration-safe (Better Auth returns a synthetic user for existing emails).
 */
export interface AuthDeps {
  config: Config;
  db: Database;
  mailer: Mailer;
  logger: Logger;
}

/**
 * Normalise client-controlled profile fields that Better Auth would otherwise store verbatim (its own `update-user` /
 * sign-up endpoints bypass `PATCH /me`'s validation): printable single-line `name` ≤ 80 chars (NUL bytes would 500),
 * `image` limited to http(s) URLs / site-relative paths (no `javascript:` / `data:` / `/\\host`).
 */
export function cleanProfileFields<T extends { name?: unknown; image?: unknown; email?: unknown }>(data: T): T {
  const out: Record<string, unknown> = { ...data };
  if (typeof out.name === "string") {
    const name = sanitizeDisplayName(out.name);
    const local = typeof out.email === "string" ? sanitizeDisplayName(out.email.split("@")[0] ?? "") : "";
    out.name = name || local || "Reader";
  }
  if (out.image !== undefined && out.image !== null) {
    out.image = typeof out.image === "string" && UrlOrPathSchema.safeParse(out.image).success ? out.image : null;
  }
  return out as T;
}

export function createAuth({ config, db, mailer, logger }: AuthDeps) {
  const isAdminEmail = (email: string) => config.adminEmails.includes(email.toLowerCase());

  const send = async (to: string, rendered: { subject: string; html: string; text: string }, what: string) => {
    try {
      await mailer.send({ to, ...rendered });
    } catch (err) {
      // Never fail the auth request because the mail transport is down; the user can request another mail.
      logger.error({ err: err instanceof Error ? err.message : String(err), what }, "failed to send auth email");
    }
  };

  const socialProviders = {
    ...(config.social.google ? { google: config.social.google } : {}),
    ...(config.social.github ? { github: config.social.github } : {}),
  };

  return betterAuth({
    appName: config.siteName,
    baseURL: config.authUrl,
    basePath: `${config.basePath}/auth`,
    secret: config.authSecret,
    logger: { disabled: config.isTest },
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } }),

    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "reader", input: false },
        banned: { type: "boolean", required: false, defaultValue: false, input: false },
        banReason: { type: "string", required: false, input: false },
      },
    },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      requireEmailVerification: config.requireEmailVerification,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user: u, url }) =>
        send(u.email, resetPasswordEmail({ siteName: config.siteName, name: u.name, url }), "reset-password"),
    },

    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user: u, url }) =>
        send(u.email, verifyEmail({ siteName: config.siteName, name: u.name, url }), "verify-email"),
      afterEmailVerification: async (u) => {
        if (isAdminEmail(u.email)) await db.update(user).set({ role: "admin" }).where(eq(user.id, u.id));
      },
    },

    ...(Object.keys(socialProviders).length > 0 ? { socialProviders } : {}),

    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },

    advanced: {
      useSecureCookies: config.isProd,
      cookiePrefix: "blog",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: config.isProd },
      // Better Auth skips its Origin / callbackURL validation when NODE_ENV=test by default. Force it on everywhere so the
      // test-suite exercises exactly what production runs (state-changing + cookie ⇒ trusted Origin; callback URLs ⇒ trustedOrigins).
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },

    // Our express-rate-limit presets cover /auth in every environment; Better Auth's own limiter adds per-rule limits in prod.
    rateLimit: { enabled: config.isProd && config.rateLimit.enabled },

    databaseHooks: {
      user: {
        create: {
          before: async (u) => ({
            data: { ...cleanProfileFields(u), role: u.emailVerified && isAdminEmail(u.email) ? "admin" : "reader" },
          }),
        },
        update: {
          before: async (u) => ({ data: cleanProfileFields(u) }),
        },
      },
      session: {
        create: {
          before: async (s) => {
            const [row] = await db.select({ banned: user.banned }).from(user).where(eq(user.id, s.userId)).limit(1);
            if (row?.banned) throw new APIError("FORBIDDEN", { code: "USER_BANNED", message: "This account has been suspended." });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Delete every session of a user (call after banning / demoting / deleting). */
export async function revokeUserSessions(db: Database, userId: string): Promise<void> {
  await db.delete(session).where(eq(session.userId, userId));
}

// ---------------------------------------------------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------------------------------------------------
type SessionState = { user: Express.SessionUser; banned: boolean } | null;
const cache = new WeakMap<Request, Promise<SessionState>>();

function asRole(v: unknown): Express.SessionUser["role"] {
  return v === "admin" ? "admin" : "reader";
}

/** Resolve the Better Auth session of a request (memoised per request). */
export function loadSession(req: Request): Promise<SessionState> {
  let p = cache.get(req);
  if (!p) {
    const auth = (req.app.locals.deps as { auth: Auth }).auth;
    p = auth.api
      .getSession({ headers: fromNodeHeaders(req.headers) })
      .then((res): SessionState => {
        if (!res) return null;
        const u = res.user as typeof res.user & { role?: unknown; banned?: unknown };
        return {
          banned: u.banned === true,
          user: {
            id: u.id,
            name: u.name,
            email: u.email,
            image: u.image ?? null,
            role: asRole(u.role),
            emailVerified: u.emailVerified,
          },
        };
      })
      .catch(() => null);
    cache.set(req, p);
  }
  return p;
}

/** The signed-in, non-banned user of this request, or null. */
export async function getSessionUser(req: Request): Promise<Express.SessionUser | null> {
  const s = await loadSession(req);
  return s && !s.banned ? s.user : null;
}
