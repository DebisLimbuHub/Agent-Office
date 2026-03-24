import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface CodexSessionMeta {
  id: string;
  cwd: string;
  source: unknown;
  agentNickname?: string | null;
  agentRole?: string | null;
}

export function getCodexSessionsDirectory(): string {
  return path.join(os.homedir(), '.codex', 'sessions');
}

export function listCodexSessionFiles(rootDir: string): string[] {
  const files: string[] = [];

  function walk(dirPath: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  }

  walk(rootDir);
  files.sort();
  return files;
}

function readFirstLine(filePath: string): string | null {
  const chunkSize = 8192;
  const buffer = Buffer.alloc(chunkSize);
  let fd: number | null = null;
  let text = '';
  let position = 0;

  try {
    fd = fs.openSync(filePath, 'r');
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, position);
      if (bytesRead === 0) {
        return text || null;
      }

      text += buffer.toString('utf-8', 0, bytesRead);
      const newlineIndex = text.indexOf('\n');
      if (newlineIndex !== -1) {
        return text.slice(0, newlineIndex);
      }

      position += bytesRead;
    }
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      fs.closeSync(fd);
    }
  }
}

export function readCodexSessionMeta(filePath: string): CodexSessionMeta | null {
  const firstLine = readFirstLine(filePath);
  if (!firstLine) {
    return null;
  }

  try {
    const record = JSON.parse(firstLine) as {
      type?: unknown;
      payload?: {
        id?: unknown;
        cwd?: unknown;
        source?: unknown;
        agent_nickname?: unknown;
        agent_role?: unknown;
      };
    };

    if (record.type !== 'session_meta' || !record.payload) {
      return null;
    }

    const { payload } = record;
    if (typeof payload.id !== 'string' || typeof payload.cwd !== 'string') {
      return null;
    }

    return {
      id: payload.id,
      cwd: payload.cwd,
      source: payload.source,
      agentNickname:
        typeof payload.agent_nickname === 'string' ? payload.agent_nickname : undefined,
      agentRole: typeof payload.agent_role === 'string' ? payload.agent_role : undefined,
    };
  } catch {
    return null;
  }
}

export function isTopLevelCodexSession(meta: CodexSessionMeta): boolean {
  return meta.source === 'cli';
}
