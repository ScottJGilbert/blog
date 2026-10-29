/**
 * Build-time migrations (+ optional seed) for deployments whose build can reach Postgres but where nobody can run `pnpm db:migrate`
 * by hand. Wired into the API service build (`apps/api` `build` script, which Vercel runs for the `api` service).
 *
 *  - MIGRATE_ON_BUILD=1            migrate (any environment, including production)
 *  - MIGRATE_ON_BUILD=0            never migrate
 *  - unset                         migrate only when VERCEL_ENV=preview and a database URL exists; never on local builds
 *  - SEED_ON_BUILD=1               afterwards run the deployment-safe seed (`seedDeployment`: demo posts/tags + SEED_* accounts).
 *                                  Skipped in VERCEL_ENV=production: demo posts do not belong there (run `pnpm db:seed` by hand).
 *
 * URLs: the direct/session URL (DATABASE_URL_UNPOOLED, else POSTGRES_URL_NON_POOLING) first, then the pooled one
 * (DATABASE_URL, else POSTGRES_URL). Supabase's direct host `db.<ref>.supabase.co` is IPv6-only on the free plan and Vercel builds
 * are IPv4-only, so when it is unreachable the pooler is used instead (see `migrateFirstReachable`).
 * Any failure exits 1, which fails the build. Messages never contain the URL or its password.
 */
import { fileURLToPath } from "node:url";
import { createDb, describeUrl, resolveDatabaseUrl, resolveUnpooledUrl, scrubSecrets } from "./client";
import { errorText, migrateFirstReachable } from "./migrate";
import { seedDeployment } from "./seed";

type Env = Record<string, string | undefined>;

const ON = new Set(["1", "true", "yes", "on"]);
const OFF = new Set(["0", "false", "no", "off"]);
const flag = (v: string | undefined): boolean | undefined => {
  const x = v?.trim().toLowerCase();
  return x && ON.has(x) ? true : x && OFF.has(x) ? false : undefined;
};

const CONNECT_TIMEOUT_MS = 15_000;
const TOTAL_TIMEOUT_MS = 300_000;

export interface BuildPlan {
  migrate: boolean;
  seed: boolean;
  /** Why, for the build log. */
  reason: string;
}

export function planBuild(env: Env = process.env): BuildPlan {
  const hasUrl = Boolean(resolveDatabaseUrl(env) || resolveUnpooledUrl(env));
  const migrateFlag = flag(env.MIGRATE_ON_BUILD);
  const preview = env.VERCEL_ENV === "preview";
  const migrate = migrateFlag ?? (preview && hasUrl);
  const reason = migrateFlag === true ? "MIGRATE_ON_BUILD=1" : migrateFlag === false ? "MIGRATE_ON_BUILD=0" : preview ? (hasUrl ? "Vercel preview build" : "Vercel preview build without a database URL") : "not a Vercel preview build and MIGRATE_ON_BUILD is not set";
  const seedWanted = flag(env.SEED_ON_BUILD) === true;
  return { migrate, seed: seedWanted && env.VERCEL_ENV !== "production", reason: seedWanted && env.VERCEL_ENV === "production" ? `${reason}; SEED_ON_BUILD ignored in production` : reason };
}

export function failureHint(message: string): string | undefined {
  if (/self-signed certificate|unable to verify|certificate/i.test(message)) return "TLS verification failed: set DATABASE_SSL_CA (the Supabase CA certificate, PEM or base64) or, as an explicit escape hatch, DATABASE_SSL=no-verify.";
  if (/tenant or user not found/i.test(message)) return "The pooler does not know this user: on *.pooler.supabase.com the username must be postgres.<project-ref>.";
  if (/password authentication failed/i.test(message)) return "Wrong password (percent-encode special characters such as @ # / in the URL).";
  return undefined;
}

export async function migrateOnBuild(env: Env = process.env, log: (message: string) => void = (m) => console.log(`[migrate-on-build] ${m}`)): Promise<"skipped" | "done"> {
  const plan = planBuild(env);
  if (flag(env.SEED_ON_BUILD) && !plan.seed) log("SEED_ON_BUILD ignored: never seeding demo content into production (run `pnpm db:seed` by hand)");
  if (!plan.migrate && !plan.seed) {
    log(`skipped (${plan.reason})`);
    return "skipped";
  }
  const urls = [...new Set(plan.migrate ? [resolveUnpooledUrl(env), resolveDatabaseUrl(env)] : [resolveDatabaseUrl(env), resolveUnpooledUrl(env)])].filter((u): u is string => Boolean(u));
  if (urls.length === 0) throw new Error("a build-time database step is enabled but none of DATABASE_URL, POSTGRES_URL, DATABASE_URL_UNPOOLED, POSTGRES_URL_NON_POOLING is set");

  let used = urls[0]!;
  try {
    if (plan.migrate) {
      log(`applying migrations (${plan.reason})`);
      used = await migrateFirstReachable(urls, { connectionTimeoutMillis: CONNECT_TIMEOUT_MS, log });
      log(`migrations applied via ${describeUrl(used)}`);
    }
    if (plan.seed) {
      log(`seeding (SEED_ON_BUILD=1) via ${describeUrl(used)}`);
      const handle = createDb(used, { max: 2, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
      try {
        const r = await seedDeployment(handle.db, env, (m) => log(`seed: ${m}`));
        log(`seed done: ${r.tags} tags, ${r.posts} new posts, ${r.users} accounts`);
      } finally {
        await handle.close();
      }
    }
  } catch (err) {
    const message = urls.reduce((m, u) => scrubSecrets(m, u), errorText(err));
    const h = failureHint(message);
    throw new Error(`${message}${h ? `\n  hint: ${h}` : ""}`);
  }
  return "done";
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const watchdog = setTimeout(() => {
    console.error(`[migrate-on-build] FAILED: no result after ${TOTAL_TIMEOUT_MS / 1000}s`);
    process.exit(1);
  }, TOTAL_TIMEOUT_MS);
  migrateOnBuild()
    .catch((err) => {
      console.error(`[migrate-on-build] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    })
    .finally(() => clearTimeout(watchdog));
}
