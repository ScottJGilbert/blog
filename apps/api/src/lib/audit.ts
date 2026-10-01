import { auditLog, type DbOrTx } from "@blog/db";

export interface AuditEntry {
  /** dotted verb, e.g. `post.publish`, `user.ban`, `media.delete` */
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
}

/**
 * Write an `audit_log` row for an admin mutation. Pass a transaction handle as `db` to make it atomic with the change.
 *
 *   await audit(deps.db, req.user, { action: "post.publish", targetType: "post", targetId: id, meta: { slug } });
 */
export async function audit(db: Pick<DbOrTx, "insert">, actor: { id: string } | null | undefined, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorId: actor?.id ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    meta: entry.meta ?? null,
  });
}
