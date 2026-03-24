# Pixel Agents Repository Intelligence Report

## 1. Executive Summary

**Operational Scope.** Pixel&nbsp;Agents is a Visual&nbsp;Studio&nbsp;Code extension that turns tool‑driven coding agents into animated pixel characters in a virtual office.  Each agent corresponds to a VS&nbsp;Code terminal running an LLM “session” (currently Claude Code) and is visualised in a webview panel.  The extension watches a transcript file for each agent, parses tool‑execution events and idle periods, and sends messages to a React/web‑canvas UI that updates the office scene and editor toolbar accordingly【413743530601376†L0-L0】.  This provides a persistent, glanceable control surface for multi‑agent coordination, highlighting busy vs idle agents and allowing users to create, focus, close or reorganise agents from the UI【413743530601376†L0-L0】.

**Core Capabilities.**  The extension can spawn new agent terminals, restore agents from persisted state, detect tool start/finish events from JSONL transcripts, animate character state (working, waiting, blocked), persist and edit office layouts, import/export layouts, manage seat assignments and external asset directories, and support a standalone browser‑mode UI for development【413743530601376†L0-L0】.  It exposes commands to show the panel and export the default layout; all other interactions occur via a postMessage protocol between extension and webview【413743530601376†L0-L0】.

**Architecture Summary.**  At runtime there are two main layers: (1) the **extension host**, implemented in Node.js/TypeScript, manages VS&nbsp;Code terminals, file watching, transcript parsing, persistence and message routing; and (2) the **webview UI**, implemented as a React application with a canvas‑based office engine, which renders the office and handles user input.  They communicate exclusively via structured messages over `postMessage`【413743530601376†L0-L0】.  This design isolates UI concerns from VS&nbsp;Code APIs and enables a browser‑mode build for local testing, while tying back‑end logic tightly to Claude Code’s CLI invocation and transcript format【413743530601376†L0-L0】.

## 2. Product Purpose and Current Reality

### Purpose

Pixel&nbsp;Agents addresses two pain points in agent‑driven development: visibility and coordination.  When running multiple LLM agents via terminals, it can be difficult to know which agent is busy, waiting for permissions, or blocked.  This extension provides a “heads‑up display” by mapping each agent to a character in a pixel‑art office; tool calls trigger animations and overlays; idle agents appear to “wait” after a configurable delay【413743530601376†L0-L0】.  Users can click seats to focus or close agents, edit the office layout, and add custom assets to personalise the workspace【413743530601376†L0-L0】.

### Current Reality

The repository implements a fully working VS&nbsp;Code extension.  The main runtime functions—extension activation, panel registration, agent management, transcript watching and parsing, layout persistence, asset loading, and UI rendering—are present and functional【413743530601376†L0-L0】.  Build scripts compile the extension with esbuild and the webview with Vite; CI publishes compiled artefacts to the VS Code marketplace and Open&nbsp;VSX.  However, the host logic is hard‑coded to Claude Code’s CLI command and transcript schema, making other backends non‑trivial to integrate without significant refactoring【413743530601376†L0-L0】.  Some scripts and docs refer to asset tooling that no longer exists, indicating drift between documentation and code【413743530601376†L0-L0】.  The UI’s office engine is modular and browser‑compatible but not thoroughly documented; deeper UI internals (game loop, renderer, state management) were not fully captured in the research due to file access issues, representing an unknown that could require further inspection【413743530601376†L0-L0】.

## 3. Architecture Overview

### Major Layers

1. **Extension Host Layer (Node/VS&nbsp;Code API)** – Entry point `src/extension.ts` registers a `PixelAgentsViewProvider` and exposes two commands (show panel and export default layout).  The provider sets up the webview, handles messages from the UI (create agent, focus agent, save layout, add external asset directory), and publishes events back to the UI (agent creation, tool start/done, layout loaded, settings loaded)【413743530601376†L0-L0】.  Sub‑modules include:
   - **Agent Manager (`src/agentManager.ts`)** – Creates terminals with `vscode.window.createTerminal`, launches the Claude CLI command, generates session IDs, persists agent metadata, and restores agents on reload【413743530601376†L0-L0】.  Tracks active tools and waiting states per agent.
   - **File Watcher (`src/fileWatcher.ts`)** – Uses `fs.watch`, `fs.watchFile` and a fallback polling loop to tail JSONL transcript files reliably across platforms【413743530601376†L0-L0】.
   - **Transcript Parser (`src/transcriptParser.ts`)** – Parses JSON lines into tool events (`agentToolStart`, `agentToolDone`) and manages waiting/permission timers【413743530601376†L0-L0】.
   - **Layout Persistence (`src/layoutPersistence.ts`)** – Reads/writes a user‑level layout JSON file via atomic write (tmp + rename) and watches for external changes, skipping its own writes【413743530601376†L0-L0】.
   - **Config Persistence** – (Missing in research) Functions `readConfig`/`writeConfig` supply external asset directory settings and sound enablement; their implementation location is unknown【413743530601376†L0-L0】.

2. **Webview UI Layer (React + Canvas)** – Entry point `webview-ui/src/main.tsx` detects runtime (IDE vs browser) and renders `App.tsx` into a root div【413743530601376†L0-L0】.  The React application composes the office canvas renderer, editor toolbar and extension message hook (`useExtensionMessages`).  Sub‑modules are organised under `office/` and include `engine/` (game loop, office state, renderer), `layout/` (data structures), `editor/` (seat editor interactions), `sprites/` (loaded furniture and character sprites) and `components/`【413743530601376†L0-L0】.  Messages from the extension drive state updates; user interactions (open agent, focus, save) are posted back via `vscode.postMessage`.

3. **Shared Asset Utilities** – `shared/assets/` contains build scripts and a Vite plugin to decode sprite sheets and serve them as JSON metadata.  This enables the browser‑mode UI to preload assets without heavy runtime PNG decoding【413743530601376†L0-L0】.

