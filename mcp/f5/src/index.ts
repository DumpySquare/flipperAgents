#!/usr/bin/env node
/**
 * F5 BIG-IP MCP Server
 *
 * Provides tools for managing F5 BIG-IP devices via Claude Desktop or any MCP client.
 *
 * Configuration via environment variables:
 *   F5_HOST     - BIG-IP hostname/IP (optional if using connect tool)
 *   F5_USER     - Username (default: admin)
 *   F5_PASS     - Password
 *   F5_PORT     - Management port (default: 443)
 *   F5_PROVIDER - Auth provider (default: tmos)
 *   HTTP_PORT   - Enable HTTP/SSE transport on specified port
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { F5Client } from './lib/f5-client.js';
import { log, logToolCall } from './lib/logger.js';

// Import tool definitions and handlers
import { connectionTools, handleConnectionTool } from './tools/connection.js';
import { backupTools, handleBackupTool } from './tools/backup.js';
import { systemTools, handleSystemTool } from './tools/system.js';
import { deploymentTools, handleDeploymentTool } from './tools/deployment.js';
import { haTools, handleHaTool } from './tools/ha.js';
import { monitoringTools, handleMonitoringTool } from './tools/monitoring.js';

// Combine all tools
const tools = [
  ...connectionTools,
  ...backupTools,
  ...systemTools,
  ...deploymentTools,
  ...haTools,
  ...monitoringTools,
];

// Tool name to category mapping
const toolCategories: Record<string, string> = {};
connectionTools.forEach((t) => (toolCategories[t.name] = 'connection'));
backupTools.forEach((t) => (toolCategories[t.name] = 'backup'));
systemTools.forEach((t) => (toolCategories[t.name] = 'system'));
deploymentTools.forEach((t) => (toolCategories[t.name] = 'deployment'));
haTools.forEach((t) => (toolCategories[t.name] = 'ha'));
monitoringTools.forEach((t) => (toolCategories[t.name] = 'monitoring'));

// Global client instance
let f5Client: F5Client | null = null;

/**
 * Initialize client from environment variables if configured
 */
async function initClientFromEnv(): Promise<void> {
  const host = process.env.F5_HOST;
  const password = process.env.F5_PASS;

  if (host && password) {
    log.info('Initializing F5 client from environment variables', { host });
    f5Client = new F5Client({
      host,
      username: process.env.F5_USER || 'admin',
      password,
      port: process.env.F5_PORT ? parseInt(process.env.F5_PORT, 10) : 443,
      provider: process.env.F5_PROVIDER || 'tmos',
    });

    try {
      await f5Client.connect();
      log.info('Connected to BIG-IP from environment config');
    } catch (error) {
      log.warn('Failed to connect from environment config', {
        error: error instanceof Error ? error.message : String(error),
      });
      f5Client = null;
    }
  }
}

/**
 * Get or throw client
 */
function getClient(): F5Client {
  if (!f5Client || !f5Client.isConnected()) {
    throw new Error(
      'Not connected to BIG-IP. Use the connect tool or set F5_HOST/F5_PASS environment variables.'
    );
  }
  return f5Client;
}

/**
 * Set global client (used by connect tool)
 */
function setClient(client: F5Client | null): void {
  f5Client = client;
}

/**
 * Handle tool calls - routes to appropriate handler
 */
async function handleToolCallImpl(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const category = toolCategories[name];

  // Connection tools can work without existing connection
  if (category === 'connection') {
    return handleConnectionTool(name, args, f5Client!, setClient);
  }

  // All other tools require an active connection
  const client = getClient();

  switch (category) {
    case 'backup':
      return handleBackupTool(name, args, client);
    case 'system':
      return handleSystemTool(name, args, client);
    case 'deployment':
      return handleDeploymentTool(name, args, client);
    case 'ha':
      return handleHaTool(name, args, client);
    case 'monitoring':
      return handleMonitoringTool(name, args, client);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Wrapper with logging
 */
async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const startTime = Date.now();
  log.info(`Tool call started: ${name}`, { tool: name });

  try {
    const result = await handleToolCallImpl(name, args);
    const durationMs = Date.now() - startTime;
    logToolCall(name, args, { success: true }, durationMs);
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    logToolCall(name, args, { success: false, error: errorMsg }, durationMs);
    throw error;
  }
}

/**
 * Create and configure MCP server
 */
function createServer(): Server {
  const server = new Server(
    {
      name: 'f5-bigip-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await handleToolCall(name, args as Record<string, unknown>);
      return {
        content: [{ type: 'text', text: result }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const httpPort = process.env.HTTP_PORT
    ? parseInt(process.env.HTTP_PORT, 10)
    : null;

  // Initialize client from env if configured
  await initClientFromEnv();

  if (httpPort) {
    // HTTP/SSE transport mode
    log.info('Starting HTTP transport', { port: httpPort });
    const { startHttpTransport, setToolHandler } = await import(
      './transports/http.js'
    );
    const server = createServer();
    setToolHandler(handleToolCall);
    startHttpTransport(server, httpPort);
  } else {
    // Default: stdio transport (for Claude Desktop)
    log.debug('Initializing stdio transport');

    const server = createServer();
    const transport = new StdioServerTransport();

    log.debug('Connecting server to transport');
    await server.connect(transport);
    log.info('F5 BIG-IP MCP server started (stdio)', { pid: process.pid });
  }
}

main().catch((error) => {
  log.error('Fatal error', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
