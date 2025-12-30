# BIG-IQ MCP Server Specification

**Status:** 📋 Spec Complete  
**Package:** `flipperagents-bigiq-mcp`  
**Priority:** Medium  
**Parent Doc:** [future-mcp-servers.md](./future-mcp-servers.md)
**Created:** 2025-12-30

---

## Summary

MCP server for F5 BIG-IQ — centralized management platform for BIG-IP fleets. Enables AI-assisted fleet operations including device inventory, license management, centralized AS3 deployment, backup orchestration, and audit log queries.

**Key Value:** Manage dozens or hundreds of BIG-IP devices through a single interface, with Claude orchestrating complex fleet-wide operations.

---

## Table of Contents

| Section | Description |
|---------|-------------|
| [1. Problem Statement](#1-problem-statement) | Why fleet management matters |
| [2. Use Cases](#2-use-cases) | Target workflows |
| [3. Architecture](#3-architecture) | How BIG-IQ fits in |
| [4. Tool Groups](#4-tool-groups) | All tools with interfaces |
| [5. Example Workflows](#5-example-workflows) | Conversation examples |
| [6. API Reference](#6-api-reference) | BIG-IQ REST patterns |
| [7. Implementation Plan](#7-implementation-plan) | Phases and milestones |
| [8. Environment Variables](#8-environment-variables) | Configuration |

---

## 1. Problem Statement

### 1.1 The Fleet Management Challenge

Managing a single BIG-IP is straightforward. Managing 50+ devices across multiple data centers introduces complexity:

| Challenge | Impact |
|-----------|--------|
| **Configuration drift** | Devices diverge over time, causing inconsistencies |
| **License tracking** | Which devices have which licenses? Any expired? |
| **Backup coordination** | Are all devices backed up? When was the last backup? |
| **Change visibility** | Who changed what, when, on which device? |
| **Deployment consistency** | How do I deploy the same app to 20 devices? |
| **Health monitoring** | Which devices need attention? |

### 1.2 What BIG-IQ Provides

BIG-IQ is F5's centralized management platform:

- **Device inventory** - Single view of all managed BIG-IP devices
- **License pools** - Centralized license management and assignment
- **Centralized AS3** - Deploy declarations to multiple devices
- **Backup management** - Scheduled and on-demand backups
- **Audit logging** - Comprehensive change history
- **Health dashboards** - Fleet-wide health visibility

### 1.3 Why an MCP Server?

BIG-IQ has a web UI and REST API, but:

| Current State | With MCP Server |
|---------------|-----------------|
| Manual UI navigation | Natural language queries |
| Script each API call | Claude orchestrates complex workflows |
| Learn BIG-IQ API structure | Ask questions, get answers |
| Build custom dashboards | Ad-hoc fleet queries |
| Write automation scripts | Conversational automation |

**Example:** "Which devices haven't been backed up in 30 days?" becomes a single question instead of API scripting.

---

## 2. Use Cases

### 2.1 Fleet Inventory & Health

| Use Case | Example Query |
|----------|---------------|
| Device inventory | "List all managed BIG-IP devices" |
| Version audit | "Which devices are running TMOS < 16.1?" |
| Health check | "Are any devices showing critical alerts?" |
| Capacity planning | "Show CPU/memory utilization across the fleet" |
| HA status | "Which HA pairs are out of sync?" |

### 2.2 License Management

| Use Case | Example Query |
|----------|---------------|
| Pool inventory | "What license pools do we have and how many are available?" |
| Assignment audit | "Which devices are using evaluation licenses?" |
| Expiration tracking | "Any licenses expiring in the next 90 days?" |
| License assignment | "Assign a Best Bundle license to bigip-prod-03" |
| License revocation | "Revoke license from decommissioned device bigip-old-01" |

### 2.3 Centralized Deployment

| Use Case | Example Query |
|----------|---------------|
| Multi-device deploy | "Deploy this AS3 declaration to all production devices" |
| Targeted deploy | "Deploy to devices in the us-east data center" |
| Deployment status | "What's the status of my last deployment?" |
| Rollback | "Rollback the last AS3 deployment on bigip-prod-02" |
| Declaration audit | "What AS3 tenants exist across the fleet?" |

### 2.4 Backup Management

| Use Case | Example Query |
|----------|---------------|
| Backup status | "Which devices haven't been backed up in 30 days?" |
| Create backup | "Backup all production devices now" |
| Restore planning | "Show available backups for bigip-prod-01" |
| Backup cleanup | "Delete backups older than 90 days" |
| Backup verification | "Verify backup integrity for critical devices" |

### 2.5 Audit & Compliance

| Use Case | Example Query |
|----------|---------------|
| Change history | "What changes were made to bigip-prod-01 last week?" |
| User audit | "Show all changes made by user john.doe" |
| Configuration diff | "Compare current config to last month's backup" |
| Compliance check | "Which devices don't have NTP configured?" |
| Alert history | "What alerts fired in the last 24 hours?" |

---

## 3. Architecture

### 3.1 System Context

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Desktop                            │
│                              │                                   │
│                    ┌─────────▼─────────┐                        │
│                    │   BIG-IQ MCP      │                        │
│                    │     Server        │                        │
│                    └─────────┬─────────┘                        │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                               │ REST API (443)
                               ▼
                    ┌─────────────────────┐
                    │      BIG-IQ         │
                    │  (Central Manager)  │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │ BIG-IP 1 │    │ BIG-IP 2 │    │ BIG-IP N │
        └──────────┘    └──────────┘    └──────────┘
```

### 3.2 MCP Server Role

The BIG-IQ MCP server:
- Connects to BIG-IQ REST API (not directly to BIG-IP devices)
- Translates natural language to API calls
- Aggregates and summarizes fleet data
- Orchestrates multi-step workflows
- Provides conversational access to audit logs

### 3.3 Relationship to TMOS MCP Server

| Server | Scope | Use Case |
|--------|-------|----------|
| **TMOS MCP** | Single BIG-IP | Direct device management, detailed config |
| **BIG-IQ MCP** | Fleet of BIG-IP | Inventory, fleet-wide operations, audit |

They complement each other:
- Use BIG-IQ MCP for fleet overview and multi-device operations
- Use TMOS MCP for deep-dive into specific device configuration

**Cross-server workflow example:**
```
User: "Find devices with SSL certs expiring soon"
→ BIG-IQ MCP: list_devices with cert expiration filter
→ Returns: bigip-prod-01, bigip-prod-03

User: "Show me the cert details on bigip-prod-01"
→ TMOS MCP: connect to bigip-prod-01, list_certificates
→ Returns: detailed cert info
```

---

## 4. Tool Groups

### 4.1 Connection & Discovery

#### `connect`

Connect to BIG-IQ and establish session.

```typescript
interface ConnectParams {
  host: string;           // BIG-IQ hostname/IP
  username?: string;      // Default: admin
  password: string;       // Password
  port?: number;          // Default: 443
}

interface ConnectResult {
  connected: boolean;
  version: string;        // BIG-IQ version
  build: string;
  edition: string;        // "CM" (Centralized Management)
  managed_devices: number;
  license_pools: number;
}
```

#### `get_system_info`

Get BIG-IQ system information.

```typescript
interface SystemInfoResult {
  hostname: string;
  version: string;
  build: string;
  platform: string;
  uptime: string;
  ha_state: 'standalone' | 'primary' | 'secondary';
  managed_device_count: number;
  license_pool_count: number;
  pending_tasks: number;
}
```

---

### 4.2 Device Management

#### `list_devices`

List all managed BIG-IP devices.

```typescript
interface ListDevicesParams {
  filter?: {
    version?: string;       // e.g., "16.1*" for version prefix
    state?: 'active' | 'unreachable' | 'framework-error';
    datacenter?: string;    // Filter by data center
    tag?: string;           // Filter by tag/label
  };
  include_health?: boolean; // Include CPU/memory stats
  include_modules?: boolean; // Include licensed modules
}

interface ManagedDevice {
  id: string;               // UUID
  hostname: string;
  address: string;          // Management IP
  version: string;          // TMOS version
  build: string;
  platform: string;         // e.g., "BIG-IP Virtual Edition"
  state: 'active' | 'unreachable' | 'framework-error';
  ha_state?: 'active' | 'standby' | 'standalone';
  ha_peer?: string;         // Peer device hostname
  last_backup?: string;     // ISO timestamp
  last_sync?: string;       // Last config sync
  health?: {
    cpu_percent: number;
    memory_percent: number;
    disk_percent: number;
  };
  modules?: string[];       // Licensed modules
  tags?: string[];          // Custom tags
}

interface ListDevicesResult {
  devices: ManagedDevice[];
  total: number;
  filtered: number;
}
```

#### `get_device`

Get detailed information for a specific device.

```typescript
interface GetDeviceParams {
  device: string;          // Hostname or ID
}

interface DeviceDetail extends ManagedDevice {
  serial_number: string;
  base_mac: string;
  marketing_name: string;
  license_type: string;
  license_expiry?: string;
  management_port: number;
  self_links: {
    backup: string;
    config: string;
    logs: string;
  };
  certificates: {
    expiring_soon: number;  // Count expiring in 30 days
    expired: number;
  };
  as3_tenants: string[];    // Deployed AS3 tenants
  last_config_change: string;
}
```

#### `get_device_health`

Get health metrics for a device or all devices.

```typescript
interface GetDeviceHealthParams {
  device?: string;         // Specific device, or omit for all
  period?: 'hour' | 'day' | 'week';
}

interface DeviceHealth {
  device: string;
  timestamp: string;
  cpu: {
    current: number;
    average: number;
    peak: number;
  };
  memory: {
    current: number;
    average: number;
    peak: number;
  };
  disk: {
    current: number;
    threshold: number;
  };
  connections: {
    current: number;
    peak: number;
  };
  throughput: {
    in_mbps: number;
    out_mbps: number;
  };
  alerts: {
    critical: number;
    warning: number;
  };
}
```

#### `sync_device`

Trigger discovery/sync for a device.

```typescript
interface SyncDeviceParams {
  device: string;
  full_sync?: boolean;     // Force full re-discovery
}

interface SyncDeviceResult {
  task_id: string;
  status: 'started' | 'queued';
  estimated_time: string;
}
```

---

### 4.3 License Management

#### `list_license_pools`

List license pools and utilization.

```typescript
interface ListLicensePoolsParams {
  pool_type?: 'regkey' | 'utility' | 'purchased';
}

interface LicensePool {
  id: string;
  name: string;
  type: 'regkey' | 'utility' | 'purchased';
  total_licenses: number;
  assigned: number;
  available: number;
  offerings: string[];      // e.g., ["Best Bundle", "Better Bundle"]
  expiration?: string;      // Pool expiration if applicable
}

interface ListLicensePoolsResult {
  pools: LicensePool[];
  total_licenses: number;
  total_assigned: number;
  total_available: number;
}
```

#### `get_license_assignments`

Get license assignments across devices.

```typescript
interface GetLicenseAssignmentsParams {
  pool?: string;           // Filter by pool name
  device?: string;         // Filter by device
}

interface LicenseAssignment {
  device: string;
  device_address: string;
  pool: string;
  offering: string;
  assigned_date: string;
  expiration?: string;
  status: 'licensed' | 'expired' | 'revoked';
}

interface GetLicenseAssignmentsResult {
  assignments: LicenseAssignment[];
  expiring_soon: LicenseAssignment[];  // Expiring in 90 days
}
```

#### `assign_license`

Assign a license to a device.

```typescript
interface AssignLicenseParams {
  device: string;          // Device hostname or ID
  pool: string;            // License pool name
  offering?: string;       // Specific offering (if pool has multiple)
}

interface AssignLicenseResult {
  success: boolean;
  device: string;
  pool: string;
  offering: string;
  license_key?: string;    // Assigned key (for regkey pools)
  expiration?: string;
  message: string;
}
```

#### `revoke_license`

Revoke a license from a device.

```typescript
interface RevokeLicenseParams {
  device: string;
  confirm: boolean;        // Must be true
}

interface RevokeLicenseResult {
  success: boolean;
  device: string;
  pool: string;
  license_returned: boolean;
  message: string;
}
```

---

### 4.4 AS3 Management

#### `list_as3_declarations`

List AS3 declarations across managed devices.

```typescript
interface ListAs3DeclarationsParams {
  device?: string;         // Filter by device
  tenant?: string;         // Filter by tenant name
}

interface As3Declaration {
  device: string;
  tenant: string;
  schema_version: string;
  last_modified: string;
  modified_by: string;
  applications: string[];  // App names within tenant
  status: 'deployed' | 'pending' | 'error';
}

interface ListAs3DeclarationsResult {
  declarations: As3Declaration[];
  total_tenants: number;
  by_device: Record<string, number>;  // Device -> tenant count
}
```

#### `deploy_as3`

Deploy AS3 declaration to one or more devices.

```typescript
interface DeployAs3Params {
  declaration: object;     // AS3 declaration
  targets: string[] | 'all' | {
    datacenter?: string;
    tag?: string;
    version?: string;      // e.g., ">=16.1"
  };
  dry_run?: boolean;       // Validate without deploying
}

interface DeployAs3Result {
  task_id: string;
  targets: string[];       // Resolved device list
  status: 'started' | 'dry-run-complete';
  dry_run_results?: {
    device: string;
    valid: boolean;
    changes: number;
    errors: string[];
  }[];
}
```

#### `get_deployment_status`

Get status of an AS3 deployment task.

```typescript
interface GetDeploymentStatusParams {
  task_id: string;
}

interface DeploymentStatus {
  task_id: string;
  status: 'running' | 'completed' | 'failed' | 'partial';
  started_at: string;
  completed_at?: string;
  results: {
    device: string;
    status: 'success' | 'failed' | 'pending';
    message?: string;
    duration_ms?: number;
  }[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    pending: number;
  };
}
```

#### `delete_as3_declaration`

Delete AS3 tenant from device(s).

```typescript
interface DeleteAs3DeclarationParams {
  tenant: string;
  devices: string[] | 'all';
  confirm: boolean;
}

interface DeleteAs3DeclarationResult {
  task_id: string;
  targets: string[];
  status: 'started';
}
```

---

### 4.5 Backup Management

#### `list_backups`

List backups for managed devices.

```typescript
interface ListBackupsParams {
  device?: string;         // Filter by device
  since?: string;          // ISO date - backups after this date
  before?: string;         // ISO date - backups before this date
}

interface Backup {
  id: string;
  device: string;
  filename: string;
  size_bytes: number;
  created_at: string;
  created_by: string;
  type: 'scheduled' | 'manual' | 'pre-change';
  status: 'available' | 'expired' | 'failed';
  retention_days: number;
  description?: string;
}

interface ListBackupsResult {
  backups: Backup[];
  total: number;
  devices_with_recent_backup: number;  // Backed up in last 7 days
  devices_needing_backup: number;      // No backup in 30+ days
}
```

#### `backup_device`

Create a backup of a specific device.

```typescript
interface BackupDeviceParams {
  device: string;
  description?: string;
  type?: 'ucs' | 'config-only';
}

interface BackupDeviceResult {
  task_id: string;
  device: string;
  status: 'started';
  estimated_time: string;
}
```

#### `backup_fleet`

Backup multiple devices.

```typescript
interface BackupFleetParams {
  devices: string[] | 'all' | {
    without_backup_days?: number;  // Devices not backed up in N days
    datacenter?: string;
    tag?: string;
  };
  description?: string;
  parallel?: number;       // Max concurrent backups (default: 5)
}

interface BackupFleetResult {
  task_id: string;
  targets: string[];
  status: 'started';
  estimated_time: string;
}
```

#### `restore_backup`

Restore a backup to a device.

```typescript
interface RestoreBackupParams {
  backup_id: string;
  target_device: string;   // Can be different from source
  confirm: boolean;
}

interface RestoreBackupResult {
  task_id: string;
  backup: string;
  target: string;
  status: 'started';
  warnings: string[];      // e.g., "Version mismatch: backup 16.1, device 17.1"
}
```

#### `get_backup_status`

Get status of backup/restore operation.

```typescript
interface GetBackupStatusParams {
  task_id: string;
}

interface BackupStatus {
  task_id: string;
  operation: 'backup' | 'restore';
  status: 'running' | 'completed' | 'failed';
  progress_percent: number;
  started_at: string;
  completed_at?: string;
  device: string;
  filename?: string;
  error?: string;
}
```

---

### 4.6 Audit & Logs

#### Local Audit Cache

The BIG-IQ MCP server maintains a local ring buffer of recent audit events, enabling:
- Quick queries without BIG-IQ API calls
- Offline access to recent history
- Faster response for common queries
- Fallback when BIG-IQ is unreachable

**Configuration:**

```bash
# Enable local audit cache (default: true)
BIGIQ_AUDIT_CACHE_ENABLED=true

# Ring buffer size (default: 500)
BIGIQ_AUDIT_CACHE_MAX_ENTRIES=500

# Persist cache to disk (optional)
BIGIQ_AUDIT_CACHE_PERSIST_PATH=/var/lib/flipper/bigiq-audit-cache.json

# Sync interval - how often to pull from BIG-IQ (default: 60s)
BIGIQ_AUDIT_CACHE_SYNC_INTERVAL_MS=60000
```

**Cache behavior:**
- On connect, pulls recent audit logs from BIG-IQ
- Periodically syncs new entries in background
- Ring buffer evicts oldest entries when full
- Optional persistence saves cache on shutdown, reloads on startup
- Tools automatically use cache when appropriate

#### `get_audit_logs`

Query audit logs for changes. Uses local cache for recent queries, falls back to BIG-IQ API for older/larger queries.

```typescript
interface GetAuditLogsParams {
  device?: string;         // Filter by device
  user?: string;           // Filter by username
  action?: 'create' | 'modify' | 'delete' | 'deploy';
  object_type?: string;    // e.g., "virtual", "pool", "as3"
  since?: string;          // ISO timestamp
  before?: string;         // ISO timestamp
  limit?: number;          // Default: 100
  source?: 'auto' | 'cache' | 'bigiq';  // Force data source (default: auto)
}

interface AuditLogEntry {
  id: string;
  timestamp: string;
  user: string;
  device: string;
  action: string;
  object_type: string;
  object_name: string;
  changes?: {
    field: string;
    old_value: string;
    new_value: string;
  }[];
  source_ip: string;
  result: 'success' | 'failure';
  error_message?: string;
}

interface GetAuditLogsResult {
  entries: AuditLogEntry[];
  total: number;
  returned: number;
  source: 'cache' | 'bigiq';  // Where data came from
  cache_status?: {            // When using cache
    entries_in_cache: number;
    oldest_cached: string;
    last_sync: string;
  };
}
```

**Source selection (auto mode):**
- Uses cache if: no `since` filter, or `since` is within cache window
- Falls back to BIG-IQ if: `since` is older than cache, or cache is empty
- Always uses BIG-IQ if: `source: 'bigiq'` specified

#### `get_local_audit_cache`

Query only the local audit cache (never calls BIG-IQ).

```typescript
interface GetLocalAuditCacheParams {
  device?: string;
  user?: string;
  action?: string;
  outcome?: 'success' | 'failure';
  limit?: number;          // Default: 50
}

interface GetLocalAuditCacheResult {
  entries: AuditLogEntry[];
  total_in_cache: number;
  oldest_entry: string;
  newest_entry: string;
  cache_capacity: number;
  last_sync: string;
}
```

**Example usage:**

```
User: "What just happened on bigip-prod-01?"
→ get_local_audit_cache(device="bigip-prod-01", limit=10)
→ Instant response from local cache

User: "Show all changes from last month"
→ get_audit_logs(since="2025-11-30", source="bigiq")
→ Full query to BIG-IQ API
```

#### `get_change_history`

Get change history for a specific device or object.

```typescript
interface GetChangeHistoryParams {
  device: string;
  object_type?: string;    // e.g., "ltm/virtual"
  object_name?: string;    // e.g., "/Common/vs_web"
  days?: number;           // Default: 30
}

interface ChangeHistoryResult {
  device: string;
  changes: {
    timestamp: string;
    user: string;
    action: string;
    object: string;
    summary: string;
  }[];
  total_changes: number;
}
```

#### `get_alerts`

Get active alerts and recent alert history.

```typescript
interface GetAlertsParams {
  device?: string;
  severity?: 'critical' | 'warning' | 'info';
  active_only?: boolean;   // Only show unacknowledged
  since?: string;
}

interface Alert {
  id: string;
  device: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;        // e.g., "system", "traffic", "security"
  message: string;
  timestamp: string;
  acknowledged: boolean;
  acknowledged_by?: string;
}

interface GetAlertsResult {
  alerts: Alert[];
  summary: {
    critical: number;
    warning: number;
    info: number;
  };
}
```

---

## 5. Example Workflows

### 5.1 Fleet Health Check

```
User: Are all my BIG-IP devices healthy?

Claude: [calls list_devices with include_health=true]

I found 24 managed devices. Here's the summary:

| Status | Count |
|--------|-------|
| ✅ Healthy | 21 |
| ⚠️ Warning | 2 |
| 🔴 Critical | 1 |

Devices needing attention:

1. **bigip-prod-07** (Critical)
   - CPU: 95% (threshold: 80%)
   - 3 critical alerts active

2. **bigip-prod-12** (Warning)
   - Memory: 78% (threshold: 75%)
   - Last backup: 45 days ago

3. **bigip-dc2-03** (Warning)
   - Unreachable for 15 minutes
   - Last seen: 2025-12-30T14:30:00Z

Would you like me to investigate any of these?
```

### 5.2 License Audit

```
User: Do we have any license issues?

Claude: [calls list_license_pools]
[calls get_license_assignments]

License Pool Summary:

| Pool | Type | Available | Assigned | Utilization |
|------|------|-----------|----------|-------------|
| Production-Best | RegKey | 5 | 20 | 80% |
| Lab-Evaluation | Utility | 10 | 8 | 80% |
| DR-Reserve | RegKey | 10 | 2 | 20% |

⚠️ Issues Found:

1. **3 licenses expiring within 90 days:**
   - bigip-prod-01: expires 2025-02-15
   - bigip-prod-02: expires 2025-02-15
   - bigip-prod-03: expires 2025-02-15

2. **2 devices using evaluation licenses in production:**
   - bigip-prod-new-01 (Lab-Evaluation pool)
   - bigip-prod-new-02 (Lab-Evaluation pool)

Recommendation: Assign Production-Best licenses to the new devices 
and renew expiring licenses.

Would you like me to reassign the evaluation licenses?
```

### 5.3 Multi-Device AS3 Deployment

```
User: Deploy this new web application to all production devices:
[pastes AS3 declaration]

Claude: [calls list_devices with filter tag="production"]
[calls deploy_as3 with dry_run=true]

Found 12 production devices. Dry-run results:

| Device | Status | Changes |
|--------|--------|---------|
| bigip-prod-01 | ✅ Valid | 3 new objects |
| bigip-prod-02 | ✅ Valid | 3 new objects |
| ... | ... | ... |
| bigip-prod-11 | ⚠️ Warning | Pool member IP conflict |
| bigip-prod-12 | ✅ Valid | 3 new objects |

⚠️ bigip-prod-11 has a warning: Pool member 10.1.1.50 already exists 
in another pool. The deployment will succeed but may cause routing issues.

Options:
1. Deploy to all 12 devices (including warning)
2. Deploy to 11 devices (skip bigip-prod-11)
3. Cancel and review the declaration

Which would you prefer?

User: Deploy to the 11 healthy devices

Claude: [calls deploy_as3 with targets excluding bigip-prod-11]

Deployment started (task_id: task_abc123)
Deploying to 11 devices...

[waits, calls get_deployment_status]

Deployment complete!

| Result | Count |
|--------|-------|
| ✅ Success | 11 |
| ⏭️ Skipped | 1 |

All production devices (except bigip-prod-11) now have the 
"web-frontend" tenant deployed.
```

### 5.4 Backup Compliance Check

```
User: Which devices haven't been backed up recently?

Claude: [calls list_backups]
[calls list_devices]

Backup Compliance Report:

| Status | Count | Devices |
|--------|-------|---------|
| ✅ Backed up (< 7 days) | 18 | - |
| ⚠️ Stale (7-30 days) | 4 | bigip-dc2-01, bigip-dc2-02, bigip-lab-01, bigip-lab-02 |
| 🔴 Overdue (> 30 days) | 2 | bigip-old-01, bigip-dr-standby |

The DR standby device (bigip-dr-standby) hasn't been backed up in 
67 days. This is a compliance risk.

Would you like me to:
1. Backup all 6 devices with stale/overdue backups
2. Backup only the 2 overdue devices
3. Show more details about each device
```

---

## 6. API Reference

### 6.1 BIG-IQ REST API Overview

Base URL: `https://<bigiq>/mgmt/`

| Endpoint | Purpose |
|----------|---------|
| `/shared/resolver/device-groups/cm-bigip-allDevices/devices` | Managed devices |
| `/cm/device/licensing/pool/` | License pools |
| `/cm/device/tasks/device-discovery` | Discovery tasks |
| `/cm/asm/working-config/virtual-servers` | ASM virtuals |
| `/shared/appsvcs/declare` | AS3 declarations |
| `/cm/device/backups` | Backup management |
| `/cm/shared/esmgmt/audit/events` | Audit logs |

### 6.2 Authentication

BIG-IQ uses token-based authentication:

```typescript
// 1. Get auth token
POST /mgmt/shared/authn/login
{
  "username": "admin",
  "password": "password",
  "loginProviderName": "tmos"
}

// Response includes token
{
  "token": {
    "token": "XXXXXXXX",
    "timeout": 1200
  }
}

// 2. Use token in subsequent requests
Headers: {
  "X-F5-Auth-Token": "XXXXXXXX"
}
```

### 6.3 Common Patterns

**Async Tasks:**

Many BIG-IQ operations return a task ID for polling:

```typescript
// Start operation
POST /mgmt/cm/device/tasks/device-backup
{ "deviceReference": { "link": "..." } }

// Response
{ "id": "task-123", "status": "STARTED" }

// Poll for completion
GET /mgmt/cm/device/tasks/device-backup/task-123
{ "id": "task-123", "status": "FINISHED", ... }
```

**Pagination:**

```typescript
GET /mgmt/shared/resolver/device-groups/cm-bigip-allDevices/devices?$top=20&$skip=0
```

**Filtering:**

```typescript
GET /mgmt/cm/device/licensing/pool?$filter=name eq 'Production-Pool'
```

### 6.4 Key API Endpoints

| Operation | Method | Endpoint |
|-----------|--------|----------|
| List devices | GET | `/shared/resolver/device-groups/cm-bigip-allDevices/devices` |
| Device details | GET | `/shared/resolver/device-groups/cm-bigip-allDevices/devices/{id}` |
| Device health | GET | `/cm/device/tasks/device-health/{id}` |
| License pools | GET | `/cm/device/licensing/pool/regkey/licenses` |
| License assignments | GET | `/cm/device/licensing/pool/regkey/licenses/{id}/offerings/{offering}/members` |
| Assign license | POST | `/cm/device/licensing/pool/regkey/licenses/{id}/offerings/{offering}/members` |
| AS3 declare | POST | `/mgmt/shared/appsvcs/declare` |
| List backups | GET | `/cm/device/backups` |
| Create backup | POST | `/cm/device/tasks/device-backup` |
| Audit logs | GET | `/cm/shared/esmgmt/audit/events` |

---

## 7. Implementation Plan

### Phase 1: Foundation

| Task | Effort | Priority |
|------|--------|----------|
| Project scaffolding | Low | P0 |
| Authentication + connection | Medium | P0 |
| `connect` / `get_system_info` | Low | P0 |
| Error handling patterns | Medium | P0 |
| Basic tests | Medium | P0 |

### Phase 2: Device Management

| Task | Effort | Priority |
|------|--------|----------|
| `list_devices` | Medium | P1 |
| `get_device` | Low | P1 |
| `get_device_health` | Medium | P1 |
| `sync_device` | Low | P2 |

### Phase 3: License Management

| Task | Effort | Priority |
|------|--------|----------|
| `list_license_pools` | Medium | P1 |
| `get_license_assignments` | Medium | P1 |
| `assign_license` | Medium | P1 |
| `revoke_license` | Low | P2 |

### Phase 4: AS3 Management

| Task | Effort | Priority |
|------|--------|----------|
| `list_as3_declarations` | Medium | P1 |
| `deploy_as3` (single device) | Medium | P1 |
| `deploy_as3` (multi-device) | High | P1 |
| `get_deployment_status` | Medium | P1 |
| `delete_as3_declaration` | Low | P2 |

### Phase 5: Backup Management

| Task | Effort | Priority |
|------|--------|----------|
| `list_backups` | Medium | P1 |
| `backup_device` | Medium | P1 |
| `backup_fleet` | High | P2 |
| `restore_backup` | Medium | P2 |
| `get_backup_status` | Low | P1 |

### Phase 6: Audit & Logs

| Task | Effort | Priority |
|------|--------|----------|
| `get_audit_logs` | Medium | P2 |
| `get_change_history` | Medium | P2 |
| `get_alerts` | Medium | P2 |

---

## 8. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BIGIQ_HOST` | Yes | BIG-IQ hostname or IP |
| `BIGIQ_USER` | No | Username (default: admin) |
| `BIGIQ_PASS` | Yes | Password |
| `BIGIQ_PORT` | No | Management port (default: 443) |
| `BIGIQ_VERIFY_SSL` | No | Verify SSL certs (default: true) |
| `HTTP_PORT` | No | Enable HTTP transport |
| `LOG_LEVEL` | No | DEBUG, INFO, WARN, ERROR |
| `BIGIQ_AUDIT_CACHE_ENABLED` | No | Enable local audit cache (default: true) |
| `BIGIQ_AUDIT_CACHE_MAX_ENTRIES` | No | Cache ring buffer size (default: 500) |
| `BIGIQ_AUDIT_CACHE_PERSIST_PATH` | No | Path to persist cache on shutdown |
| `BIGIQ_AUDIT_CACHE_SYNC_INTERVAL_MS` | No | BIG-IQ sync interval (default: 60000) |

---

## Appendix A: BIG-IQ Versions

| Version | Status | Notes |
|---------|--------|-------|
| 8.x | Supported | Current release, full API |
| 7.x | Supported | Some API differences |
| 6.x | Deprecated | Limited testing |

## Appendix B: Related Documentation

- [BIG-IQ REST API Reference](https://clouddocs.f5.com/products/big-iq/mgmt-api/latest/)
- [BIG-IQ Admin Guide](https://techdocs.f5.com/en-us/bigiq-8-3-0.html)
- [AS3 with BIG-IQ](https://clouddocs.f5.com/products/extensions/f5-appsvcs-extension/latest/userguide/big-iq.html)
- [BIG-IQ License Management](https://techdocs.f5.com/en-us/bigiq-8-3-0/managing-big-ip-devices-from-big-iq/license-management.html)

## Appendix C: Comparison with Direct Device Access

| Capability | TMOS MCP (Direct) | BIG-IQ MCP |
|------------|-------------------|------------|
| Single device config | ✅ Full access | ⚠️ Limited (via sync) |
| Fleet inventory | ❌ Manual | ✅ Native |
| Centralized deploy | ❌ Script loop | ✅ Native |
| License management | ❌ Per-device | ✅ Pooled |
| Audit history | ⚠️ Per-device | ✅ Centralized |
| Backup orchestration | ❌ Manual | ✅ Native |

Use both servers together for comprehensive BIG-IP management.
