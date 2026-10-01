import type { ApiKeyScope, UserRole } from "@blog/shared";

declare global {
  namespace Express {
    /** The authenticated user (set by `requireUser` / `optionalUser` and friends). */
    interface SessionUser {
      id: string;
      name: string;
      email: string;
      image: string | null;
      role: UserRole;
      emailVerified: boolean;
    }
    /** A verified API key (set by the `/v1` API-key middleware — WP B2). */
    interface ApiKeyPrincipal {
      id: string;
      scopes: ApiKeyScope[];
    }
    interface Request {
      user?: SessionUser;
      apiKey?: ApiKeyPrincipal;
    }
  }
}

export {};
