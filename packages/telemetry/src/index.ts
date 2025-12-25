/**
 * @flipper/telemetry
 *
 * Telemetry client for flipperAgents MCP servers.
 * Dual-ships events to F5 TEEM and PostHog Cloud.
 *
 * Usage:
 *   import { TelemetryClient, classifyError, setupGlobalErrorHandlers } from '@flipper/telemetry';
 *
 *   const telemetry = new TelemetryClient('flipperagents-tmos-mcp', '0.1.0');
 *   setupGlobalErrorHandlers(telemetry);
 *
 *   // Capture tool calls
 *   telemetry.capture('get_pool_members', 245, true);
 *   telemetry.capture('create_virtual', 1823, false, classifyError(error));
 *
 *   // Lifecycle events
 *   telemetry.lifecycle('startup', { transport: 'stdio' });
 *
 * Privacy:
 *   - Only collects tool names, durations, success/failure, error types
 *   - NO IP addresses, hostnames, credentials, or PII
 *   - Anonymous instance ID per process
 *
 * Opt-out:
 *   Set FLIPPER_TELEMETRY_ENABLED=false or DO_NOT_TRACK=1
 */

import { randomUUID } from 'node:crypto';
import os from 'node:os';
import type { TelemetryEvent, TelemetryContext, LifecycleEvent } from './types.js';
import { TeemTransport } from './teem.js';
import { PostHogTransport } from './posthog.js';
import { isTelemetryEnabled, debugLog, classifyError as classifyErrorUtil } from './utils.js';

// Re-export types and utilities
export type { TelemetryEvent, TelemetryContext, LifecycleEvent } from './types.js';
export { classifyError, setupGlobalErrorHandlers } from './utils.js';

/**
 * Telemetry client for MCP servers
 *
 * Journals events and batch-sends them to configured transports.
 * Automatically flushes on interval and process exit.
 */
export class TelemetryClient {
  private readonly enabled: boolean;
  private readonly context: TelemetryContext;
  private readonly teem: TeemTransport;
  private readonly posthog: PostHogTransport;

  private journal: TelemetryEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  private readonly FLUSH_INTERVAL_MS = 60_000; // 60 seconds
  private readonly MAX_BATCH_SIZE = 50;
  private readonly MAX_JOURNAL_SIZE = 200; // Prevent unbounded growth

  constructor(packageName: string, packageVersion: string) {
    this.enabled = isTelemetryEnabled();

    this.context = {
      packageName,
      packageVersion,
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch(),
      instanceId: randomUUID(),
    };

    this.teem = new TeemTransport(this.context);
    this.posthog = new PostHogTransport(this.context);

    if (this.enabled) {
      debugLog(`Telemetry enabled for ${packageName}@${packageVersion}`, {
        instanceId: this.context.instanceId,
      });
      this.startFlushTimer();
      this.setupExitHandlers();
    } else {
      debugLog('Telemetry disabled');
    }
  }

  /**
   * Capture a telemetry event
   *
   * @param event - Event name (typically tool/command name)
   * @param durationMs - Duration in milliseconds
   * @param success - Whether the operation succeeded
   * @param errorType - Error classification (use classifyError())
   * @param properties - Additional properties
   */
  capture(
    event: string,
    durationMs?: number,
    success = true,
    errorType?: string,
    properties?: Record<string, unknown>
  ): void {
    if (!this.enabled) return;

    const record: TelemetryEvent = {
      event,
      timestamp: new Date().toISOString(),
      duration_ms: durationMs,
      success,
      error_type: errorType,
      properties,
    };

    this.journal.push(record);
    debugLog('Captured', record);

    // Flush if batch size reached
    if (this.journal.length >= this.MAX_BATCH_SIZE) {
      this.flush();
    }

    // Prevent unbounded growth
    if (this.journal.length > this.MAX_JOURNAL_SIZE) {
      this.journal = this.journal.slice(-this.MAX_BATCH_SIZE);
    }
  }

  /**
   * Capture a lifecycle event
   *
   * @param event - Lifecycle event type
   * @param properties - Additional properties
   */
  lifecycle(event: LifecycleEvent, properties?: Record<string, unknown>): void {
    this.capture(`mcp_${event}`, undefined, event !== 'error', undefined, properties);
  }

  /**
   * Capture an error with classification
   *
   * @param error - The error to capture
   * @param context - Context about where the error occurred
   */
  captureError(error: unknown, context?: string): void {
    this.capture(context || 'uncaught_error', 0, false, classifyErrorUtil(error));
    // Flush immediately for errors
    this.flush();
  }

  /**
   * Flush pending events to all transports
   */
  async flush(): Promise<void> {
    if (!this.enabled || this.journal.length === 0 || this.isFlushing) {
      return;
    }

    this.isFlushing = true;

    // Take current journal and clear it
    const events = [...this.journal];
    this.journal = [];

    debugLog(`Flushing ${events.length} events`);

    try {
      // Dual-ship to both transports
      await Promise.allSettled([
        this.teem.send(events),
        this.posthog.send(events),
      ]);
    } catch (error) {
      // Don't let telemetry errors affect the main application
      debugLog('Flush error', error);
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Check if telemetry is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get the instance ID
   */
  getInstanceId(): string {
    return this.context.instanceId;
  }

  /**
   * Get the telemetry context
   */
  getContext(): Readonly<TelemetryContext> {
    return this.context;
  }

  /**
   * Start the periodic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.FLUSH_INTERVAL_MS);

    // Don't prevent process from exiting
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  /**
   * Stop the flush timer
   */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Setup process exit handlers to flush remaining events
   */
  private setupExitHandlers(): void {
    const exitHandler = async () => {
      this.stopFlushTimer();
      await this.flush();
    };

    process.on('beforeExit', exitHandler);

    process.on('SIGINT', async () => {
      await exitHandler();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await exitHandler();
      process.exit(0);
    });
  }
}

/**
 * Create a telemetry client instance
 *
 * Convenience function for creating a telemetry client.
 */
export function createTelemetryClient(
  packageName: string,
  packageVersion: string
): TelemetryClient {
  return new TelemetryClient(packageName, packageVersion);
}
