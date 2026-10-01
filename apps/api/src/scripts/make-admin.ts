/**
 * Promote an existing account to admin:  pnpm --filter @blog/api make-admin you@example.com
 * (the account must exist: sign up first). Use `--demote` to go back to reader.
 */
import { closeDb, eq, getDb, user } from "@blog/db";
import { revokeUserSessions } from "../auth";

async function main() {
  const args = process.argv.slice(2);
  const demote = args.includes("--demote");
  const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
  if (!email) {
    console.error("usage: make-admin <email> [--demote]");
    process.exitCode = 2;
    return;
  }
  const db = getDb();
  const [row] = await db.select({ id: user.id, role: user.role }).from(user).where(eq(user.email, email)).limit(1);
  if (!row) {
    console.error(`No account with email ${email}. Sign up first, then run this again.`);
    process.exitCode = 1;
    return;
  }
  const role = demote ? "reader" : "admin";
  await db.update(user).set({ role }).where(eq(user.id, row.id));
  if (demote) await revokeUserSessions(db, row.id);
  console.log(`${email} is now ${role}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
