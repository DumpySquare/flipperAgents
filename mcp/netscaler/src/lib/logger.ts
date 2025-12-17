/**
 * MCP Server Logging Module
 *
 * Provides structured logging with:
 * - Timestamps in ISO format
 * - Log levels (DEBUG, INFO, WARN, ERROR)
 * - Optional file output via LOG_FILE env var
 * - JSON structured format for log aggregation
 *
 * Usage:
 *   import { log, logToolCall } from './lib/logger.js';
 *   log.info('Server started', { port: 3000 });
 *   logToolCall('deploy_config', { config: '...' }, result, durationMs);
 */

import { appendFileSync } from 'node:fs';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

const LOG_FILE = process.env.LOG_FILE;
const LOG_LEVEL = (process.env.LOG_LEVEL || 'INFO').toUpperCase() as LogLevel;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[LOG_LEVEL];
}

function formatLog(entry: LogEntry): string {
  const { timestamp, level, message, data } = entry;
  if (data && Object.keys(data).length > 0) {
    return `[${timestamp}] [${level}] ${message} ${JSON.stringify(data)}`;
  }
  return `[${timestamp}] [${level}] ${message}`;
}

function writeLog(entry: LogEntry): void {
  if (!shouldLog(entry.level)) return;

  const formatted = formatLog(entry);

  // Always write to stderr (MCP servers use stdout for protocol)
  console.error(formatted);

  // Optionally write to file
  if (LOG_FILE) {
    try {
      appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
    } catch {
      // Ignore file write errors
    }
  }
}

function createLogger(level: LogLevel) {
  return (message: string, data?: Record<string, unknown>): void => {
    writeLog({
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    });
  };
}

export const log = {
  debug: createLogger('DEBUG'),
  info: createLogger('INFO'),
  warn: createLogger('WARN'),
  error: createLogger('ERROR'),
};

/**
 * Log a tool call for auditing purposes
 */
export function logToolCall(
  toolName: string,
  args: Record<string, unknown>,
  result: { success: boolean; error?: string },
  durationMs: number
): void {
  // Redact sensitive data in args
  const redactedArgs = { ...args };
  if ('config' in redactedArgs && typeof redactedArgs.config === 'string') {
    redactedArgs.config = `[${(redactedArgs.config as string).length} chars]`;
  }

  log.info(`Tool call: ${toolName}`, {
    tool: toolName,
    args: redactedArgs,
    success: result.success,
    error: result.error,
    durationMs,
  });
}
