# Agent Office — Project Brief for LLMs

## 1. Project objective

This project is building **Agent Office**, a VS Code extension and visual workspace for terminal-based coding agents.

The end goal is to take the ideas and useful UI/system structure from the **Pixel Agents** repository and adapt them into a new project focused on **Codex CLI / Codex agent workflows**, rather than Claude Code.

The main aim is:

- create a working **Agent Office** product inside VS Code
- keep the strong parts of the original project
- remove unnecessary Claude-specific coupling
- introduce a safer architecture for future backend support
- eventually support **Codex CLI** as the primary backend

In plain terms:

> Build **Agent Office** as a visual office/workspace for coding agents, with a long-term focus on making it work well for **Codex**.

---

## 2. Repository and naming decisions

### Repository
GitHub repository:
- `https://github.com/DebisLimbuHub/Agent-Office`

### Product name
Chosen name:
- **Agent Office**

Reasoning:
- clear and descriptive
- backend-neutral
- better long-term than baking Claude or Codex into the brand
- suitable for a real VS Code tool/product

Recommended branding direction:
- **Brand:** Agent Office
- **Tagline:** Visual workspace for terminal coding agents

---

## 3. Source project being adapted

The source inspiration/base is the GitHub repository:

- `https://github.com/pablodelucca/pixel-agents`

This repo was analysed in depth and retained as project context.

### Important conclusion from the repo analysis

Pixel Agents is a strong starting point, but it is **not** a drop-in Codex solution.

The important split is:

- the **webview/UI layer** is the more reusable part
- the **extension host/backend layer** is still heavily Claude-specific

That means the correct path is:

- reuse as much of the **UI, office rendering, layout tooling and message-driven UX** as possible
- replace or abstract the **Claude-specific host-side backend logic**
- move toward a backend/provider abstraction
- later implement a real **Codex backend/provider**

---

## 4. What Agent Office is trying to become

Agent Office should become a VS Code extension where:

- coding agents appear visually inside an office/workspace UI
- each agent has a visible state
- agent activity is easy to observe
- the user can manage agents from a visual layer
- layouts, seats and assets can be edited/persisted
- the backend can eventually support Codex cleanly

Desired long-term identity:

- a visual workspace
- a control panel for terminal coding agents
- a multi-agent observability and management layer
- initially VS Code-focused
- ultimately Codex-friendly

---

## 5. High-level architecture the project is built around

The inherited architecture from Pixel Agents is:

### Extension host
This side owns:
- VS Code activation
- terminal/session lifecycle
- transcript/event observation
- parsing and state derivation
- layout/settings persistence
- webview lifecycle
- host↔webview message routing

### Webview UI
This side owns:
- React UI
- office/canvas rendering
- visual state updates
- editor/layout tooling
- UI overlays/toolbars
- browser-mode support for UI development

### Key principle
Preserve this split.

The webview should remain the visual layer.

The extension host should remain the orchestration/backend layer.

---

## 6. Most important repo truths retained from the earlier analysis

These points were established as important project context and should be treated as baseline assumptions:

### The host side is still Claude-specific
Claude-specific coupling currently exists in:
- terminal/session launch
- transcript/event ingestion
- transcript parsing
- waiting/permission heuristics

### The UI is more reusable
The webview/UI side is much more reusable if the message contract is preserved.

### The host↔webview contract is critical
The webview depends on an existing message protocol.
This must not be broken casually.

### The riskiest files are on the host side
Especially:
- `src/PixelAgentsViewProvider.ts`
- `src/agentManager.ts`
- `src/fileWatcher.ts`
- `src/transcriptParser.ts`
- `src/layoutPersistence.ts`

### The safer files are usually on the UI side
Especially:
- `webview-ui/src/App.tsx`
- `webview-ui/src/hooks/useExtensionMessages.ts`
- `webview-ui/src/office/*`
- styling, components, editor UX, visual polish

---

## 7. Key project goal for future LLMs

Any LLM helping on this project should understand that the goal is **not** just to study Pixel Agents.

The goal is to:

1. understand Pixel Agents deeply
2. preserve the best parts
3. rebrand and stabilise the fork as **Agent Office**
4. prepare the architecture for backend abstraction
5. eventually make **Agent Office work well with Codex**

This should be treated as a staged engineering transformation, not a cosmetic fork.

---

## 8. Strategic direction

### Immediate direction
Use Pixel Agents as the working base.
Get Agent Office running in VS Code.
Stabilise setup, naming and understanding.

### Medium-term direction
Remove Claude branding and Claude coupling at the edges without breaking the existing runtime.

### Structural direction
Introduce a backend/provider abstraction in the extension host.

### Long-term direction
Implement a real Codex-oriented backend/provider while preserving the office UI and visual workflow.

---

## 9. Recommended implementation phases

These are the project phases that have already been reasoned about in this chat.

### Phase 0 — Workspace setup
Goal:
- get the repo running in VS Code
- install dependencies
- verify build/watch/package flow
- launch the Extension Development Host
- confirm panel/webview renders

### Phase A — Safe rebrand
Goal:
- rebrand visible surfaces from Pixel Agents to Agent Office
- do not break runtime behaviour
- do not rename protocol/event names casually

### Phase B — Remove Claude branding/coupling at the edges
Goal:
- remove Claude-specific user-facing labels
- neutralise docs/comments where safe
- do not yet rewrite backend logic

