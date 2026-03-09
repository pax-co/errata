import { apiFetch } from './client'
import type {
  AgentBlockInfo,
  AgentBlocksResponse,
  AgentBlockConfig,
  ExportedAgentConfig,
  BlockPreviewResponse,
  CustomBlockDefinition,
  BlockOverride,
  ModelRoleInfo,
} from './types'

export const agentBlocks = {
  list: () =>
    apiFetch<AgentBlockInfo[]>('/agent-blocks'),

  listModelRoles: () =>
    apiFetch<ModelRoleInfo[]>('/model-roles'),

  get: (storyId: string, agentName: string) =>
    apiFetch<AgentBlocksResponse>(`/stories/${storyId}/agent-blocks/${agentName}`),

  preview: (storyId: string, agentName: string) =>
    apiFetch<BlockPreviewResponse>(`/stories/${storyId}/agent-blocks/${agentName}/preview`),

  exportConfig: (storyId: string, agentName: string) =>
    apiFetch<ExportedAgentConfig>(`/stories/${storyId}/agent-blocks/${agentName}/export-config`),

  importConfig: (storyId: string, agentName: string, config: AgentBlockConfig) =>
    apiFetch<{ ok: boolean }>(`/stories/${storyId}/agent-blocks/${agentName}/import-config`, {
      method: 'POST',
      body: JSON.stringify({ config }),
    }),

  createCustom: (storyId: string, agentName: string, data: CustomBlockDefinition) =>
    apiFetch<AgentBlockConfig>(`/stories/${storyId}/agent-blocks/${agentName}/custom`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateCustom: (storyId: string, agentName: string, blockId: string, data: Partial<Omit<CustomBlockDefinition, 'id'>>) =>
    apiFetch<AgentBlockConfig>(`/stories/${storyId}/agent-blocks/${agentName}/custom/${blockId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteCustom: (storyId: string, agentName: string, blockId: string) =>
    apiFetch<AgentBlockConfig>(`/stories/${storyId}/agent-blocks/${agentName}/custom/${blockId}`, {
      method: 'DELETE',
    }),

  updateConfig: (storyId: string, agentName: string, data: {
    overrides?: Record<string, BlockOverride>
    blockOrder?: string[]
    disabledTools?: string[]
  }) =>
    apiFetch<AgentBlockConfig>(`/stories/${storyId}/agent-blocks/${agentName}/config`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
}
