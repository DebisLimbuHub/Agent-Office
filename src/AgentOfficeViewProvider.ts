import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import type { BackendId } from '../shared/protocol/backends.js';
import { DEFAULT_BACKEND_ID, normalizeBackendId } from '../shared/protocol/backends.js';
import {
  loadPersistedAgents,
  persistAgents,
  removeAgent,
  sendExistingAgents,
  sendLayout,
} from './agentManager.js';
import type { LoadedAssets } from './assetLoader.js';
import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadFloorTiles,
  loadFurnitureAssets,
  loadWallTiles,
  mergeLoadedAssets,
  sendAssetsToWebview,
  sendCharacterSpritesToWebview,
  sendFloorTilesToWebview,
  sendWallTilesToWebview,
} from './assetLoader.js';
import {
  cleanupCodexSubagentsForAgent,
  disposeCodexSubagentState,
} from './backends/codex/subagentTracker.js';
import {
  getBackendProvider,
  listBackendDescriptors,
  listBackendProviders,
} from './backends/index.js';
import type { BackendEvent, BackendHostRuntime } from './backends/types.js';
import { readConfig, writeConfig } from './configPersistence.js';
import {
  GLOBAL_KEY_SOUND_ENABLED,
  LAYOUT_REVISION_KEY,
  WORKSPACE_KEY_AGENT_SEATS,
} from './constants.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import { readLayoutFromFile, watchLayoutFile, writeLayoutToFile } from './layoutPersistence.js';
import type { AgentState } from './types.js';

export class AgentOfficeViewProvider implements vscode.WebviewViewProvider {
  nextAgentId = { current: 1 };
  nextTerminalIndex = { current: 1 };
  agents = new Map<number, AgentState>();
  webviewView: vscode.WebviewView | undefined;

  fileWatchers = new Map<number, fs.FSWatcher>();
  pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
  waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  transcriptPollTimers = new Map<number, ReturnType<typeof setInterval>>();
  permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

  activeAgentId = { current: null as number | null };
  knownTranscriptFiles = new Set<string>();
  projectScanTimers = new Map<string, ReturnType<typeof setInterval>>();

  defaultLayout: Record<string, unknown> | null = null;

  private assetsRoot: string | null = null;
  layoutWatcher: LayoutWatcher | null = null;
  private activeTerminalListener: vscode.Disposable | null = null;
  private closeTerminalListener: vscode.Disposable | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  private get extensionUri(): vscode.Uri {
    return this.context.extensionUri;
  }

  private get webview(): vscode.Webview | undefined {
    return this.webviewView?.webview;
  }

  private persistAgents = (): void => {
    persistAgents(this.agents, this.context);
  };

  private get hostRuntime(): BackendHostRuntime {
    return {
      nextAgentIdRef: this.nextAgentId,
      nextTerminalIndexRef: this.nextTerminalIndex,
      activeAgentIdRef: this.activeAgentId,
      projectScanTimers: this.projectScanTimers,
      agents: this.agents,
      knownTranscriptFiles: this.knownTranscriptFiles,
      fileWatchers: this.fileWatchers,
      pollingTimers: this.pollingTimers,
      waitingTimers: this.waitingTimers,
      permissionTimers: this.permissionTimers,
      transcriptPollTimers: this.transcriptPollTimers,
      persistAgents: this.persistAgents,
      emitEvent: this.emitBackendEvent,
    };
  }

