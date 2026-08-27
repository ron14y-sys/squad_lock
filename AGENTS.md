<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Committing — only when asked

**Never commit on your own initiative. Wait for an explicit instruction to commit.**

Approving a _decision_ is not approving a _commit_. "Yes, Resend is the right choice" authorises the choice, not the act of recording it in git. Make the change, show it, and stop — the person reviewing it decides when it becomes a commit.

This applies to agents in particular, and the reason is ownership: a commit is the point where a change stops being a draft someone is looking at and starts being something the team has to review, revert, or live with. That transition belongs to a person.

Enforced by the same hook as the branching rule below: any `git commit` raises a confirmation prompt naming this rule. **Approve it only if you actually asked for the commit** — the prompt is the rule, not a formality to click through.

Pushing an already-approved commit and opening a PR follow the same instruction that authorised the commit; they do not each need a separate one.

# Branching — never commit to main

**Every change goes on a branch and reaches `main` only through a pull request. No exceptions, for anyone.**

```
git checkout -b feat/short-name     # feat/ · fix/ · docs/ · chore/
# ... work, commit on the branch ...
git push -u origin HEAD
gh pr create --fill
```

Enforced in three places, so a mistake is caught rather than discovered later:

| Layer                            | What it stops                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **GitHub ruleset on `main`**     | Any direct push, force-push, or branch deletion — for everyone, **admins included**. The authoritative layer |
| **`.claude/settings.json` hook** | A Claude session running a commit or push while sitting on `main` — and, on a branch, an unrequested commit  |
| **This file**                    | The reason, for whoever reads the repo next                                                                  |

The hook resolves both rules in one pass, in this order: **on `main` a commit or push is denied outright**; on a branch, a commit **raises a confirmation prompt**. Denial wins over the prompt, so there is no state in which committing to `main` is one click away.

**Approvals are not required to merge.** A solo PR can be opened and merged by its own author. The rule exists so that every change to `main` arrives with a diff, a description, and a revert button — not to create review bureaucracy.

**If a push is rejected** and the error mentions a ruleset, that is the rule working. Move the commits onto a branch instead of trying to get around it:

```
git branch rescue/my-work    # label the commits you already made
git reset --hard origin/main # put main back where it belongs
git checkout rescue/my-work  # carry on there
```

**Known friction:** the local hook matches the phrase at the start of any line in a Bash command, so writing _documentation_ that contains an example command can trip it. Use the file-writing tools rather than a shell heredoc for that. The GitHub ruleset is the layer that actually enforces the rule; the hook is a courtesy that catches the mistake a few seconds earlier.

# Quality gates — format, lint, types, tests

**Every change is formatted, linted, type-checked and tested before it reaches a pull request.** Four gates, run at the three moments where they cost the least:

| When                                       | What runs                                | Why there                                                                                      |
| ------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **On commit** (`.husky/pre-commit`)        | Prettier + ESLint, **staged files only** | Sub-second. Catches the typo while the change is still in your head                            |
| **On push** (`.husky/pre-push`)            | `tsc --noEmit`, then the test suite      | Too slow for every commit, fast enough once per branch. Nothing reaches a PR with a type error |
| **On the PR** (`.github/workflows/ci.yml`) | All four, plus `next build`              | The authoritative layer. Runs on a clean checkout, and cannot be skipped with `--no-verify`    |

Run the whole set yourself at any time:

```
npm run verify      # format:check · lint · typecheck · test
```

Individual gates: `npm run format` (writes) · `format:check` (reads) · `lint` · `lint:fix` · `typecheck` · `test` · `test:watch`.

**The toolchain**, and why each piece is there:

- **Prettier** owns formatting. `eslint-config-prettier` sits last in `eslint.config.mjs` and switches off every ESLint rule that would argue with it, so the two never disagree about the same line.
- **ESLint** owns correctness, via `eslint-config-next/core-web-vitals` and `/typescript`. `--max-warnings=0` — a warning nobody fixes is a warning nobody reads.
- **Vitest + React Testing Library**, configured per the guide in `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`. Tests live in `__tests__/` or beside the code as `*.test.tsx`.
- **Markdown is formatted too**, on the same terms as code — the specs, plans and this file included. Prettier owns table alignment and emphasis markers so nobody has to line up a table by hand. The one exception is `.agents/`, which is vendored and not ours to touch.

**Async Server Components cannot be unit-tested** — Vitest does not support them yet. Test synchronous components directly and cover the async ones end-to-end.

**Setup for a new participant** is `npm install` and nothing else. Two lifecycle scripts do the rest: `prepare` points git at `.husky/`, so the hooks are live from the first clone, and `postinstall` generates the Prisma client.

**The Prisma client is generated, never committed.** `lib/generated/prisma` is a build artifact, kept out of git and rebuilt by `postinstall` on every `npm install` and `npm ci` — one line that covers a fresh clone, CI and the Vercel build together. Two traps here have already been sprung once (#71), and both were invisible until the first file imported the client:

- **A comment is not a script.** `.gitignore` described the client as "wired into postinstall" while no `postinstall` existed. Nothing failed, because nothing imported the client yet — the bug sat latent, waiting to surface on somebody else's clone as a confusing missing-module error with no obvious connection to its cause. If you write down that something is automated, automate it in the same commit.
- **`prisma generate` must not need a database.** `prisma.config.ts` reads `DATABASE_URL` through `process.env`, **not** prisma's `env()` helper. `env()` throws on a missing value and runs as the config module loads, so it fired for _every_ CLI command — including `generate`, which only reads a schema file and opens no connection. Before Postgres is provisioned that made the client impossible to build at all, and blocked the by-hand workaround too. `datasource` is optional by design, so migrate, studio and introspect still fail loudly, with prisma's own message, when the URL is genuinely required. **Do not put `env()` back**: `__tests__/toolchain.test.ts` fails if you do.

The shared lesson is worth stating once, because it is the reason both went unnoticed: **a build step nothing exercises yet is not working, it is merely untested.** When a toolchain fix has no natural caller, give it an assertion rather than trusting the next person to trip over it.

**Hooks find Node themselves.** A git hook does not load your shell profile, so the `PATH` inside one is not the `PATH` you see in a terminal — and on at least one machine here Node was on neither. `.husky/common.sh` looks in the usual places (Homebrew, `/usr/local`, Volta, nvm) before anything runs, and fails with a readable message instead of `npm: command not found` if it comes up empty. If your Node lives somewhere unusual, add it to `PATH` in `~/.config/husky/init.sh`, which husky sources for every hook.

**If a hook blocks you**, the fix is the failure it printed — not `--no-verify`. That flag skips the local gates and CI catches the same problem five minutes later, on a pull request everyone can see.