### Why the split

The extension host can access VS&nbsp;Code APIs (terminals, workspace/global state, file dialogs), while the webview cannot due to sandbox restrictions.  Splitting responsibilities ensures the UI remains pure front‑end (React + canvas), while the host handles environment‑specific tasks.  The separation also makes it possible to run the UI in a standalone browser for testing and asset editing【413743530601376†L0-L0】.

## 4. Repository Map

| Directory / File | Purpose | Notes |
|---|---|---|
| `src/` | Extension host implementation. | Contains `extension.ts` (activation), `PixelAgentsViewProvider.ts` (message hub), `agentManager.ts`, `fileWatcher.ts`, `transcriptParser.ts`, `layoutPersistence.ts` and other utilities.  These files constitute the runtime logic for terminals, file watching, parsing and persistence【413743530601376†L0-L0】. |
| `webview-ui/` | React-based webview UI and office engine. | Contains `src/main.tsx`, `src/App.tsx`, `src/hooks/useExtensionMessages.ts`, `office/engine/*.ts`, `office/editor/*.tsx`, `sprites/*`, etc.  Vite config `vite.config.ts` bundles the UI and provides a plugin to serve assets and metadata【413743530601376†L0-L0】. |
| `shared/assets/` | Asset processing utilities and build-time PNG decoding. | Houses `plugin.ts` for Vite and Node scripts used by the browser‑mode engine. |
| `docs/` | Design notes and user guides. | Includes `README.md`, CLAUDE.md, asset guides.  Some documents reference assets or scripts no longer in the repo, indicating drift【413743530601376†L0-L0】. |
| `scripts/` | Legacy HTML tools. | Contains `asset-manager.html`, `json-viewer.html`, and `wall-editor.html` used for manual asset editing.  A referenced CLI script (`import-tileset-cli.ts`) is missing【413743530601376†L0-L0】. |
| `.github/workflows/` | CI and publishing pipelines. | Defines build/test tasks and uses `HaaLeo/publish-vscode-extension` to publish to VS Code marketplace and Open&nbsp;VSX【413743530601376†L0-L0】. |
| `dist/` (ignored in git) | Compiled outputs. | Contains `extension.js` and the webview build; this is what is packaged in the VSIX. |
| `package.json` & `esbuild.js` | Build scripts for extension. | `esbuild.js` bundles the host and sets up watch modes; `package.json` defines scripts for build, watch and publish【413743530601376†L0-L0】. |
| `webview-ui/vite.config.ts` | Build config for UI. | Configures asset plugin, sets output dir to `../dist/webview`, and ensures relative asset paths【413743530601376†L0-L0】. |

### Entry Points

* **Host** – `src/extension.ts` exports `activate` (called by VS&nbsp;Code) and `deactivate`.  It registers a `PixelAgentsViewProvider` and two commands【413743530601376†L0-L0】.
* **Webview** – `webview-ui/src/main.tsx` bootstraps the React app and detects whether it is running in VS&nbsp;Code or in a browser【413743530601376†L0-L0】.
* **Build** – `esbuild.js` for extension bundling, `webview-ui/vite.config.ts` for UI bundling【413743530601376†L0-L0】.

### Hotspots

* **`src/PixelAgentsViewProvider.ts`** – Message routing and coordination.  Changes here affect the host‑webview contract.
* **`src/agentManager.ts`** – Terminal creation, session restoration, agent state persistence.  Coupled to the Claude CLI.
* **`src/fileWatcher.ts` & `src/transcriptParser.ts`** – File watching reliability and correct extraction of tool/waiting events.
* **`src/layoutPersistence.ts`** – Layout file read/write, migration and cross‑window synchronisation.
* **`webview-ui/src/App.tsx` & `webview-ui/src/hooks/useExtensionMessages.ts`** – Front‑end state integration and message dispatch.

## 5. Major Subsystems

### 5.1 Extension Host Subsystems

1. **Extension Lifecycle (extension.ts)** – Activates the extension and registers commands and view provider.  On activation, creates a `PixelAgentsViewProvider` instance and registers it under a view ID (e.g., `pixel-agents-view`).  Defines commands to focus the view and export the default layout【413743530601376†L0-L0】.
2. **Webview Provider & Message Router (PixelAgentsViewProvider.ts)** – Constructs the webview HTML (embedding compiled JS) and listens to messages from the UI.  Supports message types: `openClaude`, `focusAgent`, `closeAgent`, `saveLayout`, `saveAgentSeats`, `exportLayout`, `importLayout`, `addExternalAssetDirectory`, `removeExternalAssetDirectory`, `openSessionsFolder`, etc.  Sends messages back to the UI: `agentCreated`, `agentToolStart`, `agentToolDone`, `subagentClear`, `layoutLoaded`, `settingsLoaded`, `externalAssetDirectoriesUpdated`【413743530601376†L0-L0】.
3. **Agent Manager (agentManager.ts)** – Exposes `launchNewTerminal` to spawn a new terminal with `claude --session-id <uuid>`, register the agent, and start file watching.  Implements `restoreAgents` to rebind existing terminals after reload.  Manages an `AgentState` map with fields such as `activeToolIds`, `activeToolStatuses`, `waitingTimeout`, `permissionFlags` etc.  Persists and reloads agent metadata via `workspaceState`【413743530601376†L0-L0】.
4. **File Watcher (fileWatcher.ts)** – Provides `startFileWatching(agentId, filePath, fileOffset)` to tail a transcript.  Uses `fs.watch` (primary), `fs.watchFile` (stat‑based polling) and manual interval polling to handle missing events on macOS/Linux.  Reconnects if the file is moved or replaced (e.g., new session file).  Reads new bytes, splits into lines and calls into transcript parser【413743530601376†L0-L0】.
5. **Transcript Parser (transcriptParser.ts)** – Parses each JSON record and updates agent state.  When it sees tool start blocks, it emits `agentToolStart` with `id`, `toolId`, `status`.  On tool completion, it waits `TOOL_DONE_DELAY_MS` to avoid flicker then emits `agentToolDone`.  It tracks nested subagents and emits `subagentClear` events.  It also implements `startWaitingTimer` to mark an agent as waiting if no transcripts are seen for `TEXT_IDLE_DELAY_MS`【413743530601376†L0-L0】.
6. **Layout Persistence (layoutPersistence.ts)** – Manages reading/writing the office layout JSON file in `~/.pixel-agents/layout.json`.  The extension writes to a `.tmp` file then renames it to avoid corruption.  Implements `watchLayoutFile` to detect external changes, skipping its own writes using a `skipNextChange` flag.  Loads default layout from a bundled file on first run and can migrate from workspace state if revisions change【413743530601376†L0-L0】.
7. **Config Persistence (unknown)** – Functions `readConfig` and `writeConfig` are referenced when loading settings and asset directories.  They likely read a user‑level `config.json` but were not captured in the research and need inspection.

