/**
 * F5 TEEM Transport
 *
 * Sends telemetry to F5's internal TEEM endpoint.
 * Based on vscode-f5 telemetry implementation.
 */

import { randomUUID } from 'node:crypto';
import type { TelemetryEvent, TelemetryContext, TelemetryTransport } from './types.js';
import { debugLog } from './utils.js';

const TEEM_ENDPOINT = 'https://product.apis.f5.com/ee/v1/telemetry';

// API key from vscode-f5 (base64 encoded in segments for obfuscation)
const TEEM_API_KEY = Buffer.from(
  ['bW1oSlUyc0Nk', 'NjNCem5YQVh', 'EaDRreExJ', 'eWZJTW0zQXI='].join(''),
  'base64'
).toString();

/**
 * TEEM telemetry record format
 */
interface TeemRecord {
  id: string;
  timestamp: string;
  command: string;
  duration_ms: number;
  success: boolean;
  error_type?: string;
}

/**
 * TEEM payload format
 */
interface TeemPayload {
  documentType: string;
  documentVersion: string;
  digitalAssetId: string;
  digitalAssetName: string;
  digitalAssetVersion: string;
  observationStartTime: string;
  observationEndTime: string;
  epochTime: number;
  telemetryRecords: TeemRecord[];
}

/**
 * Transport for sending telemetry to F5 TEEM
 */
export class TeemTransport implements TelemetryTransport {
  constructor(private context: TelemetryContext) {}

  /**
   * Send events to TEEM endpoint
   */
  async send(events: TelemetryEvent[]): Promise<void> {
    if (events.length === 0) return;

    const now = new Date();

    const payload: TeemPayload = {
      documentType: 'FlipperAgents MCP Telemetry Data',
      documentVersion: '1',
      digitalAssetId: this.context.instanceId,
      digitalAssetName: this.context.packageName,
      digitalAssetVersion: this.context.packageVersion,
      observationStartTime: events[0].timestamp,
      observationEndTime: now.toISOString(),
      epochTime: now.getTime(),
      telemetryRecords: events.map((e) => this.toTeemRecord(e)),
    };

    debugLog('TEEM payload', payload);

    try {
      const response = await fetch(TEEM_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'F5-ApiKey': TEEM_API_KEY,
          'F5-DigitalAssetId': this.context.instanceId,
          'F5-TraceId': randomUUID(),
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        debugLog(`TEEM flush successful: ${events.length} events`);
      } else {
        debugLog(`TEEM flush failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      debugLog('TEEM flush error', error instanceof Error ? error.message : error);
    }
  }

  /**
   * Convert TelemetryEvent to TEEM record format
   */
  private toTeemRecord(event: TelemetryEvent): TeemRecord {
    return {
      id: randomUUID(),
      timestamp: event.timestamp,
      command: event.event,
      duration_ms: event.duration_ms ?? 0,
      success: event.success ?? true,
      ...(event.error_type && { error_type: event.error_type }),
    };
  }
}
