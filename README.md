# OVD — Open Vega DevTools

> Unofficial, open-source device toolkit for Vega OS developers. Not affiliated with Amazon. Vega and Fire TV are trademarks of Amazon.

OVD wraps the official Vega SDK tools behind one consistent, scriptable interface: see your devices, inspect and install packages, launch apps and follow their logs, drive them with a remote, take screenshots and get alerted when your app crashes, from a CLI (`ovd`) or a desktop app. Later stages add an MCP server for AI agents and a GitHub Action.

**Status:** early development. See the Status column in [docs/ROADMAP.md](docs/ROADMAP.md) for what's built and what's next.

## Requirements

- macOS or Ubuntu. Windows and WSL are not supported, because the Vega SDK doesn't support them.
- Node.js 22 or later.
- The [Vega SDK](https://developer.amazon.com/docs/vega/latest/), installed by you. OVD never bundles it.
- A Fire TV stick with Developer Mode, or the Vega Virtual Device.

## Install

The CLI is published on npm as `@ovd/cli` (command `ovd`):

```bash
npm i -g @ovd/cli
```

The desktop app (`.dmg`, `.deb` and AppImage) is on [GitHub Releases](https://github.com/dev-oleksandrv/ovd/releases).

## Development

```bash
pnpm install
pnpm run check      # lint + format + docs check + typecheck + tests
pnpm run cli hello  # run the CLI from source
pnpm run gui        # run the desktop app
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before opening a pull request.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE).
