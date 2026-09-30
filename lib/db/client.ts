// Shared Prisma client (spec §6.2, B1). Lazily created on first use, not at
// module load — `next build` imports every route file to collect its
// metadata, even ones nothing calls, so any top-level connection logic runs
// during the build itself. On CI (no DATABASE_URL secret yet) and on a
// misconfigured deployment, that turned a missing env var into a build
// failure instead of a runtime one.

import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const POOL_MAX = 3;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — see .env.example.");
  }
  // A few connections per instance, not pg's default of ten. Vercel runs
  // several instances at once and Supabase's pooler allows 15 clients in
  // session mode, so two instances at ten each took the site down on 30.9 —
  // a run's parallel Places-cache reads filled one, the polling screens the
  // other. Queries past the cap wait for a free connection instead.
  const adapter = new PrismaPg({ connectionString, max: POOL_MAX });
  return new PrismaClient({ adapter });
}

/**
 * One instance per process, reused across dev hot-reloads and warm
 * serverless invocations — a fresh PrismaClient (and connection pool) per
 * request would exhaust Postgres' connection limit on the free tier.
 */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}