### 5.2 Webview UI Subsystems

1. **App Shell (main.tsx / App.tsx)** – Bootstraps React, detects runtime (VS&nbsp;Code vs browser) and renders `<App />`.  The `App` component imports the office canvas, editor toolbar and a hook for extension messages.  It ties together the simulation state and editor controls.【413743530601376†L0-L0】.
2. **Extension Message Hook (useExtensionMessages.ts)** – Listens to `window.addEventListener('message')` for messages from the extension and updates local state.  Exposes functions to post messages back to the extension using `acquireVsCodeApi().postMessage`.  This is the bridge between UI and host.
3. **Office Engine (office/engine)** – Implements the game loop, office state data structures, movement and animation update functions, and the renderer that draws the scene to a canvas.  Files like `officeState.ts`, `gameLoop.ts`, `renderer.ts` manage characters, seats, floors and furniture.  They respond to tool events (start/done) and waiting flags to switch sprite frames.  (Due to fetch issues these modules were not directly inspected; their existence is inferred from file names and imports.)
4. **Layout & Editor (office/layout, office/editor)** – Defines the serialisable layout format (grid size, seat positions, furniture placements) and provides editor interactions for dragging/dropping items, selecting characters, editing seats and saving changes.  Editor state interacts with the office engine but is separate from simulation state to allow editing while agents are active.
5. **Sprites & Assets (office/sprites)** – Contains metadata and images for characters and furniture.  The Vite asset plugin decodes PNGs into JSON to avoid runtime decode overhead and provides functions to load external asset packs from user directories【413743530601376†L0-L0】.

## 6. Dependency Map

### Runtime Dependencies

* **VS&nbsp;Code API** – `vscode` module for terminals, file dialogs, workspace/global state, webview creation and messaging【413743530601376†L0-L0】.
* **Node.js core** – `fs`, `path`, `os`, `crypto` for file watching, path resolution, session ID generation, and home directory detection【413743530601376†L0-L0】.
* **UUID** – `crypto.randomUUID()` to generate session IDs for terminals.
* **React / React‑DOM** – Used in the webview UI for rendering the application【413743530601376†L0-L0】.
* **Canvas / WebGL** – The office engine uses `HTMLCanvasElement` and 2D context (or possibly WebGL) for drawing animations; this is internal to the UI and does not expose external dependencies.
* **Vite** – Bundles the webview UI and injects the asset plugin.  Used only at build time, not runtime.

### Dev & Build Dependencies

* **esbuild** – Bundles the extension into `dist/extension.js` with TypeScript support【413743530601376†L0-L0】.
* **TypeScript** – Provides types and compiled output for both host and UI.
* **ESLint / Prettier** – Linting and formatting configured in `.eslintrc.json` and `.prettierrc` (not detailed in the report but present).
* **Jest / Node test runner** – Used by webview tests via `node --import tsx/esm --test`.  The extension appears to have no unit tests.
* **Publish‑vscode‑extension Action** – Automates packaging and publishing to Marketplace and Open&nbsp;VSX【413743530601376†L0-L0】.

### Extension ↔ Webview Relationship

The extension bundles its own compiled code and the webview build into the VSIX.  At runtime, the host provides HTML that loads the `dist/webview/main.js` script and CSS.  The webview uses `acquireVsCodeApi()` to get a handle for posting messages.  There are no direct imports across layers; the contract is purely via message types and payloads【413743530601376†L0-L0】.

### Notable Transitive or Architectural Dependencies

* **File watching** relies on Node’s `fs` and its known platform limitations; fallback polling introduces CPU overhead and complexity【413743530601376†L0-L0】.
* **Claude CLI** invocation is hard‑coded; if the CLI changes or is replaced, `agentManager` must be updated【413743530601376†L0-L0】.
* **JSONL transcript format** is assumed; `transcriptParser` expects `record.type === 'assistant'` and nested `blocks` with `id` and `name` fields【413743530601376†L0-L0】.
* **Atomic layout writes** rely on `fs.renameSync` semantics working across filesystems; on some networked filesystems rename may not be atomic, which could corrupt the file【413743530601376†L0-L0】.

## 7. End‑to‑End Runtime Flows

The flows below trace key runtime sequences across modules.

### 7.1 Extension Activation and Panel Registration

1. VS&nbsp;Code activates the extension and calls `activate(context)` in `src/extension.ts`.  This registers a `PixelAgentsViewProvider` for the custom view ID and two commands: “Show Panel” (which focuses the view) and “Export Layout as Default”【413743530601376†L0-L0】.
2. When the user invokes the command or the view is shown, VS&nbsp;Code calls `resolveWebviewView(webviewView)` on the provider【413743530601376†L0-L0】.
3. The provider sets `webview.options.enableScripts = true` and writes the HTML template including `<script type="module" src="main.js"></script>`【413743530601376†L0-L0】.  It then attaches `webview.onDidReceiveMessage()` to handle incoming messages【413743530601376†L0-L0】.
4. The provider posts an initial `settingsLoaded` message containing `soundEnabled` and `externalAssetDirectories`, and, on first load, calls `restoreAgents()` to rebind existing terminals【413743530601376†L0-L0】.

