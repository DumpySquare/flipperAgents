# flipperAgents Telemetry Specification

## Overview

Telemetry client for tracking usage and adoption of flipperAgents MCP servers. Dual-ships events to:
- **F5 TEEM** - Internal F5 product telemetry (existing)
- **PostHog Cloud** - Product analytics for dashboards, funnels, retention

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│ flipperagents-  │     │ flipperagents-  │
│   tmos-mcp      │     │     ns-mcp      │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
         ┌───────────────────────┐
         │  @flipper/telemetry   │  (shared package)
         └───────────┬───────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
   ┌──────────┐           ┌──────────┐
   │ F5 TEEM  │           │ PostHog  │
   │   API    │  Cloud    │  Cloud   │
   └──────────┘           └──────────┘
```

## Package Location

```
packages/
└── telemetry/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts           # Main exports + TelemetryClient class
        ├── types.ts           # Shared types
        ├── teem.ts            # F5 TEEM transport
        ├── posthog.ts         # PostHog transport  
        └── utils.ts           # Error classification, env detection
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FLIPPER_TELEMETRY_ENABLED` | `true` | Master kill switch |
| `POSTHOG_API_KEY` | (bundled) | PostHog project API key |
| `POSTHOG_HOST` | `https://app.posthog.com` | PostHog instance |
| `FLIPPER_DEBUG_TELEMETRY` | `false` | Log payloads to console |

### Opt-out

```typescript
// Telemetry disabled if ANY of these are true:
const disabled = 
  process.env.FLIPPER_TELEMETRY_ENABLED === 'false' ||
  process.env.DO_NOT_TRACK === '1' ||
  process.env.CI === 'true';
```

---

## Client Implementation

### Types

```typescript
// packages/telemetry/src/types.ts

export interface TelemetryEvent {
  /** Event name - typically tool/command name */
  event: string;
  /** Timestamp of event */
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

export interface TelemetryContext {
  /** Package name, e.g. flipperagents-tmos-mcp */
  packageName: string;
  /** Package version */
  packageVersion: string;
  /** Runtime environment */
  nodeVersion: string;
  platform: string;
  arch: string;
  /** Unique instance ID (generated per process) */
  instanceId: string;
}
```

### Main Client

```typescript
// packages/telemetry/src/index.ts

import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { TelemetryEvent, TelemetryContext } from './types.js';
import { TeemTransport } from './teem.js';
import { PostHogTransport } from './posthog.js';

const ENABLED = process.env.FLIPPER_TELEMETRY_ENABLED !== 'false' &&
                process.env.DO_NOT_TRACK !== '1' &&
                process.env.CI !== 'true';

export class TelemetryClient {
  private context: TelemetryContext;
  private journal: TelemetryEvent[] = [];
  private teem: TeemTransport;
  private posthog: PostHogTransport;
  private flushTimer: NodeJS.Timeout | null = null;
  
  private readonly FLUSH_INTERVAL_MS = 60_000;
  private readonly MAX_BATCH_SIZE = 50;

  constructor(packageName: string, packageVersion: string) {
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

    if (ENABLED) {
      this.startFlushTimer();
      this.setupExitHandlers();
    }
  }

  /**
   * Capture a tool invocation event
   */
  capture(
    event: string,
    durationMs?: number,
    success: boolean = true,
    errorType?: string,
    properties?: Record<string, unknown>
  ): void {
    if (!ENABLED) return;

    const record: TelemetryEvent = {
      event,
      timestamp: new Date().toISOString(),
      duration_ms: durationMs,
      success,
      error_type: errorType,
      properties,
    };

    this.journal.push(record);

    if (process.env.FLIPPER_DEBUG_TELEMETRY) {
      console.log('[telemetry]', record);
    }

    if (this.journal.length >= this.MAX_BATCH_SIZE) {
      this.flush();
    }
  }

  /**
   * Capture a lifecycle event (startup, shutdown, etc.)
   */
  lifecycle(event: 'startup' | 'shutdown' | 'error', properties?: Record<string, unknown>): void {
    this.capture(`mcp_${event}`, undefined, event !== 'error', undefined, properties);
  }

  /**
   * Capture an error with classification
   */
  captureError(error: unknown, context?: string): void {
    this.capture(
      context || 'uncaught_error',
      0,
      false,
      classifyError(error)
    );
    // Flush immediately for errors
    this.flush();
  }

  /**
   * Flush pending events to all transports
   */
  async flush(): Promise<void> {
    if (!ENABLED || this.journal.length === 0) return;

    const events = [...this.journal];
    this.journal = [];

    // Dual-ship to both transports
    await Promise.allSettled([
      this.teem.send(events),
      this.posthog.send(events),
    ]);
  }

  isEnabled(): boolean {
    return ENABLED;
  }

  getInstanceId(): string {
    return this.context.instanceId;
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => this.flush(), this.FLUSH_INTERVAL_MS);
    this.flushTimer.unref();
  }

  private setupExitHandlers(): void {
    const exitHandler = () => {
      this.flush();
    };
    process.on('beforeExit', exitHandler);
    process.on('SIGINT', () => { exitHandler(); process.exit(0); });
    process.on('SIGTERM', () => { exitHandler(); process.exit(0); });
  }
}

// Re-export utilities
export { classifyError, setupGlobalErrorHandlers } from './utils.js';
export type { TelemetryEvent, TelemetryContext } from './types.js';
```

