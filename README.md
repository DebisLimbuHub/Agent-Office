# Agent Office

<h2 align="center" style="padding-bottom: 20px;">
  The game interface where AI agents build real things
</h2>

<div align="center" style="margin-top: 25px;">

[![stars](https://img.shields.io/github/stars/DebisLimbuHub/Agent-Office?logo=github&color=0183ff&style=flat)](https://github.com/DebisLimbuHub/Agent-Office/stargazers)
[![license](https://img.shields.io/github/license/DebisLimbuHub/Agent-Office?color=0183ff&style=flat)](https://github.com/DebisLimbuHub/Agent-Office/blob/main/LICENSE)
[![issues](https://img.shields.io/github/issues/DebisLimbuHub/Agent-Office?color=7057ff)](https://github.com/DebisLimbuHub/Agent-Office/issues)
[![release](https://img.shields.io/github/v/release/DebisLimbuHub/Agent-Office?display_name=tag&color=2ea44f)](https://github.com/DebisLimbuHub/Agent-Office/releases/latest)
[![download latest vsix](https://img.shields.io/badge/Download-Latest%20VSIX-2ea44f?style=flat)](https://github.com/DebisLimbuHub/Agent-Office/releases/latest)

</div>

<div align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents">VS Code Marketplace</a> • <a href="https://github.com/DebisLimbuHub/Agent-Office/releases/latest">Download Latest VSIX</a> • <a href="CONTRIBUTING.md">Contributing</a> • <a href="CHANGELOG.md">Changelog</a>
</div>

<br/>

Agent Office turns multi-agent AI systems into something you can actually see and manage. Each agent becomes a character in a pixel art office. They walk around, sit at their desk, and visually reflect what they are doing - typing when writing code, reading when searching files, waiting when it needs your attention.

Right now it works as a VS Code extension with built-in Codex CLI and Claude Code backends. Codex is the default built-in path, but the long-term vision is a fully agent-agnostic, platform-agnostic interface for orchestrating any AI agents, deployable anywhere.

This is the source code for the Agent Office VS Code extension. Agent Office is a fork and rebrand of the original `pixel-agents` project by Pablo De Lucca. During this first-pass rebrand, the published package identifiers still use the original `pixel-agents` name for compatibility: [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents) and [Open VSX](https://open-vsx.org/extension/pablodelucca/pixel-agents).

![Agent Office screenshot](webview-ui/public/Screenshot.jpg)

## Quick Install

To install directly from GitHub:

1. Click **Download Latest VSIX** above, or open the [latest release](https://github.com/DebisLimbuHub/Agent-Office/releases/latest)
2. Under **Assets**, click the file that ends in `.vsix`, such as `agent-office-v1.1.2.vsix`
3. Do not download `Source code (zip)` or `Source code (tar.gz)` if you want the VS Code extension package
4. In VS Code, open the Command Palette and run **Extensions: Install from VSIX...**
5. Select the downloaded `.vsix` file
6. Reload VS Code when prompted
7. Press `Ctrl+Shift+P` to open the Command Palette
8. Search for **Agent Office: Show Panel** and select it
9. Agent Office will open in the bottom panel area of VS Code

## Requirements

- VS Code 1.105.0 or later
- A supported backend CLI installed and configured

Today, the built-in providers are Codex CLI and Claude Code. Codex is the default built-in backend path in the extension, while the product direction and UI architecture remain intentionally backend-neutral.

## Features

- **One agent, one character** - every agent terminal gets its own animated character
- **Live activity tracking** - characters animate based on what the agent is actually doing
- **Office layout editor** - design your office with floors, walls, and furniture using the built-in editor
- **Speech bubbles** - visual indicators when an agent is waiting for input or needs permission
- **Sound notifications** - optional chime when an agent finishes its turn
- **Sub-agent visualization** - nested subtasks can appear as separate characters linked to their parent
- **Persistent layouts** - your office design is saved and shared across VS Code windows
- **External asset directories** - load custom or third-party furniture packs from any folder on your machine
- **Diverse characters** - six included characters based on [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack)

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Agent Office characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## Getting Started

1. Open the **Agent Office** panel in the bottom panel area of VS Code
2. Click **+ Agent** to spawn a new agent terminal and its character
3. Start working with the agent and watch the character react in real time
4. Click a character to select it, then click a seat to reassign it
5. Click **Layout** to open the office editor and customize your space

Agent Office launches Codex by default. Use the backend menu to switch providers. Right-click for the selected backend's bypass-permissions option when available.

## Customize Your Office

The built-in editor lets you design your office with:

- **Floor colors** - full HSB color control
- **Walls** - auto-tiling walls with color customization
- **Tools** - select, paint, erase, place, eyedropper, and pick
- **Undo and redo** - 50 levels with Ctrl+Z / Ctrl+Y
- **Export and import** - share layouts as JSON files via the Settings modal

The grid is expandable up to 64x64 tiles. Click the ghost border outside the current grid to grow it.

### Office Assets

All office assets (furniture, floors, walls) are open source and included in this repository under `webview-ui/public/assets/`. No external purchases or imports are needed to get started.

Each furniture item lives in its own folder under `webview-ui/public/assets/furniture/` with a `manifest.json` that declares its sprites, rotation groups, state groups, and animation frames. Floor tiles live in `webview-ui/public/assets/floors/`, and wall tile sets live in `webview-ui/public/assets/walls/`.

To use furniture from an external directory, open Settings -> **Add Asset Directory**. See [docs/external-assets.md](docs/external-assets.md) for the full manifest format and how to use third-party asset packs.

Characters are based on the amazing work of [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack).

## Development

If you want to build or contribute to Agent Office from source:

```bash
git clone https://github.com/DebisLimbuHub/Agent-Office.git
cd Agent-Office
npm install
cd webview-ui && npm install && cd ..
npm run build
```

Then press **F5** in VS Code to launch the Extension Development Host.

For a headless smoke check on Linux, run `npm run smoke:vscode`. It launches an isolated VS Code instance under Xvfb with its own temporary `--user-data-dir`, opens **Agent Office: Show Panel**, captures a screenshot, and only cleans up processes tied to that temporary root.

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
