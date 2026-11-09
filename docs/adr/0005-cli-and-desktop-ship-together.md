# 0005. CLI and desktop ship together

- Status: Accepted
- Date: 2026-10-14

## Context

Terminal, CI and agent users need the CLI; people who want a device hub, a log viewer and a remote need the desktop app. Building one surface first would leave the other behind and tempt logic into the surface that comes first. The desktop app is also a good place to teach the CLI.

## Decision

- Every feature ships in the CLI and the desktop app in the same stage. A feature that exists in only one surface is not done.
- Every desktop action writes its `ovd …` equivalent to the status-bar CLI echo (copyable) and to the second line of its toast.
- If a desktop action has no CLI equivalent, the CLI part is missing and must be built.

## Consequences

- Each feature costs a CLI command and a desktop screen or action, but the logic is written once in core (ADR 0001).
- The CLI's command names and flags are visible in the desktop UI, so renaming a command is a change to both.
- Desktop users learn the CLI by using the app, which helps with scripting and CI later.

## Amendments

- 2026-11-09 (#92, `ee45bc6`): view-only desktop actions write no `ovd …` echo. View-only means changing only what is shown: Clear, Pause and Resume, Follow, scroll. Filter changes still echo. This matches `docs/conventions/gui.md` (Behavior, CLI echo).
