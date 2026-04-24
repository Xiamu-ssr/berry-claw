/**
 * Agents graph — React Flow canvas.
 *
 * Shows every agent as a card-shaped node. Groups agents by project via
 * ProjectNode. Team relationships render as directed edges teammate →
 * leader. Clicking a node fires onSelect so the parent page can open a
 * detail drawer.
 *
 * Data-wise this component is purely derived from FactStore. No fetches,
 * no local state beyond React Flow's own.
 */
import { useMemo, useCallback, useEffect } from 'react';
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
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Folder, Bot } from 'lucide-react';
import type { AgentFact } from '../facts/types';
import { useAgentFacts } from '../facts/useFacts';

// Status dot colors — matching AgentStatusBadge palette keeps the UI
// internally consistent.
const STATUS_COLORS: Record<string, string> = {
  idle: '#9ca3af',
  thinking: '#3b82f6',
  tool_executing: '#f59e0b',
  compacting: '#8b5cf6',
  memory_flushing: '#6366f1',
  delegating: '#ec4899',
  sleeping: '#6b7280',
  error: '#ef4444',
};

interface AgentNodeData {
  fact: AgentFact;
  onSelect: (id: string) => void;
  [k: string]: unknown;
}

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const { fact, onSelect } = data;
  const color = STATUS_COLORS[fact.status] ?? '#9ca3af';
  const modelShort = fact.model.split('/').pop() || fact.model;
  return (
    <div
      onClick={() => onSelect(fact.id)}
      className={`px-3 py-2 rounded-lg border-2 shadow-sm cursor-pointer min-w-[180px] bg-white dark:bg-gray-800 transition-colors ${
        fact.isActive
          ? 'border-berry-500 ring-2 ring-berry-200 dark:ring-berry-900/40'
          : 'border-gray-200 dark:border-gray-700 hover:border-berry-300'
      }`}
    >
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <Bot size={13} className="text-berry-500 flex-shrink-0" />
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{fact.name}</span>
        {fact.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-berry-100 dark:bg-berry-900/40 text-berry-700 dark:text-berry-300">Active</span>}
      </div>
      <div className="text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate">{modelShort}</div>
      {fact.statusDetail && (
        <div className="text-[10px] text-gray-400 mt-1 truncate italic">{fact.statusDetail}</div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
    </div>
  );
}

function ProjectNode({ data }: NodeProps<Node<{ path: string; agentCount: number }>>) {
  const { path, agentCount } = data;
  const basename = path.split('/').pop() || path;
  return (
    <div className="px-3 py-2 rounded-lg border-2 border-dashed border-indigo-300 dark:border-indigo-700 bg-indigo-50/60 dark:bg-indigo-900/20 min-w-[160px]">
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
      <div className="flex items-center gap-2">
        <Folder size={13} className="text-indigo-500" />
        <span className="text-xs font-semibold text-indigo-800 dark:text-indigo-200 truncate">{basename}</span>
      </div>
      <div className="text-[10px] text-indigo-600/70 dark:text-indigo-400/70 mt-0.5">{agentCount} agent{agentCount !== 1 ? 's' : ''}</div>
    </div>
  );
}

const nodeTypes = { agent: AgentNode, project: ProjectNode };

interface AgentsGraphProps {
  onSelect: (agentId: string) => void;
}

export default function AgentsGraph({ onSelect }: AgentsGraphProps) {
  const facts = useAgentFacts();

  const { nodes: baseNodes, edges: baseEdges } = useMemo(() => {
    // Group agents by project so leaders + teammates cluster visually.
    // Agents with no project go into a virtual "unassigned" lane.
    const byProject = new Map<string, AgentFact[]>();
    for (const a of facts) {
      const key = a.project ?? '__no_project__';
      const list = byProject.get(key) ?? [];
      list.push(a);
      byProject.set(key, list);
    }

    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const COL_W = 260;
    const ROW_H = 110;

    let col = 0;
    for (const [project, agents] of byProject) {
      const projectY = 0;
      if (project !== '__no_project__') {
        nodes.push({
          id: `project:${project}`,
          type: 'project',
          position: { x: col * COL_W, y: projectY },
          data: { path: project, agentCount: agents.length },
          draggable: true,
        });
      }

      agents.forEach((a, i) => {
        nodes.push({
          id: a.id,
          type: 'agent',
          position: { x: col * COL_W, y: projectY + 90 + i * ROW_H },
          data: { fact: a, onSelect },
          draggable: true,
        });
        if (project !== '__no_project__') {
          edges.push({
            id: `project:${project}->${a.id}`,
            source: `project:${project}`,
            target: a.id,
            style: { stroke: '#a5b4fc', strokeDasharray: '4 4' },
          });
        }
      });
      col++;
    }

    // Team edges: any agent with team.leaderId links to leader.
    // (AgentEntry carries team via config — but AgentFact doesn't expose
    // team membership; we rely on teams being rendered separately in
    // TeamsPage for now. Left as a TODO once TeamFact-driven edges are
    // wired in.)

    return { nodes, edges };
  }, [facts, onSelect]);

  const [nodes, setNodes, onNodesChange] = useNodesState(baseNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(baseEdges);

  useEffect(() => {
    setNodes((prev) => {
      const prevPositions = new Map(prev.map((node) => [node.id, node.position]));
      return baseNodes.map((node) => ({
        ...node,
        position: prevPositions.get(node.id) ?? node.position,
      }));
    });
  }, [baseNodes, setNodes]);

  useEffect(() => {
    setEdges(baseEdges);
  }, [baseEdges, setEdges]);

  const handleNodeClick = useCallback((_: unknown, node: Node) => {
    if (node.type === 'agent') onSelect(node.id);
  }, [onSelect]);

  return (
    <div className="w-full h-full min-h-[500px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodesDraggable
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
        {/*
         * MiniMap notes:
         *  - Custom node components without explicit width/height need the
         *    `nodeStrokeWidth` bump + a `nodeColor` that returns opaque color
         *    so React Flow's internal measurement can paint them visibly.
         *  - `maskColor` darker than the canvas clarifies viewport extent.
         */}
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            const data = n.data as { fact?: AgentFact } | undefined;
            return n.type === 'project'
              ? '#818cf8'
              : data?.fact?.isActive
                ? '#ec4899'
                : '#f97316';
          }}
          nodeStrokeColor="#1f2937"
          nodeStrokeWidth={3}
          nodeBorderRadius={4}
          maskColor="rgba(17, 24, 39, 0.5)"
          style={{ backgroundColor: 'rgba(249, 250, 251, 0.92)' }}
        />
      </ReactFlow>
    </div>
  );
}
