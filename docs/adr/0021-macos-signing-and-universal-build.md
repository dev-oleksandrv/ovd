# 0021. macOS signing, notarization and a universal build

- Status: Accepted
- Date: 2026-10-18

## Context

macOS Gatekeeper blocks apps downloaded from the internet unless they are signed with a Developer ID certificate and notarized by Apple. On recent macOS versions the user has to go through System Settings to open an unsigned app, which is unacceptable for a public release. The maintainer has an Apple Developer account. GitHub's `macos-latest` runners are Apple Silicon, so a default build only runs on arm64 Macs, while some Vega developers still use Intel Macs.

## Decision

- The desktop app is signed with a **Developer ID Application** certificate and notarized with an **App Store Connect API key**, by electron-builder in the Release workflow. Hardened runtime is on, with the JIT entitlements Electron needs.
- Credentials live only in GitHub secrets: `CSC_LINK` (base64 `.p12`), `CSC_KEY_PASSWORD`, `APPLE_API_KEY` (`.p8` contents, written to a temporary file at build time), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
- Signing runs on real release tags and on manual runs of the Release workflow (`workflow_dispatch`), when the secrets exist. A manual run publishes nothing; it uploads the signed builds as workflow artifacts, to test signing before a release. CI builds and `-dry` tags are unsigned, so they stay fast and never use the notarization service.
- macOS ships one **universal** `.dmg` (arm64 + x64).
- Linux packages (AppImage, `.deb`) are not signed.

## Consequences

- Released macOS builds open without Gatekeeper warnings.
- The universal `.dmg` is about twice the size of a single-architecture build.
- Notarization adds a few minutes to each release and depends on Apple's service being up.
- The certificate expires after five years and the API key can be revoked; renewing either means updating the secrets.
- Until the secrets are added, releases are unsigned.
