# Agent Office

<h2 align="center" style="padding-bottom: 20px;">
  The game interface where AI agents build real things
</h2>

<div align="center" style="margin-top: 25px;">

[![stars](https://img.shields.io/github/stars/DebisLimbuHub/Agent-Office?logo=github&color=0183ff&style=flat)](https://github.com/DebisLimbuHub/Agent-Office/stargazers)
[![license](https://img.shields.io/github/license/DebisLimbuHub/Agent-Office?color=0183ff&style=flat)](https://github.com/DebisLimbuHub/Agent-Office/blob/main/LICENSE)
[![issues](https://img.shields.io/github/issues/DebisLimbuHub/Agent-Office?color=7057ff)](https://github.com/DebisLimbuHub/Agent-Office/issues)

</div>

<div align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents">VS Code Marketplace</a> • <a href="https://github.com/DebisLimbuHub/Agent-Office/discussions">Discussions</a> • <a href="https://github.com/DebisLimbuHub/Agent-Office/issues">Issues</a> • <a href="CONTRIBUTING.md">Contributing</a> • <a href="CHANGELOG.md">Changelog</a>
</div>

<br/>

Agent Office turns multi-agent AI systems into something you can actually see and manage. Each agent becomes a character in a pixel art office. They walk around, sit at their desk, and visually reflect what they are doing - typing when writing code, reading when searching files, waiting when it needs your attention.

Right now it works as a VS Code extension with built-in Codex CLI and Claude Code backends. Codex is the default built-in path, but the long-term vision is a fully agent-agnostic, platform-agnostic interface for orchestrating any AI agents, deployable anywhere.

This is the source code for the Agent Office VS Code extension. During this first-pass rebrand, the published package identifiers still use the original `pixel-agents` name for compatibility: [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents) and [Open VSX](https://open-vsx.org/extension/pablodelucca/pixel-agents).

![Agent Office screenshot](webview-ui/public/Screenshot.jpg)

## Features

- **One agent, one character** — every agent terminal gets its own animated character
- **Live activity tracking** — characters animate based on what the agent is actually doing (writing, reading, running commands)
- **Office layout editor** — design your office with floors, walls, and furniture using a built-in editor
- **Speech bubbles** — visual indicators when an agent is waiting for input or needs permission
- **Sound notifications** — optional chime when an agent finishes its turn
- **Sub-agent visualization** — nested subtasks can appear as separate characters linked to their parent
- **Persistent layouts** — your office design is saved and shared across VS Code windows
- **External asset directories** — load custom or third-party furniture packs from any folder on your machine
- **Diverse characters** — 6 diverse characters. These are based on the amazing work of [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack).

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Agent Office characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## Requirements

- VS Code 1.105.0 or later
- A supported backend CLI installed and configured

Today, the built-in providers are Codex CLI and Claude Code. Codex is the default built-in backend path in the extension, while the product direction and UI architecture remain intentionally backend-neutral.

## Getting Started

If you just want to use Agent Office, the easiest way is to download the [VS Code extension](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents). If you want to play with the code, develop, or contribute, then:

### Install from GitHub Releases

If you want people to install the extension directly from GitHub instead of cloning the source code, publish a GitHub Release with the packaged `.vsix` file attached. This repository is now set up so every published GitHub Release can attach that `.vsix` automatically.

Users can then:

1. Open the repo's **Releases** page
2. Download the latest `.vsix` asset
3. In VS Code, run **Extensions: Install from VSIX...**
4. Select the downloaded file and reload VS Code

Downloading the repository source code is mainly for development. Normal users should install either from the VS Code Marketplace or from a release `.vsix`.

### Install from source

```bash
git clone https://github.com/DebisLimbuHub/Agent-Office.git
cd Agent-Office
npm install
cd webview-ui && npm install && cd ..
npm run build
```

Then press **F5** in VS Code to launch the Extension Development Host.

For a headless smoke check on Linux, run `npm run smoke:vscode`. It launches an isolated VS Code instance under Xvfb with its own temporary `--user-data-dir`, opens **Agent Office: Show Panel**, captures a screenshot, and only cleans up processes tied to that temporary root.

## Releasing on GitHub

This repository already includes a GitHub Actions workflow at `.github/workflows/publish-extension.yml` that packages the extension, uploads the generated `.vsix` file to the GitHub Release, and optionally publishes to the marketplaces when the required tokens are configured.

To make GitHub downloads work for end users:

1. Bump the version in `package.json`
2. Create and publish a GitHub Release
3. Let the workflow attach the built `.vsix` file to that release

If you also want automatic marketplace publishing:

1. Add the repository secret `VSCE_PAT` for the Visual Studio Marketplace publisher account
2. Add the repository secret `OPEN_VSX_TOKEN` for the Open VSX publisher account

After that, users can install from either the Marketplace link or the GitHub Release asset. You can also run the workflow manually with `dry_run` enabled to build a `.vsix` and download it from the Actions artifact without publishing it anywhere.

### Usage

1. Open the **Agent Office** panel (it appears in the bottom panel area alongside your terminal)
2. Click **+ Agent** to spawn a new agent terminal and its character. Agent Office launches Codex by default; use the backend menu to switch providers. Right-click for the selected backend's bypass-permissions option when available
3. Start working with the agent and watch the character react in real time
4. Click a character to select it, then click a seat to reassign it
5. Click **Layout** to open the office editor and customize your space

## Layout Editor

The built-in editor lets you design your office:

- **Floor** — Full HSB color control
- **Walls** — Auto-tiling walls with color customization
- **Tools** — Select, paint, erase, place, eyedropper, pick
- **Undo/Redo** — 50 levels with Ctrl+Z / Ctrl+Y
- **Export/Import** — Share layouts as JSON files via the Settings modal

The grid is expandable up to 64×64 tiles. Click the ghost border outside the current grid to grow it.

### Office Assets

All office assets (furniture, floors, walls) are now **fully open-source** and included in this repository under `webview-ui/public/assets/`. No external purchases or imports are needed — everything works out of the box.

Each furniture item lives in its own folder under `webview-ui/public/assets/furniture/` with a `manifest.json` that declares its sprites, rotation groups, state groups (on/off), and animation frames. Floor tiles live in `webview-ui/public/assets/floors/`, and wall tile sets live in `webview-ui/public/assets/walls/`. This modular structure makes it easy to add, remove, or modify assets without touching any code.

To add a new furniture item, create a folder in `webview-ui/public/assets/furniture/` with your PNG sprite(s) and a `manifest.json`, then rebuild. The asset manager (`scripts/asset-manager.html`) provides a visual editor for creating and editing manifests.

To use furniture from an external directory, open Settings → **Add Asset Directory**. See [docs/external-assets.md](docs/external-assets.md) for the full manifest format and how to use third-party asset packs.

Characters are based on the amazing work of [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack).

## How It Works

Agent Office watches backend session artifacts and translates them into a small set of visual states: active work, tool activity, waiting, permission prompts, and subtask activity. In the current implementation, the built-in providers derive those signals from backend-specific JSONL session logs, but the office UI itself is driven by backend-neutral messages.

The webview runs a lightweight game loop with canvas rendering, BFS pathfinding, and a character state machine (idle → walk → type/read). Everything is pixel-perfect at integer zoom levels.

## Tech Stack

- **Extension**: TypeScript, VS Code Webview API, esbuild
- **Webview**: React 19, TypeScript, Vite, Canvas 2D

## Known Limitations

- **Agent-terminal sync** — the way agents are connected to terminal instances is not super robust and sometimes desyncs, especially when terminals are rapidly opened/closed or restored across sessions.
- **Heuristic-based status detection** — some backend session formats still do not provide clean signals for when an agent is waiting for user input or when it has finished its turn. The current detection still uses a mix of explicit events and heuristics, so agents may briefly show the wrong status or miss transitions.
- **Windows-only testing** — the extension has only been tested on Windows 11. It may work on macOS or Linux, but there could be unexpected issues with file watching, paths, or terminal behavior on those platforms.

## Where This Is Going

The long-term vision is an interface where managing AI agents feels like playing the Sims, but the results are real things built.

- **Agents as characters** you can see, assign, monitor, and redirect, each with visible roles (designer, coder, writer, reviewer), stats, context usage, and tools.
- **Desks as directories** — drag an agent to a desk to assign it to a project or working directory.
- **An office as a project** — with a Kanban board on the wall where idle agents can pick up tasks autonomously.
- **Deep inspection** — click any agent to see its model, branch, system prompt, and full work history. Interrupt it, chat with it, or redirect it.
- **Token health bars** — rate limits and context windows visualized as in-game stats.
- **Fully customizable** — upload your own character sprites, themes, and office assets. Eventually maybe even move beyond pixel art into 3D or VR.

For this to work, the architecture needs to be modular at every level:

- **Platform-agnostic**: VS Code extension today, Electron app, web app, or any other host environment tomorrow.
- **Agent-agnostic**: Claude and Codex today, but built to support OpenCode, Gemini, Cursor, Copilot, and others through composable adapters.
- **Theme-agnostic**: community-created assets, skins, and themes from any contributor.

We're actively working on the core module and adapter architecture that makes this possible. If you're interested to talk about this further, please visit our [Discussions Section](https://github.com/DebisLimbuHub/Agent-Office/discussions).


## Community & Contributing

Use **[Issues](https://github.com/DebisLimbuHub/Agent-Office/issues)** to report bugs or request features. Join **[Discussions](https://github.com/DebisLimbuHub/Agent-Office/discussions)** for questions and conversations.

See [CONTRIBUTING.md](CONTRIBUTING.md) for instructions on how to contribute.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Supporting the Project

If you find Agent Office useful, consider supporting its development:

<a href="https://github.com/sponsors/pablodelucca">
  <img src="https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?logo=github" alt="GitHub Sponsors">
</a>
<a href="https://ko-fi.com/pablodelucca">
  <img src="https://img.shields.io/badge/Support-Ko--fi-ff5e5b?logo=ko-fi" alt="Ko-fi">
</a>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=DebisLimbuHub/Agent-Office&type=Date)](https://www.star-history.com/?repos=DebisLimbuHub%2FAgent-Office&type=date&legend=bottom-right)

## License

This project is licensed under the [MIT License](LICENSE).
