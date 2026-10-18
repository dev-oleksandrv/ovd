# OVD — Open Vega DevTools

Open-source (Apache-2.0), unofficial device toolkit for **Vega OS** developers. One core library, exposed as a CLI (`ovd`), an Electron desktop app, and later an MCP server and a GitHub Action. It wraps the official Vega SDK tools (`vega`, `vda`, `vpm`, `vlcm`, `vmsgr`, `loggingctl`, `inputd-cli`, `vpt`, `perf`) behind one scriptable interface: devices, packages, apps, logs, crashes, remote, screenshots.

- Published on npm as `@ovd/cli` (the maintainer's npm user scope `ovd`) with the `ovd` command. Not affiliated with Amazon.
- Architecture: `docs/ARCHITECTURE.md`. Decisions: `docs/adr/`. Build order and stage scope: `docs/ROADMAP.md`. Read them before structural changes or starting a stage.
- Desktop design: [OVD Desktop v2 in Claude Design](https://claude.ai/design/p/11662d93-ccfb-4d11-9761-b6fd499be3fd?file=OVD+Desktop+v2.dc.html). It is the spec for every screen; UI changes are made there first, then in code (ADR 0019).

## Commands

```bash
pnpm run check        # lint + format check + typecheck + test — run before every commit
pnpm test             # vitest run (all projects: core, cli)
pnpm run test:watch   # vitest in watch mode
pnpm run lint         # eslint (one flat config at the root, enforces package boundaries)
pnpm run format       # prettier --write
pnpm run typecheck    # tsc --noEmit in every package
pnpm run build        # build every package (CLI bundles core with tsup; desktop via electron-vite)
pnpm run cli <args>   # run the CLI from source (tsx), e.g. pnpm run cli hello --json (no `--`)
pnpm run gui          # desktop app in dev mode (electron-vite)
```

Tooling lives at the root: TypeScript 5.9 (typescript-eslint doesn't support 7.x), `eslint.config.mjs`, `.prettierrc.yaml`, `vitest.config.ts` (one project per package). `@ovd/core` is private and exports TypeScript source; surfaces bundle it.

## Working agreement

The maintainer drives the process. Propose, then wait for a decision.

- Do not install or upgrade dependencies, change build/packaging/CI config, or touch files outside the task's scope without asking.
- Non-trivial work: present the design first, implement after approval.
- If a task grows beyond what was agreed, stop and say so.
- Work belongs to a stage in `docs/ROADMAP.md`. Do not build features from a later stage "while you're there".
- Before a stage that has a hardware check (`docs/ROADMAP.md`), ask whether it was done and what it showed. Never design around an unverified SDK behavior.

## Git

- **One branch per change** (feature, fix, refactor, docs, anything), in every session. Never commit directly to `main`.
- Before the first edit of a task, check `git branch --show-current`. On `main`, create the task's branch from an up-to-date `main` first. Unrelated work gets its own branch, not the current one.
- Branch names: `<type>/<short-kebab-slug>`, e.g. `feat/devices-list`, `fix/logs-reinstall-restart`.
- Commits follow **Conventional Commits 1.0**: `<type>(<scope>)!: <subject>`.
  - Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `style`, `build`, `ci`, `chore`, `revert`.
  - Scope names the workspace package the change touches: `core` (`packages/core`), `cli` (`apps/cli`), `gui` (`apps/gui`), `mcp` (`apps/mcp`). **Required** whenever a commit touches a package, e.g. `feat(gui): add device list screen`, `fix(cli): exit non-zero on arch mismatch`.
  - A commit that touches several packages lists them, comma-separated, in dependency order: `feat(core,cli,gui): add devices list`. Prefer one commit per package when the change splits cleanly.
  - Repo-level changes outside packages: no scope (`docs: …`, `ci: …`, `chore: …`), or `deps` for dependency updates (`build(deps): …`).
  - Subject: imperative, lowercase, no trailing period, ≤ 72 chars. Breaking changes: `!` plus a `BREAKING CHANGE:` footer.
- Claude may create branches and commit. Claude must **never push, force-push, rewrite history, or merge into `main`**, except when the maintainer invokes `/ship` (`.claude/skills/ship/`): it pushes the current branch, opens a PR, and merges it once CI is green.
- Every user-facing change adds a changeset (`.changeset/*.md`, `pnpm changeset`) on its branch; no user-visible change → `pnpm changeset --empty`. CI fails package changes without one. Merging the Version PR (`changeset-release/main`) tags `v<version>`, and the tag releases npm + desktop builds (ADR 0020).
- `docs/superpowers/` (working specs and plans) is gitignored. Only polished docs (`docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/adr/`) are versioned.

## Open source: no secrets, no personal data

- Never commit API keys, tokens, signing material, `.env` files, Amazon account details, real device serials, real IP addresses or real hostnames.
- OVD never stores Amazon credentials. Sign-in happens in the browser through `vega devmode login`.
- The emulator console auth token (`~/.emulator_console_auth_token`) is read at runtime only: never log, echo or commit it.
- Fixtures, docs, screenshots and examples use the neutral sample data set (ADR 0016): devices "Fire TV Stick 4K Select", "Living room stick", "Bedroom stick", "Vega Virtual Device"; apps `com.example.player`, `com.example.player.debug`, `com.example.hellovega`; documentation IPs (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`); fake serials. Never the maintainer's own apps or third-party apps.
- No telemetry.

## Architecture in one screen

```
packages/core/   all logic: SDK discovery and runner, versioned output adapters, devices, packages, apps, logs, activity log
apps/cli/        `ovd` command: thin commander layer over core, human output by default, --json everywhere
apps/gui/        Electron: main (runs core in-process, IPC), preload (typed bridge), renderer (React UI)
apps/mcp/        stdio MCP server over core (Stage 7)
fixtures/<sdk-version>/  recorded SDK outputs, the test fixtures for parsers
```

- **One core.** Logic lives in `packages/core`; CLI, desktop, MCP and Action only call it. The desktop never shells out to an `ovd` found on PATH (ADR 0001).
- **Wrap, don't reimplement.** Call the user's installed SDK tools; never talk device protocols directly; never bundle SDK binaries; refuse to run without an SDK (ADR 0002).
- **CLI and desktop together.** A feature isn't done until both surfaces have it, and every desktop action shows its `ovd …` equivalent (ADR 0005).
- **`--json` on every command**, stable shape, meaningful exit codes (ADR 0006).
- **JSON modes first** when parsing SDK output; text parsers stay small and are tested against recorded fixtures (ADR 0007).
- **Tests run without hardware.** Real devices are for manual checks only.
- Structural changes (new package, new surface, new SDK tool dependency, new backend, new persisted store) need an ADR in `docs/adr/`.

Path-scoped details live in `.claude/rules/`.

## Adding a feature

Order: core → CLI → desktop → tests, in one branch.

1. **Core:** an action in `packages/core` that calls SDK tools through the runner, parses with an adapter, returns typed data, and appends device actions to the activity log.
2. **Fixture:** record the SDK output the parser depends on into `fixtures/<sdk-version>/`, sanitized (`.claude/rules/testing.md`).
3. **CLI:** an `ovd` command over the action, with human output and `--json`.
4. **Desktop:** the screen or action from the design (OVD Desktop v2), with loading, empty, error and offline-target states, and the CLI echo.
5. **Tests:** parser tests against fixtures, core tests with a fake runner, CLI output tests for `--json`.

## Code style

- TypeScript `strict`. No `any`, no non-null `!` without a comment explaining why it is safe.
- Named exports only. One React component per file. Files: `PascalCase.tsx` for components, `camelCase.ts` otherwise.
- Prefer small, single-purpose files. Comments explain _why_, not _what_.
- Validate everything parsed from SDK output or IPC at the boundary; never pass untyped data inward.

## Vega specifics

- Platforms: macOS and Ubuntu only. No Windows or WSL (ADR 0013).
- Architectures: sticks are `armv7`; the Virtual Device matches the host (`x86_64` on Intel and Ubuntu, `aarch64` on Apple Silicon). Always compare against what the target reports, never assume (ADR 0008).
- A stick without Developer Mode is invisible to VDA. "Developer Mode off" is a setup flow, never a device state (ADR 0009).
- VDA runs through `vega exec vda`, not from PATH.
- Use the `amazon-devices-vega-*` skills (developer mode, build-and-run, setup-sdk, app manifest) when you need SDK behavior details.
