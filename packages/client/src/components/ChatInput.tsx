import { useCallback, useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Brain, Paperclip, Pause, Send, X } from 'lucide-react';
import type { ContentBlock, ModelCatalogItem } from '@berry-agent/claw-contracts';
import type { AnnotationAttachment } from './WorkspaceRail';
import { cn } from '../utils/cn';
import { modelFamily } from '../utils/format';
import { ModelPicker } from './ui/ModelPicker';

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';

interface ChatInputProps {
  onSend: (prompt: string | ContentBlock[]) => void;
  onInterject?: (text: string) => void;
  onPause?: () => void;
  isLoading: boolean;
  agentName?: string;
  contextWindow: number | null;
  model?: string;
  modelOptions: string[];
  /** Full catalog (family + ctx) for the in-chat ModelPicker family-lock.
   *  When absent we fall back to a plain list built from modelOptions. */
  modelCatalog?: ModelCatalogItem[];
  onModelChange?: (model: string) => void;
  reasoningEffort?: ReasoningEffort;
  onReasoningEffortChange?: (effort: ReasoningEffort) => void;
  incomingAnnotation?: AnnotationAttachment;
}

interface ImageAttachment {
  id: string;
  name: string;
  mediaType: string;
  dataUrl: string;
  data: string;
  sizeBytes: number;
}