### Phase C — Introduce backend abstraction
Goal:
- create a backend/provider abstraction layer in the extension host
- move Claude implementation behind that abstraction
- keep current behaviour working
- prepare the codebase for Codex

### Phase D — Codex support
Goal:
- implement a real Codex provider/backend
- map Codex lifecycle and activity into the existing UI semantics
- keep the office/webview experience intact

---

## 10. What should be reused vs replaced

### Reuse if possible
- webview UI structure
- office rendering system
- layout editor
- layout persistence approach
- asset system, if still valid
- message-driven UI model
- browser-mode support, if useful

### Replace or isolate
- Claude-specific terminal launch logic
- Claude-specific transcript file assumptions
- Claude transcript parsing
- Claude-oriented waiting/permission heuristics
- any host logic that assumes Claude is the only backend

---

## 11. Core invariants that should not be broken

Any LLM working on this project should preserve these unless there is a very good reason and a safe migration path:

- keep the **host/webview split**
- keep the **host↔webview contract stable** unless changes are additive and coordinated
- keep **layout persistence** working
- keep **import/export/save/load** layout behaviour working
- keep **browser-mode UI development** working if it currently exists
- preserve **extension activation and panel boot**
- preserve **webview rendering**
- avoid speculative refactors with unclear payoff
- prefer minimal, reviewable, low-risk changes

---

## 12. High-risk areas

These areas have the highest side-effect risk:

### `src/PixelAgentsViewProvider.ts`
Why risky:
- central message hub
- coordinates host↔webview behaviour
- layout/settings/asset wiring passes through here

### `src/agentManager.ts`
Why risky:
- terminal/session lifecycle
- persistence and restore
- CLI/backend launch
- agent identity

### `src/fileWatcher.ts`
Why risky:
- transcript/event observation reliability
- file offsets
- watcher recovery
- subtle event loss bugs

### `src/transcriptParser.ts`
Why risky:
- activity semantics
- waiting/tool-done timing
- backend-specific assumptions
- UI state derived from parser events

### `src/layoutPersistence.ts`
Why risky:
- canonical layout file
- cross-window sync
- write behaviour and migrations

### `webview-ui/src/hooks/useExtensionMessages.ts`
Why risky:
- UI contract boundary
- if host payloads drift, this breaks silently

---

## 13. Safer areas for contained changes

These are generally the safer areas to improve first:

- UI branding
- user-facing labels
- docs
- toolbar polish
- layout editor ergonomics
- presentational components
- browser mock improvements
- asset-tooling clarity
- comments and typing improvements
- small guardrails and error handling

---

## 14. File reading order for future LLMs

If an LLM needs to ramp up quickly, read in roughly this order:

1. `package.json`
2. `src/extension.ts`
3. `src/PixelAgentsViewProvider.ts`
4. `src/agentManager.ts`
5. `src/fileWatcher.ts`
6. `src/transcriptParser.ts`
7. `src/layoutPersistence.ts`
8. `webview-ui/src/main.tsx`
9. `webview-ui/src/App.tsx`
10. `webview-ui/src/hooks/useExtensionMessages.ts`
11. `webview-ui/src/office/engine/*`
12. `webview-ui/src/office/layout/*`
13. `webview-ui/src/office/editor/*`
14. `webview-ui/src/office/components/*`
15. `webview-ui/src/office/sprites/*`
16. `shared/assets/plugin.ts`
17. `webview-ui/vite.config.ts`
18. `README.md`
19. `docs/*`
20. `.github/workflows/*`

---

## 15. Working style expected from future LLMs

When helping on this project, the LLM should act like:

- a repo operator
- a careful extension engineer
- a systems-aware modifier
- a low-risk implementation assistant

It should **not** behave like:
- a shallow summariser
- a speculative refactor bot
- a documentation-only bot
- a “rename everything” bot

Preferred behaviour:
- inspect first
- map flows before changing them
- preserve behaviour
- prefer small diffs
- separate verified facts from assumptions
- explicitly call out risks and unknowns
- use checklists and validation steps
- treat build/dev/test results seriously

---

## 16. Expected Codex-related end state

The eventual desired state is:

- Agent Office works in VS Code
- Agent Office is no longer structurally locked to Claude
- the extension host uses a backend/provider abstraction
- the UI remains stable and reusable
- Codex can be supported without rewriting the whole repo
- activity from Codex can be translated into office/agent visual state
- the product feels like a genuine Codex-friendly agent workspace

This is the long-term north star.

---

## 17. Practical summary in one paragraph

Agent Office is a fork/adaptation of Pixel Agents. The project goal is to turn it into a VS Code visual workspace for coding agents, with a long-term focus on working well with Codex. The safest path is to preserve the host/webview architecture, reuse the UI and office system, avoid breaking the host↔webview contract, gradually remove Claude-specific surface coupling, then introduce a backend/provider abstraction in the extension host so Codex can be integrated properly later.

---

## 18. Instruction to any future LLM

If you are helping on this project, optimise for the following:

- preserve working behaviour first
- improve clarity and reliability second
- enable backend abstraction third
- implement Codex support cleanly after the architecture is ready

Do not jump straight to “replace Claude with Codex” without respecting the architecture and message boundaries.

Treat this as a real engineering migration, not a search-and-replace job.
