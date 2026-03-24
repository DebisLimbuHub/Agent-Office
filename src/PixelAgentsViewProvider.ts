import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

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
import { DEFAULT_BACKEND_ID, getBackendProvider, listBackendProviders } from './backends/index.js';
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

export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
  nextAgentId = { current: 1 };
  nextTerminalIndex = { current: 1 };
  agents = new Map<number, AgentState>();
  webviewView: vscode.WebviewView | undefined;

  fileWatchers = new Map<number, fs.FSWatcher>();
  pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
  waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
  permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

  activeAgentId = { current: null as number | null };
  knownJsonlFiles = new Set<string>();
  projectScanTimer = { current: null as ReturnType<typeof setInterval> | null };

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
      projectScanTimerRef: this.projectScanTimer,
      agents: this.agents,
      knownTranscriptFiles: this.knownJsonlFiles,
      fileWatchers: this.fileWatchers,
      pollingTimers: this.pollingTimers,
      waitingTimers: this.waitingTimers,
      permissionTimers: this.permissionTimers,
      jsonlPollTimers: this.jsonlPollTimers,
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

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'openClaude') {
        await getBackendProvider(DEFAULT_BACKEND_ID).createSession(this.hostRuntime, {
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
        console.log(`[Pixel Agents] saveAgentSeats:`, JSON.stringify(message.seats));
        this.context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, message.seats);
      } else if (message.type === 'saveLayout') {
        this.layoutWatcher?.markOwnWrite();
        writeLayoutToFile(message.layout as Record<string, unknown>);
      } else if (message.type === 'setSoundEnabled') {
        this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
      } else if (message.type === 'webviewReady') {
        this.restorePersistedAgents();

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

        const projectDir = getBackendProvider(DEFAULT_BACKEND_ID).getSessionsDirectory();
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        console.log('[Extension] workspaceRoot:', workspaceRoot);
        console.log('[Extension] projectDir:', projectDir);
        if (projectDir) {
          getBackendProvider(DEFAULT_BACKEND_ID).startDiscovery(this.hostRuntime);

          (async () => {
            try {
              console.log('[Extension] Loading furniture assets...');
              const extensionPath = this.extensionUri.fsPath;
              console.log('[Extension] extensionPath:', extensionPath);

              const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
              let assetsRoot: string | null = null;
              if (fs.existsSync(bundledAssetsDir)) {
                console.log('[Extension] Found bundled assets at dist/');
                assetsRoot = path.join(extensionPath, 'dist');
              } else if (workspaceRoot) {
                console.log('[Extension] Trying workspace for assets...');
                assetsRoot = workspaceRoot;
              }

              if (!assetsRoot) {
                console.log('[Extension] ⚠️  No assets directory found');
                if (this.webview) {
                  sendLayout(this.context, this.webview, this.defaultLayout);
                  this.startLayoutWatcher();
                }
                return;
              }

              console.log('[Extension] Using assetsRoot:', assetsRoot);
              this.assetsRoot = assetsRoot;
              this.defaultLayout = loadDefaultLayout(assetsRoot);

              const characterSprites = await loadCharacterSprites(assetsRoot);
              if (characterSprites && this.webview) {
                console.log('[Extension] Character sprites loaded, sending to webview');
                sendCharacterSpritesToWebview(this.webview, characterSprites);
              }

              const floorTiles = await loadFloorTiles(assetsRoot);
              if (floorTiles && this.webview) {
                console.log('[Extension] Floor tiles loaded, sending to webview');
                sendFloorTilesToWebview(this.webview, floorTiles);
              }

              const wallTiles = await loadWallTiles(assetsRoot);
              if (wallTiles && this.webview) {
                console.log('[Extension] Wall tiles loaded, sending to webview');
                sendWallTilesToWebview(this.webview, wallTiles);
              }

              const assets = await this.loadAllFurnitureAssets();
              if (assets && this.webview) {
                console.log('[Extension] ✅ Assets loaded, sending to webview');
                sendAssetsToWebview(this.webview, assets);
              }
            } catch (err) {
              console.error('[Extension] ❌ Error loading assets:', err);
            }
            if (this.webview) {
              console.log('[Extension] Sending saved layout');
              sendLayout(this.context, this.webview, this.defaultLayout);
              this.startLayoutWatcher();
            }
          })();
        } else {
          (async () => {
            try {
              const extensionPath = this.extensionUri.fsPath;
              const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
              if (fs.existsSync(bundledAssetsDir)) {
                const distRoot = path.join(extensionPath, 'dist');
                this.defaultLayout = loadDefaultLayout(distRoot);
                const characterSprites = await loadCharacterSprites(distRoot);
                if (characterSprites && this.webview) {
                  sendCharacterSpritesToWebview(this.webview, characterSprites);
                }
                const floorTiles = await loadFloorTiles(distRoot);
                if (floorTiles && this.webview) {
                  sendFloorTilesToWebview(this.webview, floorTiles);
                }
                const wallTiles = await loadWallTiles(distRoot);
                if (wallTiles && this.webview) {
                  sendWallTilesToWebview(this.webview, wallTiles);
                }
              }
            } catch {
              /* ignore */
            }
            if (this.webview) {
              sendLayout(this.context, this.webview, this.defaultLayout);
              this.startLayoutWatcher();
            }
          })();
        }
        sendExistingAgents(this.agents, this.context, this.webview);
      } else if (message.type === 'openSessionsFolder') {
        const projectDir = getBackendProvider(DEFAULT_BACKEND_ID).getSessionsDirectory();
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
      console.log('[Pixel Agents] External layout change — pushing to webview');
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
            removeAgent(
              id,
              this.agents,
              this.fileWatchers,
              this.pollingTimers,
              this.waitingTimers,
              this.permissionTimers,
              this.jsonlPollTimers,
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
    for (const id of [...this.agents.keys()]) {
      removeAgent(
        id,
        this.agents,
        this.fileWatchers,
        this.pollingTimers,
        this.waitingTimers,
        this.permissionTimers,
        this.jsonlPollTimers,
        this.persistAgents,
      );
    }
    if (this.projectScanTimer.current) {
      clearInterval(this.projectScanTimer.current);
      this.projectScanTimer.current = null;
    }
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