interface QueuedPrompt {
  id: string;
  text: string;
  attachments: ImageAttachment[];
  annotations: AnnotationAttachment[];
  createdAt: number;
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ACCEPTED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export default function ChatInput({
  onSend,
  onInterject,
  onPause,
  isLoading,
  agentName,
  contextWindow,
  model,
  modelOptions,
  modelCatalog,
  onModelChange,
  reasoningEffort,
  onReasoningEffortChange,
  incomingAnnotation,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationAttachment[]>([]);
  const [queue, setQueue] = useState<QueuedPrompt[]>([]);
  const [awaitingQueueStart, setAwaitingQueueStart] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const reasonRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (reasonRef.current && !reasonRef.current.contains(e.target as Node)) {
        setReasonOpen(false);
      }
    }
    if (reasonOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [reasonOpen]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  useEffect(() => {
    if (!incomingAnnotation) return;
    setAnnotations((prev) => prev.some((item) => item.id === incomingAnnotation.id)
      ? prev
      : [...prev, incomingAnnotation]);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [incomingAnnotation]);

  const ingestFile = useCallback(async (file: File): Promise<ImageAttachment | null> => {
    if (!ACCEPTED_IMAGE_MIME.includes(file.type) || file.size > MAX_IMAGE_BYTES) return null;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
    const comma = dataUrl.indexOf(',');
    return {
      id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: file.name || 'pasted-image',
      mediaType: file.type,
      dataUrl,
      data: comma >= 0 ? dataUrl.slice(comma + 1) : '',
      sizeBytes: file.size,
    };
  }, []);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const incoming: ImageAttachment[] = [];
    for (const file of Array.from(files)) {
      const att = await ingestFile(file);
      if (att) incoming.push(att);
    }
    if (incoming.length > 0) setAttachments((prev) => [...prev, ...incoming]);
  }, [ingestFile]);

  const promptFromDraft = useCallback((text: string, draftAttachments: ImageAttachment[], draftAnnotations: AnnotationAttachment[]): string | ContentBlock[] => {
    if (draftAttachments.length === 0 && draftAnnotations.length === 0) return text;
    const blocks: ContentBlock[] = draftAttachments.map((a) => ({
      type: 'image',
      data: a.data,
      mediaType: a.mediaType,
    }));
    blocks.push(...draftAnnotations.map((annotation) => annotation.block));
    if (text) blocks.push({ type: 'text', text });
    return blocks;
  }, []);

  useEffect(() => {
    if (isLoading && awaitingQueueStart) setAwaitingQueueStart(false);
  }, [awaitingQueueStart, isLoading]);

  useEffect(() => {
    if (isLoading || awaitingQueueStart || queue.length === 0) return;
    const [next, ...rest] = queue;
    onSend(promptFromDraft(next.text, next.attachments, next.annotations));
    setQueue(rest);
    setAwaitingQueueStart(true);
  }, [awaitingQueueStart, isLoading, onSend, promptFromDraft, queue]);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text && attachments.length === 0 && annotations.length === 0) return;
    setQueue((prev) => [
      ...prev,
      {
        id: `queue_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text,
        attachments,
        annotations,
        createdAt: Date.now(),
      },
    ]);
    setInput('');
    setAttachments([]);
    setAnnotations([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const editQueuedPrompt = (id: string) => {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    setInput(item.text);
    setAttachments(item.attachments);
    setAnnotations(item.annotations);
    setQueue((prev) => prev.filter((q) => q.id !== id));
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const sendQueuedPromptNow = (id: string) => {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    if (onInterject && item.attachments.length === 0 && item.annotations.length === 0) {
      onInterject(item.text);
    } else if (!isLoading) {
      onSend(promptFromDraft(item.text, item.attachments, item.annotations));
      setAwaitingQueueStart(true);
    } else {
      return;
    }
    setQueue((prev) => prev.filter((q) => q.id !== id));
  };

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    await addFiles(files);
  }, [addFiles]);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLElement>) => {
    if (e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    await addFiles(e.dataTransfer.files);
  }, [addFiles]);

  // Prefer the rich catalog (family + ctx) so the in-chat switch can family-lock
  // to the current model; fall back to a flat catalog synthesized from the bare
  // model id list when the catalog hasn't loaded.
  const catalog: ModelCatalogItem[] = modelCatalog?.length
    ? modelCatalog
    : [...new Set([model, ...modelOptions].filter((m): m is string => !!m))].map((m) => ({
        model: m,
        providerName: m.startsWith('tier:') ? 'tier' : '',
        type: m.startsWith('tier:') ? 'tier' : 'model',
        family: modelFamily(m),
      }));
  const lockFamily = modelFamily(model) ?? catalog.find((m) => m.model === model)?.family;

  return (
    <div className="relative rounded-3xl border border-white/[0.08] bg-[#1a1c20]/80 p-2 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.05)_inset] backdrop-blur-2xl transition-all duration-300">
      <div className="mx-auto w-full">
        {queue.length > 0 && (
          <div className="mb-2 space-y-1.5 rounded-2xl border border-white/[0.04] bg-white/[0.02] p-2 backdrop-blur-md">
            <div className="flex items-center justify-between px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              <span>Queue</span>
              <span className="text-[var(--theme-primary)]">{queue.length} pending</span>
            </div>
            <AnimatePresence initial={false}>
              {queue.map((item, index) => {
                const canInterject = !!onInterject && item.attachments.length === 0 && item.annotations.length === 0;
                const canSendNow = canInterject || !isLoading;
                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, height: 0, y: 10 }}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -10 }}
                    className="flex items-center gap-3 rounded-xl bg-black/20 px-3 py-2 text-xs text-zinc-400 shadow-inner"
                  >
                    <span className="shrink-0 font-mono text-[10px] text-zinc-600">#{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-300">
                      {item.text || `${item.attachments.length} image · ${item.annotations.length} annotation`}
                    </span>
                    {item.attachments.length > 0 && (
                      <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-zinc-400">
                        {item.attachments.length} image
                      </span>
                    )}
                    {item.annotations.length > 0 && (
                      <span className="shrink-0 rounded-full bg-sky-300/10 px-2 py-0.5 text-[10px] text-sky-200">
                        {item.annotations.length} note
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => editQueuedPrompt(item.id)}
                      className="shrink-0 rounded-lg px-2 py-1 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      disabled={!canSendNow}
                      onClick={() => sendQueuedPromptNow(item.id)}
                      title={canInterject ? '立即插入当前回合' : '立即发送'}
                      className="shrink-0 rounded-lg bg-[var(--theme-primary-soft)] px-2 py-1 text-[var(--theme-primary)] transition-colors hover:bg-[var(--theme-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      发送
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2 px-2">
            {attachments.map((a) => (
              <div key={a.id} className="group relative">
                <img
                  src={a.dataUrl}
                  alt={a.name}
                  className="h-16 w-16 rounded-xl border border-white/[0.1] object-cover shadow-sm"
                />
                <button
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                  className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-zinc-400 opacity-0 shadow-md transition-all group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-200"
                  title="Remove"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {annotations.length > 0 && (
          <div className="mb-3 space-y-2 px-2">
            {annotations.map((item) => (
              <div key={item.id} className="flex gap-3 rounded-2xl border border-sky-300/15 bg-sky-300/[0.06] p-2">
                <img
                  src={`data:${item.block.image.mediaType};base64,${item.block.image.data}`}
                  alt="annotation"
                  className="h-16 w-20 shrink-0 rounded-xl border border-white/[0.10] object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-sky-100">{item.block.body}</div>
                  <div className="mt-1 truncate font-mono text-[10px] text-zinc-500">{item.block.source.url}</div>
                </div>
                <button
                  type="button"
                  title="Remove annotation"
                  onClick={() => setAnnotations((prev) => prev.filter((x) => x.id !== item.id))}
                  className="h-6 w-6 rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
                >
                  <X size={12} className="mx-auto" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="relative flex min-h-[44px] items-end gap-2 rounded-2xl bg-transparent px-1">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            placeholder={`Ask ${agentName ?? 'Agent'} something...`}
            rows={1}
            className="max-h-[240px] w-full resize-none bg-transparent py-3 pl-3 pr-10 text-[14px] leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:outline-none hide-scrollbar"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_IMAGE_MIME.join(',')}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Attach image"
            className="absolute bottom-2.5 right-12 flex h-8 w-8 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <Paperclip size={16} />
          </button>
          <button
            onClick={isLoading && onPause ? onPause : handleSubmit}
            disabled={!isLoading && !input.trim() && attachments.length === 0 && annotations.length === 0}
            title={isLoading && onPause ? '暂停当前执行' : '发送'}
            className="absolute bottom-2.5 right-2 flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--theme-primary)] text-[#0a0a0a] shadow-[0_4px_12px_var(--theme-primary-glow)] transition-all hover:opacity-90 hover:shadow-[0_4px_16px_var(--theme-primary-glow)] disabled:cursor-not-allowed disabled:bg-white/[0.04] disabled:text-zinc-600 disabled:shadow-none"
          >
            {isLoading ? <Pause size={14} /> : <Send size={14} className="ml-0.5" />}
          </button>
        </div>

        <div className="mt-1 flex items-center justify-between px-3 pb-1 text-[11px] text-zinc-500">
          <div className="flex items-center gap-4">
            <div className="relative" ref={reasonRef}>
              <button
                onClick={() => setReasonOpen(!reasonOpen)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors",
                  reasoningEffort && reasoningEffort !== 'none'
                    ? 'bg-[var(--theme-primary-soft)] text-[var(--theme-primary)]'
                    : 'hover:bg-white/[0.06] hover:text-zinc-300',
                )}
              >
                <Brain size={12} />
                <span>Reason{reasoningEffort && reasoningEffort !== 'none' ? `: ${reasoningEffort}` : ''}</span>
              </button>
              <AnimatePresence>
                {reasonOpen && onReasoningEffortChange && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-[calc(100%+8px)] left-0 z-50 min-w-[140px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1a1c20] p-1 shadow-2xl backdrop-blur-xl"
                  >
                    <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                      Reasoning Effort
                    </div>
                    {(['none', 'low', 'medium', 'high', 'max', 'xhigh'] as const).map((effort) => (
                      <button
                        key={effort}
                        onClick={() => {
                          onReasoningEffortChange(effort);
                          setReasonOpen(false);
                        }}
                        className={cn(
                          "w-full rounded-xl px-3 py-2 text-left text-[12px] capitalize transition-colors",
                          reasoningEffort === effort
                            ? 'bg-[var(--theme-primary-soft)] font-medium text-[var(--theme-primary)]'
                            : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200',
                        )}
                      >
                        {effort}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            {catalog.length > 0 && onModelChange && (
              <ModelPicker
                catalog={catalog}
                value={model}
                onSelect={onModelChange}
                lockFamily={lockFamily}
                placeholder="模型"
                className="min-w-[120px]"
                panelClassName="bottom-full mb-1 w-[min(360px,80vw)]"
              />
            )}
          </div>
          <div className="font-mono text-[10px] tracking-wide opacity-50">
            {attachments.length > 0 ? `${attachments.length} IMG · ` : ''}
            {annotations.length > 0 ? `${annotations.length} NOTE · ` : ''}
            {Math.round((input.length / 1024) * 10) / 10}K / {contextWindow ? `${Math.round(contextWindow / 1024)}K` : '∞'}
          </div>
        </div>
      </div>
    </div>
  );
}
