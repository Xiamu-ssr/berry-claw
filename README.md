# Berry Claw

The first product built on the [Berry Agent platform](https://github.com/Xiamu-ssr/berry-agent-sdk).
Web/desktop/mobile chat UI + Node server that runs SDK agent runtimes
in-process today, and will move to a distributed `@berry-agent/a8s` cluster
without changing the product layer.

The full product alignment document is published at:

https://xiamu-ssr.github.io/berry-claw/

The source file is [`AGENTS.HTML`](./AGENTS.HTML) — open it in a browser.

## Quick start

```bash
npm install -g @berry-agent/claw-server@alpha
berry-claw start             # listens on http://localhost:3210 by default
berry-claw key show          # prints the per-instance auth key
```

Then open the web client, or install desktop/mobile binaries from the
GitHub Releases page.

## Development

```bash
npm install
npm run dev
npm run build
npm test
npm run build:desktop
npm run build:mobile
```

See [`AGENTS.HTML`](./AGENTS.HTML) for full architecture, cross-platform
strategy, package layout, and release process.
