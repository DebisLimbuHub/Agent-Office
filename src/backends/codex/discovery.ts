import * as path from 'path';

import { TERMINAL_NAME_PREFIX } from '../../constants.js';
import type { AgentState } from '../../types.js';

interface TerminalLike {
  name: string;
}

function pathsMatch(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

export function isAgentOfficeTerminalName(name: string): boolean {
  return name.startsWith(TERMINAL_NAME_PREFIX);
}

export function findPendingCodexAgentForSession(
  agents: Iterable<AgentState>,
  sessionCwd: string,
  activeTerminal?: TerminalLike,
): AgentState | undefined {
  const pendingAgents = [...agents]
    .filter((agent) => agent.backendId === 'codex' && agent.pendingSession)
    .sort((a, b) => a.id - b.id);

  if (activeTerminal) {
    const activeMatch = pendingAgents.find(
      (agent) =>
        agent.terminalRef === activeTerminal &&
        (!agent.projectDir || pathsMatch(agent.projectDir, sessionCwd)),
    );
    if (activeMatch) {
      return activeMatch;
    }
  }

  return pendingAgents.find(
    (agent) => !agent.projectDir || pathsMatch(agent.projectDir, sessionCwd),
  );
}

export function findExistingCodexAgentBySessionId(
  agents: Iterable<AgentState>,
  sessionId: string,
): AgentState | undefined {
  for (const agent of agents) {
    if (agent.backendId === 'codex' && agent.backendSessionId === sessionId) {
      return agent;
    }
  }

  return undefined;
}

export function shouldAttachCodexTranscript(
  agent: Pick<AgentState, 'pendingSession' | 'transcriptFile'>,
  transcriptFile: string,
): boolean {
  if (agent.pendingSession) {
    return true;
  }

  if (!agent.transcriptFile) {
    return true;
  }

  return !pathsMatch(agent.transcriptFile, transcriptFile);
}

export function canAdoptActiveTerminal(
  activeTerminal: TerminalLike | undefined,
  agents: Iterable<AgentState>,
): boolean {
  if (!activeTerminal || !isAgentOfficeTerminalName(activeTerminal.name)) {
    return false;
  }

  return ![...agents].some((agent) => agent.terminalRef === activeTerminal);
}
