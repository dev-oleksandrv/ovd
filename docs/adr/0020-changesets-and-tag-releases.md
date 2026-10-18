# 0020. Changesets and tag-driven releases

- Status: Accepted
- Date: 2026-10-18

## Context

Every stage ends with a release (ADR 0018): the CLI on npm and desktop builds on GitHub Releases (ADR 0015). Conventional Commit subjects describe code (`feat(core): add device info adapter`), not what a user notices, so a changelog generated from commits reads poorly as release notes. The CLI and the desktop app ship the same features at the same time (ADR 0005), so separate version numbers would only confuse users.

## Decision

- Use `@changesets/cli` 3. Each branch with a user-facing change adds a `.changeset/*.md` file that names the bump and gives a plain-language summary. Changes with nothing to announce add an empty changeset.
- One product version: `@ovd/cli`, `@ovd/gui` and `@ovd/core` are a `fixed` group. `privatePackages.version: true` versions the private desktop and core packages; `privatePackages.tag: false`, because the release tag is `v<version>`.
- `changedFilePatterns` limits the changeset requirement to package sources and manifests. Docs, CI and tooling changes need none. CI fails a pull request that changes them without a changeset.
- On every push to `main`, the Version workflow runs `changesets/action` v2 to keep one Version PR open on `changeset-release/main`. Merging it is the release decision. When no changesets are pending and the version has no tag yet, the workflow pushes `v<version>`.
- The Version workflow authenticates with a fine-grained personal access token (`CHANGESETS_TOKEN`, Contents and Pull requests read/write on this repository). The default `GITHUB_TOKEN` would neither trigger CI on the Version PR nor start the Release workflow on the tag.
- A `v*` tag starts the Release workflow: desktop builds on `macos-latest` (`.dmg`) and `ubuntu-latest` (AppImage, `.deb`), `pnpm run check`, the npm publish of the CLI with provenance (`NPM_TOKEN`), and a GitHub Release with the builds and notes taken from the CLI and desktop changelogs.
- A tag containing `-dry` (e.g. `v0.1.0-dry.1`) runs every build and an `npm publish --dry-run`, and publishes nothing.

## Consequences

- One small file per user-facing pull request. `/ship` drafts it from the diff when it is missing.
- Release notes are written with the change, not at release time.
- The PAT expires and must be renewed. While it is expired, no Version PR appears and nothing is tagged; pending changesets wait on `main`.
- Only `@ovd/cli` is published. `@ovd/gui` and `@ovd/core` are private and only carry the shared version.
- Desktop builds are unsigned and not notarized until signing is decided.
