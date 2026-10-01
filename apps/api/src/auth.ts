import { account, session, user, verification, type Database, eq } from "@blog/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import type { Config } from "./config";
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
    },

    // Our express-rate-limit presets cover /auth in every environment; Better Auth's own limiter adds per-rule limits in prod.
    rateLimit: { enabled: config.isProd && config.rateLimit.enabled },

    databaseHooks: {
      user: {
        create: {
          before: async (u) => ({
            data: { ...u, role: u.emailVerified && isAdminEmail(u.email) ? "admin" : "reader" },
          }),
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
