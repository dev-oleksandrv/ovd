# Where each fact lives

Every kind of fact has one owner. Other documents link to the owner instead of repeating it. When you learn something new, write it in its owner. When two documents disagree, the precedence in `AGENTS.md` (Sources of truth) decides.

| Kind of fact                                                | Owner                                                                                                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| What OVD is, how to install it                              | [`README.md`](../README.md)                                                                                                               |
| Agent instructions: commands, working agreement, precedence | [`AGENTS.md`](../AGENTS.md) (Claude Code-only notes: `CLAUDE.md`)                                                                         |
| Architecture: layout, dependency rules, core, surfaces      | [`ARCHITECTURE.md`](ARCHITECTURE.md) §1–6                                                                                                 |
| Known Vega SDK behavior                                     | [`ARCHITECTURE.md`](ARCHITECTURE.md) §8                                                                                                   |
| Decisions and why                                           | [`adr/`](adr/README.md), one ADR per decision                                                                                             |
| Conventions per area (core, SDK calls, CLI, desktop, tests) | [`conventions/`](conventions/)                                                                                                            |
| Stages, scope and status (what's built, what's next)        | [`ROADMAP.md`](ROADMAP.md), Status column and sub-stage headings                                                                          |
| Branches, commits, changesets, releases, PR checklist       | [`CONTRIBUTING.md`](../CONTRIBUTING.md)                                                                                                   |
| Release history                                             | `CHANGELOG.md` in each package, written by changesets                                                                                     |
| Desktop screens, copy, states and colors                    | [OVD Desktop v2](https://claude.ai/design/p/11662d93-ccfb-4d11-9761-b6fd499be3fd?file=OVD+Desktop+v2.dc.html) in Claude Design (ADR 0019) |
| Enforced agent permissions and hooks                        | `.claude/settings.json` (explained in `CLAUDE.md`)                                                                                        |

Working specs and plans live in `docs/superpowers/`, which is gitignored; they are notes, not owners. `pnpm run check:docs` checks that the paths these documents mention exist.
