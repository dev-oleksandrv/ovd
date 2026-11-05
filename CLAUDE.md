@AGENTS.md

# Claude Code notes

`AGENTS.md` (imported above) holds the project instructions for every agent. This file holds only what is specific to Claude Code.

## Enforced layer: `.claude/settings.json`

- **Permissions** apply in every mode, bypass included. Deny rules match the usual spelling of a command (not `git -C . push`, `sh -c …`), so they back up the rules in `AGENTS.md` but don't replace them.
  - Denied: force-push, `rebase`, `reset --hard`, `commit --amend`, `filter-branch`, `branch -D` (history is never rewritten); `npm`/`pnpm publish` (only the release workflow publishes, ADR 0020); `vega platform doctor` (it prints secrets); reading `~/.emulator_console_auth_token`, `~/.npmrc` and `.env` files.
  - Ask first: `git push`, `git merge`, `gh pr merge`, `gh release`, `gh workflow run` (allowed only under `/ship`); `pnpm add/remove/up`; edits to lint, test, e2e and CI config and to `.claude/settings.json`.
- **Hooks** (`.claude/hooks/`): after every `Edit`/`Write`, `post-edit-lint.mjs` lints the changed file; before a turn ends, `stop-check.mjs` runs `pnpm run check` when the turn changed code (`apps/`, `packages/`, `e2e/`, `scripts/`, root config). Either one sends you back with the errors. Fix them, or tell the maintainer why they can't pass; never weaken the gate to get through.
- The `hookify.*.local.md` files some checkouts have are optional local extras, not the enforced layer.

## `/ship`

Claude never pushes, force-pushes, rewrites history or merges into `main`, except when the maintainer invokes `/ship` (`.claude/skills/ship/`): it pushes the current branch, opens a PR, and merges it once CI is green.

## Path-scoped rules

`.claude/rules/*.md` are symlinks to `docs/conventions/*.md`, so their `paths:` frontmatter loads each convention only when you touch a matching file. Edit the file in `docs/conventions/`. Don't replace a symlink with an `@` import: Claude Code expands imports in path-scoped rules at session start, which loses the scoping.

## Skills

- For SDK behavior details, use the `amazon-devices-vega-*` skills (developer mode, build-and-run, setup-sdk, app manifest). They come from Amazon Devices Builder Tools, not from this repo or the Vega SDK; each developer installs them with `npx -y @amazon-devices/amazon-devices-buildertools-mcp@latest init-context --agent claude-code-cli`. If they aren't loaded, say so and verify host-side behavior yourself (`AGENTS.md`, Working agreement). New verified behavior goes in `docs/ARCHITECTURE.md` §8.
- The desktop design lives in Claude Design: [OVD Desktop v2](https://claude.ai/design/p/11662d93-ccfb-4d11-9761-b6fd499be3fd?file=OVD+Desktop+v2.dc.html). UI changes are made there first, then in code (ADR 0019).
