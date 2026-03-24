# Pixel Agents Repository Intelligence Report

## Executive Summary and Product Purpose

**Executive Summary (requested sections: Executive Summary; Product Purpose and Core Capabilities)**  
This repository (by entity["people","Pablo De Lucca","pixel-agents author"]) is a VS Code extension that renders a live, animated “pixel office” inside a webview panel; each tracked agent corresponds to a VS Code terminal session and is visualised as a character whose animation/overlays reflect what the agent is doing (tools running, waiting, etc.). The extension’s runtime entrypoint is a bundled `dist/extension.js` declared in the extension manifest. citeturn14search4

Operationally, the system works by (a) creating/associating VS Code terminals, (b) watching per-agent transcript files, (c) parsing those transcripts into structured “agent activity” events, and (d) pushing those events over a `postMessage` protocol into a React-based webview that runs the office simulation/render loop. citeturn41view0turn42view2turn43view7turn17view0

**What exact problem it solves**  
The repo solves a practical “observability + coordination” problem for terminal-driven coding agents: it gives the user a persistent, glanceable control surface (one per agent terminal) that makes agent state visible and actionable (focus an agent, close an agent, see whether tools are executing, whether the agent is waiting/blocked, and manage the physical layout/seat assignments). The core mechanism is translating transcript-derived tool state into UI state via extension↔webview messaging (e.g., `agentToolStart`, `agentToolDone`, and waiting timers). citeturn43view7turn43view8turn43view10turn42view2

**Primary user-visible capabilities (grounded in code paths)**  
The following capabilities are explicitly implemented via webview message handlers in the extension host:

- Create a new agent terminal from the UI (webview message `openClaude`), which spawns a new VS Code terminal and starts a Claude session with a generated session id. citeturn41view0turn41view6  
- Focus an agent (webview message `focusAgent`), which brings the corresponding terminal to the foreground. citeturn42view1  
- Close an agent (webview message `closeAgent`), disposing its terminal. citeturn42view1turn42view2  
- Persist seat assignments per workspace (`saveAgentSeats` → `workspaceState`). citeturn42view2  
- Persist office layout to a user-level file (`saveLayout` → write to layout file). citeturn42view2turn46view9  
- Export and import the layout as a JSON file using VS Code file dialogs (`exportLayout`, `importLayout`). citeturn42view3turn42view4turn42view5  
- Add/remove external asset directories (e.g., extra furniture packs) and hot-reload the webview’s furniture catalog. citeturn44view10turn46view5turn46view7  
- Open the session folder in the OS file explorer (`openSessionsFolder`). citeturn42view3

**Main architectural layers and why they are split**  
The repository is split into two primary runtime layers plus shared tooling:

- **Extension host (Node.js / VS Code API)**: owns terminals, filesystem watching, transcript parsing, persistence, and the webview container lifecycle. This split exists because only the extension host can interact with VS Code terminals, workspace/global state, and local filesystem APIs with the required privileges. citeturn45view0turn42view2turn43view4turn46view9  
- **Webview UI (React + canvas engine)**: owns rendering, interaction, and editor UX for the layout; it receives authoritative events from the extension host and renders them. The webview is bundled separately with Vite to `dist/webview`. citeturn38view0turn39view0turn17view0  
- **Shared assets utilities**: used to build/serve asset indexes and pre-decoded sprite data, especially to support running the UI in a browser without relying on extension-side PNG decoding. citeturn40view0turn39view2turn24view1

## Architecture Overview and Major Subsystems

**Architecture Overview (requested sections: Architecture Overview; Major Subsystems; Claude-Specific vs Agent-Agnostic Design)**

### Major subsystems on the extension host side

**Extension lifecycle / panel registration**  
`src/extension.ts` registers a single `PixelAgentsViewProvider` as a webview view provider and wires up two commands:
- `Pixel Agents: Show Panel` focuses the view
- `Pixel Agents: Export Layout as Default` delegates to the provider’s `exportDefaultLayout()` method. citeturn45view0turn14search4

**Webview provider / message router**  
`src/PixelAgentsViewProvider.ts` is the central coordinator that:
- sets up webview HTML and scripts (`enableScripts: true`)
- receives messages from webview (e.g., `openClaude`, `saveLayout`, `addExternalAssetDirectory`)
- sends messages to webview (e.g., `agentCreated`, `settingsLoaded`, `externalAssetDirectoriesUpdated`, `layoutLoaded`)
- subscribes to VS Code terminal events (`onDidChangeActiveTerminal`, `onDidCloseTerminal`). citeturn41view0turn42view2turn41view2turn42view5turn46view7

