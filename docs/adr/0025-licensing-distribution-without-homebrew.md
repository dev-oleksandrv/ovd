# 0025. Licensing, distribution and no telemetry, without Homebrew

- Status: Accepted
- Date: 2026-11-13

## Context

ADR 0015 planned a Homebrew tap from the first public release. Since then the tap has moved twice: to Stage 4, because a formula needs a published version, and then to Stage 5, because it needs an external tap repository. v0.3.0 is out, so nothing blocks it any more. On 2026-11-13 the maintainer dropped it: npm (`npm i -g @ovd/cli`, `npx @ovd/cli`) and GitHub Releases already cover macOS and Ubuntu, and a tap would add a third release target and a second repository to keep in step for no new reach. This ADR supersedes 0015. It keeps 0015's other decisions unchanged.

## Decision

- License: Apache-2.0, with a `NOTICE` file, for its explicit patent grant.
- Public repository from day one, with `CONTRIBUTING.md`, issue templates and `good first issue` labels.
- Published on npm as `@ovd/cli`, exposing the `ovd` command (`npm i -g @ovd/cli` or `npx @ovd/cli`). `@ovd` is the maintainer's npm user scope (user `ovd`).
- Desktop builds: `.dmg`, `.deb` and AppImage, on GitHub Releases.
- No Homebrew tap and no other package manager. Revisit only if users ask for one.
- README disclaimer: "Unofficial, open-source device toolkit for Vega OS developers. Not affiliated with Amazon. Vega and Fire TV are trademarks of Amazon."
- No telemetry by default; opt-in only, if ever.
- SDK binaries and SDK docs are never copied into the repo (ADR 0002).

## Consequences

- Nothing secret can live in the repo or the published packages.
- Releases have two targets, npm and GitHub Releases (ADR 0020). There is no tap repository to maintain.
- `brew install ovd` doesn't exist. Users install with npm or download a desktop build.
- Without telemetry, adoption is measured from GitHub stars, npm downloads and issues from non-maintainers.
- ROADMAP 5.4 is dropped (#108 closed as not planned).
