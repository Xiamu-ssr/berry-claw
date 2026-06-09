import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Plus, RefreshCw } from 'lucide-react';
import { showToast } from './Toast';
import { AgentEditor } from './agents/AgentEditor';
import { AgentCreateWizard, type AgentCreateValues } from './agents/AgentCreateWizard';
import { AgentHero } from './agents/AgentHero';
import { AgentListPane } from './agents/AgentListPane';
import { AgentModulePanel } from './agents/AgentModules';
import { emptyAgentForm, type AgentForm, type DetailTab, type InspectRuntime } from './agents/types';
import { createAgent, deleteAgent as deleteAgentOnA8s, inspectAgent, listModelCatalog, patchAgentSpec } from '../a8s/agents';
import { switchModel, setReasoningEffort } from '../a8s/data';
import { useAgentFacts, useSystemFact, useTeamFacts } from '../facts/useFacts';
import { factStore } from '../facts/store';
import { uniqueStrings } from '../utils/format';
import type {
  AgentFact,
  ModelCatalogItem as ModelInfo,
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
  const teams = useTeamFacts();
  const system = useSystemFact();
  const [selectedId, setSelectedId] = useState<string | undefined>(agents[0]?.id);
  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0];

  const [query, setQuery] = useState('');
  const [detailTab, setDetailTab] = useState<DetailTab>('context');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [runtime, setRuntime] = useState<InspectRuntime | null>(null);
  const [loadingRuntime, setLoadingRuntime] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<AgentForm>(emptyAgentForm);

  // Known project roots come from team membership (an a8s AgentFact carries no
  // project of its own), feeding the wizard's ProjectPicker.
  const knownProjects = useMemo(
    () => uniqueStrings(teams.map((t) => t.project)).sort(),
    [teams],
  );
  const takenIds = useMemo(() => agents.map((a) => a.id), [agents]);

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
  }, [refetchModels]);

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
    setWizardOpen(true);
  };

  const startEdit = (agent: AgentFact) => {
    void refetchModels();
    setDetailTab('context');
    setForm({
      ...emptyAgentForm(),
      id: agent.id,
      name: agent.name,
      model: agent.model,
    });
    setEditorOpen(true);
  };

  const createFromWizard = async (values: AgentCreateValues) => {
    setBusy(true);
    try {
      await createAgent({
        agentId: values.agentId,
        name: values.name,
        model: values.model,
        classifierModel: values.classifierModel,
        reasoningEffort: values.reasoningEffort || undefined,
        project: values.project,
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Create failed', 'error');
      return;
    } finally {
      setBusy(false);
    }
    showToast('Agent created');
    setWizardOpen(false);
    setSelectedId(values.agentId);
    void factStore.hydrate('agent');
    window.dispatchEvent(new CustomEvent('berry:select-agent', { detail: values.agentId }));
  };

  const saveEdit = async () => {
    const id = form.id.trim();
    const model = form.model.trim();
    if (!id || !model) {
      showToast('模型不能为空', 'error');
      return;
    }
    try {
      // Live-patch the mutable fields; a8s has no rename, so name is a label
      // only — model/reasoning are what take effect on the wire.
      await switchModel(id, model);
      if (form.reasoningEffort) await setReasoningEffort(id, form.reasoningEffort);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
      return;
    }
    showToast('Agent updated');
    setEditorOpen(false);
    void factStore.hydrate('agent');
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
            }}
          />
        }
      >
        <div className="space-y-4 p-5">
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

      <AgentCreateWizard
        open={wizardOpen}
        catalog={models}
        takenIds={takenIds}
        knownProjects={knownProjects}
        onCancel={() => setWizardOpen(false)}
        onCreate={createFromWizard}
        busy={busy}
      />
      <AgentEditor
        open={editorOpen}
        form={form}
        models={models}
        onChange={setForm}
        onSave={saveEdit}
        onClose={() => setEditorOpen(false)}
      />
    </WorkbenchPage>
  );
}