**Agent/terminal manager**  
`src/agentManager.ts` is responsible for:
- creating the terminal (`vscode.window.createTerminal`) and sending the CLI command to start a session
- allocating and persisting agent ids and terminal indices
- persisting a compact agent snapshot to `workspaceState`
- restoring agents on webview readiness by matching persisted state to live terminals and starting transcript watching once the JSONL file exists. citeturn41view6turn42view7turn42view8turn42view9

Notably, the “agent backend” is currently hardwired to Claude Code’s CLI invocation (`claude --session-id …`), including an optional permissions bypass flag. citeturn41view6

**Transcript ingest and parsing**  
The ingest chain is split into:
- `src/fileWatcher.ts`: robust file-change detection, using multiple strategies (primary `fs.watch`, secondary `fs.watchFile` with polling interval, plus a tertiary manual poll). citeturn43view4turn43view6  
- `src/transcriptParser.ts`: line-by-line JSON parsing and event extraction, mapping transcript content into webview messages such as `agentToolStart` and `agentToolDone`, with additional book-keeping for subagent tools and “waiting” behaviour via timers. citeturn43view9turn43view7turn43view8turn43view10

**Layout persistence + cross-window sync**  
`src/layoutPersistence.ts` stores the canonical office layout in a user-level JSON file in the user’s home directory (join of `os.homedir()` with constants `LAYOUT_FILE_DIR` and `LAYOUT_FILE_NAME`). citeturn45view4  
Writes are atomic-ish: it writes `layout.json.tmp` then renames into place (`fs.renameSync`). citeturn46view9turn46view10

It also implements cross-window sync by watching the layout file for external changes and ignoring the extension’s own writes through a `markOwnWrite()`/`skipNextChange` mechanism. citeturn45view3turn45view7

### Major subsystems on the webview side

**React app shell + runtime detection**  
The webview UI bootstraps via `webview-ui/src/main.tsx` and renders `<App />` into `#root`. citeturn17view0  
A small runtime detector (`webview-ui/src/runtime.ts`) determines whether it is running inside an IDE webview (presence of `acquireVsCodeApi`) or in a standalone browser runtime. citeturn23view0  
In browser runtime, it dynamically initialises a mock layer (`browserMock.ts`) before rendering. citeturn17view0turn22view0

**Office canvas + editor UX**  
The app composes an office canvas renderer and editor modules; `App.tsx` imports:
- `useExtensionMessages` (bridge for extension→webview messages)
- `OfficeCanvas` (rendering surface)
- `ToolOverlay` (activity overlay UI)
- `EditorState` and `EditorToolbar` (layout editing subsystem). citeturn46view16turn20view1turn20view3turn18view0

This strongly implies a “canvas engine + React UI chrome” architecture, where React handles UI state and inputs while the office scene is rendered onto a canvas. (Inference: file names and module boundaries indicate this; deeper confirmation would require reading `OfficeCanvas.tsx`, which could not be retrieved due to GitHub fetch errors in this session.) citeturn20view3turn46view16

### VS Code extension host ↔ webview interaction boundary

The boundary is a `postMessage` protocol:
- **Webview→host**: implemented via `webviewView.webview.onDidReceiveMessage(...)` with message `type` dispatch (e.g., `openClaude`, `saveLayout`, `addExternalAssetDirectory`). citeturn41view0turn42view2turn44view10  
- **Host→webview**: implemented via `webview.postMessage(...)` calls such as `agentCreated`, `agentToolStart`, `agentToolDone`, `layoutLoaded`, settings updates, etc. citeturn42view7turn43view7turn43view8turn42view5turn46view7

## Repository Map and Dependency Map

**Repository Map (requested sections: Repository Map; Appendix: File-by-File Critical Path List)**

### Top-level structure (what matters operationally)

| Area | What it contains | Why it matters | Evidence |
|---|---|---|---|
| `src/` | Extension host implementation: provider, terminal manager, transcript parsing, watchers, persistence | This is the “truth” for agent discovery, state, filesystem I/O, and messages sent to UI | citeturn13view0turn41view0turn42view8turn46view9 |
| `webview-ui/` | React webview UI + office engine/editor | Renders the office and editor; consumes host messages; includes browser runtime support | citeturn38view0turn17view0turn46view16turn18view0 |
| `shared/assets/` | Asset build + PNG decode utilities used by Vite dev server/build | Enables pre-decoding/serving sprite data and building catalog/index files for browser mode | citeturn40view0turn39view2turn24view1 |
| `docs/` | Operational docs; external asset configuration | Helps understand intended workflows; may lag behind code | citeturn12view0turn13view0 |
| `scripts/` | HTML-based tools (asset manager, JSONL viewer, wall editor) | Appears to be a reduced subset of an older asset pipeline; still useful for manual workflows | citeturn25view0turn13view4 |
| `.github/workflows/` | CI + publishing + badges | Defines how builds run and how extension gets published | citeturn30view0turn32view0turn32view5turn32view6 |

