<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Committing — only when asked

**Never commit on your own initiative. Wait for an explicit instruction to commit.**

Approving a *decision* is not approving a *commit*. "Yes, Resend is the right choice" authorises the choice, not the act of recording it in git. Make the change, show it, and stop — the person reviewing it decides when it becomes a commit.

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

| Layer | What it stops |
|---|---|
| **GitHub ruleset on `main`** | Any direct push, force-push, or branch deletion — for everyone, **admins included**. The authoritative layer |
| **`.claude/settings.json` hook** | A Claude session running a commit or push while sitting on `main` — and, on a branch, an unrequested commit |
| **This file** | The reason, for whoever reads the repo next |

The hook resolves both rules in one pass, in this order: **on `main` a commit or push is denied outright**; on a branch, a commit **raises a confirmation prompt**. Denial wins over the prompt, so there is no state in which committing to `main` is one click away.

**Approvals are not required to merge.** A solo PR can be opened and merged by its own author. The rule exists so that every change to `main` arrives with a diff, a description, and a revert button — not to create review bureaucracy.

**If a push is rejected** and the error mentions a ruleset, that is the rule working. Move the commits onto a branch instead of trying to get around it:

```
git branch rescue/my-work    # label the commits you already made
git reset --hard origin/main # put main back where it belongs
git checkout rescue/my-work  # carry on there
```

**Known friction:** the local hook matches the phrase at the start of any line in a Bash command, so writing *documentation* that contains an example command can trip it. Use the file-writing tools rather than a shell heredoc for that. The GitHub ruleset is the layer that actually enforces the rule; the hook is a courtesy that catches the mistake a few seconds earlier.