### 7.2 Opening/Showing the Pixel Agents Panel

1. The webview loads `dist/webview/main.js` and runs `main.tsx`.  The code calls `acquireVsCodeApi()` and sets up message handling.
2. The webview sends `{ type: 'webviewReady' }` to the host.  The provider responds by sending persisted settings and restoring agents【413743530601376†L0-L0】.
3. If the user clicks “New Agent” in the UI, the webview posts `{ type: 'openClaude' }`.  The provider calls `agentManager.launchNewTerminal()`【413743530601376†L0-L0】.

### 7.3 Spawning or Associating an Agent / Terminal

1. `launchNewTerminal` generates a UUID session ID via `crypto.randomUUID()`.  It calls `vscode.window.createTerminal({ name: 'Claude Agent #n', cwd: workspaceRoot })` and immediately sends the command `claude --session-id <uuid>` (with optional `--dangerously-skip-permissions`) to the terminal’s stdin【413743530601376†L0-L0】.
2. It creates an `AgentState` with empty sets/maps for active tools and waiting flags, associates the transcript file path (constructed elsewhere) and persists agent metadata to `workspaceState`【413743530601376†L0-L0】.
3. It notifies the webview via `webview.postMessage({ type: 'agentCreated', id, folderName })` so that the UI can add a new character【413743530601376†L0-L0】.
4. `agentManager` calls `startFileWatching(id, filePath, fileOffset)` to tail the JSONL transcript once it exists; for restored agents it begins watching as soon as `fs.existsSync(file)` becomes true【413743530601376†L0-L0】.

### 7.4 Detecting Activity from Transcripts

1. `fileWatcher` sets up watchers: `fs.watch` for event‑driven notifications; `fs.watchFile` for stat‑polling; and a manual interval that reads file size differences to catch missed events【413743530601376†L0-L0】.
2. On change, `readNewLines()` reads bytes from the last `agent.fileOffset`, splits on newline boundaries, updates `fileOffset`, and passes complete lines to `transcriptParser`【413743530601376†L0-L0】.
3. When a new transcript file appears (e.g., when the agent starts a new session), the watcher resets offsets and state and begins watching the new file path【413743530601376†L0-L0】.

### 7.5 Translating Activity into Character State Changes

1. For each JSON line, `transcriptParser` parses it with `JSON.parse()`.  It looks for records of `type: 'assistant'` and iterates over `message.content` blocks, each containing tool metadata.  When a block with `id` is found, it emits `agentToolStart` with `id` and `toolId`【413743530601376†L0-L0】.
2. When the parser observes the end of a tool (no further tool blocks or a new assistant message), it schedules a `setTimeout` with `TOOL_DONE_DELAY_MS` (e.g., 500ms) to send `agentToolDone`.  It also clears any nested subagent state and emits `subagentClear`【413743530601376†L0-L0】.
3. If there is no transcript activity for `TEXT_IDLE_DELAY_MS` (e.g., 2000ms), the parser calls `startWaitingTimer()` to mark the agent as waiting; this results in the UI showing a “waiting” animation【413743530601376†L0-L0】.

### 7.6 Rendering/Updating the Office Scene

1. On `agentCreated`, the UI adds a character at a seat (persisted or default).  On `agentToolStart`, it changes the character’s animation to the tool’s associated action (e.g., working, building); on `agentToolDone`, it reverts to idle.  On `subagentClear`, it clears overlays for nested tools【413743530601376†L0-L0】.
2. The office engine’s game loop ticks at a fixed frame rate, updating character positions, animations and overlay timers.  Editor state allows moving seats, adding/removing furniture, and saving the layout【413743530601376†L0-L0】.

### 7.7 Layout Editing, Saving, Importing/Exporting, Restoring

1. When the user edits the layout and clicks Save, the webview sends `{ type: 'saveLayout', layout }`.  The provider calls `layoutWatcher.markOwnWrite()` then writes `layout.json.tmp` and renames to `layout.json`【413743530601376†L0-L0】.
2. On import, the provider opens a file dialog (`vscode.window.showOpenDialog`), reads the selected JSON file, validates it, writes it as the new layout file, and sends `layoutLoaded` to the webview【413743530601376†L0-L0】.
3. On export, it reads the current layout, opens a save dialog (`showSaveDialog`), and writes the layout out; this is used to create a default layout file for distribution【413743530601376†L0-L0】.
4. On startup, the provider loads the layout from the file; if missing or revision‑mismatched, it falls back to the bundled default and writes it out【413743530601376†L0-L0】.  It watches the file for changes and posts `layoutLoaded` to all open webviews on modification【413743530601376†L0-L0】.

### 7.8 Asset Loading and Custom Directories

1. On startup, the provider reads user settings (sound, external asset directories) via `readConfig()` and sends them as part of `settingsLoaded`【413743530601376†L0-L0】.
2. It calls `loadFurnitureAssets()` on the default asset root (`dist/webview/furniture`) and each external directory, merging results via `mergeLoadedAssets()`.  The assets are JSON files produced by the Vite plugin, containing sprites and metadata【413743530601376†L0-L0】.
3. When the user adds or removes an external directory (`addExternalAssetDirectory`/`removeExternalAssetDirectory`), the provider updates the config, reloads furniture assets and sends `externalAssetDirectoriesUpdated`【413743530601376†L0-L0】.

### 7.9 Multi‑Agent Orchestration and Sub‑Agent Flow

Agents are independent: each terminal has its own transcript file and `AgentState`.  `transcriptParser` handles nested tool calls by maintaining maps from tool IDs to names/statuses and emits `subagentClear` events on completion.  There is no dynamic scaling or parent/child agent spawning beyond this; multi‑agent coordination is left to the user【413743530601376†L0-L0】.