### Entry points and hotspots

**Entry points**
- **Extension runtime entry**: `src/extension.ts` (`activate`, `deactivate`). citeturn45view0  
- **Webview runtime entry**: `webview-ui/src/main.tsx` (renders `<App />`). citeturn17view0  
- **Build entrypoints**: `esbuild.js` (extension bundling) + `webview-ui/vite.config.ts` (webview bundling and browser-mode asset serving). citeturn26search0turn39view0turn40view0

**Hotspots for future modifications (based on responsibility concentration)**
- `src/PixelAgentsViewProvider.ts`: message schema changes, asset loading changes, layout sync behaviour. citeturn41view0turn42view2turn46view7  
- `src/agentManager.ts`: anything touching terminal spawn/restore and how sessions map to files. citeturn41view6turn42view9  
- `src/fileWatcher.ts` + `src/transcriptParser.ts`: correctness of activity→animation semantics and cross-platform reliability. citeturn43view4turn43view9turn43view7  
- `src/layoutPersistence.ts`: layout format migrations, atomic write strategy, cross-window sync and conflict policy. citeturn46view9turn45view3turn46view12  
- `webview-ui/src/App.tsx` + `webview-ui/src/hooks/useExtensionMessages.ts`: UI state model, message application, editor integration. citeturn46view16turn46view1

**Appendix-style critical path list (condensed)**  
The minimal “read these first” files to understand runtime behaviour end-to-end are:
- `src/extension.ts` citeturn45view0  
- `src/PixelAgentsViewProvider.ts` citeturn41view0turn42view2turn46view7  
- `src/agentManager.ts` citeturn41view6turn42view9turn42view8  
- `src/fileWatcher.ts` citeturn43view4turn43view3  
- `src/transcriptParser.ts` citeturn43view9turn43view7turn43view8  
- `src/layoutPersistence.ts` citeturn46view9turn45view3turn46view12  
- `webview-ui/src/main.tsx` citeturn17view0  
- `webview-ui/src/App.tsx` citeturn46view16  
- `webview-ui/vite.config.ts` (build + browser-mode asset serving) citeturn40view0turn39view2turn39view0  

## End-to-End Runtime Flows

**End-to-End Runtime Flows (requested section: End-to-End Runtime Flows)**  
Below are the most important flows traced across the repo, with concrete file-level evidence.

### Extension activation → panel registration → startup

1) VS Code activates the extension and calls `activate(context)` in `src/extension.ts`. citeturn45view0  
2) The extension constructs a `PixelAgentsViewProvider` and registers it as a webview view provider (`registerWebviewViewProvider(VIEW_ID, provider)`). citeturn45view0turn45view1  
3) The `Pixel Agents: Show Panel` command focuses the view (`executeCommand(`${VIEW_ID}.focus`)`). citeturn45view0  
4) The `Pixel Agents: Export Layout as Default` command delegates to `provider.exportDefaultLayout()`. citeturn45view2

**Note on activation events (unknown)**: the extension manifest explicitly sets `"activationEvents": []`. citeturn14search4  
In modern VS Code versions, activation can be implicit for contributed views/commands, but the exact behaviour depends on platform/version. (Inference: the extension must still become active to register its webview provider; validating this would require verifying activation triggers in a running Extension Development Host.)

### Opening/showing the Pixel Agents panel

1) When the view is resolved, `PixelAgentsViewProvider.resolveWebviewView(webviewView)` is invoked. citeturn41view0  
2) It enables scripts (`webview.options = { enableScripts: true }`) and sets the webview HTML with `getWebviewContent(...)`. citeturn41view0  
3) It attaches a webview message handler (`webview.onDidReceiveMessage(async (message) => { ... })`). citeturn41view0turn42view2  
4) On the webview’s `webviewReady` signal, the provider triggers `restoreAgents(...)` (restoring persisted agents) and also sends settings (`settingsLoaded`) including `soundEnabled` and `externalAssetDirectories`. citeturn42view2turn46view7

### Spawning or associating an agent/terminal

1) UI requests a new agent via message `{ type: 'openClaude', ... }`, received in `PixelAgentsViewProvider`. citeturn41view0  
2) The provider calls `launchNewTerminal(...)` in `agentManager.ts`. citeturn41view0turn42view6  
3) `agentManager.ts` creates a VS Code terminal (`vscode.window.createTerminal`), generates a UUID session id, and runs the Claude CLI string `claude --session-id <uuid>` (optionally `--dangerously-skip-permissions`). citeturn41view6  
4) It initialises an `AgentState` object with tool-tracking sets/maps and waiting/permission flags, persists agents, and notifies the webview with `{ type: 'agentCreated', id, folderName }`. citeturn42view7turn42view8  
5) For restored agents, once the JSONL file exists it sets `agent.fileOffset = stat.size` and starts file watching via `startFileWatching(...)`. citeturn42view9

