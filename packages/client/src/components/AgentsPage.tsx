import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Plus, RefreshCw } from 'lucide-react';
import { showToast } from './Toast';
import { AgentEditor } from './agents/AgentEditor';
import { AgentHero } from './agents/AgentHero';
import { AgentListPane } from './agents/AgentListPane';
import { AgentModulePanel } from './agents/AgentModules';
import { emptyAgentForm, type AgentForm, type DetailTab, type InspectRuntime } from './agents/types';
import { createAgent, deleteAgent as deleteAgentOnA8s, inspectAgent, listModelCatalog, patchAgentSpec } from '../a8s/agents';
import { switchModel, setReasoningEffort } from '../a8s/data';
import { useAgentFacts, useSystemFact } from '../facts/useFacts';
import { factStore } from '../facts/store';
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
  const [selectedId, setSelectedId] = useState<string | undefined>(agents[0]?.id);
  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0];

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
      setSelectedId(agents[0]?.id);
    }
  }, [agents, selectedId]);

  const refetchModels = useCallback(async () => {
    try {
      setModels(await listModelCatalog());
    } catch {
      setModels([]);
    }
  }, []);

  // Prompt packs are a not-yet-ported product surface (the console BFF owned
  // them). a8s has no prompt-pack registry, so the picker degrades to the
  // agent's current value rather than calling a dead route.
  const refetchPromptPacks = useCallback(async () => {
    setPromptPacks([]);
  }, []);

  const loadInspect = useCallback(async (agentId: string) => {
    setLoadingRuntime(true);
    try {
      setRuntime(await inspectAgent(agentId));
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
        agent.hands?.map((hand) => hand.kind).join(' ') ?? '',
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
      ...emptyAgentForm(),
      id: agent.id,
      name: agent.name,
      model: agent.model,
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

    try {
      if (editorMode === 'edit') {
        // An existing agent: live-patch the mutable fields rather than
        // re-create. Name is a label; a8s has no rename, so editing name is
        // a no-op on the wire today — model/reasoning are what take effect.
        await switchModel(id, model);
        if (form.reasoningEffort) await setReasoningEffort(id, form.reasoningEffort);
      } else {
        await createAgent({
          agentId: id,
          name,
          model,
          reasoningEffort: form.reasoningEffort || undefined,
          project: form.project.trim() || undefined,
        });
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
      return;
    }
    showToast(editorMode === 'create' ? 'Agent created' : 'Agent updated');
    setSelectedId(id);
    closeEditor();
    void factStore.hydrate('agent');
    window.dispatchEvent(new CustomEvent('berry:select-agent', { detail: id }));
  };

  const activateAgent = async (agentId: string) => {
    // Selection is frontend-owned now — no backend round-trip.
    factStore.setSelectedAgent(agentId);
    setSelectedId(agentId);
    window.dispatchEvent(new CustomEvent('berry:select-agent', { detail: agentId }));
    showToast('Active agent switched');
  };

  const deleteAgent = async (agent: AgentFact) => {
    if (!window.confirm(`Remove agent "${agent.name}" from the registry? SDK-owned agent data stays on disk.`)) return;
    try {
      await deleteAgentOnA8s(agent.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
      return;
    }
    showToast('Agent removed from registry');
    void factStore.hydrate('agent');
  };

  const patchAgent = async (agent: AgentFact, patch: Record<string, unknown>, success: string) => {
    try {
      const applied = await patchAgentSpec(agent.id, patch);
      if (!applied) {
        showToast('该项暂未接入控制台', 'error');
        return false;
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error');
      return false;
    }
    showToast(success);
    void loadInspect(agent.id);
    void factStore.hydrate('agent');
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
            activeId={selected?.id}
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
                active={true}
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
