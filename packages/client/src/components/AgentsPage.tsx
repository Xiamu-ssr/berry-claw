import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Plus, RefreshCw } from 'lucide-react';
import { showToast } from './Toast';
import { AgentEditor } from './agents/AgentEditor';
import { AgentHero } from './agents/AgentHero';
import { AgentListPane } from './agents/AgentListPane';
import { AgentModulePanel } from './agents/AgentModules';
import { emptyAgentForm, type AgentForm, type DetailTab, type InspectRuntime } from './agents/types';
import { API, apiFetch } from '../api/paths';
import { useAgentFacts, useSystemFact } from '../facts/useFacts';
import type {
  AgentFact,
  ModelCatalogItem as ModelInfo,
  PromptPackInfo,
} from '@berry-agent/claw-contracts';
import {
  EmptyState,
  PrimaryButton,
  SecondaryButton,
  SplitWorkbench,
  WorkbenchPage,
} from './workbench';

export default function AgentsPage() {
  const agents = useAgentFacts();
  const system = useSystemFact();
  const activeAgent = agents.find((agent) => agent.isActive);
  const [selectedId, setSelectedId] = useState<string | undefined>(activeAgent?.id ?? agents[0]?.id);
  const selected = agents.find((agent) => agent.id === selectedId) ?? activeAgent ?? agents[0];

  const [query, setQuery] = useState('');
  const [detailTab, setDetailTab] = useState<DetailTab>('context');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [promptPacks, setPromptPacks] = useState<PromptPackInfo[]>([]);
  const [runtime, setRuntime] = useState<InspectRuntime | null>(null);
  const [loadingRuntime, setLoadingRuntime] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null);
  const [form, setForm] = useState<AgentForm>(emptyAgentForm);

  useEffect(() => {
    if (!agents.length) {
      setSelectedId(undefined);
      return;
    }
    if (!selectedId || !agents.some((agent) => agent.id === selectedId)) {
      setSelectedId(activeAgent?.id ?? agents[0]?.id);
    }
  }, [activeAgent?.id, agents, selectedId]);

  const refetchModels = useCallback(async () => {
    const res = await apiFetch(API.models);
    const data = await res.json();
    setModels(Array.isArray(data.models) ? data.models : []);
  }, []);

  const refetchPromptPacks = useCallback(async () => {
    const res = await apiFetch(API.promptPacks);
    const data = await res.json();
    setPromptPacks(Array.isArray(data.promptPacks) ? data.promptPacks : []);
  }, []);

  const loadInspect = useCallback(async (agentId: string) => {
    setLoadingRuntime(true);
    try {
      const res = await apiFetch(API.agentInspect(agentId));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRuntime((data.runtime ?? null) as InspectRuntime | null);
    } catch (err) {
      setRuntime(null);
      showToast(err instanceof Error ? err.message : 'Failed to inspect agent', 'error');
    } finally {
      setLoadingRuntime(false);
    }
  }, []);

  useEffect(() => {
    void refetchModels();
    void refetchPromptPacks();
  }, [refetchModels, refetchPromptPacks]);

  useEffect(() => {
    if (!selected?.id) {
      setRuntime(null);
      return;
    }
    void loadInspect(selected.id);
  }, [loadInspect, selected?.id]);

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents.filter((agent) => {
      const haystack = [
        agent.id,
        agent.name,
        agent.model,
        agent.provider,
        agent.workspace,
        agent.project ?? '',
      ].join(' ').toLowerCase();
      return !q || haystack.includes(q);
    });
  }, [agents, query]);

  const startCreate = () => {
    void refetchModels();
    void refetchPromptPacks();
    setEditorMode('create');
    setDetailTab('context');
    setForm({
      ...emptyAgentForm(),
      model: models[0]?.model ?? 'tier:balanced',
      reasoningEffort: 'medium',
      promptPack: promptPacks[0]?.id ?? 'berry-default-zh',
    });
  };

  const startEdit = (agent: AgentFact) => {
    void refetchModels();
    void refetchPromptPacks();
    setEditorMode('edit');
    setDetailTab('context');
    setForm({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      project: agent.project ?? '',
      reasoningEffort: agent.reasoningEffort ?? '',
      promptPack: agent.promptPack ?? 'berry-default-zh',
    });
  };

  const closeEditor = () => {
    setEditorMode(null);
    setForm(emptyAgentForm());
  };

  const saveAgent = async () => {
    const id = form.id.trim();
    const name = form.name.trim();
    const model = form.model.trim();
    if (!id || !name || !model) {
      showToast('Agent id, name, and model are required', 'error');
      return;
    }

    const previous = editorMode === 'edit' ? selected : undefined;
    const body = {
      ...(previous
        ? {
            workspace: previous.workspace,
            tools: previous.tools,
            disabledTools: previous.disabledTools,
            skillDirs: previous.skillDirs,
            disabledSkills: previous.disabledSkills,
            enabledSkills: previous.enabledSkills,
            promptPack: previous.promptPack,
            safetyLevel: previous.safetyLevel,
          }
        : {}),
      name,
      model,
      project: form.project.trim() || undefined,
      reasoningEffort: form.reasoningEffort || undefined,
      promptPack: form.promptPack || undefined,
    };
    const res = await apiFetch(API.agent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error ?? `Save failed (${res.status})`, 'error');
      return;
    }
    showToast(editorMode === 'create' ? 'Agent created' : 'Agent updated');
    setSelectedId(id);
    closeEditor();
    window.dispatchEvent(new CustomEvent('berry:select-agent', { detail: id }));
  };

  const activateAgent = async (agentId: string) => {
    const res = await apiFetch(API.agentActivate(agentId), { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.error ?? 'Activate failed', 'error');
      return;
    }
    setSelectedId(agentId);
    window.dispatchEvent(new CustomEvent('berry:select-agent', { detail: agentId }));
    showToast('Active agent switched');
  };

  const deleteAgent = async (agent: AgentFact) => {
    if (!window.confirm(`Remove agent "${agent.name}" from the Claw registry? SDK-owned agent data stays on disk.`)) return;
    const res = await apiFetch(API.agent(agent.id), { method: 'DELETE' });
    if (!res.ok) {
      showToast(`Delete failed (${res.status})`, 'error');
      return;
    }
    showToast('Agent removed from registry');
  };

  const patchAgent = async (agent: AgentFact, patch: Record<string, unknown>, success: string) => {
    const res = await apiFetch(API.agent(agent.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error ?? `Update failed (${res.status})`, 'error');
      return false;
    }
    showToast(success);
    void loadInspect(agent.id);
    return true;
  };

  return (
    <WorkbenchPage
      eyebrow="Workspace"
      title="智能体"
      actions={
        <>
          <SecondaryButton onClick={() => selected?.id && loadInspect(selected.id)}>
            <RefreshCw size={13} />
            刷新
          </SecondaryButton>
          <PrimaryButton onClick={startCreate}>
            <Plus size={14} />
            新建
          </PrimaryButton>
        </>
      }
    >
      <SplitWorkbench
        left={
          <AgentListPane
            agents={filteredAgents}
            selectedId={selected?.id}
            activeId={activeAgent?.id}
            query={query}
            onQueryChange={setQuery}
            onSelect={(id) => {
              setSelectedId(id);
              setDetailTab('context');
              setEditorMode(null);
            }}
          />
        }
      >
        <div className="space-y-4 p-5">
          {editorMode && (
            <AgentEditor
              mode={editorMode}
              form={form}
              models={models}
              promptPacks={promptPacks}
              onChange={setForm}
              onSave={saveAgent}
              onClose={closeEditor}
            />
          )}

          {!selected ? (
            <EmptyState
              icon={<Bot size={24} />}
              title="还没有智能体"
              body="创建一个 agent 后，它会拥有 SDK 管理的 workspace、记忆、指令、技能和 session。"
              action={<PrimaryButton onClick={startCreate}><Plus size={14} />新建智能体</PrimaryButton>}
            />
          ) : (
            <>
              <AgentHero
                agent={selected}
                active={selected.id === activeAgent?.id}
                loading={loadingRuntime}
                runtime={runtime}
                systemSkills={system?.installedSkills ?? []}
                sharedMcp={system?.mcpShared ?? []}
                activeModule={detailTab}
                onModuleChange={setDetailTab}
                onActivate={() => activateAgent(selected.id)}
                onEdit={() => startEdit(selected)}
                onDelete={() => deleteAgent(selected)}
              />

              <AgentModulePanel
                module={detailTab}
                agent={selected}
                runtime={runtime}
                loadingRuntime={loadingRuntime}
                systemSkills={system?.installedSkills ?? []}
                sharedMcp={system?.mcpShared ?? []}
                onReload={() => loadInspect(selected.id)}
                onPatch={(patch, success) => patchAgent(selected, patch, success)}
              />
            </>
          )}
        </div>
      </SplitWorkbench>
    </WorkbenchPage>
  );
}