### Detecting activity from transcripts / observability signals

1) File watching is initiated through `startFileWatching(...)` which uses:
- primary `fs.watch`
- secondary `fs.watchFile` (stat-based polling; explicitly noted as reliable on macOS)
- a tertiary manual poll. citeturn43view4turn43view6  
2) On file changes, the watcher calls `readNewLines(...)`. citeturn43view4turn43view6  
3) For session transitions (e.g., new transcript file), the watcher clears timers/activity, swaps `agent.jsonlFile`, resets offsets/buffers, persists, and starts watching the new file. citeturn43view3turn43view5  

(Partial unknown) The implementation details of `readNewLines` are not shown in the captured excerpts; based on its usage and the presence of `agent.fileOffset`/`agent.lineBuffer` in state, it likely reads appended bytes from `agent.jsonlFile`, splits into complete newline-delimited JSON entries, and pushes each line into the transcript parser. This is an inference from how it is called and from adjacent persistence/reset logic. citeturn42view9turn43view3turn43view9

### Translating activity into character state changes in the UI

1) `src/transcriptParser.ts` parses each JSONL line with `JSON.parse(line)` and checks record structure. citeturn43view9  
2) When it detects tool activity, it updates `AgentState` tool-tracking collections and emits a webview event:
- `agentToolStart` with `{ id: agentId, toolId: block.id, status }`. citeturn43view7  
- `agentToolDone` after a delay (`TOOL_DONE_DELAY_MS`) to avoid flicker. citeturn43view8  
3) It tracks subagent tool state and emits `subagentClear` events when a parent tool completes. citeturn43view8  
4) It triggers waiting behaviour through `startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, ...)` (indicating that “no activity for a threshold” maps to an idle/waiting UI state). citeturn43view10  

### Rendering/updating the office scene in the webview

The concrete rendering internals were not fully retrievable in this session due to GitHub fetch errors for some webview files (notably `OfficeCanvas.tsx` and engine modules). What can be stated with repository evidence is:

- The webview is a React app that renders `App.tsx`, and `App.tsx` composes an `OfficeCanvas` with editor state and a message bridge hook (`useExtensionMessages`). citeturn17view0turn46view16  
- The office is organised into a dedicated `webview-ui/src/office/` subsystem with clear separations for `engine/`, `layout/`, `editor/`, `sprites/`, and `components/`. citeturn18view0turn19view0turn20view0turn20view1turn20view2turn20view3  

**Inference (labelled):** Given this structure and naming, the likely runtime is “tick/update” logic in `office/engine/gameLoop.ts` updating an `officeState` model and then drawing via a renderer onto the `OfficeCanvas` element; agent tool events from the extension mutate office state to change character animation states and overlays. This inference is strongly supported by the explicit module names (`gameLoop.ts`, `officeState.ts`, `renderer.ts`) and the React composition pattern, but confirming exact function boundaries requires direct inspection of those files. citeturn19view0turn20view3turn46view16  

### Layout editing, saving, importing/exporting, restoring

**Saving layout**
- Webview emits `saveLayout` with a `layout` payload.
- Extension calls `layoutWatcher.markOwnWrite()` and persists to the user-level layout file via `writeLayoutToFile(...)`. citeturn42view2turn46view9  

**Import/export**
- Export: provider reads layout via `readLayoutFromFile()` and writes chosen output path via a save dialog. citeturn42view3turn42view4  
- Import: provider opens a JSON file from a dialog, writes it to layout file, and posts `{ type: 'layoutLoaded', layout: imported }`. It also shows error messages on parse failure. citeturn42view5  

**Restoring on startup**
- On `webviewReady`, provider calls `restoreAgents(...)` and sends settings (`settingsLoaded`). citeturn42view2turn46view7  
- Layout restore logic is file-first with migration support: it can reset to bundled default if file revision is out-of-date, migrate from `workspaceState` if present, or write bundled default when no layout exists. citeturn46view12turn46view8  

### Asset loading and custom/external asset directories

- On webview ready, the extension reads config and posts `settingsLoaded` including `externalAssetDirectories`. citeturn46view7  
- The extension merges `loadFurnitureAssets(this.assetsRoot)` with any external directories from config, logging each directory and combining with `mergeLoadedAssets`. citeturn46view7  
- The settings flow allows adding/removing external directories, persists config via `readConfig`/`writeConfig`, then calls `reloadAndSendFurniture()` followed by `externalAssetDirectoriesUpdated`. citeturn44view10turn46view5turn46view6  