---

## Transport Implementations

### TEEM Transport (existing F5 endpoint)

```typescript
// packages/telemetry/src/teem.ts

import { randomUUID } from 'node:crypto';
import { TelemetryEvent, TelemetryContext } from './types.js';

const TEEM_ENDPOINT = 'https://product.apis.f5.com/ee/v1/telemetry';
const TEEM_API_KEY = Buffer.from(
  ['bW1oSlUyc0Nk', 'NjNCem5YQVh', 'EaDRreExJ', 'eWZJTW0zQXI='].join(''),
  'base64'
).toString();

export class TeemTransport {
  constructor(private context: TelemetryContext) {}

  async send(events: TelemetryEvent[]): Promise<void> {
    const payload = {
      documentType: 'F5 MCP Telemetry Data',
      documentVersion: '1',
      digitalAssetId: this.context.instanceId,
      digitalAssetName: this.context.packageName,
      digitalAssetVersion: this.context.packageVersion,
      observationStartTime: events[0].timestamp,
      observationEndTime: new Date().toISOString(),
      epochTime: Date.now(),
      telemetryRecords: events.map(e => ({
        id: randomUUID(),
        timestamp: e.timestamp,
        command: e.event,
        duration_ms: e.duration_ms || 0,
        success: e.success ?? true,
        error_type: e.error_type,
      })),
    };

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

      if (!response.ok && process.env.FLIPPER_DEBUG_TELEMETRY) {
        console.error('[teem] flush failed:', response.status);
      }
    } catch (error) {
      if (process.env.FLIPPER_DEBUG_TELEMETRY) {
        console.error('[teem] flush error:', error);
      }
    }
  }
}
```

### PostHog Transport

```typescript
// packages/telemetry/src/posthog.ts

import { TelemetryEvent, TelemetryContext } from './types.js';

const POSTHOG_HOST = process.env.POSTHOG_HOST || 'https://app.posthog.com';
const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY || 'phc_XXXXXXXXXXXXXX'; // bundled key

export class PostHogTransport {
  constructor(private context: TelemetryContext) {}

  async send(events: TelemetryEvent[]): Promise<void> {
    // PostHog batch capture endpoint
    const batch = events.map(e => ({
      event: e.event,
      distinct_id: this.context.instanceId,
      timestamp: e.timestamp,
      properties: {
        $lib: this.context.packageName,
        $lib_version: this.context.packageVersion,
        duration_ms: e.duration_ms,
        success: e.success,
        error_type: e.error_type,
        node_version: this.context.nodeVersion,
        platform: this.context.platform,
        arch: this.context.arch,
        ...e.properties,
      },
    }));

    try {
      const response = await fetch(`${POSTHOG_HOST}/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: POSTHOG_API_KEY,
          batch,
        }),
      });

      if (!response.ok && process.env.FLIPPER_DEBUG_TELEMETRY) {
        console.error('[posthog] flush failed:', response.status);
      }
    } catch (error) {
      if (process.env.FLIPPER_DEBUG_TELEMETRY) {
        console.error('[posthog] flush error:', error);
      }
    }
  }
}
```

---

## Usage in MCP Servers

### Initialization (index.ts)

```typescript
// mcp/f5/src/index.ts

import { TelemetryClient, setupGlobalErrorHandlers, classifyError } from '@flipper/telemetry';

// Initialize telemetry singleton
export const telemetry = new TelemetryClient('flipperagents-tmos-mcp', '0.1.0');

// Setup global error handlers
setupGlobalErrorHandlers(telemetry);

// Capture startup
telemetry.lifecycle('startup', { transport: process.env.HTTP_PORT ? 'http' : 'stdio' });

// On shutdown
process.on('beforeExit', () => {
  telemetry.lifecycle('shutdown');
});
```

### Tool Call Wrapper

```typescript
// mcp/f5/src/index.ts

async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const startTime = Date.now();

  try {
    const result = await handleToolCallImpl(name, args);
    const durationMs = Date.now() - startTime;
    
    // Capture successful tool call
    telemetry.capture(name, durationMs, true);
    
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    
    // Capture failed tool call with error classification
    telemetry.capture(name, durationMs, false, classifyError(error));
    
    throw error;
  }
}
```

### Direct Capture for Specific Events

```typescript
// Capture connection events
telemetry.capture('bigip_connect', connectionTimeMs, true, undefined, {
  version: deviceInfo.version,
  platform: deviceInfo.platform,
});

