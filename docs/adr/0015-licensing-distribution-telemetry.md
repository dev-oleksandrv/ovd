# 0015. Licensing, distribution and no telemetry

- Status: Accepted
- Date: 2026-10-14

## Context

OVD is a tool companies may adopt, built in the open by a single maintainer who wants outside contributors. It is unofficial and must not look like an Amazon product. "OVD" was also used by an older, unrelated project, so the bare npm name could clash.

## Decision

- License: Apache-2.0, with a `NOTICE` file, for its explicit patent grant.
- Public repository from day one, with `CONTRIBUTING.md`, issue templates and `good first issue` labels.
- Published on npm as `@voronkov/ovd`, exposing the `ovd` command (`npm i -g @voronkov/ovd` or `npx @voronkov/ovd`). Moving to an org scope later would mean a new package and deprecating this one.
- Desktop builds: `.dmg`, `.deb` and AppImage. A Homebrew tap from the first public release.
- README disclaimer: "Unofficial, open-source device toolkit for Vega OS developers. Not affiliated with Amazon. Vega and Fire TV are trademarks of Amazon."
- No telemetry by default; opt-in only, if ever.
- SDK binaries and SDK docs are never copied into the repo (ADR 0002).

## Consequences

- Nothing secret can live in the repo or the published packages.
- Releases go to npm, GitHub Releases and Homebrew, so the release workflow has three targets.
- Without telemetry, adoption is measured from GitHub stars, npm downloads and issues from non-maintainers.