**Unknown (explicit):** The implementation of `readConfig()`/`writeConfig()` (including the exact on-disk config path and schema) could not be retrieved here; attempting to fetch `src/configPersistence.ts` resulted in a GitHub error. citeturn46view0  
The repository documentation claims a user-level config at `~/.pixel-agents/config.json`, which is consistent with the observed usage pattern (user-level settings and directory list), but should be treated as a doc-based assumption until the actual implementation file is inspected. citeturn12view0turn46view7  

### Multi-agent orchestration and sub-agent handling

- Multi-agent is fundamentally “one agent ↔ one terminal ↔ one character”: agents are stored in a `Map<number, AgentState>`, persisted to `workspaceState`, restored by matching to live terminals, and tracked independently. citeturn42view7turn42view8turn42view9  
- Sub-agent handling exists at the transcript parse layer: `transcriptParser.ts` maintains subagent tool name mappings and emits `subagentClear` events when a parent tool completes. citeturn43view8  

## State, Persistence, and Data Models

**State, Persistence, and Data Models (requested sections: State, Persistence, and Data Models; Key Open Questions / Unknowns)**

### Extension-side state and source of truth

**Agent runtime state (in-memory)**  
Agent state is held in-memory (a map keyed by numeric id) and includes tool-tracking structures like `activeToolIds`, `activeToolStatuses`, `activeToolNames`, plus waiting/permission flags. citeturn42view7turn43view7turn43view8  

**Persisted agent state**  
The persisted snapshot stored in `workspaceState` includes at least: `id`, `terminalName`, `jsonlFile`, `projectDir`, `folderName`. citeturn42view8turn41view8  
This means the extension can restore visual agents only when the corresponding terminal still exists and matches persisted `terminalName` semantics. (Inference: restore logic matches entries against `vscode.window.terminals`; exact matching criteria beyond “terminal exists” requires deeper inspection of the restore loop.) citeturn41view8turn41view9  

**Seat assignments are separate**  
Seat assignments are explicitly stored under a separate key via `saveAgentSeats` and are “never touched by persistAgents”. citeturn42view2

**Layout is user-level file state**  
The layout is stored in a user-level file path derived from `os.homedir()` + constants. citeturn45view4  
Writes are performed by writing a `.tmp` file and renaming over the target, reducing partial write risk. citeturn46view9turn46view10

**Cross-window sync model**  
`watchLayoutFile` tracks `mtimeMs`, uses both `fs.watch` and a poller, and prevents its own writes from triggering immediate self-reloads via `skipNextChange`/`markOwnWrite`. citeturn45view3turn45view7  
This is a classic last-write-wins pattern; the only conflict-avoidance mechanism visible in code excerpts is “ignore my next change”. (Unknown: whether the webview has a “dirty/unsaved” mechanism that delays applying external layout changes; this is referenced in the repository’s design notes but not confirmed in code excerpts here.) citeturn45view3turn13view3  

**Global user settings**  
Sound enablement is stored via `globalState.update(...)` and then provided to the webview via `settingsLoaded`. citeturn42view2turn46view7  
External asset directories are also delivered via that same `settingsLoaded` payload. citeturn46view7  

### Webview-side state and message application

The webview clearly has a dedicated state layer for:
- office simulation state (`office/engine/officeState.ts` exists)
- editor state (`office/editor/editorState.ts` exists and is imported by `App.tsx`)
- message application (`useExtensionMessages` hook). citeturn19view0turn20view1turn46view16turn46view1  

**Unknown (explicit):** The precise data model types and payload shapes used in `useExtensionMessages` and the office engine were not extracted due to tool limits and fetch errors for some files. citeturn46view1turn46view2turn46view4  
However, on the extension side, several payloads are explicit:
- `agentToolStart`: `{ id, toolId, status }` citeturn43view7  
- `agentToolDone`: `{ id, toolId }` citeturn43view8  
- `agentCreated`: `{ id, folderName }` citeturn42view7  
- `settingsLoaded`: `{ soundEnabled, externalAssetDirectories }` citeturn46view7  
- `externalAssetDirectoriesUpdated`: `{ dirs }` citeturn44view10turn46view5  
- `layoutLoaded`: `{ layout }` citeturn42view5  

### Fragile synchronisation points (risk assessment)

- **Terminal identity vs persistence**: persisted agents store `terminalName`; if terminal naming changes or user renames terminals (or VS Code changes naming behaviour), restore may fail. This is an inference drawn from what’s persisted (`terminalName`) and the fact restore depends on live terminals. citeturn42view8turn41view8  
- **File watching reliability**: the project already compensates for `fs.watch` unreliability by layering `fs.watchFile` and manual polling and by catching watch failures. This is a strong signal that transcript detection is a central reliability risk. citeturn43view4turn43view6  
- **Layout cross-window changes**: the layout file watcher uses a single “skip next” flag; fast consecutive writes from multiple windows could still produce missed/skipped updates. (Inference from the algorithm: single `skipNextChange` boolean and `mtimeMs` checking.) citeturn45view3turn45view7  

