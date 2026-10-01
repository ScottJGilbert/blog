import { account, comment, eq, or, session, sql, subscriber, user, verification, type Database } from "@blog/db";
import { UpdateMeInputSchema, type Me } from "@blog/shared";
import { Router } from "express";
import { badRequest, forbidden, notFound } from "../errors";
import type { Deps } from "../deps";
import { sanitizeDisplayName } from "../lib/text";
import { parseBody } from "../lib/validate";
import { requireUser } from "../middleware/auth";

/** Subscription status of a signed-in user (matched by user id or by account email). */
export async function getSubscriptionStatus(db: Database, u: { id: string; email: string }): Promise<{ status: "pending" | "confirmed" | "unsubscribed" } | null> {
  const [row] = await db
    .select({ status: subscriber.status })
    .from(subscriber)
    .where(or(eq(subscriber.userId, u.id), eq(subscriber.email, u.email.toLowerCase())))
    .limit(1);
  return row ? { status: row.status } : null;
}

export async function loadMe(db: Database, userId: string): Promise<Me> {
  const [row] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
  if (!row) throw notFound("User not found");
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    image: row.image,
    role: row.role,
    emailVerified: row.emailVerified,
    subscription: await getSubscriptionStatus(db, row),
  };
}

/** `GET/PATCH/DELETE /me`. (`/me/subscription` belongs to the public router.) */
export function meRouter(deps: Deps): Router {
  const router = Router();

  router.get("/me", requireUser, async (req, res) => {
    res.set("cache-control", "no-store");
    res.json({ data: await loadMe(deps.db, req.user!.id) });
  });

  router.patch("/me", requireUser, async (req, res) => {
    const input = parseBody(UpdateMeInputSchema, req);
    const name = input.name !== undefined ? sanitizeDisplayName(input.name) : undefined;
    if (name === "") throw badRequest("Name cannot be empty", [{ path: ["name"], message: "must contain printable characters" }]);
    await deps.db
      .update(user)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(input.image !== undefined ? { image: input.image } : {}),
      })
      .where(eq(user.id, req.user!.id));
    res.json({ data: await loadMe(deps.db, req.user!.id) });
  });

  /**
   * Anonymise the account: comments stay (body "[deleted]", no author → "Deleted user"), credentials / sessions /
   * newsletter subscription are removed, the user row is blanked (rows that reference it, e.g. audit log, stay valid).
   */
  router.delete("/me", requireUser, async (req, res) => {
    const me = req.user!;
    if (me.role === "admin") throw forbidden("Administrators cannot delete their own account; ask another administrator to demote you first.");

    const subs = await deps.db.select().from(subscriber).where(or(eq(subscriber.userId, me.id), eq(subscriber.email, me.email.toLowerCase())));
    for (const s of subs) {
      if (s.listmonkSubscriberId != null) {
        await deps.newsletter.removeSubscriber(String(s.listmonkSubscriberId)).catch((err) => deps.logger.warn({ err: String(err) }, "newsletter removal failed during account deletion"));
      }
    }

    await deps.db.transaction(async (tx) => {
      await tx.update(comment).set({ body: "[deleted]", status: "deleted", authorId: null, editedAt: null }).where(eq(comment.authorId, me.id));
      await tx.delete(subscriber).where(or(eq(subscriber.userId, me.id), eq(subscriber.email, me.email.toLowerCase())));
      await tx.delete(session).where(eq(session.userId, me.id));
      await tx.delete(account).where(eq(account.userId, me.id));
      // Better Auth stores one-time tokens as identifier `reset-password:<token>` with the user id as value (verification links are
      // stateless JWTs). Match by exact value / literal substring: `like` would treat `_` and `%` in an e-mail as wildcards and
      // delete other people's pending tokens.
      await tx
        .delete(verification)
        .where(sql`${verification.value} = ${me.id} or strpos(${verification.identifier}, ${me.email.toLowerCase()}) > 0 or strpos(${verification.identifier}, ${me.id}) > 0`);
      await tx
        .update(user)
        .set({ name: "Deleted user", email: `deleted+${me.id}@deleted.invalid`, image: null, emailVerified: false, role: "reader" })
        .where(eq(user.id, me.id));
    });
    res.status(204).end();
  });

  return router;
}
