# Agent Office Webview

This folder contains the React + TypeScript webview UI for Agent Office.

## What Lives Here

- `src/App.tsx` is the composition root.
- `src/hooks/useExtensionMessages.ts` is the main host/webview message boundary.
- `src/office/` contains the office engine, renderer, layout system, editor, and sprite helpers.
- `src/browserMock.ts` provides a standalone browser-mode runtime so the UI can be developed without launching the VS Code extension host.
- `vite.config.ts` builds the webview bundle and wires up the browser mock asset plugin.

## Development Modes

### VS Code webview mode

Build from the repo root and launch the Extension Development Host:

```bash
npm run build
```

Then press `F5` in VS Code.

### Browser mock mode

Run the webview as a standalone Vite app:

```bash
cd webview-ui
npm run dev
```

This uses `src/browserMock.ts` plus the Vite asset plugin to serve the same asset payloads and message shapes that the extension webview expects.

## Asset Flow

- Source assets live in `webview-ui/public/assets/`.
- `../shared/assets/plugin.ts` exposes decoded asset JSON endpoints in Vite dev mode.
- The browser mock fetches those endpoints first and falls back to client-side PNG decoding when needed.
- Production builds emit the webview bundle to `../dist/webview/`.

## Useful Commands

From `webview-ui/`:

```bash
npm run dev
npm run build
npm run lint
npm run test
```

## Notes

- The webview is intentionally backend-neutral. It reacts to semantic messages such as `agentToolStart`, `agentStatus`, `layoutLoaded`, and `furnitureAssetsLoaded`.
- If host payloads change, update `src/hooks/useExtensionMessages.ts` and `src/browserMock.ts` together.