  private emitBackendEvent = (event: BackendEvent): void => {
    if (!this.webview) return;

    switch (event.type) {
      case 'sessionCreated':
        this.webview.postMessage({
          type: 'agentCreated',
          id: event.agentId,
          folderName: event.folderName,
        });
        break;
      case 'sessionClosed':
        this.webview.postMessage({ type: 'agentClosed', id: event.agentId });
        break;
      case 'statusChanged':
        this.webview.postMessage({
          type: 'agentStatus',
          id: event.agentId,
          status: event.status,
        });
        break;
      case 'toolStarted':
        this.webview.postMessage({
          type: 'agentToolStart',
          id: event.agentId,
          toolId: event.toolId,
          status: event.status,
        });
        break;
      case 'toolFinished':
        this.webview.postMessage({
          type: 'agentToolDone',
          id: event.agentId,
          toolId: event.toolId,
        });
        break;
      case 'toolsCleared':
        this.webview.postMessage({ type: 'agentToolsClear', id: event.agentId });
        break;
      case 'permissionRequired':
        this.webview.postMessage({ type: 'agentToolPermission', id: event.agentId });
        break;
      case 'permissionCleared':
        this.webview.postMessage({ type: 'agentToolPermissionClear', id: event.agentId });
        break;
      case 'subagentToolStarted':
        this.webview.postMessage({
          type: 'subagentToolStart',
          id: event.agentId,
          parentToolId: event.parentToolId,
          toolId: event.toolId,
          status: event.status,
        });
        break;
      case 'subagentToolFinished':
        this.webview.postMessage({
          type: 'subagentToolDone',
          id: event.agentId,
          parentToolId: event.parentToolId,
          toolId: event.toolId,
        });
        break;
      case 'subagentCleared':
        this.webview.postMessage({
          type: 'subagentClear',
          id: event.agentId,
          parentToolId: event.parentToolId,
        });
        break;
      case 'subagentPermissionRequired':
        this.webview.postMessage({
          type: 'subagentToolPermission',
          id: event.agentId,
          parentToolId: event.parentToolId,
        });
        break;
      case 'subagentPermissionCleared':
        this.webview.postMessage({
          type: 'subagentToolPermissionClear',
          id: event.agentId,
          parentToolId: event.parentToolId,
        });
        break;
    }
  };

  private restorePersistedAgents(): void {
    if (this.agents.size > 0) return;

    const persistedAgents = loadPersistedAgents(this.context);
    for (const provider of listBackendProviders()) {
      const providerAgents = persistedAgents.filter((agent) => agent.backendId === provider.id);
      if (providerAgents.length > 0) {
        provider.restoreSessions(this.hostRuntime, providerAgents);
      }
    }

    this.persistAgents();
  }

  private postBackendCatalog(): void {
    if (!this.webview) return;
    this.webview.postMessage({
      type: 'backendProvidersLoaded',
      backends: listBackendDescriptors(),
      defaultBackendId: DEFAULT_BACKEND_ID,
    });
  }

  private resolveAssetsRoot(): string | null {
    const extensionPath = this.extensionUri.fsPath;
    const candidates = [
      path.join(extensionPath, 'dist'),
      path.join(extensionPath, 'webview-ui', 'public'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(path.join(candidate, 'assets'))) {
        return candidate;
      }
    }

    return null;
  }

  private async initializeAssetsAndLayout(): Promise<void> {
    try {
      this.assetsRoot = this.resolveAssetsRoot();
      this.defaultLayout = this.assetsRoot ? loadDefaultLayout(this.assetsRoot) : null;

      if (this.assetsRoot && this.webview) {
        const characterSprites = await loadCharacterSprites(this.assetsRoot);
        if (characterSprites) {
          sendCharacterSpritesToWebview(this.webview, characterSprites);
        }

        const floorTiles = await loadFloorTiles(this.assetsRoot);
        if (floorTiles) {
          sendFloorTilesToWebview(this.webview, floorTiles);
        }

        const wallTiles = await loadWallTiles(this.assetsRoot);
        if (wallTiles) {
          sendWallTilesToWebview(this.webview, wallTiles);
        }

        const assets = await this.loadAllFurnitureAssets();
        if (assets) {
          sendAssetsToWebview(this.webview, assets);
        }
      }
    } catch (err) {
      console.error('[Extension] ❌ Error loading assets:', err);
    }

    if (this.webview) {
      sendLayout(this.context, this.webview, this.defaultLayout);
      this.startLayoutWatcher();
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'createSession') {
        const backendId = normalizeBackendId(message.backendId);
        const provider = getBackendProvider(backendId);
        if (!provider.isImplemented) {
          vscode.window.showInformationMessage(
            `Agent Office: ${provider.displayName} support is not implemented yet.`,
          );
          return;
        }
        await provider.createSession(this.hostRuntime, {
          folderPath: message.folderPath as string | undefined,
          bypassPermissions: message.bypassPermissions as boolean | undefined,
        });
      } else if (message.type === 'focusAgent') {
        const agent = this.agents.get(message.id);
        if (agent) {
          getBackendProvider(agent.backendId).focusSession(agent);
        }
      } else if (message.type === 'closeAgent') {
        const agent = this.agents.get(message.id);
        if (agent) {
          getBackendProvider(agent.backendId).closeSession(agent);
        }
      } else if (message.type === 'saveAgentSeats') {
        console.log(`[Agent Office] saveAgentSeats:`, JSON.stringify(message.seats));
        this.context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, message.seats);
      } else if (message.type === 'saveLayout') {
        this.layoutWatcher?.markOwnWrite();
        writeLayoutToFile(message.layout as Record<string, unknown>);
      } else if (message.type === 'setSoundEnabled') {
        this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
      } else if (message.type === 'webviewReady') {
        this.restorePersistedAgents();
        this.postBackendCatalog();

        const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
        const config = readConfig();
        this.webview?.postMessage({
          type: 'settingsLoaded',
          soundEnabled,
          externalAssetDirectories: config.externalAssetDirectories,
        });

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 1) {
          this.webview?.postMessage({
            type: 'workspaceFolders',
            folders: workspaceFolders.map((folder) => ({
              name: folder.name,
              path: folder.uri.fsPath,
            })),
          });
        }

