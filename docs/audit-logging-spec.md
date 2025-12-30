# Customer Audit Logging Specification

**Status:** 📋 Spec Complete  
**Location:** `@flipper/audit-logger` (shared package)  
**Scope:** All MCP servers  
**Parent Doc:** [future-mcp-servers.md](./future-mcp-servers.md)
**Updated:** 2025-12-30 (added local buffer destination)

---

## Summary

Customer-facing audit logging that sends operational logs from MCP servers to enterprise SIEM/logging platforms. Unlike internal telemetry (anonymous product analytics), this provides detailed, contextual logs for customer audit, compliance, and troubleshooting needs.

**Key Principle:** Customer controls destination, format, and filtering. Logs are sanitized to avoid leaking secrets.

---

## Table of Contents

| Section | Description |
|---------|-------------|
| [1. Overview](#1-overview) | Purpose and comparison to telemetry |
| [2. Log Schema](#2-log-schema) | What gets logged |
| [3. Destinations](#3-destinations) | Supported log destinations |
| [4. Configuration](#4-configuration) | How to configure logging |
| [5. Filtering](#5-filtering) | Control what gets logged |
| [6. Sanitization](#6-sanitization) | Privacy and secret handling |
| [7. Implementation](#7-implementation) | Architecture and code |
| [8. Example Outputs](#8-example-outputs) | Sample log entries |
| [9. Implementation Plan](#9-implementation-plan) | Phases and milestones |

---

## 1. Overview

### 1.1 Purpose

Enterprise customers need operational logs for:

| Need | Description |
|------|-------------|
| **Audit/Compliance** | Who did what, when, to which device |
| **Troubleshooting** | Why did that operation fail? |
| **Security monitoring** | Detect unauthorized or suspicious activity |
| **Change tracking** | What changed on my infrastructure |
| **Incident response** | Reconstruct events during outage |

### 1.2 Comparison to Internal Telemetry

| Aspect | Internal Telemetry | Customer Audit Logging |
|--------|-------------------|------------------------|
| Audience | F5/Anthropic product team | Customer SOC/ops team |
| Purpose | Product analytics, adoption | Audit, compliance, troubleshooting |
| Detail level | Aggregated, anonymous | Detailed, contextual |
| Destination | F5 TEEM, PostHog | Splunk, Datadog, Elastic, etc. |
| Control | Opt-out only | Fully customer-configured |
| PII handling | None collected | Sanitized but contextual |
| Default state | Enabled | Disabled (opt-in) |

### 1.3 Scope

Audit logging is implemented as a shared package used by all MCP servers:

- `flipperagents-tmos-mcp`
- `flipperagents-ns-mcp`
- `flipperagents-bigiq-mcp` (future)
- `flipperagents-xc-mcp` (future)

---

## 2. Log Schema

### 2.1 Base Log Entry

Every log entry contains these fields:

```typescript
interface AuditLogEntry {
  // Identity
  timestamp: string;           // ISO 8601 format
  level: 'debug' | 'info' | 'warn' | 'error';
  event_id: string;            // Unique ID for this event
  
  // Source
  mcp_server: string;          // e.g., "flipperagents-tmos-mcp"
  mcp_version: string;         // e.g., "0.1.0"
  session_id: string;          // Unique per MCP session
  
  // What happened
  category: AuditCategory;
  action: string;              // Tool name or lifecycle event
  outcome: 'success' | 'failure' | 'pending';
  duration_ms?: number;
  
  // Target (if applicable)
  target?: {
    device?: string;           // Hostname (not IP)
    device_type?: string;      // "bigip", "netscaler", "bigiq"
    partition?: string;        // BIG-IP partition
    tenant?: string;           // AS3 tenant
    object_type?: string;      // e.g., "ltm/virtual", "lbvserver"
    object_name?: string;      // e.g., "vs_webapp"
  };
  
  // Change details (for write operations)
  change?: {
    type: 'create' | 'modify' | 'delete';
    objects_affected: string[];
    summary?: string;          // Human-readable summary
  };
  
  // Error details (for failures)
  error?: {
    type: string;              // Classified error type
    message: string;           // Sanitized error message
    remediation?: string;      // Suggested fix
  };
  
  // Additional context
  metadata?: Record<string, unknown>;
}

type AuditCategory = 
  | 'lifecycle'      // Server start/stop
  | 'connection'     // Device connect/disconnect
  | 'read'           // Get/list operations
  | 'write'          // Create/modify/delete operations
  | 'auth'           // Authentication events
  | 'error';         // Errors and exceptions
```

### 2.2 Category-Specific Fields

#### Lifecycle Events

```typescript
interface LifecycleEvent extends AuditLogEntry {
  category: 'lifecycle';
  action: 'startup' | 'shutdown' | 'config_reload';
  metadata: {
    transport: 'stdio' | 'http';
    config_sources: string[];  // Where config was loaded from
  };
}
```

#### Connection Events

```typescript
interface ConnectionEvent extends AuditLogEntry {
  category: 'connection';
  action: 'connect' | 'disconnect' | 'reconnect';
  target: {
    device: string;
    device_type: string;
  };
  metadata: {
    connection_time_ms?: number;
    tmos_version?: string;
    platform?: string;
  };
}
```

#### Read Operations

```typescript
interface ReadEvent extends AuditLogEntry {
  category: 'read';
  action: string;              // Tool name, e.g., "list_pools"
  target: {
    device: string;
    object_type?: string;
    object_name?: string;
  };
  metadata: {
    result_count?: number;
    filtered?: boolean;
  };
}
```

#### Write Operations

```typescript
interface WriteEvent extends AuditLogEntry {
  category: 'write';
  action: string;              // Tool name, e.g., "create_pool"
  target: {
    device: string;
    object_type: string;
    object_name: string;
  };
  change: {
    type: 'create' | 'modify' | 'delete';
    objects_affected: string[];
    summary: string;
    rollback_id?: string;      // If rollback is available
  };
}
```

---

## 3. Destinations

### 3.1 Supported Destinations

| Destination | Protocol | Use Case |
|-------------|----------|----------|
| **Splunk** | HEC (HTTP Event Collector) | Enterprise SIEM |
| **Elasticsearch** | HTTP/Bulk API | ELK stack |
| **Datadog** | HTTP API | Cloud monitoring |
| **Syslog** | UDP/TCP (RFC 5424) | Legacy infrastructure |
| **Webhook** | HTTP POST | Custom integrations |
| **File** | Local JSON Lines | Development, custom processing |
| **Console** | stdout | Development, debugging |
| **Local Buffer** | In-memory ring buffer | Quick lookback, offline/air-gapped |

### 3.2 Splunk HEC

```typescript
interface SplunkConfig {
  type: 'splunk';
  endpoint: string;            // https://splunk.company.com:8088/services/collector
  token: string;               // HEC token
  index?: string;              // Target index
  source?: string;             // Source identifier
  sourcetype?: string;         // Default: "_json"
  verify_ssl?: boolean;        // Default: true
}
```

**Payload format:**
```json
{
  "time": 1705315860.123,
  "host": "mcp-server-1",
  "source": "flipperagents-tmos-mcp",
  "sourcetype": "_json",
  "index": "network_audit",
  "event": {
    "timestamp": "2024-01-15T10:31:00.123Z",
    "level": "info",
    "category": "write",
    "action": "create_pool",
    ...
  }
}
```

### 3.3 Elasticsearch

```typescript
interface ElasticsearchConfig {
  type: 'elasticsearch';
  endpoint: string;            // https://elastic.company.com:9200
  index_pattern: string;       // e.g., "mcp-audit-{date}"
  auth?: {
    type: 'basic' | 'api_key';
    username?: string;
    password?: string;
    api_key?: string;
  };
  verify_ssl?: boolean;
}
```

**Payload format:** Standard Elasticsearch bulk API

### 3.4 Datadog

```typescript
interface DatadogConfig {
  type: 'datadog';
  api_key: string;
  site?: string;               // Default: "datadoghq.com"
  service?: string;            // Service name for APM correlation
  tags?: string[];             // Additional tags
}
```

### 3.5 Syslog

```typescript
interface SyslogConfig {
  type: 'syslog';
  host: string;
  port: number;                // Default: 514
  protocol: 'udp' | 'tcp' | 'tls';
  facility?: number;           // Default: 1 (user)
  app_name?: string;
  
  // For TLS
  tls?: {
    ca_cert?: string;
    client_cert?: string;
    client_key?: string;
    verify?: boolean;
  };
}
```

**Format:** RFC 5424 with JSON structured data

```
<14>1 2024-01-15T10:31:00.123Z mcp-host flipperagents-tmos-mcp - - [audit@12345 category="write" action="create_pool" outcome="success"] {"timestamp":"2024-01-15T10:31:00.123Z",...}
```

### 3.6 Webhook

```typescript
interface WebhookConfig {
  type: 'webhook';
  url: string;
  method?: 'POST' | 'PUT';     // Default: POST
  headers?: Record<string, string>;
  
  // Authentication
  auth?: {
    type: 'basic' | 'bearer' | 'header';
    username?: string;
    password?: string;
    token?: string;
    header_name?: string;
    header_value?: string;
  };
  
  // Formatting
  format?: 'json' | 'json_lines';
  wrap_array?: boolean;        // Wrap batch in array
}
```

### 3.7 File

```typescript
interface FileConfig {
  type: 'file';
  path: string;                // Path to log file
  format: 'json' | 'json_lines';
  
  // Rotation
  rotation?: {
    max_size_mb?: number;      // Rotate at this size
    max_files?: number;        // Keep this many rotated files
    max_age_days?: number;     // Delete files older than this
  };
}
```

### 3.8 Console

```typescript
interface ConsoleConfig {
  type: 'console';
  format: 'json' | 'pretty';   // Pretty = human-readable
  stream?: 'stdout' | 'stderr';
}
```

### 3.9 Local Buffer (In-Memory Ring Buffer)

In-memory ring buffer for quick queries without external SIEM dependency. Useful for:
- Debugging when no SIEM configured
- Quick lookback during troubleshooting
- Development and testing
- Offline/air-gapped environments

```typescript
interface LocalBufferConfig {
  type: 'local';
  max_entries: number;         // Default: 500 (ring buffer size)
  persist_path?: string;       // Optional: persist to file on shutdown
  expose_tool?: boolean;       // Expose as MCP tool (default: true)
  include_debug?: boolean;     // Include debug-level in buffer (default: false)
}
```

**How it works:**
- Ring buffer holds last N entries in memory
- Oldest entries evicted when buffer full
- Optional persistence saves to JSON file on shutdown, reloads on startup
- When `expose_tool: true`, adds `get_local_audit_logs` MCP tool

**MCP Tool: `get_local_audit_logs`**

```typescript
interface GetLocalAuditLogsParams {
  limit?: number;              // Default: 50, max: max_entries
  since?: string;              // ISO timestamp filter
  category?: AuditCategory;    // Filter by category
  action?: string;             // Filter by action/tool name
  outcome?: 'success' | 'failure';
  device?: string;             // Filter by target device
}

interface GetLocalAuditLogsResult {
  entries: AuditLogEntry[];
  total_in_buffer: number;
  oldest_entry: string;        // Timestamp of oldest entry
  buffer_capacity: number;
}
```

**Example usage:**

```
User: "Show me the last 10 failed operations"
→ get_local_audit_logs(limit=10, outcome="failure")

User: "What did I do on bigip-prod-01 in the last hour?"
→ get_local_audit_logs(device="bigip-prod-01", since="2025-12-30T14:00:00Z")
```

**Configuration example:**

```yaml
destinations:
  # Primary: send to Splunk
  - type: splunk
    endpoint: https://splunk.company.com:8088
    token: ${SPLUNK_TOKEN}
  
  # Secondary: keep local buffer for quick queries
  - type: local
    max_entries: 500
    persist_path: /var/lib/flipper/audit-buffer.json
    expose_tool: true
```

**Environment variables:**

```bash
FLIPPER_AUDIT_LOCAL_ENABLED=true
FLIPPER_AUDIT_LOCAL_MAX_ENTRIES=500
FLIPPER_AUDIT_LOCAL_PERSIST_PATH=/var/lib/flipper/audit-buffer.json
```

**Implementation:**

```typescript
// packages/audit-logger/src/destinations/local.ts

export class LocalBufferDestination implements Destination {
  type = 'local';
  private buffer: AuditLogEntry[] = [];
  private maxEntries: number;
  private persistPath?: string;
  
  constructor(private config: LocalBufferConfig) {
    this.maxEntries = config.max_entries || 500;
    this.persistPath = config.persist_path;
    
    // Load persisted buffer on startup
    if (this.persistPath) {
      this.loadFromDisk();
    }
  }
  
  async send(entries: AuditLogEntry[]): Promise<void> {
    for (const entry of entries) {
      // Skip debug unless configured
      if (entry.level === 'debug' && !this.config.include_debug) {
        continue;
      }
      
      this.buffer.push(entry);
      
      // Evict oldest if over capacity (ring buffer)
      if (this.buffer.length > this.maxEntries) {
        this.buffer.shift();
      }
    }
  }
  
  /**
   * Query the local buffer
   */
  query(params: GetLocalAuditLogsParams): GetLocalAuditLogsResult {
    let entries = [...this.buffer];
    
    // Apply filters
    if (params.since) {
      const since = new Date(params.since);
      entries = entries.filter(e => new Date(e.timestamp) >= since);
    }
    if (params.category) {
      entries = entries.filter(e => e.category === params.category);
    }
    if (params.action) {
      entries = entries.filter(e => e.action === params.action);
    }
    if (params.outcome) {
      entries = entries.filter(e => e.outcome === params.outcome);
    }
    if (params.device) {
      entries = entries.filter(e => e.target?.device === params.device);
    }
    
    // Sort newest first, apply limit
    entries = entries
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, params.limit || 50);
    
    return {
      entries,
      total_in_buffer: this.buffer.length,
      oldest_entry: this.buffer[0]?.timestamp || '',
      buffer_capacity: this.maxEntries,
    };
  }
  
  /**
   * Persist buffer to disk
   */
  async close(): Promise<void> {
    if (this.persistPath) {
      await this.saveToDisk();
    }
  }
  
  private async saveToDisk(): Promise<void> {
    if (!this.persistPath) return;
    try {
      await fs.writeFile(
        this.persistPath,
        JSON.stringify(this.buffer, null, 2)
      );
    } catch (e) {
      console.error('[audit-logger] Failed to persist buffer:', e);
    }
  }
  
  private loadFromDisk(): void {
    if (!this.persistPath) return;
    try {
      if (fs.existsSync(this.persistPath)) {
        const data = fs.readFileSync(this.persistPath, 'utf-8');
        this.buffer = JSON.parse(data);
        // Trim to max size in case config changed
        if (this.buffer.length > this.maxEntries) {
          this.buffer = this.buffer.slice(-this.maxEntries);
        }
      }
    } catch (e) {
      console.error('[audit-logger] Failed to load persisted buffer:', e);
      this.buffer = [];
    }
  }
}
```

---

## 4. Configuration

### 4.1 Configuration Methods

| Method | Use Case |
|--------|----------|
| Environment variables | Simple setup, containers |
| Config file | Complex setups, multiple destinations |
| Runtime API | Dynamic configuration |

### 4.2 Environment Variables

Simple single-destination setup via env vars:

```bash
# Enable audit logging
FLIPPER_AUDIT_ENABLED=true

# Destination type
FLIPPER_AUDIT_DESTINATION=splunk

# Splunk-specific
FLIPPER_AUDIT_SPLUNK_ENDPOINT=https://splunk.company.com:8088/services/collector
FLIPPER_AUDIT_SPLUNK_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
FLIPPER_AUDIT_SPLUNK_INDEX=network_audit

# Or for syslog
FLIPPER_AUDIT_DESTINATION=syslog
FLIPPER_AUDIT_SYSLOG_HOST=syslog.company.com
FLIPPER_AUDIT_SYSLOG_PORT=514
FLIPPER_AUDIT_SYSLOG_PROTOCOL=tcp

# Filtering
FLIPPER_AUDIT_MIN_LEVEL=info
FLIPPER_AUDIT_CATEGORIES=write,error,auth

# Buffering
FLIPPER_AUDIT_BATCH_SIZE=100
FLIPPER_AUDIT_FLUSH_INTERVAL_MS=5000
```

### 4.3 Config File

For complex setups with multiple destinations:

```yaml
# flipper-audit.yaml

audit:
  enabled: true
  
  # Multiple destinations
  destinations:
    - type: splunk
      endpoint: https://splunk.company.com:8088/services/collector
      token: ${SPLUNK_HEC_TOKEN}  # Env var substitution
      index: network_audit
      
    - type: file
      path: /var/log/flipper/audit.jsonl
      format: json_lines
      rotation:
        max_size_mb: 100
        max_files: 10
  
  # Global filtering
  filter:
    min_level: info
    categories:
      - write
      - error
      - auth
    exclude_actions:
      - list_pools        # Too noisy
      - get_device_health
  
  # Buffering
  buffer:
    batch_size: 100
    flush_interval_ms: 5000
    retry_attempts: 3
    retry_delay_ms: 1000
  
  # Sanitization
  sanitize:
    redact_patterns:
      - "password"
      - "secret"
      - "token"
      - "key"
    hash_hostnames: false
    include_ips: false
```

Config file locations (checked in order):
1. `$FLIPPER_AUDIT_CONFIG` (explicit path)
2. `./flipper-audit.yaml`
3. `~/.config/flipper/audit.yaml`
4. `/etc/flipper/audit.yaml`

### 4.4 Runtime API

For dynamic configuration during MCP session:

```typescript
// Tool: configure_audit_logging
interface ConfigureAuditLoggingParams {
  enabled?: boolean;
  min_level?: 'debug' | 'info' | 'warn' | 'error';
  categories?: AuditCategory[];
  
  // Cannot change destinations at runtime (security)
}
```

---

## 5. Filtering

### 5.1 Filter Dimensions

| Dimension | Description | Example |
|-----------|-------------|---------|
| **Level** | Minimum severity | `min_level: warn` |
| **Category** | Event categories | `categories: [write, error]` |
| **Action** | Specific tools | `exclude_actions: [list_pools]` |
| **Target** | Device or object | `include_devices: [bigip-prod-*]` |
| **Outcome** | Success/failure | `outcomes: [failure]` |

### 5.2 Filter Configuration

```yaml
filter:
  # Severity threshold
  min_level: info
  
  # Include only these categories
  categories:
    - write
    - error
    - auth
  
  # Exclude specific actions (even if category matches)
  exclude_actions:
    - list_pools
    - get_device_health
    - list_devices
  
  # Only log for specific devices (glob patterns)
  include_devices:
    - "bigip-prod-*"
    - "bigip-staging-*"
  
  # Only log failures (good for alerting destination)
  outcomes:
    - failure
```

### 5.3 Per-Destination Filtering

Different filters for different destinations:

```yaml
destinations:
  # Everything to Splunk
  - type: splunk
    endpoint: https://splunk.company.com:8088
    token: ${SPLUNK_TOKEN}
    filter:
      min_level: info
  
  # Only errors to PagerDuty webhook
  - type: webhook
    url: https://events.pagerduty.com/v2/enqueue
    filter:
      min_level: error
      outcomes: [failure]
  
  # Debug logs to file for troubleshooting
  - type: file
    path: /var/log/flipper/debug.jsonl
    filter:
      min_level: debug
```

---

## 6. Sanitization

### 6.1 Principles

1. **Never log credentials** — passwords, tokens, API keys
2. **Redact sensitive patterns** — anything matching configured patterns
3. **Hash or omit IPs** — configurable based on policy
4. **Preserve auditability** — enough context to investigate

### 6.2 Automatic Redaction

Fields automatically redacted:

```typescript
const ALWAYS_REDACT = [
  'password',
  'passwd',
  'secret',
  'token',
  'api_key',
  'apikey',
  'private_key',
  'privatekey',
  'credential',
  'auth',
];
```

### 6.3 Redaction Examples

**Input (internal):**
```json
{
  "action": "connect",
  "target": {
    "device": "bigip-prod-1",
    "address": "10.1.1.100"
  },
  "metadata": {
    "username": "admin",
    "password": "SuperSecret123!"
  }
}
```

**Output (logged):**
```json
{
  "action": "connect",
  "target": {
    "device": "bigip-prod-1"
  },
  "metadata": {
    "username": "admin",
    "password": "[REDACTED]"
  }
}
```

### 6.4 IP Address Handling

Configurable per customer policy:

```yaml
sanitize:
  # Option 1: Omit IPs entirely (default)
  include_ips: false
  
  # Option 2: Include IPs (for internal networks)
  include_ips: true
  
  # Option 3: Hash IPs (anonymized but consistent)
  hash_ips: true
```

### 6.5 Custom Redaction Patterns

```yaml
sanitize:
  redact_patterns:
    - "password"
    - "secret"
    - "ssn"
    - "credit_card"
    - pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b"  # SSN format
      replacement: "[SSN REDACTED]"
```

---

## 7. Implementation

### 7.1 Package Structure

```
packages/
└── audit-logger/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts           # Main exports
        ├── types.ts           # Schema definitions
        ├── logger.ts          # AuditLogger class
        ├── config.ts          # Configuration loading
        ├── filter.ts          # Filtering logic
        ├── sanitize.ts        # Redaction logic
        ├── buffer.ts          # Batching/buffering
        └── destinations/
            ├── index.ts       # Destination factory
            ├── splunk.ts
            ├── elasticsearch.ts
            ├── datadog.ts
            ├── syslog.ts
            ├── webhook.ts
            ├── file.ts
            └── console.ts
```

### 7.2 Core Classes

#### AuditLogger

```typescript
// packages/audit-logger/src/logger.ts

import { AuditLogEntry, AuditConfig } from './types.js';
import { loadConfig } from './config.js';
import { shouldLog } from './filter.js';
import { sanitize } from './sanitize.js';
import { Buffer } from './buffer.js';
import { createDestinations } from './destinations/index.js';

export class AuditLogger {
  private config: AuditConfig;
  private buffer: Buffer;
  private destinations: Destination[];
  private sessionId: string;
  
  constructor(
    private serverName: string,
    private serverVersion: string,
    configOverrides?: Partial<AuditConfig>
  ) {
    this.config = loadConfig(configOverrides);
    this.sessionId = randomUUID();
    this.destinations = createDestinations(this.config.destinations);
    this.buffer = new Buffer(this.config.buffer, this.flush.bind(this));
  }
  
  /**
   * Log an audit event
   */
  log(entry: Partial<AuditLogEntry>): void {
    if (!this.config.enabled) return;
    
    const fullEntry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      event_id: randomUUID(),
      level: 'info',
      mcp_server: this.serverName,
      mcp_version: this.serverVersion,
      session_id: this.sessionId,
      outcome: 'success',
      ...entry,
    };
    
    // Apply filtering
    if (!shouldLog(fullEntry, this.config.filter)) return;
    
    // Sanitize sensitive data
    const sanitized = sanitize(fullEntry, this.config.sanitize);
    
    // Add to buffer
    this.buffer.add(sanitized);
  }
  
  /**
   * Log a tool invocation
   */
  tool(
    action: string,
    category: 'read' | 'write',
    target?: AuditLogEntry['target'],
    options?: {
      outcome?: 'success' | 'failure';
      duration_ms?: number;
      change?: AuditLogEntry['change'];
      error?: AuditLogEntry['error'];
      metadata?: Record<string, unknown>;
    }
  ): void {
    this.log({
      category,
      action,
      target,
      ...options,
    });
  }
  
  /**
   * Log lifecycle event
   */
  lifecycle(
    action: 'startup' | 'shutdown' | 'config_reload',
    metadata?: Record<string, unknown>
  ): void {
    this.log({
      category: 'lifecycle',
      action,
      level: 'info',
      metadata,
    });
  }
  
  /**
   * Log connection event
   */
  connection(
    action: 'connect' | 'disconnect' | 'reconnect',
    device: string,
    deviceType: string,
    outcome: 'success' | 'failure' = 'success',
    metadata?: Record<string, unknown>
  ): void {
    this.log({
      category: 'connection',
      action,
      outcome,
      target: { device, device_type: deviceType },
      metadata,
    });
  }
  
  /**
   * Log error
   */
  error(
    action: string,
    error: Error | unknown,
    target?: AuditLogEntry['target']
  ): void {
    this.log({
      category: 'error',
      action,
      level: 'error',
      outcome: 'failure',
      target,
      error: {
        type: classifyError(error),
        message: sanitizeErrorMessage(error),
      },
    });
  }
  
  /**
   * Flush pending logs to destinations
   */
  async flush(): Promise<void> {
    const entries = this.buffer.drain();
    if (entries.length === 0) return;
    
    await Promise.allSettled(
      this.destinations.map(dest => dest.send(entries))
    );
  }
  
  /**
   * Shutdown logger gracefully
   */
  async shutdown(): Promise<void> {
    await this.flush();
    this.destinations.forEach(dest => dest.close?.());
  }
}
```

#### Destination Interface

```typescript
// packages/audit-logger/src/destinations/index.ts

export interface Destination {
  type: string;
  send(entries: AuditLogEntry[]): Promise<void>;
  close?(): void;
}

export function createDestinations(configs: DestinationConfig[]): Destination[] {
  return configs.map(config => {
    switch (config.type) {
      case 'splunk': return new SplunkDestination(config);
      case 'elasticsearch': return new ElasticsearchDestination(config);
      case 'datadog': return new DatadogDestination(config);
      case 'syslog': return new SyslogDestination(config);
      case 'webhook': return new WebhookDestination(config);
      case 'file': return new FileDestination(config);
      case 'console': return new ConsoleDestination(config);
      default: throw new Error(`Unknown destination type: ${config.type}`);
    }
  });
}
```

#### Splunk Destination Example

```typescript
// packages/audit-logger/src/destinations/splunk.ts

import { Destination, AuditLogEntry, SplunkConfig } from '../types.js';

export class SplunkDestination implements Destination {
  type = 'splunk';
  
  constructor(private config: SplunkConfig) {}
  
  async send(entries: AuditLogEntry[]): Promise<void> {
    const events = entries.map(entry => ({
      time: new Date(entry.timestamp).getTime() / 1000,
      host: entry.mcp_server,
      source: entry.mcp_server,
      sourcetype: this.config.sourcetype || '_json',
      index: this.config.index,
      event: entry,
    }));
    
    // Splunk HEC accepts multiple events in one request
    const body = events.map(e => JSON.stringify(e)).join('\n');
    
    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Splunk ${this.config.token}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    
    if (!response.ok) {
      console.error(`[audit-logger] Splunk send failed: ${response.status}`);
    }
  }
}
```

### 7.3 Usage in MCP Servers

```typescript
// mcp/f5/src/index.ts

import { AuditLogger } from '@flipper/audit-logger';

// Initialize audit logger
const auditLogger = new AuditLogger(
  'flipperagents-tmos-mcp',
  '0.1.0'
);

// Log startup
auditLogger.lifecycle('startup', { transport: 'stdio' });

// In tool handler
async function handleToolCall(name: string, args: Record<string, unknown>) {
  const startTime = Date.now();
  const target = extractTarget(args);  // Extract device/object info
  
  try {
    const result = await handleToolCallImpl(name, args);
    const durationMs = Date.now() - startTime;
    
    // Log successful tool call
    auditLogger.tool(name, categorizeAction(name), target, {
      outcome: 'success',
      duration_ms: durationMs,
      change: extractChangeInfo(name, args, result),
    });
    
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    
    // Log failed tool call
    auditLogger.tool(name, categorizeAction(name), target, {
      outcome: 'failure',
      duration_ms: durationMs,
      error: {
        type: classifyError(error),
        message: sanitizeErrorMessage(error),
      },
    });
    
    throw error;
  }
}

// On shutdown
process.on('beforeExit', async () => {
  auditLogger.lifecycle('shutdown');
  await auditLogger.shutdown();
});
```

---

## 8. Example Outputs

### 8.1 Startup Event

```json
{
  "timestamp": "2024-01-15T10:00:00.000Z",
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "level": "info",
  "mcp_server": "flipperagents-tmos-mcp",
  "mcp_version": "0.1.0",
  "session_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "category": "lifecycle",
  "action": "startup",
  "outcome": "success",
  "metadata": {
    "transport": "stdio",
    "config_sources": ["/etc/flipper/audit.yaml"]
  }
}
```

### 8.2 Connection Event

```json
{
  "timestamp": "2024-01-15T10:00:05.123Z",
  "event_id": "8d0f7780-8536-51ef-055c-f18gc2g01bf8",
  "level": "info",
  "mcp_server": "flipperagents-tmos-mcp",
  "mcp_version": "0.1.0",
  "session_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "category": "connection",
  "action": "connect",
  "outcome": "success",
  "target": {
    "device": "bigip-prod-1",
    "device_type": "bigip"
  },
  "duration_ms": 1523,
  "metadata": {
    "tmos_version": "16.1.3",
    "platform": "BIG-IP Virtual Edition"
  }
}
```

### 8.3 Read Operation

```json
{
  "timestamp": "2024-01-15T10:00:10.456Z",
  "event_id": "9e1g8891-9647-62fg-166d-g29hd3h12cg9",
  "level": "info",
  "mcp_server": "flipperagents-tmos-mcp",
  "mcp_version": "0.1.0",
  "session_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "category": "read",
  "action": "list_pools",
  "outcome": "success",
  "target": {
    "device": "bigip-prod-1",
    "device_type": "bigip",
    "partition": "Common"
  },
  "duration_ms": 245,
  "metadata": {
    "result_count": 12
  }
}
```

### 8.4 Write Operation

```json
{
  "timestamp": "2024-01-15T10:00:15.789Z",
  "event_id": "af2h9902-a758-73gh-277e-h3aie4i23dh0",
  "level": "info",
  "mcp_server": "flipperagents-tmos-mcp",
  "mcp_version": "0.1.0",
  "session_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "category": "write",
  "action": "add_pool_member",
  "outcome": "success",
  "target": {
    "device": "bigip-prod-1",
    "device_type": "bigip",
    "partition": "Common",
    "object_type": "ltm/pool",
    "object_name": "pool_webapp"
  },
  "duration_ms": 892,
  "change": {
    "type": "modify",
    "objects_affected": ["pool_webapp"],
    "summary": "Added member 10.1.1.50:443",
    "rollback_id": "rb_xyz789"
  }
}
```

### 8.5 Error Event

```json
{
  "timestamp": "2024-01-15T10:00:20.012Z",
  "event_id": "bg3i0013-b869-84hi-388f-i4bjf5j34ei1",
  "level": "error",
  "mcp_server": "flipperagents-tmos-mcp",
  "mcp_version": "0.1.0",
  "session_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "category": "write",
  "action": "create_virtual",
  "outcome": "failure",
  "target": {
    "device": "bigip-prod-1",
    "device_type": "bigip",
    "partition": "Common",
    "object_type": "ltm/virtual",
    "object_name": "vs_new_app"
  },
  "duration_ms": 1234,
  "error": {
    "type": "ValidationError",
    "message": "Pool 'pool_nonexistent' does not exist",
    "remediation": "Create the pool first or specify an existing pool"
  }
}
```

---

## 9. Implementation Plan

### Phase 1: Core Framework

| Task | Effort | Priority |
|------|--------|----------|
| Package structure and types | Low | P0 |
| Config loading (env + file) | Medium | P0 |
| AuditLogger class | Medium | P0 |
| Buffer/batching | Low | P0 |
| Sanitization logic | Medium | P0 |
| Console destination | Low | P0 |
| File destination | Low | P0 |

**Deliverable:** Working logger with file/console output

### Phase 2: Enterprise Destinations

| Task | Effort | Priority |
|------|--------|----------|
| Splunk HEC destination | Medium | P0 |
| Elasticsearch destination | Medium | P1 |
| Syslog destination | Medium | P1 |
| Webhook destination | Low | P1 |
| Datadog destination | Medium | P2 |

**Deliverable:** All major SIEM integrations

### Phase 3: Advanced Features

| Task | Effort | Priority |
|------|--------|----------|
| Per-destination filtering | Medium | P1 |
| Config file hot-reload | Low | P2 |
| Runtime config API | Low | P2 |
| Retry logic | Medium | P1 |
| Health check endpoint | Low | P2 |

**Deliverable:** Production-ready logging

### Phase 4: Integration

| Task | Effort | Priority |
|------|--------|----------|
| Integrate with TMOS MCP | Medium | P0 |
| Integrate with NetScaler MCP | Medium | P0 |
| Documentation | Medium | P1 |
| Example configs per SIEM | Low | P1 |

**Deliverable:** All MCP servers emit audit logs

---

## Appendix A: Environment Variable Reference

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `FLIPPER_AUDIT_ENABLED` | boolean | `false` | Enable audit logging |
| `FLIPPER_AUDIT_CONFIG` | string | - | Path to config file |
| `FLIPPER_AUDIT_DESTINATION` | string | `console` | Destination type |
| `FLIPPER_AUDIT_MIN_LEVEL` | string | `info` | Minimum log level |
| `FLIPPER_AUDIT_CATEGORIES` | string | `*` | Comma-separated categories |
| `FLIPPER_AUDIT_BATCH_SIZE` | number | `100` | Events per batch |
| `FLIPPER_AUDIT_FLUSH_INTERVAL_MS` | number | `5000` | Flush interval |
| `FLIPPER_AUDIT_SPLUNK_ENDPOINT` | string | - | Splunk HEC URL |
| `FLIPPER_AUDIT_SPLUNK_TOKEN` | string | - | Splunk HEC token |
| `FLIPPER_AUDIT_SPLUNK_INDEX` | string | `main` | Splunk index |
| `FLIPPER_AUDIT_SYSLOG_HOST` | string | - | Syslog server |
| `FLIPPER_AUDIT_SYSLOG_PORT` | number | `514` | Syslog port |
| `FLIPPER_AUDIT_SYSLOG_PROTOCOL` | string | `udp` | udp/tcp/tls |
| `FLIPPER_AUDIT_FILE_PATH` | string | - | Log file path |

## Appendix B: Splunk HEC Setup

1. In Splunk, go to **Settings → Data Inputs → HTTP Event Collector**
2. Click **New Token**
3. Name: `flipper-mcp`
4. Select index: Create or use existing
5. Copy the token value
6. Configure MCP server:

```bash
export FLIPPER_AUDIT_ENABLED=true
export FLIPPER_AUDIT_DESTINATION=splunk
export FLIPPER_AUDIT_SPLUNK_ENDPOINT=https://splunk.company.com:8088/services/collector
export FLIPPER_AUDIT_SPLUNK_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export FLIPPER_AUDIT_SPLUNK_INDEX=network_audit
```

## Appendix C: Elasticsearch Setup

```bash
# Create index template
curl -X PUT "https://elastic.company.com:9200/_index_template/mcp-audit" \
  -H "Content-Type: application/json" \
  -d '{
    "index_patterns": ["mcp-audit-*"],
    "template": {
      "mappings": {
        "properties": {
          "timestamp": { "type": "date" },
          "level": { "type": "keyword" },
          "category": { "type": "keyword" },
          "action": { "type": "keyword" },
          "outcome": { "type": "keyword" },
          "target.device": { "type": "keyword" },
          "duration_ms": { "type": "integer" }
        }
      }
    }
  }'
```

## Appendix D: Related Documentation

- [Splunk HTTP Event Collector](https://docs.splunk.com/Documentation/Splunk/latest/Data/UsetheHTTPEventCollector)
- [Elasticsearch Bulk API](https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-bulk.html)
- [Datadog Log Management](https://docs.datadoghq.com/logs/)
- [RFC 5424 - Syslog Protocol](https://datatracker.ietf.org/doc/html/rfc5424)
