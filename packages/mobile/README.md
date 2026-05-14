# Berry Claw Mobile

Capacitor shell for the shared `@berry-agent/claw-client` React/Vite client.

The mobile app is a client. The agent runtime stays in `@berry-agent/claw-server`,
usually on a desktop, LAN box, or cloud host.

## Android

```bash
npm install
npm -w @berry-agent/claw-mobile run add:android
npm -w @berry-agent/claw-mobile run apk:debug
```

The first command creates `packages/mobile/android/`. It is intentionally not
checked in until the Android signing/build setup is finalized.