        // Start discovery for all implemented providers
        for (const provider of listBackendProviders()) {
          if (provider.isImplemented) {
            provider.startDiscovery(this.hostRuntime);
          }
        }

        void this.initializeAssetsAndLayout();
        sendExistingAgents(this.agents, this.context, this.webview);
      } else if (message.type === 'openSessionsFolder') {
        const focusedAgent =
          this.activeAgentId.current !== null
            ? this.agents.get(this.activeAgentId.current)
            : undefined;
        const fallbackBackendId = focusedAgent?.backendId ?? DEFAULT_BACKEND_ID;
        const backendId: BackendId = focusedAgent
          ? focusedAgent.backendId
          : normalizeBackendId(message.backendId, fallbackBackendId);
        const projectDir = getBackendProvider(backendId).getSessionsDirectory();
        if (projectDir && fs.existsSync(projectDir)) {
          vscode.env.openExternal(vscode.Uri.file(projectDir));
        }
      } else if (message.type === 'exportLayout') {
        const layout = readLayoutFromFile();
        if (!layout) {
          vscode.window.showWarningMessage('Agent Office: No saved layout to export.');
          return;
        }
        const uri = await vscode.window.showSaveDialog({
          filters: { 'JSON Files': ['json'] },
          defaultUri: vscode.Uri.file(path.join(os.homedir(), 'agent-office-layout.json')),
        });
        if (uri) {
          fs.writeFileSync(uri.fsPath, JSON.stringify(layout, null, 2), 'utf-8');
          vscode.window.showInformationMessage('Agent Office: Layout exported successfully.');
        }
      } else if (message.type === 'addExternalAssetDirectory') {
        const uris = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: 'Select Asset Directory',
        });
        if (!uris || uris.length === 0) return;
        const newPath = uris[0].fsPath;
        const config = readConfig();
        if (!config.externalAssetDirectories.includes(newPath)) {
          config.externalAssetDirectories.push(newPath);
          writeConfig(config);
        }
        await this.reloadAndSendFurniture();
        this.webview?.postMessage({
          type: 'externalAssetDirectoriesUpdated',
          dirs: config.externalAssetDirectories,
        });
      } else if (message.type === 'removeExternalAssetDirectory') {
        const config = readConfig();
        config.externalAssetDirectories = config.externalAssetDirectories.filter(
          (dir) => dir !== (message.path as string),
        );
        writeConfig(config);
        await this.reloadAndSendFurniture();
        this.webview?.postMessage({
          type: 'externalAssetDirectoriesUpdated',
          dirs: config.externalAssetDirectories,
        });
      } else if (message.type === 'importLayout') {
        const uris = await vscode.window.showOpenDialog({
          filters: { 'JSON Files': ['json'] },
          canSelectMany: false,
        });
        if (!uris || uris.length === 0) return;
        try {
          const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
          const imported = JSON.parse(raw) as Record<string, unknown>;
          if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
            vscode.window.showErrorMessage('Agent Office: Invalid layout file.');
            return;
          }
          this.layoutWatcher?.markOwnWrite();
          writeLayoutToFile(imported);
          this.webview?.postMessage({ type: 'layoutLoaded', layout: imported });
          vscode.window.showInformationMessage('Agent Office: Layout imported successfully.');
        } catch {
          vscode.window.showErrorMessage('Agent Office: Failed to read or parse layout file.');
        }
      }
    });

    this.ensureWindowListeners();
  }

  exportDefaultLayout(): void {
    const layout = readLayoutFromFile();
    if (!layout) {
      vscode.window.showWarningMessage('Agent Office: No saved layout found.');
      return;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('Agent Office: No workspace folder found.');
      return;
    }
    const assetsDir = path.join(workspaceRoot, 'webview-ui', 'public', 'assets');

    let maxRevision = 0;
    if (fs.existsSync(assetsDir)) {
      for (const file of fs.readdirSync(assetsDir)) {
        const match = /^default-layout-(\d+)\.json$/.exec(file);
        if (match) {
          maxRevision = Math.max(maxRevision, parseInt(match[1], 10));
        }
      }
    }
    const nextRevision = maxRevision + 1;
    layout[LAYOUT_REVISION_KEY] = nextRevision;

    const targetPath = path.join(assetsDir, `default-layout-${nextRevision}.json`);
    const json = JSON.stringify(layout, null, 2);
    fs.writeFileSync(targetPath, json, 'utf-8');
    vscode.window.showInformationMessage(
      `Agent Office: Default layout exported as revision ${nextRevision} to ${targetPath}`,
    );
  }

  private async loadAllFurnitureAssets(): Promise<LoadedAssets | null> {
    if (!this.assetsRoot) return null;
    let assets = await loadFurnitureAssets(this.assetsRoot);
    const config = readConfig();
    for (const extraDir of config.externalAssetDirectories) {
      console.log('[Extension] Loading external assets from:', extraDir);
      const extra = await loadFurnitureAssets(extraDir);
      if (extra) {
        assets = assets ? mergeLoadedAssets(assets, extra) : extra;
      }
    }
    return assets;
  }

  private async reloadAndSendFurniture(): Promise<void> {
    if (!this.assetsRoot || !this.webview) return;
    try {
      const assets = await this.loadAllFurnitureAssets();
      if (assets) {
        sendAssetsToWebview(this.webview, assets);
      }
    } catch (err) {
      console.error('[Extension] Error reloading furniture assets:', err);
    }
  }

  private startLayoutWatcher(): void {
    if (this.layoutWatcher) return;
    this.layoutWatcher = watchLayoutFile((layout) => {
      console.log('[Agent Office] External layout change — pushing to webview');
      this.webview?.postMessage({ type: 'layoutLoaded', layout });
    });
  }

  private ensureWindowListeners(): void {
    if (!this.activeTerminalListener) {
      this.activeTerminalListener = vscode.window.onDidChangeActiveTerminal((terminal) => {
        this.activeAgentId.current = null;
        if (!terminal) return;
        for (const [id, agent] of this.agents) {
          if (agent.terminalRef === terminal) {
            this.activeAgentId.current = id;
            this.webview?.postMessage({ type: 'agentSelected', id });
            break;
          }
        }
      });
    }

    if (!this.closeTerminalListener) {
      this.closeTerminalListener = vscode.window.onDidCloseTerminal((closedTerminal) => {
        for (const [id, agent] of this.agents) {
          if (agent.terminalRef === closedTerminal) {
            if (this.activeAgentId.current === id) {
              this.activeAgentId.current = null;
            }
            if (agent.backendId === 'codex') {
              cleanupCodexSubagentsForAgent(id, this.emitBackendEvent);
            }
            removeAgent(
              id,
              this.agents,
              this.fileWatchers,
              this.pollingTimers,
              this.waitingTimers,
              this.permissionTimers,
              this.transcriptPollTimers,
              this.persistAgents,
            );
            this.emitBackendEvent({ type: 'sessionClosed', agentId: id });
          }
        }
      });
    }
  }

  dispose(): void {
    this.layoutWatcher?.dispose();
    this.layoutWatcher = null;
    this.activeTerminalListener?.dispose();
    this.activeTerminalListener = null;
    this.closeTerminalListener?.dispose();
    this.closeTerminalListener = null;
    disposeCodexSubagentState(this.emitBackendEvent);
    for (const id of [...this.agents.keys()]) {
      removeAgent(
        id,
        this.agents,
        this.fileWatchers,
        this.pollingTimers,
        this.waitingTimers,
        this.permissionTimers,
        this.transcriptPollTimers,
        this.persistAgents,
      );
    }
    for (const timer of this.projectScanTimers.values()) {
      clearInterval(timer);
    }
    this.projectScanTimers.clear();
  }
}

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

  let html = fs.readFileSync(indexPath, 'utf-8');

  html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
    const fileUri = vscode.Uri.joinPath(distPath, filePath);
    const webviewUri = webview.asWebviewUri(fileUri);
    return `${attr}="${webviewUri}"`;
  });

  return html;
}