## Build, Tooling, and Release Pipeline

**Build and Tooling Pipeline (requested section: Build and Tooling Pipeline)**

### How the project builds and bundles

**Extension build**
- Root `package.json` runs `node esbuild.js` as part of `compile/build/package`. citeturn26search0  
- The extension entrypoint is `dist/extension.js` (manifest `main`). citeturn14search4  

**Webview build**
- Root build invokes `npm run build` in `webview-ui`. citeturn26search0turn32view0  
- Webview Vite output is configured to target `../dist/webview`, with `base: './'`. citeturn39view0  

### Dev loops and test hooks

- Root watch script runs build watchers in parallel (`npm-run-all -p watch:*`) including `node esbuild.js --watch` and `tsc --watch`. citeturn26search0  
- Webview supports `vite` dev server via `webview-ui`’s `dev` script. citeturn38view0  
- Webview’s `test` script runs Node’s built-in test runner with TSX ESM loader (`node --import tsx/esm --test test/*.test.ts`). citeturn38view0  

### CI and publishing

**CI pipeline**  
CI installs dependencies for both root and webview, runs type checks, lints, formatting checks, then builds extension + webview. citeturn32view2turn32view0  
Notably, many steps are `continue-on-error: true` (including build), and a summary step is written; this implies CI may be tuned to provide feedback rather than hard fail on every issue. citeturn32view0  

**Publishing**  
The publish workflow uses `HaaLeo/publish-vscode-extension@v2` to publish to:
- Visual Studio Marketplace (via `VSCE_PAT`)
- entity["organization","Open VSX","vscode extension registry"] (via `OPEN_VSX_TOKEN`), and then uploads the VSIX asset to GitHub Releases when triggered by a release event. citeturn32view5turn32view6  

### Packaging controls

The repo includes a `.vscodeignore` that excludes sources (`src/**`, `webview-ui/**`, `scripts/**`, etc.) from the published extension, implying the release artefact relies on `dist/` outputs. citeturn14search1  

### Tooling inconsistencies to fix early (high-signal maintenance issue)

Root `package.json` defines an `import-tileset` script referencing `scripts/import-tileset-cli.ts`. citeturn26search0  
However, the `scripts/` directory in the repo currently contains only three HTML files and does not include `import-tileset-cli.ts`. citeturn25view0turn27view0  
This is concrete technical debt: either the script is stale, files were removed, or the tool moved. Any developer trying to run asset import will hit a 404/missing file failure. citeturn27view0  

## Codex Portability, Technical Debt, and Agent Mode Handoff

**Codex Portability Assessment; Technical Debt and Architectural Risks; Agent Mode Handoff Pack; Key Open Questions / Unknowns (requested sections: Claude-Specific vs Agent-Agnostic Design; Codex Portability Assessment; Technical Debt and Architectural Risks; Agent Mode Handoff Pack; Key Open Questions / Unknowns; Appendix)**

### Claude-specific vs agent-agnostic design

**Claude-specific (confirmed)**
- Terminal launch command is `claude --session-id ...` (with Claude-specific permissions flag). citeturn41view6  
- Transcript parsing assumes a JSON record structure with `record.type === 'assistant'` and `record.message.content` as an array of blocks containing tool metadata (`id`, `name`, `input`). citeturn43view9turn43view7  

These are not generic abstractions; they are direct coupling points to Claude Code’s CLI and transcript format.

**Agent-agnostic (partially implemented)**
- The webview UI has explicit runtime detection and a browser-mode mock interface, suggesting the rendering/editor subsystem is designed to run outside VS Code and is not intrinsically Claude-bound. citeturn23view0turn17view0turn39view2  
- The extension↔webview protocol uses generic-ish event names like `agentToolStart`, `agentToolDone`, `agentCreated`, `layoutLoaded`, which could be re-used by other backends as long as you emit the same events. citeturn43view7turn43view8turn42view7turn42view5  

**Overall assessment**  
The current architecture is “UI-agnostic, backend-specific”: the office UI and layout tooling look reusable, but the host-side agent integration is heavily Claude-specific because it depends on the Claude CLI invocation and Claude’s JSONL schema. citeturn41view6turn43view9turn46view16  

### Codex portability assessment

**How close is this repo to supporting Codex (or other agent backends)?**  
Based strictly on current mainline code paths, it is not close in the extension host layer: there is no visible provider abstraction in the host that would allow swapping “Claude CLI + JSONL tailing” for “Codex events”. The integration points are concrete and embedded in `agentManager.ts` and `transcriptParser.ts`. citeturn41view6turn43view9turn45view0  

