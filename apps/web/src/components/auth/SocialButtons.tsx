"use client";

import { useState } from "react";
import { FaGithub, FaGoogle } from "react-icons/fa";
import { Button } from "@/components/ui/Button";
import { authErrorMessage, getAuthClient, SOCIAL_PROVIDERS } from "@/lib/auth-client";

const LABEL = { google: "Google", github: "GitHub" } as const;
const ICON = { google: FaGoogle, github: FaGithub } as const;

/** Rendered only for providers enabled through NEXT_PUBLIC_AUTH_GOOGLE / NEXT_PUBLIC_AUTH_GITHUB. */
export function SocialButtons({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  if (SOCIAL_PROVIDERS.length === 0) return null;

  async function go(provider: (typeof SOCIAL_PROVIDERS)[number]) {
    setError(null);
    const { error } = await getAuthClient().signIn.social({
      provider,
      callbackURL: `/auth/complete?next=${encodeURIComponent(next)}`,
      errorCallbackURL: "/login?error=social",
    });
    if (error) setError(authErrorMessage(error));
  }

  return (
    <div className="mt-6">
      <p className="flex items-center gap-3 text-sm text-muted">
        <span aria-hidden className="h-px flex-1 bg-border" />
        or continue with
        <span aria-hidden className="h-px flex-1 bg-border" />
      </p>
      <div className="mt-4 grid gap-3">
        {SOCIAL_PROVIDERS.map((provider) => {
          const Icon = ICON[provider];
          return (
            <Button key={provider} variant="secondary" size="lg" onClick={() => go(provider)}>
              <Icon aria-hidden className="size-4" />
              {LABEL[provider]}
            </Button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
