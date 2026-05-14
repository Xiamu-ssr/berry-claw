# Berry Claw Desktop

Electron shell for the shared `@berry-agent/claw-client` React/Vite client.

Development expects the client dev server on `http://127.0.0.1:3211`:

```bash
npm run dev:client
npm -w @berry-agent/claw-desktop run dev
```

Build packages the shared client dist into the desktop app:

```bash
npm -w @berry-agent/claw-desktop run build
```
