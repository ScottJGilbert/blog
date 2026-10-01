import { and, count, desc, eq, ilike, ne, or, post, user, sql, type DbOrTx, type SQL } from "@blog/db";
import type { AdminUser, BanUserInput, ListUsersQuery, UpdateUserInput } from "@blog/shared";
import { revokeUserSessions } from "../../auth";
import type { Deps } from "../../deps";
import { HttpError, conflict, forbidden, notFound } from "../../errors";
import { audit } from "../../lib/audit";
import { likePattern } from "./common";

type UserRow = typeof user.$inferSelect;
type Actor = { id: string };

export function toAdminUser(u: UserRow): AdminUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    role: u.role,
    emailVerified: u.emailVerified,
    banned: u.banned,
    banReason: u.banReason,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

export function createAdminUsersService(deps: Deps) {
  const { db } = deps;

  async function find(id: string, tx: DbOrTx = db): Promise<UserRow> {
    const [row] = await tx.select().from(user).where(eq(user.id, id)).limit(1);
    if (!row) throw notFound("User not found");
    return row;
  }

  /**
   * Lock every admin row (in id order, so concurrent callers queue instead of deadlocking) and make sure that after
   * `target` stops being an active admin at least one OTHER active (not banned) admin remains, and the acting admin is
   * still one of them. Serialises "A demotes B" vs "B demotes A" so the platform can never end up without an admin.
   */
  async function assertAnotherAdminRemains(tx: DbOrTx, actor: Actor, target: UserRow): Promise<void> {
    const admins = await tx
      .select({ id: user.id, banned: user.banned })
      .from(user)
      .where(eq(user.role, "admin"))
      .orderBy(user.id)
      .for("update");
    const others = admins.filter((a) => a.id !== target.id && !a.banned);
    if (others.length === 0) throw conflict("This is the last administrator; promote someone else first");
    if (!others.some((a) => a.id === actor.id)) throw forbidden("Your administrator access changed; please sign in again");
  }

  return {
    async list(q: ListUsersQuery): Promise<{ items: AdminUser[]; total: number }> {
      const conds: SQL[] = [];
      if (q.q) {
        const p = likePattern(q.q);
        conds.push(or(ilike(user.name, p), ilike(user.email, p))!);
      }
      if (q.role) conds.push(eq(user.role, q.role));
      if (q.banned !== undefined) conds.push(eq(user.banned, q.banned));
      const where = conds.length ? and(...conds) : undefined;
      const [rows, [totals]] = await Promise.all([
        db
          .select()
          .from(user)
          .where(where)
          .orderBy(desc(user.createdAt), desc(user.id))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        db.select({ n: count() }).from(user).where(where),
      ]);
      return { items: rows.map(toAdminUser), total: totals?.n ?? 0 };
    },

    async get(id: string): Promise<AdminUser> {
      return toAdminUser(await find(id));
    },

    async update(actor: Actor, id: string, input: UpdateUserInput): Promise<AdminUser> {
      const target = await find(id);
      if (input.role === undefined || input.role === target.role) return toAdminUser(target);
      if (id === actor.id) throw forbidden("You cannot change your own role");
      const updated = await db.transaction(async (tx) => {
        if (target.role === "admin" && input.role !== "admin") await assertAnotherAdminRemains(tx, actor, target);
        const [row] = await tx.update(user).set({ role: input.role, updatedAt: sql`now()` }).where(eq(user.id, id)).returning();
        await audit(tx, actor, { action: "user.role", targetType: "user", targetId: id, meta: { from: target.role, to: input.role, email: target.email } });
        return row!;
      });
      return toAdminUser(updated);
    },

    async ban(actor: Actor, id: string, input: BanUserInput): Promise<AdminUser> {
      const target = await find(id);
      if (id === actor.id) throw forbidden("You cannot ban yourself");
      const updated = await db.transaction(async (tx) => {
        if (target.role === "admin" && !target.banned) await assertAnotherAdminRemains(tx, actor, target);
        const [row] = await tx.update(user).set({ banned: true, banReason: input.reason, updatedAt: sql`now()` }).where(eq(user.id, id)).returning();
        await audit(tx, actor, { action: "user.ban", targetType: "user", targetId: id, meta: { reason: input.reason, email: target.email } });
        return row!;
      });
      await revokeUserSessions(db, id);
      return toAdminUser(updated);
    },

    async unban(actor: Actor, id: string): Promise<AdminUser> {
      const target = await find(id);
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx.update(user).set({ banned: false, banReason: null, updatedAt: sql`now()` }).where(eq(user.id, id)).returning();
        await audit(tx, actor, { action: "user.unban", targetType: "user", targetId: id, meta: { email: target.email } });
        return row!;
      });
      return toAdminUser(updated);
    },

    /**
     * Delete an account. Posts are `ON DELETE RESTRICT`: a user who owns posts yields 409 unless `reassignTo`
     * (another active admin) is given, in which case the posts move there in the same transaction. Comments,
     * subscriptions, media, newsletters, API keys and audit rows keep existing (FK SET NULL); sessions/accounts cascade.
     */
    async remove(actor: Actor, id: string, opts: { reassignTo?: string } = {}): Promise<void> {
      const target = await find(id);
      if (id === actor.id) throw forbidden("You cannot delete yourself");
      await db.transaction(async (tx) => {
        if (target.role === "admin" && !target.banned) await assertAnotherAdminRemains(tx, actor, target);
        const [owned] = await tx.select({ n: count() }).from(post).where(eq(post.authorId, id));
        const postCount = owned?.n ?? 0;
        let reassigned = 0;
        if (postCount > 0) {
          if (!opts.reassignTo) {
            throw conflict(`This user owns ${postCount} post(s). Delete them or pass ?reassignTo=<adminId> to transfer them.`, { posts: postCount });
          }
          if (opts.reassignTo === id) throw new HttpError(400, "validation_error", "reassignTo must be a different user");
          const [dest] = await tx.select().from(user).where(and(eq(user.id, opts.reassignTo), eq(user.role, "admin"), ne(user.banned, true))).limit(1);
          if (!dest) throw new HttpError(400, "validation_error", "reassignTo must be the id of an active administrator");
          await tx.update(post).set({ authorId: dest.id, updatedAt: sql`now()` }).where(eq(post.authorId, id));
          reassigned = postCount;
        }
        await tx.delete(user).where(eq(user.id, id));
        await audit(tx, actor, {
          action: "user.delete",
          targetType: "user",
          targetId: id,
          meta: { email: target.email, role: target.role, reassignedPosts: reassigned, ...(reassigned ? { reassignTo: opts.reassignTo } : {}) },
        });
      });
    },
  };
}

export type AdminUsersService = ReturnType<typeof createAdminUsersService>;
