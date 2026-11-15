# 0029. CLI and desktop ship together, except view-only actions

- Status: Accepted
- Date: 2026-11-15

Decided by the maintainer in two steps and first written as amendments to ADR 0005: view-only actions on 2026-11-08 (#92, `ee45bc6`), the live screen view at the Stage 4 sign-off on 2026-11-12 (#119). Moved into this ADR on 2026-11-15 (#124), because a changed decision gets a new ADR (`docs/adr/README.md`).

## Context

ADR 0005 made every feature ship in the CLI and the desktop app in the same stage, and every desktop action write its `ovd …` equivalent to the CLI echo. Two kinds of desktop action turned out to have no meaningful command. Some change only what the desktop shows (Clear, Pause and Resume, Follow, scrolling on Logs): an echo for them would be noise, and a CLI flag for them makes no sense. And the live screen view (Remote & Screen, ROADMAP 4.4) is a stream of frames in a window; a terminal can't show it. This ADR supersedes 0005. It keeps 0005's other decisions unchanged.

## Decision

- Every feature ships in the CLI and the desktop app in the same stage. A feature that exists in only one surface is not done.
- Every desktop action writes its `ovd …` equivalent to the status-bar CLI echo (copyable) and to the second line of its toast.
- If a desktop action has no CLI equivalent, the CLI part is missing and must be built.
- **View-only actions** are exempt from the echo and need no command. View-only means changing only what is shown: Clear, Pause and Resume, Follow, scrolling. Filter changes are not view-only and still echo (`docs/conventions/gui.md`, Behavior).
- **The live screen view** is view-only and has no CLI command of its own. Its CLI counterpart is `ovd screenshot`, which the stick's Refresh echoes. Any action taken from the view (keys, screenshots) still has its command and echo.

## Consequences

- Each feature costs a CLI command and a desktop screen or action, but the logic is written once in core (ADR 0001).
- The CLI's command names and flags are visible in the desktop UI, so renaming a command is a change to both.
- Desktop users learn the CLI by using the app, which helps with scripting and CI later.
- The desktop has a few actions the CLI never gets: the view-only ones and the live screen view.
