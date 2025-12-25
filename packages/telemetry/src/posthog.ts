/**
 * PostHog Transport
 *
 * Sends telemetry to PostHog Cloud for product analytics.
 * Uses the PostHog batch capture API.
 */

import type { TelemetryEvent, TelemetryContext, TelemetryTransport } from './types.js';
import { debugLog } from './utils.js';

// PostHog configuration
const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://app.posthog.com';

/**
 * Get PostHog API key from environment
 * Read at runtime to support testing
 */
function getApiKey(): string {
  return process.env.POSTHOG_API_KEY || '';
}

/**
 * PostHog batch event format
 */
interface PostHogEvent {
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

/**
 * PostHog batch payload format
 */
interface PostHogBatchPayload {
  api_key: string;
  batch: PostHogEvent[];
}

/**
 * Transport for sending telemetry to PostHog
 */
export class PostHogTransport implements TelemetryTransport {
  constructor(private context: TelemetryContext) {}

  /**
   * Check if PostHog is configured
   */
  isConfigured(): boolean {
    return !!getApiKey();
  }

  /**
   * Send events to PostHog batch endpoint
   */
  async send(events: TelemetryEvent[]): Promise<void> {
    if (events.length === 0) return;

    // Skip if not configured
    if (!this.isConfigured()) {
      debugLog('PostHog not configured (no API key), skipping');
      return;
    }

    const batch: PostHogEvent[] = events.map((e) => this.toPostHogEvent(e));

    const payload: PostHogBatchPayload = {
      api_key: getApiKey(),
      batch,
    };

    debugLog('PostHog payload', payload);

    try {
      const response = await fetch(`${POSTHOG_HOST}/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        debugLog(`PostHog flush successful: ${events.length} events`);
      } else {
        debugLog(`PostHog flush failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      debugLog('PostHog flush error', error instanceof Error ? error.message : error);
    }
  }

  /**
   * Convert TelemetryEvent to PostHog event format
   */
  private toPostHogEvent(event: TelemetryEvent): PostHogEvent {
    return {
      event: event.event,
      distinct_id: this.context.instanceId,
      timestamp: event.timestamp,
      properties: {
        // PostHog standard properties
        $lib: this.context.packageName,
        $lib_version: this.context.packageVersion,

        // Event properties
        duration_ms: event.duration_ms,
        success: event.success,
        error_type: event.error_type,

        // Environment properties
        node_version: this.context.nodeVersion,
        platform: this.context.platform,
        arch: this.context.arch,

        // Custom properties from event
        ...event.properties,
      },
    };
  }
}
