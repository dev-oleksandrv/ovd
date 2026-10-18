# Contributing to OVD

Thanks for your interest! This guide covers how to set up the project and what a change needs before review.

## Setup

```bash
pnpm install
pnpm run check   # lint + typecheck + tests
pnpm run build
```

You need macOS or Ubuntu, Node.js ≥ 22 and pnpm. For manual device checks you also need the [Vega SDK](https://developer.amazon.com/docs/vega/latest/) and a Fire TV stick with Developer Mode or the Vega Virtual Device. Tests never need hardware.

## What to work on

- `docs/ROADMAP.md` lists the stages and what each one delivers. Issues labelled `good first issue` are a good start.
- Read `docs/ARCHITECTURE.md` first. Structural changes need an Architecture Decision Record in `docs/adr/` (template in `docs/adr/README.md`).

## How a feature is built

Every feature lands in the core first, then in the CLI and the desktop app together:

1. Core action in `packages/core`, calling the official SDK tools.
2. Recorded, sanitized SDK output in `fixtures/<sdk-version>/` and parser tests.
3. `ovd` command with human output and `--json`.
4. Desktop screen or action, following the [OVD Desktop v2 design](https://claude.ai/design/p/11662d93-ccfb-4d11-9761-b6fd499be3fd?file=OVD+Desktop+v2.dc.html), with loading, empty, error and offline states, and the CLI echo.

## Branches

One branch per change. Never commit directly to `main`. Name branches `<type>/<short-kebab-slug>`, e.g. `feat/devices-list`.

## Commits

Commits follow [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>)!: <subject>
```

- **Types:** `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `style`, `build`, `ci`, `chore`, `revert`.
- **Scope:** the workspace package the change touches, required whenever one is touched: `core`, `cli`, `gui`, `mcp`. Several packages: comma-separated, e.g. `feat(core,cli,gui): add devices list`. Repo-level changes (docs, CI, tooling) have no scope; dependency updates use `deps`.
- **Subject:** imperative, lowercase, no trailing period, ≤ 72 characters.
- **Breaking changes** (including `--json` output shape changes): add `!` and a `BREAKING CHANGE:` footer.

## Before opening a pull request

- `pnpm run check` passes.
- New logic comes with tests that run without hardware.
- New parsers come with recorded fixtures.
- The feature works in both the CLI and the desktop app.
- For device-facing changes, say in the PR which devices you checked on (stick, Virtual Device, or none).

## No secrets, no personal data

This is a public repository.

- Never commit API keys, tokens, signing material, `.env` files, Amazon account details, real device serials or real IP addresses.
- Fixtures and examples use the sample data set: devices "Fire TV Stick 4K Select", "Living room stick", "Bedroom stick", "Vega Virtual Device"; apps `com.example.player`, `com.example.player.debug`, `com.example.hellovega`; documentation IP ranges.
- Don't copy Vega SDK binaries or documentation into the repo.

OVD is unofficial and not affiliated with Amazon. Vega and Fire TV are trademarks of Amazon.
