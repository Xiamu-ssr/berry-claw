import type { ContentBlock } from '@berry-agent/claw-contracts';

export type WorkspaceRailTab = 'browser' | 'files' | 'session';
export type AnnotationBlock = Extract<ContentBlock, { type: 'annotation' }>;

export interface AnnotationAttachment {
  id: string;
  block: AnnotationBlock;
}

export interface SessionListItem {
  id: string;
  title?: string;
  updatedAt?: number;
  messageCount?: number;
  status?: 'idle' | 'running' | 'interrupted' | string;
}
