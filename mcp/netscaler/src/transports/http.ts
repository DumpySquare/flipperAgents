/**
 * HTTP/SSE Transport for NetScaler MCP Server
 *
 * Uses the MCP SDK's SSEServerTransport to expose the server over HTTP.
 * - GET /sse - Establish SSE connection (server -> client messages)
 * - POST /message?sessionId=xxx - Send messages to server
 * - POST /api/call - Synchronous tool call endpoint (for testing/CLI usage)
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

// Tool handler type - will be set by caller
export type ToolHandler = (name: string, args: Record<string, unknown>) => Promise<string>;

// Connection checker type - for health checks
export type ConnectionChecker = () => Promise<{ nitro: boolean; ssh: boolean }>;

const sessions = new Map<string, SSEServerTransport>();

// Tool handler - set via setToolHandler()
let toolHandler: ToolHandler | null = null;
let connectionChecker: ConnectionChecker | null = null;

export function setToolHandler(handler: ToolHandler): void {
  toolHandler = handler;
}

export function setConnectionChecker(checker: ConnectionChecker): void {
  connectionChecker = checker;
}

// Helper to read request body
async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function startHttpTransport(server: Server, port: number = 3000): void {
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url!, `http://${req.headers.host}`);

    // GET /sse - Establish SSE connection
    if (req.method === 'GET' && url.pathname === '/sse') {
      console.error(`[HTTP] New SSE connection from ${req.socket.remoteAddress}`);

      const transport = new SSEServerTransport('/message', res);
      sessions.set(transport.sessionId, transport);

      // Clean up session on close
      transport.onclose = () => {
        console.error(`[HTTP] SSE session ${transport.sessionId} closed`);
        sessions.delete(transport.sessionId);
      };

      await server.connect(transport);
      return;
    }

    // POST /message?sessionId=xxx - Handle incoming messages
    if (req.method === 'POST' && url.pathname === '/message') {
      const sessionId = url.searchParams.get('sessionId');

      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing sessionId parameter' }));
        return;
      }

      const transport = sessions.get(sessionId);
      if (!transport) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }

      await transport.handlePostMessage(req, res);
      return;
    }

    // POST /api/call - Synchronous tool call (for testing/CLI without SSE)
    if (req.method === 'POST' && url.pathname === '/api/call') {
      if (!toolHandler) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Tool handler not configured' }));
        return;
      }

      try {
        const body = await readBody(req);
        const { tool, args } = JSON.parse(body) as { tool: string; args?: Record<string, unknown> };

        if (!tool) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "tool" field in request body' }));
          return;
        }

        console.error(`[HTTP] API call: ${tool}`);
        const result = await toolHandler(tool, args || {});

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result }));
      } catch (error) {
        console.error(`[HTTP] API call error:`, error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: error instanceof Error ? error.message : String(error)
        }));
      }
      return;
    }

    // GET /health - Simple health check
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        sessions: sessions.size,
        transport: 'sse'
      }));
      return;
    }

    // GET /check - Deep health check (tests NetScaler connectivity)
    if (req.method === 'GET' && url.pathname === '/check') {
      if (!connectionChecker) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Connection checker not configured' }));
        return;
      }

      try {
        console.error('[HTTP] Running connection check...');
        const connectivity = await connectionChecker();
        const allOk = connectivity.nitro && connectivity.ssh;

        res.writeHead(allOk ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: allOk ? 'ok' : 'degraded',
          netscaler: {
            nitro: connectivity.nitro ? 'ok' : 'unreachable',
            ssh: connectivity.ssh ? 'ok' : 'unreachable'
          },
          sessions: sessions.size
        }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        }));
      }
      return;
    }

    // POST /shutdown - Graceful shutdown (for development/testing)
    if (req.method === 'POST' && url.pathname === '/shutdown') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'shutting down' }));
      console.error('[HTTP] Shutdown requested, closing server...');
      // Close all SSE sessions
      for (const transport of sessions.values()) {
        transport.close();
      }
      sessions.clear();
      // Close HTTP server and exit
      httpServer.close(() => {
        console.error('[HTTP] Server closed');
        process.exit(0);
      });
      return;
    }

    // GET / - Usage info
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'netscaler-mcp',
        transport: 'sse',
        endpoints: {
          '/sse': 'GET - Establish SSE connection',
          '/message?sessionId=xxx': 'POST - Send JSON-RPC message',
          '/api/call': 'POST - Synchronous tool call (body: {"tool": "name", "args": {...}})',
          '/health': 'GET - Quick health check (MCP server only)',
          '/check': 'GET - Deep health check (tests NetScaler NITRO + SSH connectivity)',
          '/shutdown': 'POST - Graceful shutdown'
        }
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  httpServer.listen(port, () => {
    console.error(`NetScaler MCP server (HTTP/SSE) listening on port ${port}`);
  });
}
