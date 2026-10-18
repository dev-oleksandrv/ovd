# 0018. Stage-by-stage releases and a growing UI

- Status: Accepted
- Date: 2026-10-15

## Context

The project has one maintainer with limited time and about seventy planned features. Milestones and deadlines would slip; large releases would delay feedback. The desktop design shows every screen, but most of them depend on later work, and dead buttons make a tool feel broken.

## Decision

- Work follows the stages in `docs/ROADMAP.md`. Stages 0–3 are strictly sequential and form the first public release; later stages and their sub-stages can be reordered freely.
- Every stage ends with a tagged release: npm and desktop builds.
- Stages that depend on unverified SDK behavior start with a short hardware check.
- The desktop sidebar only shows screens and tabs whose stage has shipped. Everything else appears in the command palette as "Coming in a later version", never as a dead button. Markers in the design such as "Later" or "to be verified" are removed when the feature ships.

## Consequences

- Users get value after every stage, and the maintainer gets feedback early.
- The release pipeline must be cheap enough to run after every stage.
- The palette's "later" list must be updated whenever a stage ships.
