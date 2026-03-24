import * as fs from 'fs';
import * as path from 'path';

import { buildAssetIndex, buildFurnitureCatalog } from './build.js';
import {
  decodeAllCharacters,
  decodeAllFloors,
  decodeAllFurniture,
  decodeAllWalls,
} from './loader.js';

interface DecodedCache {
  characters: ReturnType<typeof decodeAllCharacters> | null;
  floors: ReturnType<typeof decodeAllFloors> | null;
  walls: ReturnType<typeof decodeAllWalls> | null;
  furniture: ReturnType<typeof decodeAllFurniture> | null;
}

export interface BrowserMockAssetsPluginOptions {
  assetsDir: string;
  distAssetsDir: string;
}

interface DevServerResponse {
  setHeader(name: string, value: string): void;
  end(body: string): void;
}

interface DevServerWatcher {
  add(path: string): void;
  on(event: 'add' | 'change' | 'unlink', listener: (file: string) => void): void;
}

interface DevServer {
  config: { base: string };
  middlewares: {
    use(path: string, handler: (_req: unknown, res: DevServerResponse) => void): void;
  };
  watcher: DevServerWatcher;
  ws: { send(payload: { type: 'full-reload' }): void };
}

interface BrowserMockAssetsPlugin {
  name: string;
  configureServer(server: DevServer): void;
  closeBundle(): void;
}

/**
 * Vite plugin used by the standalone browser-mode UI.
 *
 * In dev it exposes JSON endpoints for the asset index, furniture catalog,
 * and pre-decoded sprite payloads so the browser mock can avoid decoding PNGs
 * in the hot path. In build it emits the lightweight metadata files that the
 * production browser bundle reads from `dist/webview/assets/`.
 */
export function browserMockAssetsPlugin(
  options: BrowserMockAssetsPluginOptions,
): BrowserMockAssetsPlugin {
  const { assetsDir, distAssetsDir } = options;
  const cache: DecodedCache = { characters: null, floors: null, walls: null, furniture: null };

  function clearCache(): void {
    cache.characters = null;
    cache.floors = null;
    cache.walls = null;
    cache.furniture = null;
  }

  function handleAssetFsEvent(server: DevServer, file: string, verb: string): void {
    if (!file.startsWith(assetsDir)) return;
    console.log(`[browser-mock-assets] Asset ${verb}: ${path.relative(assetsDir, file)}`);
    clearCache();
    server.ws.send({ type: 'full-reload' });
  }

  return {
    name: 'browser-mock-assets',
    configureServer(server) {
      const base = server.config.base.replace(/\/$/, '');

      server.middlewares.use(`${base}/assets/furniture-catalog.json`, (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(buildFurnitureCatalog(assetsDir)));
      });
      server.middlewares.use(`${base}/assets/asset-index.json`, (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(buildAssetIndex(assetsDir)));
      });

      server.middlewares.use(`${base}/assets/decoded/characters.json`, (_req, res) => {
        cache.characters ??= decodeAllCharacters(assetsDir);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(cache.characters));
      });
      server.middlewares.use(`${base}/assets/decoded/floors.json`, (_req, res) => {
        cache.floors ??= decodeAllFloors(assetsDir);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(cache.floors));
      });
      server.middlewares.use(`${base}/assets/decoded/walls.json`, (_req, res) => {
        cache.walls ??= decodeAllWalls(assetsDir);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(cache.walls));
      });
      server.middlewares.use(`${base}/assets/decoded/furniture.json`, (_req, res) => {
        cache.furniture ??= decodeAllFurniture(assetsDir, buildFurnitureCatalog(assetsDir));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(cache.furniture));
      });

      if (fs.existsSync(assetsDir)) {
        server.watcher.add(assetsDir);
      }
      server.watcher.on('add', (file) => handleAssetFsEvent(server, file, 'added'));
      server.watcher.on('change', (file) => handleAssetFsEvent(server, file, 'changed'));
      server.watcher.on('unlink', (file) => handleAssetFsEvent(server, file, 'removed'));
    },
    closeBundle() {
      fs.mkdirSync(distAssetsDir, { recursive: true });

      const catalog = buildFurnitureCatalog(assetsDir);
      fs.writeFileSync(path.join(distAssetsDir, 'furniture-catalog.json'), JSON.stringify(catalog));
      fs.writeFileSync(
        path.join(distAssetsDir, 'asset-index.json'),
        JSON.stringify(buildAssetIndex(assetsDir)),
      );
    },
  };
}
