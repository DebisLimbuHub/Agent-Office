import type { ToolActivity } from './types.js';

/** Derive a short human-readable activity string from tools/status. */
export function getActivityText(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  agentStatus: string | undefined,
  currentTool: string | null,
): string {
  const hasActiveStatus = agentStatus === 'active';
  const tools = agentTools[agentId];
  if (tools && tools.length > 0) {
    // Find the latest non-done tool.
    const activeTool = [...tools].reverse().find((tool) => !tool.done);
    if (activeTool) {
      if (activeTool.permissionWait) return 'Needs approval';
      return activeTool.status;
    }
    // All tools done but agent still active mid-turn: keep the last tool label visible.
    if (hasActiveStatus) {
      const lastTool = tools[tools.length - 1];
      if (lastTool) return lastTool.status;
    }
  }

  if (agentStatus === 'waiting') {
    return 'Waiting for input';
  }
  if (hasActiveStatus) {
    return currentTool ?? 'Working';
  }

  return 'Idle';
}
