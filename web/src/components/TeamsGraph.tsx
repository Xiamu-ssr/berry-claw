/**
 * Teams graph — one sub-canvas per team. Each team shows a Crown leader
 * node at the center with teammates radiating below. Worklist progress
 * rides as a small badge on the leader node.
 *
 * Derived purely from FactStore (useTeamFacts / useAgentFacts). Clicking
 * a leader node triggers onSelect so the parent page can open the team
 * detail view.
 */
import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Crown, User, ListChecks } from 'lucide-react';
import type { TeamFact, AgentFact } from '../facts/types';
import { useTeamFacts, useAgentFacts } from '../facts/useFacts';

interface LeaderData {
  team: TeamFact;
  leader: AgentFact | undefined;
  onSelect: (leaderId: string) => void;
  [k: string]: unknown;
}
interface TeammateData {
  agent: AgentFact | undefined;
  role: string;
  onSelect: (agentId: string) => void;
  [k: string]: unknown;
}

function LeaderNode({ data }: NodeProps<Node<LeaderData>>) {
  const { team, leader, onSelect } = data;
  const done = team.worklist.filter((t) => t.status === 'done').length;
  const failed = team.worklist.filter((t) => t.status === 'failed').length;
  const total = team.worklist.length;
  return (
    <div
      onClick={() => onSelect(team.leaderId)}
      className="px-3 py-2 rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-900/20 shadow-sm cursor-pointer min-w-[200px] hover:border-amber-500 transition-colors"
    >
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
      <div className="flex items-center gap-2 mb-1">
        <Crown size={14} className="text-amber-600" />
        <span className="text-sm font-semibold text-amber-900 dark:text-amber-100 truncate">{team.name}</span>
      </div>
      <div className="text-[11px] font-mono text-amber-700/80 dark:text-amber-300/80 truncate">
        leader: {leader?.name ?? team.leaderId}
      </div>
      {total > 0 && (
        <div className="flex items-center gap-1 mt-1.5 text-[10px] text-amber-700 dark:text-amber-300">
          <ListChecks size={11} />
          <span>{done}/{total} done{failed > 0 && <span className="text-red-600 ml-1">· {failed} failed</span>}</span>
        </div>
      )}
    </div>
  );
}

function TeammateNode({ data }: NodeProps<Node<TeammateData>>) {
  const { agent, role, onSelect } = data;
  return (
    <div
      onClick={() => agent && onSelect(agent.id)}
      className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 min-w-[140px] hover:border-berry-300 cursor-pointer transition-colors"
    >
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
      <div className="flex items-center gap-1.5">
        <User size={11} className="text-gray-500" />
        <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{agent?.name ?? '(missing)'}</span>
      </div>
      <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{role}</div>
    </div>
  );
}

const nodeTypes = { leader: LeaderNode, teammate: TeammateNode };

interface TeamsGraphProps {
  onLeaderSelect: (leaderId: string) => void;
  onAgentSelect?: (agentId: string) => void;
}

export default function TeamsGraph({ onLeaderSelect, onAgentSelect }: TeamsGraphProps) {
  const teams = useTeamFacts();
  const agents = useAgentFacts();
  const agentById = useMemo(() => {
    const m = new Map<string, AgentFact>();
    for (const a of agents) m.set(a.id, a);
    return m;
  }, [agents]);

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const TEAM_W = 280;
    const LEADER_Y = 40;
    const MATE_Y = 160;
    const MATE_SPACING = 160;

    teams.forEach((team, ti) => {
      const centerX = ti * TEAM_W * 2 + 120;
      const leaderId = `leader:${team.leaderId}`;
      nodes.push({
        id: leaderId,
        type: 'leader',
        position: { x: centerX - 100, y: LEADER_Y },
        data: { team, leader: agentById.get(team.leaderId), onSelect: onLeaderSelect },
      });

      const n = team.teammates.length;
      team.teammates.forEach((tm, i) => {
        const offset = (i - (n - 1) / 2) * MATE_SPACING;
        const mateId = `mate:${team.leaderId}:${tm.agentId}`;
        nodes.push({
          id: mateId,
          type: 'teammate',
          position: { x: centerX + offset - 70, y: MATE_Y },
          data: {
            agent: agentById.get(tm.agentId),
            role: tm.role,
            onSelect: (id: string) => onAgentSelect?.(id) ?? onLeaderSelect(team.leaderId),
          },
        });
        edges.push({
          id: `${leaderId}->${mateId}`,
          source: leaderId,
          target: mateId,
          style: { stroke: '#fbbf24' },
        });
      });
    });

    return { nodes, edges };
  }, [teams, agentById, onLeaderSelect, onAgentSelect]);

  const handleNodeClick = useCallback((_: unknown, node: Node) => {
    if (node.type === 'leader') onLeaderSelect((node.data as LeaderData).team.leaderId);
  }, [onLeaderSelect]);

  if (teams.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        No teams yet. Create one from an agent bound to a project.
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-[500px] relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView
        // Lean on fitView, but clamp the single-team zoom — otherwise a
        // lonely leader node gets magnified until its text blows up.
        fitViewOptions={{ padding: 0.4, maxZoom: 0.9, minZoom: 0.3 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => (n.type === 'leader' ? '#f59e0b' : '#94a3b8')}
          nodeStrokeColor="#1f2937"
          nodeStrokeWidth={3}
          nodeBorderRadius={4}
          maskColor="rgba(17, 24, 39, 0.5)"
          style={{ backgroundColor: 'rgba(249, 250, 251, 0.92)' }}
        />
      </ReactFlow>
      {/* Hint overlay when every team has no teammates yet — the graph
           otherwise looks empty because a single leader node doesn't
           communicate "this is a team". */}
      {teams.every((t) => t.teammates.length === 0) && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300 shadow-sm pointer-events-none">
          Leader is alone. Tell them <code className="font-mono">spawn_teammate</code> from chat.
        </div>
      )}
    </div>
  );
}
