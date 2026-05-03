/**
 * MCP Client
 * ===========
 *
 * Creates MCP clients using @ai-sdk/mcp with @modelcontextprotocol/sdk
 * for stdio and StreamableHTTP transports.
 *
 * The primary path uses createMCPClient from @ai-sdk/mcp which provides
 * direct AI SDK tool integration. Stdio transport uses StdioClientTransport
 * from @modelcontextprotocol/sdk. HTTP transport uses the built-in SSE
 * transport from @ai-sdk/mcp.
 */

import { createMCPClient } from '@ai-sdk/mcp';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpClientResult, McpServerConfig, StdioTransportConfig, StreamableHttpTransportConfig } from './types';
import { type McpRegistryOptions, resolveMcpServers } from './registry';
import type { AgentType } from '../config/agent-configs';
import { getRequiredMcpServers } from '../config/agent-configs';
import type { McpServerResolveOptions } from '../config/agent-configs';

// =============================================================================
// Transport Creation
// =============================================================================

/**
 * Create the appropriate transport for an MCP server configuration.
 *
 * For stdio servers: creates a StdioClientTransport instance from @modelcontextprotocol/sdk
 * For HTTP servers: returns an SSE transport config object for @ai-sdk/mcp
 *
 * @param config - Server configuration with transport details
 * @returns Transport for createMCPClient
 */
function createTransport(
  config: McpServerConfig,
): StdioClientTransport | { type: 'sse'; url: string; headers?: Record<string, string> } {
  const { transport } = config;

  if (transport.type === 'stdio') {
    const stdioConfig = transport as StdioTransportConfig;
    return new StdioClientTransport({
      command: stdioConfig.command,
      args: stdioConfig.args ?? [],
      env: stdioConfig.env
        ? { ...process.env, ...stdioConfig.env } as Record<string, string>
        : undefined,
      cwd: stdioConfig.cwd,
    });
  }

  // StreamableHTTP transport - use SSE transport from @ai-sdk/mcp
  const httpConfig = transport as StreamableHttpTransportConfig;
  return {
    type: 'sse' as const,
    url: httpConfig.url,
    headers: httpConfig.headers,
  };
}

// =============================================================================
// Client Creation
// =============================================================================

/**
 * Create an MCP client for a single server configuration.
 *
 * Uses createMCPClient from @ai-sdk/mcp which provides tools
 * compatible with the AI SDK streamText/generateText functions.
 *
 * @param config - Server configuration to connect to
 * @returns MCP client result with tools and cleanup function
 */
export async function createMcpClient(config: McpServerConfig): Promise<McpClientResult> {
  const transport = createTransport(config);

  const client = await createMCPClient({ transport });

  const tools = await client.tools();

  return {
    serverId: config.id,
    tools,
    close: async () => {
      await client.close();
    },
  };
}

/**
 * Create MCP clients for all servers required by an agent type.
 *
 * Resolves which MCP servers the agent needs based on its configuration
 * and the current environment, then creates clients for each.
 *
 * @param agentType - The agent type to get MCP servers for
 * @param resolveOptions - Options for resolving which servers to use
 * @param registryOptions - Options for configuring server connections
 * @returns Array of MCP client results with tools and cleanup functions
 */
export async function createMcpClientsForAgent(
  agentType: AgentType,
  resolveOptions: McpServerResolveOptions = {},
  registryOptions: McpRegistryOptions = {},
): Promise<McpClientResult[]> {
  // Determine which servers this agent needs
  const serverIds = getRequiredMcpServers(agentType, resolveOptions);

  // Resolve server configurations
  const serverConfigs = resolveMcpServers(serverIds, registryOptions);

  // Create clients for each server (parallel initialization)
  const results = await Promise.allSettled(
    serverConfigs.map((config) => createMcpClient(config)),
  );

  // Collect successful clients, skip failed ones gracefully
  const clients: McpClientResult[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      clients.push(result.value);
    }
    // Failed MCP connections are non-fatal - the agent can still function
    // without optional MCP tools
  }

  return clients;
}

/**
 * Merge tools from multiple MCP clients into a single tools object.
 *
 * @param clients - Array of MCP client results
 * @returns Combined tools object for use with streamText/generateText
 */
export function mergeMcpTools(
  clients: McpClientResult[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  for (const client of clients) {
    Object.assign(merged, client.tools);
  }

  return merged;
}

/**
 * Close all MCP clients gracefully.
 *
 * @param clients - Array of MCP client results to close
 */
export async function closeAllMcpClients(
  clients: McpClientResult[],
): Promise<void> {
  await Promise.allSettled(clients.map((c) => c.close()));
}
