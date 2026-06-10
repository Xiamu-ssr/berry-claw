import { useCallback, useEffect, useState, type MutableRefObject } from 'react';
import {
  fetchModelOptions as fetchModelOptionsFromA8s,
  switchModel as switchModelOnA8s,
  setReasoningEffort as setReasoningEffortOnA8s,
} from '../a8s/data';
import { listModelCatalog } from '../a8s/agents';
import type { ModelCatalogItem } from '@berry-agent/claw-contracts';
import type { ReasoningEffort } from '../components/ChatInput';
import { uniqueStrings } from '../utils/format';

interface ModelControlsToast {
  show(init: { variant?: string; title?: string; message?: string; durationMs?: number }): void;
}

/**
 * Model + reasoning controls for the currently-selected agent — the inference
 * knobs surfaced in the chat toolbar. Owns the model option list + full
 * catalog (catalog drives the family-aware in-chat ModelPicker), refreshes
 * them when the active instance changes, and exposes the switch/effort
 * mutators. Kept out of App so the container stays glue, and so this slice is
 * independently testable.
 *
 * `selectedAgentIdRef` is a live ref (not a value) so the handlers always act
 * on the agent the user is viewing without re-binding on every selection.
 */
export function useModelControls(
  selectedAgentIdRef: MutableRefObject<string | undefined>,
  toastRef: MutableRefObject<ModelControlsToast>,
  refreshKey: { id?: string; apiBase?: string },
) {
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogItem[]>([]);

  const refreshModelOptions = useCallback(async () => {
    try {
      const { current, options } = await fetchModelOptionsFromA8s(selectedAgentIdRef.current);
      setModelOptions(uniqueStrings([current, ...options]));
    } catch {
      setModelOptions([]);
    }
    // The full catalog (with family + ctx) powers the in-chat ModelPicker's
    // family-lock; the bare string list above is kept for legacy call sites.
    try {
      setModelCatalog(await listModelCatalog());
    } catch {
      setModelCatalog([]);
    }
  }, [selectedAgentIdRef]);

  useEffect(() => {
    void refreshModelOptions();
  }, [refreshKey.id, refreshKey.apiBase, refreshModelOptions]);

  const handleModelChange = useCallback(async (model: string) => {
    const nextModel = model.trim();
    if (!nextModel) return;
    const agentId = selectedAgentIdRef.current;
    if (!agentId) return;
    try {
      await switchModelOnA8s(agentId, nextModel);
      setModelOptions((prev) => uniqueStrings([nextModel, ...prev]));
      toastRef.current.show({
        variant: 'info',
        title: '模型已切换',
        message: nextModel,
        durationMs: 2500,
      });
    } catch (err) {
      toastRef.current.show({
        variant: 'error',
        title: '模型切换失败',
        message: err instanceof Error ? err.message : String(err),
        durationMs: 5000,
      });
    }
  }, [selectedAgentIdRef, toastRef]);

  const handleReasoningEffortChange = useCallback(async (effort: ReasoningEffort) => {
    const agentId = selectedAgentIdRef.current;
    if (!agentId) return;
    try {
      await setReasoningEffortOnA8s(agentId, effort);
    } catch (err) {
      console.error('[reasoning] failed to update:', err);
    }
  }, [selectedAgentIdRef]);

  return {
    modelOptions,
    modelCatalog,
    refreshModelOptions,
    handleModelChange,
    handleReasoningEffortChange,
  };
}