### 7.10 Error Handling and Recovery

* **File watch errors** – `fileWatcher` listens for `error` events and logs them; if watchers fail, the manual poller continues reading the file.  Unknown behaviour for persistent failures could be improved【413743530601376†L0-L0】.
* **Transcript parse errors** – `transcriptParser` catches `JSON.parse` errors and ignores malformed lines; it does not send UI updates on parse failure【413743530601376†L0-L0】.
* **External asset failures** – On failing to load an external directory, the provider logs the error and continues.  The UI may show missing assets as blank or default icons.
* **Layout write conflicts** – `layoutWatcher` tracks `mtimeMs` and uses a skip flag to ignore its own writes.  However, concurrent writes across multiple VS&nbsp;Code windows could still cause missed updates and is a known fragile point【413743530601376†L0-L0】.

## 8. State, Persistence, and Data Models

### Extension‑Side State and Source of Truth

1. **In‑memory AgentState (per agent)** – Contains: `id`, `terminal`, `jsonlFile`, `fileOffset`, `activeToolIds`, `activeToolStatuses`, `activeToolNames`, `waitingTimeout`, `permissionFlags` and other fields.  This is not serialised; it is reconstructed on restore【413743530601376†L0-L0】.
2. **Workspace State** – Persists a list of agents with minimal metadata: `id`, `terminalName`, `jsonlFile`, `projectDir`, `folderName`.  Used to reattach live terminals after reload.  Seat assignments are stored separately in `workspaceState` under a different key to avoid being overwritten【413743530601376†L0-L0】.
3. **Global State** – Stores `soundEnabled` and may store other user settings.  This state survives across workspaces.
4. **Layout File** – Located at `~/.pixel-agents/layout.json`.  Contains `revision`, grid dimensions, list of seats with positions and assignments, list of furniture placements and metadata.  This is considered the canonical office layout and is watched for external modifications【413743530601376†L0-L0】.
5. **Config File** – (Unknown) Likely at `~/.pixel-agents/config.json`.  Stores `externalAssetDirectories` and `soundEnabled`.  Implementation details were not observed but can be deduced from calls【413743530601376†L0-L0】.

### Webview‑Side State

1. **Office State** – A store (probably a React hook or a plain object) representing the current positions and animations of all characters, furniture, floor grid, etc.  Maintained by the office engine’s game loop.
2. **Editor State** – Tracks selected item, drag state, editing mode, and unsaved layout changes.  Lives outside the simulation state to allow modifications without interfering with live animations.
3. **Message Queue / Bridge** – `useExtensionMessages` holds last known settings, layout, and agent statuses.  It applies extension events to local stores and posts user actions back to the extension.

### Data Models / Message Payloads

The extension and webview communicate via JSON objects with a `type` field.  Key payloads include:

| Message Type | Direction | Payload Fields |
|---|---|---|
| `agentCreated` | Host→Webview | `{ id: number, folderName: string }` |
| `agentToolStart` | Host→Webview | `{ id: number, toolId: string, status: string }` |
| `agentToolDone` | Host→Webview | `{ id: number, toolId: string }` |
| `subagentClear` | Host→Webview | `{ id: number }` |
| `settingsLoaded` | Host→Webview | `{ soundEnabled: boolean, externalAssetDirectories: string[] }` |
| `layoutLoaded` | Host→Webview | `{ layout: Layout }` |
| `externalAssetDirectoriesUpdated` | Host→Webview | `{ dirs: string[] }` |
| `openClaude` | Webview→Host | `{ projectDir?: string }` |
| `focusAgent` | Webview→Host | `{ id: number }` |
| `closeAgent` | Webview→Host | `{ id: number }` |
| `saveLayout` | Webview→Host | `{ layout: Layout }` |
| `saveAgentSeats` | Webview→Host | `{ agentSeats: Record<number, SeatId> }` |
| `exportLayout` | Webview→Host | `{}` |
| `importLayout` | Webview→Host | `{}` |
| `addExternalAssetDirectory` | Webview→Host | `{ dir: string }` |
| `removeExternalAssetDirectory` | Webview→Host | `{ dir: string }` |
| `openSessionsFolder` | Webview→Host | `{}` |

### Fragile Synchronisation Points

* **Terminal Identification** – Persisting `terminalName` to match live terminals can break if the user renames terminals or VS&nbsp;Code changes naming semantics【413743530601376†L0-L0】.
* **File Watching** – `fs.watch` can miss events; the fallback polling ensures eventual consistency but introduces delay and complexity【413743530601376†L0-L0】.
* **Layout Cross‑window** – Only a single `skipNextChange` flag prevents loops; concurrent writes from multiple windows may still conflict【413743530601376†L0-L0】.
* **Heuristic Timers** – Idle and tool‑done detection rely on timeouts; long‑running tools or frequent output can cause misclassification【413743530601376†L0-L0】.

## 9. Build, Packaging, and Developer Workflow

### Build and Packaging

* **Extension Build (`esbuild.js`)** – Bundles TypeScript sources in `src/` into `dist/extension.js` using esbuild.  Configures watch mode and minification for production.  The compiled file becomes the `main` entry in the extension manifest【413743530601376†L0-L0】.
* **Webview Build (`webview-ui/vite.config.ts`)** – Uses Vite to bundle the React app into `dist/webview/`.  Includes a custom plugin (`@pixel-agents/assets`) that decodes PNG sprite sheets into JSON and provides an API endpoint for the browser‑mode editor【413743530601376†L0-L0】.
* **Packaging** – A `.vscodeignore` file excludes source directories from the VSIX, packaging only `dist/` output.  The root `package.json` defines a `package` script that runs `npm run build` and `vsce package` to produce the VSIX【413743530601376†L0-L0】.

### Developer Workflow

