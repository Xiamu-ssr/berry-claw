import {
  AgentScope,
  createAgentFileBrowser,
  type AgentBrowseRoot as SDKAgentBrowseRoot,
  type AgentFileContent as SDKAgentFileContent,
  type AgentFileEntry as SDKAgentFileEntry,
  type AgentFileList as SDKAgentFileList,
} from '@berry-agent/core';
import type { ConfigManager } from './config-manager.js';

export interface AgentBrowseRoot extends SDKAgentBrowseRoot {
  agentId: string;
}

export type AgentFileEntry = SDKAgentFileEntry;

export interface AgentFileList extends Omit<SDKAgentFileList, 'root'> {
  root: AgentBrowseRoot;
}

export interface AgentFileContent extends Omit<SDKAgentFileContent, 'root'> {
  root: AgentBrowseRoot;
}

export class AgentFileHost {
  constructor(
    private readonly config: ConfigManager,
  ) {}

  browseRoot(agentId: string): AgentBrowseRoot {
    const { agentId: targetId, browser } = this.agentFileBrowserFor(agentId);
    return { agentId: targetId, ...browser.browseRoot() };
  }

  async list(agentId: string, requestPath = ''): Promise<AgentFileList> {
    const { agentId: targetId, browser } = this.agentFileBrowserFor(agentId);
    const list = await browser.list(requestPath);
    return { ...list, root: { agentId: targetId, ...list.root } };
  }

  async read(agentId: string, requestPath = ''): Promise<AgentFileContent> {
    const { agentId: targetId, browser } = this.agentFileBrowserFor(agentId);
    const file = await browser.read(requestPath);
    return { ...file, root: { agentId: targetId, ...file.root } };
  }

  private agentFileBrowserFor(agentId: string): {
    agentId: string;
    browser: ReturnType<typeof createAgentFileBrowser>;
  } {
    const entry = this.config.getAgent(agentId);
    if (!entry) throw new Error(`Agent "${agentId}" not found`);
    const workspace = entry.workspace ?? this.config.agentWorkspace(agentId);
    return {
      agentId,
      browser: createAgentFileBrowser(new AgentScope(workspace, entry.project)),
    };
  }
}
