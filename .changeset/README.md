# Changesets

Every user-facing change adds a changeset: `pnpm changeset`. It names the version bump and says, in plain language, what a user of the CLI or the desktop app notices. Changes with nothing to announce add an empty one: `pnpm changeset --empty`.

All packages share one product version (`fixed` in `config.json`). See ADR 0020.
