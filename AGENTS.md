<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

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
| **`.claude/settings.json` hook** | A Claude session running a commit or push while sitting on `main` |
| **This section** | The reason, for whoever reads the repo next |

**Approvals are not required to merge.** A solo PR can be opened and merged by its own author. The rule exists so that every change to `main` arrives with a diff, a description, and a revert button — not to create review bureaucracy.

**If a push is rejected** and the error mentions a ruleset, that is the rule working. Move the commits onto a branch instead of trying to get around it:

```
git branch rescue/my-work    # label the commits you already made
git reset --hard origin/main # put main back where it belongs
git checkout rescue/my-work  # carry on there
```

**Known friction:** the local hook matches the phrase at the start of any line in a Bash command, so writing *documentation* that contains an example command can trip it. Use the file-writing tools rather than a shell heredoc for that. The GitHub ruleset is the layer that actually enforces the rule; the hook is a courtesy that catches the mistake a few seconds earlier.