However, it is closer on the UI side if you preserve the message protocol:
- If an alternative backend can emit the same `agentToolStart/Done` and waiting/permission semantics, you could reuse most of the office renderer/editor. citeturn43view7turn43view10turn46view16  

**What would need to change to make it work well with Codex rather than Claude Code? (concrete targets)**
1) Introduce a **provider layer** in the extension host that encapsulates:
   - session creation (spawn terminal vs API attach)
   - session discovery/restoration
   - event ingestion (tail JSONL vs SSE vs websocket vs polling APIs)
   - mapping into the existing webview protocol.  
   Today, these concerns are fused into `agentManager.ts` + `fileWatcher.ts` + `transcriptParser.ts`. citeturn41view6turn43view4turn43view9  

2) Replace the Claude CLI invocation with a Codex session lifecycle:
   - swap `terminal.sendText("claude --session-id ...")` with Codex startup/attach mechanics (exact command/API depends on Codex runtime you target). citeturn41view6  

3) Replace transcript parsing with Codex event parsing:
   - `transcriptParser.ts` currently expects “assistant message blocks” style tool metadata; you will need a mapping from Codex tool calls/events to `toolId`/`status` semantics used by the webview. citeturn43view9turn43view7turn43view8  

4) Preserve (or redesign) the waiting/permission model:
   - Waiting is triggered by timers (`TEXT_IDLE_DELAY_MS` → `startWaitingTimer`). citeturn43view10  
   - Permission gating uses “permission-exempt tools” and non-exempt detection (`PERMISSION_EXEMPT_TOOLS`). citeturn43view7  
   Codex may model “approval required” differently; you may prefer explicit events rather than heuristic timers.

### Design quality and technical debt

**Strong architectural decisions**
- **Clear separation of concerns**: `PixelAgentsViewProvider` centralises message routing and view lifecycle; `agentManager` handles terminal/session lifecycle; `fileWatcher` handles robust tailing; `transcriptParser` converts input into events; `layoutPersistence` owns on-disk layout and sync. citeturn45view0turn42view8turn43view4turn43view9turn46view9turn45view3  
- **Cross-platform file watch resilience**: layering `fs.watch`, `fs.watchFile`, and manual polling is pragmatic and acknowledges real-world filesystem watcher flakiness. citeturn43view4turn43view6  
- **Atomic layout writes**: `.tmp` write + rename reduces risk of corrupted layout files. citeturn46view9turn46view10  
- **Browser-mode runtime and asset-serving plugin**: the Vite plugin serves JSON metadata and decoded sprites, allowing the UI to run outside VS Code and reducing browser-side PNG decoding overhead. citeturn39view2turn40view3turn39view0  

**Brittle / likely bug areas**
- **Terminal/session identity**: persisting `terminalName` as an identity anchor is potentially fragile (rename/collisions). (Inference from persisted fields and restore dependency on live terminals.) citeturn42view8turn41view8  
- **Heuristic timing/state**: waiting/permission logic is timer-driven and can drift or misclassify in edge cases (e.g., long tool runs, partial writes). This is suggested by explicit delays (`TOOL_DONE_DELAY_MS`) and idle timers (`TEXT_IDLE_DELAY_MS`) and the complexity of file-watching. citeturn43view8turn43view10turn43view4  
- **Docs/scripts drift**: build scripts reference missing files (`import-tileset-cli.ts`), and documentation appears to reference an asset pipeline not present in the repo. citeturn26search0turn25view0turn27view0turn13view4  

### Agent Mode Handoff Pack

**Concise architecture summary (for Agent mode)**
- Extension host is the orchestrator: `PixelAgentsViewProvider` is the message hub; `agentManager` owns terminal spawn/restore; `fileWatcher` tails transcript files; `transcriptParser` maps transcript lines into tool/waiting events; `layoutPersistence` stores a shared user-level layout file and syncs across windows. citeturn42view2turn42view8turn43view4turn43view9turn46view9turn45view3  
- Webview is React + office engine: `main.tsx` renders `App.tsx`; `App.tsx` wires `OfficeCanvas`, editor state, and an extension message hook. citeturn17view0turn46view16  
- Core integration is the `postMessage` protocol with events like `openClaude`, `agentCreated`, `agentToolStart/Done`, `settingsLoaded`, `layoutLoaded`. citeturn41view0turn42view7turn43view7turn46view7turn42view5  

**Key files to read first (recommended order)**
1) `src/PixelAgentsViewProvider.ts` citeturn41view0turn42view2turn46view7  
2) `src/agentManager.ts` citeturn41view6turn42view9turn42view8  
3) `src/fileWatcher.ts` citeturn43view4turn43view3  
4) `src/transcriptParser.ts` citeturn43view9turn43view7turn43view8  
5) `src/layoutPersistence.ts` citeturn46view9turn45view3turn46view12  
6) `webview-ui/src/App.tsx` + `webview-ui/src/hooks/useExtensionMessages.ts` citeturn46view16turn46view1  
7) `webview-ui/vite.config.ts` (asset pipeline + browser-mode) citeturn40view0turn39view2turn39view0  