* **Running Locally** – `npm run watch` at repo root builds the extension and webview in watch mode.  Use `F5` in VS Code to launch the Extension Development Host and open the Pixel Agents view.  The webview can also run in a standalone browser via `npm run dev` in `webview-ui`【413743530601376†L0-L0】.
* **Testing** – The webview has minimal tests run via Node’s test runner.  The extension has no unit tests; manual testing is required for transcript parsing and file watching.
* **CI** – GitHub Actions install dependencies, run lint/format/type check tasks and build both extension and webview.  Many CI steps are `continue-on-error`, emphasising quick feedback rather than strict enforcement【413743530601376†L0-L0】.
* **Publishing** – The `publish` workflow packages the compiled extension and publishes to the Visual&nbsp;Studio Marketplace and Open&nbsp;VSX using `HaaLeo/publish-vscode-extension`【413743530601376†L0-L0】.

### Platform Assumptions & Limitations

* **Host OS** – Relies on Node’s file watching semantics; on macOS and some Linux filesystems, `fs.watch` events can be coalesced or dropped, which the code mitigates via polling【413743530601376†L0-L0】.
* **CLI Availability** – Requires `claude` binary on `PATH`.  The CLI invocation is synchronous; if the CLI is missing or named differently, agent creation fails.
* **Browser Mode** – Standalone UI mode uses dynamic import and a mocked extension API.  Asset plugin fetches decode‑metadata via HTTP; this is configured via Vite and not available when embedded in VS Code.

## 10. Claimed Design vs Implemented Design

The repository claims to be a general “Pixel Agents” extension with possible support for multiple agent backends.  In practice, the implemented design is highly Claude‑specific.  For instance:

* The **agent creation** command uses `claude --session-id` and includes a `--dangerously-skip-permissions` flag; there is no abstraction to switch to another CLI【413743530601376†L0-L0】.
* **Transcript parsing** expects specific JSON structure: records with `type: 'assistant'` and blocks containing `id` and `tool` metadata【413743530601376†L0-L0】.
* **Waiting behaviour** uses heuristics based on absence of transcript events and lists of “permission‑exempt tools”; this couples the extension to Claude’s tool semantics【413743530601376†L0-L0】.

Nevertheless, the UI is largely decoupled from Claude; as long as the host posts the same messages, the React/canvas engine will render animations appropriately.  The design splits strongly along the extension–webview boundary, and the webview can run in a browser without any Claude dependencies【413743530601376†L0-L0】.

## 11. Claude‑Specific vs Agent‑Agnostic Assessment

### Claude‑Specific Components

* **Session Command** – The command `claude --session-id` is hard‑coded in `agentManager.ts`, together with optional flags.  Changing this to support Codex or other models requires rewriting the command invocation and adjusting environment variables【413743530601376†L0-L0】.
* **Transcript Format** – `transcriptParser.ts` expects messages from Claude’s JSONL transcripts.  Another backend would require rewriting the parser to map new events into `agentToolStart/Done` semantics【413743530601376†L0-L0】.
* **Permission & Waiting Logic** – Uses heuristics tuned to Claude’s behaviour (e.g., times when Claude awaits user approval) and special lists of “permission‑exempt tools”【413743530601376†L0-L0】.

### Agent‑Agnostic Components

* **UI and Office Engine** – The webview is generic; characters and tools are represented generically as events.  As long as the host emits the same message schema (`agentToolStart`, etc.), the UI remains unchanged【413743530601376†L0-L0】.
* **Layout Persistence and Editor** – Operate entirely on a generic layout format and do not embed Claude semantics【413743530601376†L0-L0】.
* **Asset Loader** – Can load any furniture/character sprite, including user‑added packs, independent of agent type【413743530601376†L0-L0】.

### Assessment

The current architecture is not agent‑agnostic in the host; it is strongly coupled to Claude.  To support other backends like Codex, a provider abstraction is required to decouple session creation, transcript parsing and permission logic.  The UI and message protocol provide a good foundation for reuse across backends【413743530601376†L0-L0】.

## 12. Codex Portability Assessment

### What Must Change

1. **Abstract Session Manager** – Replace the direct `claude` CLI invocation with a pluggable provider interface.  The interface should define methods for `createSession`, `restoreSessions`, `disposeSession`, and `subscribeEvents`.  `agentManager` would call this interface rather than spawning a CLI directly.
2. **Event Parser** – Rewrite or extend `transcriptParser.ts` to handle Codex’s tool call and completion events.  For example, Codex may emit events via a websocket or API, not a JSONL file, requiring asynchronous streams rather than file watching.
3. **Permission & Waiting Logic** – Codex might not require the same permission heuristics; waiting could be signalled explicitly by the API.  The host should treat waiting as a first‑class event rather than inferring from silence.
4. **Terminal Integration** – If Codex sessions run outside VS Code terminals (e.g., via API), the agent/character mapping must decouple from terminals.  Agents could be conceptual rather than tied to a VS Code terminal.
5. **Config Options** – Expose a configuration for selecting the backend (Claude, Codex, etc.) and per‑backend settings (API keys, CLI paths).

### Opportunities

* The webview and layout engine can largely remain unchanged.  The message schema used by the UI is simple and can represent generic tool start/done/waiting states【413743530601376†L0-L0】.
* By introducing a provider abstraction and event translation layer, the project could support multiple backends simultaneously, enabling side‑by‑side visualisation of different LLM systems.

### Challenges

* Codex may deliver tool events in fundamentally different structures (e.g., streaming JSON via SSE).  Adapting `fileWatcher` to network streams could require rewriting significant parts of the host.
* CLI‑less backends remove the neat mapping of one terminal per agent; alternative UI actions (e.g., focusing an API session) would need new semantics.

## 13. Technical Debt, Risks, and Fragile Areas

### Key Risks

