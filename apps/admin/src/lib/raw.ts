"use client";

import { NewsletterSchema, type Newsletter } from "@blog/shared";
import { ApiError, codeForStatus } from "@blog/shared/client";
import { handleUnauthorized } from "./api";

/** For endpoints the shared client does not expose with a useful return type (test send result, unschedule). */
async function postJson(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "include",
    headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) handleUnauthorized();
  const json = (await res.json().catch(() => undefined)) as { data?: unknown; error?: { code?: never; message?: string; details?: unknown } } | undefined;
  if (!res.ok) {
    throw new ApiError({ status: res.status, code: codeForStatus(res.status), message: json?.error?.message ?? res.statusText, details: json?.error?.details });
  }
  return json?.data;
}

export interface TestSendResult {
  sent: boolean;
  provider: "listmonk" | "noop";
  warning: string | null;
}

export async function testNewsletter(id: string, email: string): Promise<TestSendResult> {
  const data = (await postJson(`/admin/newsletters/${encodeURIComponent(id)}/test`, { email })) as Partial<TestSendResult> | undefined;
  return { sent: data?.sent ?? true, provider: data?.provider ?? "noop", warning: data?.warning ?? null };
}

export async function unscheduleNewsletter(id: string): Promise<Newsletter> {
  return NewsletterSchema.parse(await postJson(`/admin/newsletters/${encodeURIComponent(id)}/unschedule`));
}
