/**
 * HTTP/SSE Transport for F5 BIG-IP MCP Server
 *
 * Provides an alternative to stdio transport for development and testing.
 * Uses Server-Sent Events (SSE) for server-to-client communication.
 *
 * Endpoints:
 *   GET  /          - Usage info
 *   GET  /sse       - Establish SSE connection (returns sessionId)
 *   POST /message   - Send JSON-RPC message (requires sessionId query param)
 *   GET  /health    - Health check
 *   GET  /check     - Connection check (tests BIG-IP connectivity)
 *   POST /api/call  - Direct tool invocation (bypasses MCP protocol)
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { log } from '../lib/logger.js';

// Active SSE sessions
const sessions = new Map<string, SSEServerTransport>();

// Tool handler for direct API calls
let toolHandler: ((name: string, args: Record<string, unknown>) => Promise<string>) | null = null;

// Connection checker for /check endpoint
let connectionChecker: (() => Promise<{ connected: boolean }>) | null = null;

/**
 * Set the tool handler for direct API calls
 */
export function setToolHandler(
  handler: (name: string, args: Record<string, unknown>) => Promise<string>
): void {
  toolHandler = handler;
}

/**
 * Set connection checker for /check endpoint
 */
export function setConnectionChecker(
  checker: () => Promise<{ connected: boolean }>
): void {
  connectionChecker = checker;
}

/**
 * Parse request body as JSON
 */
async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(
  res: ServerResponse,
  data: unknown,
  status = 200
): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

/**
 * Start HTTP server with SSE transport
 */
export function startHttpTransport(mcpServer: Server, port: number): void {
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const path = url.pathname;
    const method = req.method?.toUpperCase() || 'GET';

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    try {
      // Route handling
      if (path === '/' && method === 'GET') {
        // Usage info
        sendJson(res, {
          name: 'F5 BIG-IP MCP Server',
          version: '0.1.0',
          endpoints: {
            '/': 'GET - This usage info',
            '/sse': 'GET - Establish SSE connection',
            '/message?sessionId=xxx': 'POST - Send JSON-RPC message',
            '/health': 'GET - Health check',
            '/check': 'GET - Test BIG-IP connectivity',
            '/api/call': 'POST - Direct tool invocation',
          },
        });
        return;
      }

      if (path === '/health' && method === 'GET') {
        sendJson(res, {
          status: 'ok',
          sessions: sessions.size,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (path === '/check' && method === 'GET') {
        if (connectionChecker) {
          const result = await connectionChecker();
          sendJson(res, result);
        } else {
          sendJson(res, { connected: false, error: 'No connection checker configured' });
        }
        return;
      }

      if (path === '/sse' && method === 'GET') {
        // Create SSE transport
        const sessionId = randomUUID();
        log.info('SSE connection established', { sessionId });

        const transport = new SSEServerTransport(`/message?sessionId=${sessionId}`, res);
        sessions.set(sessionId, transport);

        // Clean up on close
        res.on('close', () => {
          sessions.delete(sessionId);
          log.info('SSE connection closed', { sessionId });
        });

        await mcpServer.connect(transport);
        return;
      }

      if (path === '/message' && method === 'POST') {
        const sessionId = url.searchParams.get('sessionId');
        if (!sessionId) {
          sendJson(res, { error: 'Missing sessionId parameter' }, 400);
          return;
        }

        const transport = sessions.get(sessionId);
        if (!transport) {
          sendJson(res, { error: 'Invalid session' }, 404);
          return;
        }

        await transport.handlePostMessage(req, res);
        return;
      }

      if (path === '/api/call' && method === 'POST') {
        // Direct tool invocation (bypasses MCP protocol)
        if (!toolHandler) {
          sendJson(res, { error: 'Tool handler not configured' }, 500);
          return;
        }

        const body = (await parseBody(req)) as {
          tool?: string;
          args?: Record<string, unknown>;
        };

        if (!body.tool) {
          sendJson(res, { error: 'Missing tool parameter' }, 400);
          return;
        }

        try {
          const result = await toolHandler(body.tool, body.args || {});
          sendJson(res, { success: true, result: JSON.parse(result) });
        } catch (error) {
          sendJson(
            res,
            {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
            500
          );
        }
        return;
      }

      // 404 for unknown routes
      sendJson(res, { error: 'Not found' }, 404);
    } catch (error) {
      log.error('HTTP error', {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      sendJson(
        res,
        { error: error instanceof Error ? error.message : 'Internal error' },
        500
      );
    }
  });

  httpServer.listen(port, () => {
    log.info(`F5 BIG-IP MCP server listening on http://localhost:${port}`);
    console.error(`F5 BIG-IP MCP server listening on http://localhost:${port}`);
  });
}