**Safest entry points for changes**
- Add new UI-only features that do not modify the message contract (stay within `webview-ui/` and keep existing message types). citeturn46view16  
- Extend layout format with backward compatibility by bumping revision and updating `layoutPersistence` migration/reset logic. citeturn46view12turn46view8  
- Add new tool-to-animation mappings by extending `transcriptParser`’s mapping into existing message events (or additive events). citeturn43view7turn43view8  

**Most dangerous areas (high blast radius)**
- `fileWatcher.ts` (watch/tail correctness impacts all agent activity). citeturn43view4turn43view3  
- `agentManager.ts` restore logic and persisted schema (breaks continuity across reloads). citeturn42view8turn42view9  
- Any changes to message types/payloads without synchronised updates in `useExtensionMessages` and UI consumers. citeturn41view0turn46view16  

**Assumptions Agent mode should preserve**
- The canonical layout is user-level file state, not per-workspace, and is updated atomically through `.tmp` + rename. citeturn45view4turn46view9  
- Cross-window layout sync relies on `markOwnWrite()`/`skipNextChange` and `mtimeMs` polling. citeturn45view3turn45view7  
- Tool completion events are intentionally delayed (`TOOL_DONE_DELAY_MS`) to avoid UI flicker. citeturn43view8  
- Watchers are layered (`fs.watch` + `fs.watchFile` + poll). Removing layers risks regressions on macOS/Linux. citeturn43view4turn43view6  

**Likely debugging hotspots**
- “Agents not animating / stuck”: trace `fileWatcher → readNewLines → transcriptParser → webview.postMessage`. citeturn43view4turn43view9turn43view7  
- “Agents not restoring”: trace `restoreAgents` + persisted schema and terminal matching. citeturn41view8turn42view9turn42view8  
- “Layout conflicts across windows”: trace `watchLayoutFile(checkForChange)` and “skip next change” interactions. citeturn45view3turn45view7  
- “External assets not appearing”: trace `readConfig.externalAssetDirectories → loadFurnitureAssets(extraDir) → mergeLoadedAssets → reloadAndSendFurniture`. citeturn46view7turn44view10  

**Recommended first checks after code changes**
- Verify build output paths: webview must compile into `dist/webview` and extension into `dist/extension.js`. citeturn39view0turn14search4  
- Exercise basic flows: open panel, create agent, observe `agentCreated` → `agentToolStart/Done` by forcing a tool call; confirm messages reach webview. citeturn41view0turn42view7turn43view7turn43view8  
- Validate layout saving: `saveLayout` writes correct JSON and cross-window watcher does not cause loops. citeturn42view2turn46view9turn45view7  

**Refactors that would make Codex/other backends easier**
- Create a `Provider` interface on host side with methods `createSession`, `restoreSessions`, `subscribeEvents`, `disposeSession`, and a standard event model (`ToolStart/ToolDone/Waiting/NeedsApproval`) that maps to existing webview message types. Today the concerns are spread across `agentManager`, `fileWatcher`, and `transcriptParser`. citeturn41view6turn43view4turn43view9  
- Make the webview contract explicit and versioned (e.g., a shared `types.ts` in `shared/` used by both sides) to reduce breakage when adding new events. (Inference: contract is currently implicit across message dispatch in provider and UI hook.) citeturn41view0turn46view16  

### Key open questions / unknowns (explicit)

1) **Where is `readConfig`/`writeConfig` implemented and what is the canonical config schema/path?**  
Calls are clearly present and used for external asset directories and settings hydration, but the implementation file could not be fetched in this session. citeturn44view10turn46view7turn46view0  

2) **What is the exact transcript file location and session-id→file mapping for new agents?**  
We can see restoration polling for an agent’s JSONL file and subsequent watching, and we can see session id generation, but the path construction logic (projects folder hashing, etc.) wasn’t captured in the excerpts here. citeturn41view6turn42view9turn42view7  

3) **How exactly does the webview apply incoming message events to office/character state?**  
We can confirm the existence of a dedicated hook (`useExtensionMessages`) and office canvas modules, but could not extract their logic into this report due to fetch errors and tool limits. citeturn46view16turn46view1turn46view2turn46view3turn46view4  

4) **What is the conflict policy when a layout is edited locally while an external layout file change occurs?**  
The extension watcher can detect external changes and avoid self-triggered reloads, but UI-side “dirty state” behaviour is not confirmed in code excerpts. citeturn45view3turn45view7