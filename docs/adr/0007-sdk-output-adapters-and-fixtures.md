# 0007. Versioned SDK output adapters and recorded fixtures

- Status: Accepted
- Date: 2026-10-14

## Context

Parsing SDK output is the project's main risk. Output changes between SDK versions (for example `vlcm launch-app` being deprecated in favour of `vmsgr send`), and a broken parser fails silently. Contributors may not own a Fire TV stick, and CI has no device.

## Decision

- Use JSON modes wherever the SDK offers them: `vega device info`, `vpt info --json`, `loggingctl vault --json-dump`, `vega sdk --json`.
- Text parsers stay small and live in adapters. When an SDK version changes the output, add a versioned adapter rather than branching inside one parser.
- Every parser is validated with `zod` and tested against recorded outputs in `fixtures/<sdk-version>/`.
- Fixtures are sanitized before they are committed (ADR 0016).
- Tests never need hardware. Real devices are only for manual checks.
- A nightly CI job installs the latest SDK, starts a headless Virtual Device, runs the first-release commands with `--json`, records new fixtures when the SDK version changes, and opens an issue on failure.

## Consequences

- An SDK change that breaks output is caught within a day, before users report it.
- Anyone can run and extend the test suite without a device.
- Recording fixtures is a manual step for every new parser and every new SDK version.
