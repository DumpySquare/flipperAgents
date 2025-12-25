# @flipper/telemetry

Telemetry client for flipperAgents MCP servers. Dual-ships events to F5 TEEM and PostHog Cloud.

## Installation

```bash
npm install @flipper/telemetry
```

## Usage

```typescript
import { 
  TelemetryClient, 
  classifyError, 
  setupGlobalErrorHandlers 
} from '@flipper/telemetry';

// Initialize client
const telemetry = new TelemetryClient('flipperagents-tmos-mcp', '0.1.0');

// Setup global error handlers
setupGlobalErrorHandlers(telemetry);

// Capture lifecycle events
telemetry.lifecycle('startup', { transport: 'stdio' });

// Capture tool calls
const startTime = Date.now();
try {
  const result = await someToolCall();
  telemetry.capture('tool_name', Date.now() - startTime, true);
} catch (error) {
  telemetry.capture('tool_name', Date.now() - startTime, false, classifyError(error));
  throw error;
}

// Shutdown
telemetry.lifecycle('shutdown');
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `FLIPPER_TELEMETRY_ENABLED` | `true` | Master kill switch |
| `POSTHOG_API_KEY` | - | PostHog project API key |
| `POSTHOG_HOST` | `https://app.posthog.com` | PostHog instance URL |
| `FLIPPER_DEBUG_TELEMETRY` | `false` | Log telemetry payloads |
| `DO_NOT_TRACK` | - | Standard opt-out (set to `1`) |
| `CI` | - | Auto-disables in CI environments |

## Privacy

### What IS Collected
- Tool/command names
- Execution duration
- Success/failure status
- Error classifications (NOT messages)
- Runtime environment (Node version, OS, arch)
- Anonymous instance ID (random UUID)

### What is NOT Collected
- IP addresses or hostnames
- Configuration content
- Credentials or secrets
- Any PII

## API

### `TelemetryClient`

```typescript
new TelemetryClient(packageName: string, packageVersion: string)
```

#### Methods

- `capture(event, durationMs?, success?, errorType?, properties?)` - Record an event
- `lifecycle(event, properties?)` - Record lifecycle event (startup/shutdown/error)
- `captureError(error, context?)` - Record an error with classification
- `flush()` - Force flush pending events
- `isEnabled()` - Check if telemetry is enabled
- `getInstanceId()` - Get the anonymous instance ID

### `classifyError(error: unknown): string`

Classify an error into a category (NetworkError, AuthError, ValidationError, etc.)

### `setupGlobalErrorHandlers(telemetry: TelemetryClient)`

Setup handlers for uncaughtException and unhandledRejection.

## License

Apache-2.0
