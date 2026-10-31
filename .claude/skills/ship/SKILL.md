---
name: ship
description: Push the current branch, open a PR, wait for CI to go green, merge it, then return to an up-to-date main and delete the branch. Maintainer-invoked only.
disable-model-invocation: true
---

# /ship

The maintainer typing `/ship` is the approval to push and merge this one branch. It does not carry over to any other branch or a later turn.

Run the steps in order. If any step fails, stop, report what failed with the decisive output, and leave everything as it is. Never force-push, never rewrite history, never retry a merge with different flags, never fix a red CI on your own.

## 1. Preflight

```bash
git branch --show-current
git status --porcelain
git fetch origin
git log --oneline origin/main..HEAD
```

Stop if the branch is `main`, the tree is dirty, or there are no commits ahead of `origin/main`. Stop if the branch name does not match `<type>/<short-kebab-slug>`, any commit subject is not a Conventional Commit, or a commit that touches a workspace package lacks its scope (`packages/core` → `core`, `apps/cli` → `cli`, `apps/gui` → `gui`, `apps/mcp` → `mcp`, `e2e` → `e2e`; check with `git show --stat <sha>`). The one exception is the Version PR branch `changeset-release/main`: the changesets action names it and writes its commit, so skip these checks and step 2 for it.

Then run `pnpm run check` and `pnpm run test:e2e`. Stop on a non-zero exit.

Scan the diff (`git diff origin/main...HEAD`) for secrets and personal data: tokens, `.env` content, real serials, real IPs, account emails, app IDs outside the `com.example.*` sample set. Stop and report if anything turns up.

## 2. Changeset

```bash
pnpm exec changeset status --since origin/main
```

Exit 0: the branch has a changeset or touches no package sources, go on.

Otherwise draft one in `.changeset/<short-kebab-slug>.md`:

```md
---
'@ovd/cli': patch
---

One plain-language line on what a CLI or desktop user notices.
```

- Name `@ovd/cli` or `@ovd/gui` (whichever the user-visible change is in; the `fixed` group bumps all packages together).
- **Bump** from the commits: any `!` or `BREAKING CHANGE:` → `major`, any `feat` → `minor`, otherwise `patch`.
- **Summary** from the diff, not the commit subjects: what the user notices, no file or module names. Several changes get several bullet lines.
- No user-visible change (refactor, tests, tooling): an empty changeset instead, `pnpm exec changeset add --empty`.

Show the maintainer the bump and the summary and wait for their OK or edits. Then commit it alone, as `chore: add changeset`, and go on.

## 3. Push

```bash
git push -u origin <branch>
```

## 4. Pull request

Reuse an open PR for this branch if `gh pr view --json number,url,state` finds one. Otherwise create it:

```bash
gh pr create --base main --head <branch> --title "<title>" --body-file <scratchpad>/pr-body.md
```

- **Title:** a Conventional Commit subject for the whole change. With one commit, use its subject.
- **Body:** follow the format of earlier PRs once there are some (`gh pr list --state merged --limit 1`, then `gh pr view <n>`):
  - `## Summary`: one plain-language line on what changed and why, then bullets per area (core, CLI, desktop, docs). Describe what is in the diff, nothing more. Name the roadmap stage (e.g. "Stage 1.3") when the change belongs to one.
  - `## Test plan`: a checklist. Tick only what was actually done; `pnpm run check` and `pnpm run test:e2e` from step 1 with the real test counts. Leave device checks (stick, Virtual Device) unticked unless the maintainer confirmed them in this conversation.
  - End with the attribution line from the system reminder, if there is one.
- No secrets, real IPs, serials or account details in the title or body.

## 5. Wait for CI

Record the head SHA (`git rev-parse HEAD`). Run the watch in the background and wait for its completion notice; CI can take up to 15 minutes:

```bash
gh pr checks <number> --watch --fail-fast --interval 20
```

Right after the PR opens, `gh` may report no checks yet. Wait a minute and run it again, at most 3 times.

- Exit 0: all checks passed, go on.
- Still no checks after 3 tries: the repo may have no CI workflow yet. Stop and ask the maintainer whether to merge without CI. Merge only on an explicit yes in this conversation.
- Anything else: stop. Show the failing check and the tail of its log (`gh run view <run-id> --log-failed | tail -50`). Do not merge.

## 6. Merge

Merge commit only, and only the commit CI tested:

```bash
gh pr merge <number> --merge --match-head-commit <sha>
```

## 7. Sync main and clean up

```bash
git checkout main
git pull --ff-only
git branch -d <branch>
git push origin --delete <branch>
```

`git branch -d` refuses unmerged work; if it refuses, stop and report rather than using `-D`.

## 8. Report

PR URL, merge commit SHA, and `git log --oneline -1` on `main`.
