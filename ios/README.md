# AgentTower iOS client

This is a SwiftUI iPhone/iPad client for a running AgentTower server.

## What it is

- A native shell around the existing AgentTower web UI
- Native server configuration and password sign-in
- Session cookie handoff into `WKWebView`
- Works well for browsing and controlling a server you already run on a Mac, VM, or remote host

## What it is not

- It does **not** replace the desktop/server app
- It cannot read `~/.claude` or `~/.codex` directly on iOS
- It cannot spawn or signal local Claude/Codex processes on the iPhone itself

## Run it

1. Start AgentTower on your Mac or server.
2. Generate the Xcode project:

```bash
cd ios
xcodegen generate
```

3. Open `ios/AgentTowerMobile.xcodeproj` in Xcode.
4. Run on Simulator or device.

## Private configuration

To make a personal build connect and sign in automatically:

```bash
cp Config/Private.xcconfig.example Config/Private.xcconfig
```

Edit `Config/Private.xcconfig`, then regenerate the project. The private file is
gitignored. `Private.xcconfig.example` is safe to commit and documents the
required values.

Do not distribute a build containing a real password. Values from the private
configuration are embedded in the compiled app.

## Connection notes

- iOS Simulator can use `http://localhost:3000` if AgentTower is running on the same Mac.
- A physical iPhone must use your Mac's LAN IP like `http://192.168.1.20:3000` or a public HTTPS URL.
- The app currently allows HTTP connections so local-network development works without extra ATS setup.
