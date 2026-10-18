# 0016. Neutral sample data

- Status: Accepted
- Date: 2026-10-15

## Context

Docs, screenshots, designs and test fixtures all need example devices and apps. Using the maintainer's own apps or third-party apps would leak unreleased work, imply endorsements, and put real identifiers into a public repository.

## Decision

- Docs, screenshots, designs, fixtures and examples use one neutral data set:
  - Devices: Fire TV Stick 4K Select, Living room stick, Bedroom stick, Vega Virtual Device.
  - Apps: `com.example.player`, `com.example.player.debug`, `com.example.hellovega`.
- Recorded fixtures are sanitized before commit: fake serials, documentation IP ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`), placeholder hostnames and emails, sample app IDs and device names.
- Sticks in sample data are always `armv7` (ADR 0008).

## Consequences

- Fixtures and screenshots can be shared freely.
- Sanitizing is a required step when recording a fixture.
- Examples look consistent across docs, the design and tests.
