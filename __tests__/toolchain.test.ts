import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the two bugs fixed in issue #71. Both were latent for weeks — nothing
 * failed until the first file imported the generated Prisma client, and by then
 * the failure showed up as an unrelated-looking "cannot find module" on someone
 * else's fresh clone.
 *
 * These assertions are cheap and they fail loudly the moment either fix is
 * reverted, which is the only kind of test worth writing about a build config.
 */

const root = join(__dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("prisma toolchain", () => {
  it("generates the client on install, so a fresh clone has one", () => {
    // Bug A: `.gitignore` documented a `postinstall` that did not exist, so
    // `lib/generated/prisma` was built on no machine — not locally, not in CI,
    // not on Vercel.
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts.postinstall).toBe("prisma generate");
  });

  it("does not make `prisma generate` depend on a database", () => {
    // Bug B: prisma's `env()` throws on a missing value and runs as the config
    // module loads, so it fired for *every* CLI command — including `generate`,
    // which only reads a schema file. Without a provisioned database that made
    // the client impossible to build at all, by hand or otherwise.
    const config = read("prisma.config.ts");

    // Asserted on the import rather than on a bare `env(`, so the comment
    // in that file explaining the trap does not trip its own guard.
    expect(config).not.toMatch(
      /import\s*\{[^}]*\benv\b[^}]*\}\s*from\s*["']prisma\/config["']/
    );
    expect(config).toMatch(/url:\s*process\.env\.DATABASE_URL/);
  });
});