1. **Terminal Name Binding** – Using `terminalName` as the key for restoration may break when terminals are renamed or reused【413743530601376†L0-L0】.  A more robust identifier (e.g., `terminal.creationOptions.cwd` + sequence) could improve reliability.
2. **File Watching Complexity** – The layered watch/poll logic is complex; subtle bugs may arise on edge cases (network shares, high‑IO workloads).  Unit tests and instrumentation would help.
3. **Heuristic Timers** – Idle/waiting detection and tool‑completion delays are arbitrary constants.  They may misclassify long‑running tasks or high‑frequency outputs.  Exposing these as settings or listening to explicit events could reduce fragility【413743530601376†L0-L0】.
4. **Docs vs Code Drift** – Scripts referenced in docs (`import-tileset-cli.ts`) are missing.  If left unfixed, future contributors will waste time chasing non‑existent tooling【413743530601376†L0-L0】.
5. **No Unit Tests on Host** – The core logic (file watching, parsing, persistence) lacks automated tests, increasing the risk of regressions and complicating refactoring efforts.

### Technical Debt

* **Incomplete Abstractions** – The host lacks an abstraction layer for different agent backends; everything is coupled to Claude’s CLI and transcript schema.
* **Missing Config Implementation** – `readConfig`/`writeConfig` are called but not found; this indicates incomplete or hidden code and impedes extension configuration【413743530601376†L0-L0】.
* **CI Non‑blocking** – CI uses `continue-on-error` for build steps.  Errors may slip through unnoticed, leading to broken releases【413743530601376†L0-L0】.
* **Testing Gaps** – No automated tests for file watch/tracing; manual verification is labour intensive.

## 14. Change Hotspots and Safe Entry Points

| Area | Safe Entry Points | Reason / Advice |
|---|---|---|
| **UI Enhancements** | Modify `webview-ui/src` components, add new React components or styles, extend editor logic.  Avoid changing message types without parallel host changes. | UI is decoupled; as long as the message contract is respected, adding features like new overlays, sound effects or UI panels is low‑risk. |
| **Layout Format** | Extend `layoutPersistence.ts` to handle new fields, bump `revision` and provide migration.  Update default layout JSON. | The layout is versioned; adding optional fields with defaults minimises breakage. |
| **Asset Packs** | Add new assets under `webview-ui/public/furniture` or support additional external directories via config.  Update the asset merge logic if new categories are introduced. | Asset loading is modular; new packs require only metadata JSON and sprite images. |
| **Build/CI** | Update `esbuild.js` or `vite.config.ts` to tune bundling, add sourcemaps, or integrate test frameworks. | Build scripts are isolated; modifications here seldom affect runtime. |
| **Settings** | Implement the missing `readConfig`/`writeConfig` functions to manage `config.json`.  Add new settings (e.g., `idleTimeoutMs`) by reading/writing the config and sending them via `settingsLoaded`. | Extending config is incremental and low risk but must update UI to consume new fields. |

### Dangerous Areas (High Blast Radius)

* **`agentManager.ts`** – Changing terminal/spawn logic or persisted schema can break agent restoration and state tracking.
* **`fileWatcher.ts` / `transcriptParser.ts`** – Modifying watch semantics or parse heuristics can cause lost events or incorrect animations across all agents.
* **Message Contract** – Altering the names or shapes of messages without synchronising UI and host code will break communication.
* **Layout Watcher** – Changes to skip logic or mtime handling may introduce infinite reload loops or lost updates.

## 15. Debugging Playbook

### Common Failure Modes and Diagnostics

1. **Agents Do Not Appear / Animate**
   - **Check**: Does `agentManager` call `webview.postMessage({ type: 'agentCreated' })`?  Is the `webview` ready?  Inspect logs for transcript parser errors.
   - **Files to Inspect**: `PixelAgentsViewProvider.ts` for `webview.postMessage`; `agentManager.ts` for `launchNewTerminal`; `fileWatcher.ts` for reading new lines; `transcriptParser.ts` for parse errors.
   - **Commands**: Run the extension in dev mode, open the panel, start an agent, and monitor the console (developer tools) for messages.

2. **Agents Not Restoring After Reload**
   - **Check**: Is `workspaceState` storing the agent list with correct `terminalName` and `jsonlFile`?  Do the terminals still exist?  Are session IDs consistent?
   - **Files to Inspect**: `agentManager.ts` (`persistAgents`, `restoreAgents`), `PixelAgentsViewProvider.ts` (`restoreAgents` call), `layoutPersistence.ts` if seat assignments mismatch.
   - **Commands**: Reload window, list terminals, open the Pixel Agents view.

3. **Layout Not Saving or Conflicting Across Windows**
   - **Check**: Does `layoutPersistence.ts` write a `.tmp` file?  Does `skipNextChange` prevent loops?  Are external tools modifying the layout file?
   - **Files to Inspect**: `layoutPersistence.ts`, cross‑window watchers; `PixelAgentsViewProvider.ts` for `saveLayout` handling.
   - **Commands**: Modify the layout in one window, save, switch to another window and observe update; inspect layout file timestamp.

4. **External Assets Missing**
   - **Check**: Is the directory path correct?  Does `loadFurnitureAssets()` return any items?  Are there console errors in the webview?
   - **Files to Inspect**: `PixelAgentsViewProvider.ts` (asset directory loading and merging), `shared/assets/plugin.ts` (decoding), `webview-ui/src/hooks/useExtensionMessages.ts` (settings dispatch).
   - **Commands**: Add an external directory, reload the view, open devtools network tab to see if assets are fetched.

### Validation After Changes

* **Run `npm run package`** – Ensure build and packaging succeed.
* **Launch Extension Development Host** – Use F5 in VS Code and verify that the panel shows, agents spawn, and tool events animate correctly.
* **Test Layout Import/Export** – Use UI buttons to export and import a layout; confirm file contents match expectations.
* **Check Config Persistence** – Change settings (sound toggle, external directories), reload VS Code and confirm persistence.

## 16. Agent Mode Working Notes

### 10 Files to Read First (in order)

