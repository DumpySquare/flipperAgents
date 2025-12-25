/**
 * Telemetry Types
 */

/**
 * A single telemetry event record
 */
export interface TelemetryEvent {
  /** Event name - typically tool/command name */
  event: string;
  /** ISO timestamp of event */
  timestamp: string;
  /** Duration in milliseconds (for tool calls) */
  duration_ms?: number;
  /** Success/failure status */
  success?: boolean;
  /** Error classification (not message) */
  error_type?: string;
  /** Additional properties */
  properties?: Record<string, unknown>;
}

/**
 * Context about the running instance
 */
export interface TelemetryContext {
  /** Package name, e.g. @flipper/f5-mcp */
  packageName: string;
  /** Package version */
  packageVersion: string;
  /** Node.js version */
  nodeVersion: string;
  /** OS platform */
  platform: string;
  /** CPU architecture */
  arch: string;
  /** Unique instance ID (random UUID per process) */
  instanceId: string;
}

/**
 * Transport interface for sending telemetry
 */
export interface TelemetryTransport {
  send(events: TelemetryEvent[]): Promise<void>;
}

/**
 * Lifecycle event types
 */
export type LifecycleEvent = 'startup' | 'shutdown' | 'error';
