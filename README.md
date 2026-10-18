# OVD — Open Vega DevTools

> Unofficial, open-source device toolkit for Vega OS developers. Not affiliated with Amazon. Vega and Fire TV are trademarks of Amazon.

OVD wraps the official Vega SDK tools behind one consistent, scriptable interface: see your devices, inspect and install packages, launch apps and follow their logs, from a CLI (`ovd`) or a desktop app. Later stages add a remote, screenshots, crash alerts, an MCP server for AI agents and a GitHub Action.

**Status:** early development. See [docs/ROADMAP.md](docs/ROADMAP.md) for what's built and what's next.

## Requirements

- macOS or Ubuntu. Windows and WSL are not supported, because the Vega SDK doesn't support them.
- Node.js 22 or later.
- The [Vega SDK](https://developer.amazon.com/docs/vega/latest/), installed by you. OVD never bundles it.
- A Fire TV stick with Developer Mode, or the Vega Virtual Device.

## Install

Not published yet. The CLI will be available as `@ovd/cli` on npm (`npm i -g @ovd/cli`, command `ovd`), and the desktop app as `.dmg`, `.deb` and AppImage on GitHub Releases.

## Development

```bash
pnpm install
pnpm run check      # lint + format check + typecheck + tests
pnpm run cli hello  # run the CLI from source
pnpm run gui        # run the desktop app
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before opening a pull request.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE).