1. `src/PixelAgentsViewProvider.ts` – Primary message hub and panel lifecycle.
2. `src/extension.ts` – Activation and command registration.
3. `src/agentManager.ts` – Terminal spawn/restore and state management.
4. `src/fileWatcher.ts` – Tailing transcripts reliably.
5. `src/transcriptParser.ts` – Mapping transcript lines to tool events and waiting logic.
6. `src/layoutPersistence.ts` – Layout file I/O and migration.
7. `webview-ui/src/main.tsx` & `webview-ui/src/App.tsx` – Bootstrapping and UI composition.
8. `webview-ui/src/hooks/useExtensionMessages.ts` – Message bridge between extension and UI.
9. `webview-ui/vite.config.ts` – Asset plugin and build configuration.
10. `docs/CLAUDE.md` & README – Understand intended workflows and design notes.

### 5 Likely Debugging Hotspots

1. Transcript tailing and parsing chain: `fileWatcher` → `transcriptParser` → `webview.postMessage`.
2. Agent restoration and terminal mapping: `agentManager.persistAgents` and `restoreAgents`.
3. Layout file synchronisation: `layoutPersistence.watchLayoutFile` and skip logic.
4. Asset loading and merging: `PixelAgentsViewProvider.reloadAndSendFurniture` and `shared/assets/plugin.ts`.
5. Webview message handling: `useExtensionMessages` and UI state updates.

### 5 Likely Refactor Opportunities

1. Introduce a **provider abstraction** for agent backends.  Decouple `agentManager` from the Claude CLI and allow plugging in Codex or other APIs.
2. Extract a **shared types module** defining message payload interfaces used by both host and webview to prevent drift and enable type safety.
3. Consolidate file watching and parsing into a more testable component with dependency injection for watchers.
4. Implement a **config service** with explicit schema and default values, replacing the unknown `readConfig`/`writeConfig` functions.
5. Add **unit and integration tests** for `transcriptParser`, `fileWatcher` and `layoutPersistence` to catch regressions.

### 5 Recommended First Tasks for a Coding Agent

1. **Locate and implement `readConfig`/`writeConfig`** – Ensure the extension can persist settings and external asset directories correctly.
2. **Add logging and error reporting** to `fileWatcher` and `transcriptParser` to aid debugging (e.g., log dropped lines, watcher restarts).
3. **Refactor `agentManager` to use a provider interface**, preparing for Codex integration.
4. **Write unit tests** for transcript parsing edge cases (nested tool calls, malformed JSON, long idle periods).
5. **Fix docs/scripts drift** – Remove references to missing scripts or reintroduce the asset import CLI.  Update documentation to reflect current code.

### Invariants to Preserve

* The message protocol (`agentToolStart`, `agentToolDone`, etc.) must remain stable or versioned; the UI depends on these events.
* The layout file is the canonical source of truth; atomic write (tmp + rename) semantics should be maintained to avoid corruption.
* File watching should always layer event‑based and polling approaches to handle OS differences.
* Idle/waiting detection must not produce false positives for long‑running tools; maintain or expose timers as settings.
* Agent IDs and seat assignments must be unique and persisted; do not reuse IDs across sessions.

### Mental Model of the System

Visualise Pixel Agents as a two‑process system: the **host** manages terminals and file watchers, translating agent activity into messages; the **webview** renders a virtual office and responds to those messages.  Agent state lives in the host; layout and seat assignments live both in the host (persisted file) and webview (editing).  The host writes to disk and posts messages; the webview listens and renders.  The contract between them is a set of message types.  Changing this contract is expensive; extending it is possible but requires coordination.

## 17. Appendix: Critical Files in Read Order

Below is a concise list of files to inspect in order to build an in‑depth understanding.  Some items were not accessible in the research; these should be fetched from the repository for completeness.

1. **`src/extension.ts`** – Extension entry point and command registration.
2. **`src/PixelAgentsViewProvider.ts`** – View provider and message routing; HTML generation for webview.
3. **`src/agentManager.ts`** – Terminal creation, session restoration, agent state persistence.
4. **`src/fileWatcher.ts`** – Robust file tailing across platforms.
5. **`src/transcriptParser.ts`** – Parsing JSONL transcripts into tool events; idle/wait logic.
6. **`src/layoutPersistence.ts`** – Layout file read/write, migration, cross‑window sync.
7. **`src/configPersistence.ts`** (Missing) – Implementation of `readConfig`/`writeConfig` if present.
8. **`webview-ui/src/main.tsx`** – Bootstrapping the React app.
9. **`webview-ui/src/App.tsx`** – Root component connecting office engine, editor and message hook.
10. **`webview-ui/src/hooks/useExtensionMessages.ts`** – Bridge for host ↔ UI messages.
11. **`webview-ui/office/engine/`** – Game loop (`gameLoop.ts`), office state (`officeState.ts`), renderer (`renderer.ts`).
12. **`webview-ui/office/editor/`** – Layout editing logic and seat management.
13. **`shared/assets/plugin.ts`** – Vite plugin for decoding and serving sprite metadata.
14. **`webview-ui/vite.config.ts`** – Config for UI build and asset plugin integration.
15. **`docs/CLAUDE.md` & `docs/README.md`** – Descriptions of intended flows, layout editing, and design notes.

### Unknowns / To Investigate Further

* The actual code for `readConfig` and `writeConfig` to understand config persistence (external assets, sound, etc.).
* The implementation of the office engine modules (`gameLoop.ts`, `officeState.ts`, `renderer.ts`) and how they map message events to animations.
* How `projectDir` is determined for new agents and where transcripts live on disk.  Understanding this mapping is essential for multi‑workspace support.
* Whether the webview has a dirty/unsaved layout state and how it resolves conflicts when external layout changes are detected.
* The severity of cross‑window write conflicts and whether the `skipNextChange` strategy is sufficient for concurrency.

---

This report combines file‑level evidence from the repository with operational reasoning to provide a code‑first, operator‑oriented understanding.  It aims to accelerate future development, debugging and adaptation, particularly when integrating new agent backends or extending the UI.