// Capture feature usage
telemetry.capture('backup_created', durationMs, true, undefined, {
  backup_type: 'ucs',
  include_private_keys: false,
});
```

---

## Example Payloads

### TEEM Payload (to F5)

```json
{
  "documentType": "F5 MCP Telemetry Data",
  "documentVersion": "1",
  "digitalAssetId": "550e8400-e29b-41d4-a716-446655440000",
  "digitalAssetName": "flipperagents-tmos-mcp",
  "digitalAssetVersion": "0.1.0",
  "observationStartTime": "2024-01-15T10:30:00.000Z",
  "observationEndTime": "2024-01-15T10:31:00.000Z",
  "epochTime": 1705315860000,
  "telemetryRecords": [
    {
      "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "timestamp": "2024-01-15T10:30:05.123Z",
      "command": "get_pool_members",
      "duration_ms": 245,
      "success": true
    },
    {
      "id": "8d0f7780-8536-51ef-055c-f18gc2g01bf8",
      "timestamp": "2024-01-15T10:30:15.456Z",
      "command": "create_virtual_server",
      "duration_ms": 1823,
      "success": false,
      "error_type": "ValidationError"
    }
  ]
}
```

### PostHog Payload

```json
{
  "api_key": "phc_XXXXXXXXXXXXXX",
  "batch": [
    {
      "event": "get_pool_members",
      "distinct_id": "550e8400-e29b-41d4-a716-446655440000",
      "timestamp": "2024-01-15T10:30:05.123Z",
      "properties": {
        "$lib": "flipperagents-tmos-mcp",
        "$lib_version": "0.1.0",
        "duration_ms": 245,
        "success": true,
        "node_version": "v20.10.0",
        "platform": "darwin",
        "arch": "arm64"
      }
    },
    {
      "event": "create_virtual_server",
      "distinct_id": "550e8400-e29b-41d4-a716-446655440000",
      "timestamp": "2024-01-15T10:30:15.456Z",
      "properties": {
        "$lib": "flipperagents-tmos-mcp",
        "$lib_version": "0.1.0",
        "duration_ms": 1823,
        "success": false,
        "error_type": "ValidationError",
        "node_version": "v20.10.0",
        "platform": "darwin",
        "arch": "arm64"
      }
    }
  ]
}
```

---

## Error Classification

```typescript
// packages/telemetry/src/utils.ts

export function classifyError(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';

  const msg = error.message.toLowerCase();
  const name = error.name;

  // Network errors
  if (name === 'FetchError' || name === 'AbortError' ||
      msg.includes('econnrefused') || msg.includes('etimedout') ||
      msg.includes('enotfound')) {
    return 'NetworkError';
  }

  // Auth errors
  if (msg.includes('401') || msg.includes('403') ||
      msg.includes('authentication') || msg.includes('unauthorized')) {
    return 'AuthError';
  }

  // Validation errors
  if (name === 'ValidationError' || name === 'TypeError' ||
      msg.includes('invalid') || msg.includes('required')) {
    return 'ValidationError';
  }

  // API errors (client)
  if (msg.includes('400') || msg.includes('422')) {
    return 'ApiError';
  }

  // Server errors
  if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
    return 'ServerError';
  }

  return name || 'Error';
}

export function setupGlobalErrorHandlers(telemetry: { captureError: (e: unknown, ctx?: string) => void }): void {
  process.on('uncaughtException', (error) => {
    telemetry.captureError(error, 'uncaughtException');
    setTimeout(() => process.exit(1), 1000);
  });

  process.on('unhandledRejection', (reason) => {
    telemetry.captureError(reason, 'unhandledRejection');
  });
}
```

---

## Privacy & Data Collection

### What IS Collected
- Tool/command names
- Execution duration
- Success/failure status
- Error classifications (NOT messages or stack traces)
- Runtime environment (Node version, OS, arch)
- Anonymous instance ID (random UUID per process)

### What is NOT Collected
- IP addresses or hostnames
- Configuration content or credentials
- Device information (IPs, passwords, configs)
- Any PII

---

## Migration from Existing Implementation

The current `mcp/f5/src/lib/teem.ts` can be deprecated once the shared package is in place:

1. Create `packages/telemetry/` with shared implementation
2. Update MCP server `package.json` files to depend on `@flipper/telemetry`
3. Replace imports in both servers
4. Remove `mcp/f5/src/lib/teem.ts`

---

## Testing

```typescript
// packages/telemetry/src/__tests__/client.test.ts

import { TelemetryClient } from '../index.js';

describe('TelemetryClient', () => {
  beforeEach(() => {
    process.env.FLIPPER_TELEMETRY_ENABLED = 'true';
  });

  it('captures tool events', () => {
    const client = new TelemetryClient('flipperagents-test-mcp', '1.0.0');
    client.capture('test_tool', 100, true);
    // Assert journal contains event
  });

  it('respects opt-out', () => {
    process.env.FLIPPER_TELEMETRY_ENABLED = 'false';
    const client = new TelemetryClient('flipperagents-test-mcp', '1.0.0');
    expect(client.isEnabled()).toBe(false);
  });

  it('classifies errors correctly', () => {
    expect(classifyError(new Error('ECONNREFUSED'))).toBe('NetworkError');
    expect(classifyError(new Error('401 Unauthorized'))).toBe('AuthError');
  });
});
```
