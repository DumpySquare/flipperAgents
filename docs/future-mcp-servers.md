# Future MCP Servers

Planning document for additional MCP servers and advanced MCP capabilities beyond the current NetScaler and TMOS implementations.

## Summary

This document outlines three categories of future work:

1. **New MCP Servers** — F5 XC, BIG-IQ, and NGINX backends to expand device coverage
2. **Advanced MCP Features** — Leverage MCP spec capabilities like subscriptions, prompts, and sampling
3. **Cross-Cutting Enhancements** — Orchestration, diff/compare, rollback patterns, and AS3 drift detection

The goal is to evolve from isolated device management toward a unified migration and fleet management platform where Claude can orchestrate complex workflows across multiple backends reliably.

**Key Initiative: AS3 Drift Detection** — A major tool group within TMOS MCP that combines corkscrew and tmos-converter projects to detect when live BIG-IP config diverges from AS3 source of truth. Generates validated patches for user review, never auto-applies.

---

## Table of Contents

| Section | Status | Completion |
|---------|--------|------------|
| [1. New MCP Servers](#1-new-mcp-servers) | | |
| ├─ [1.1 F5 Distributed Cloud (XC)](#11-f5-distributed-cloud-xc) | 🟡 Planned | 0% |
| ├─ [1.2 BIG-IQ](#12-big-iq) | 📋 Spec Complete | 0% |
| └─ [1.3 NGINX](#13-nginx) | ⚪ Deferred | 0% |
| [2. Advanced MCP Features](#2-advanced-mcp-features) | | |
| ├─ [2.1 Resource Subscriptions](#21-resource-subscriptions) | 🟡 Planned | 0% |
| ├─ [2.2 Prompt Templates](#22-prompt-templates) | 🟡 Planned | 0% |
| └─ [2.3 Sampling Integration](#23-sampling-integration) | ⚪ Research | 0% |
| [3. Cross-Cutting Enhancements](#3-cross-cutting-enhancements) | | |
| ├─ [3.1 Cross-Server Orchestration](#31-cross-server-orchestration) | 🟡 Planned | 0% |
| ├─ [3.2 Diff/Compare Tools](#32-diffcompare-tools) | 🟡 Planned | 0% |
| ├─ [3.3 Rollback Patterns](#33-rollback-patterns) | 🟡 Planned | 0% |
| └─ [3.4 AS3 Drift Detection](#34-as3-drift-detection) | ✅ Complete | 100% |
| [4. Implementation Notes](#4-implementation-notes) | 🟢 Active | 50% |
| [5. Shared Infrastructure](#5-shared-infrastructure) | | |
| └─ [5.1 Customer Audit Logging](#51-customer-audit-logging) | 📋 Spec Complete | 0% |
| └─ [5.2 Integration Testing](#52-integration-testing) | 📋 Spec Complete | 0% |
| └─ [5.3 Corkscrew + Converter Merge](#53-corkscrew--tmos-converter-merge) | 📋 Proposal | 0% |

**Legend:** 🟢 Active | 🟡 Planned | ⚪ Deferred/Research | 📋 Spec Complete | ✅ Complete

---

## 1. New MCP Servers

### 1.1 F5 Distributed Cloud (XC)

**Package name:** `flipperagents-xc-mcp`  
**Priority:** High  
**Rationale:** Migration target for NetScaler/BIG-IP configs

#### Use Cases

- Migrate configurations from NetScaler or BIG-IP to XC
- Manage HTTP load balancers, origin pools, health checks
- Certificate management
- WAF policy configuration

#### API Reference

- [XC API Documentation](https://docs.cloud.f5.com/docs/api)
- Authentication: API tokens or service credentials
- Base URL: `https://<tenant>.console.ves.volterra.io/api`

#### Potential Tools

| Tool | Description |
|------|-------------|
| `list_load_balancers` | List HTTP/HTTPS load balancers |
| `get_load_balancer` | Get load balancer configuration |
| `create_load_balancer` | Create new HTTP/HTTPS load balancer |
| `update_load_balancer` | Update load balancer configuration |
| `delete_load_balancer` | Delete load balancer |
| `list_origin_pools` | List origin pools |
| `get_origin_pool` | Get origin pool details |
| `create_origin_pool` | Create new origin pool |
| `list_health_checks` | List health check configurations |
| `list_certificates` | List TLS certificates |
| `upload_certificate` | Upload TLS certificate and key |
| `get_namespace` | Get namespace configuration |
| `list_namespaces` | List available namespaces |

#### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `XC_TENANT` | Yes | XC tenant name |
| `XC_API_TOKEN` | Yes | API token for authentication |
| `XC_NAMESPACE` | No | Default namespace |

#### Research Questions

- [ ] What's the best auth approach - API tokens vs service credentials?
- [ ] How are configs structured - per namespace?
- [ ] What's the migration path from AS3 declarations to XC?
- [ ] Rate limiting considerations?
- [ ] How do WAF policies map from BIG-IP ASM?

---

### 1.2 BIG-IQ

**Package name:** `flipperagents-bigiq-mcp`  
**Priority:** Medium  
**Rationale:** Fleet management, licensing, AS3 deployments  
**Full Specification:** [bigiq-mcp-spec.md](./bigiq-mcp-spec.md)

#### Summary

MCP server for F5 BIG-IQ — centralized management for BIG-IP fleets. Enables:

- Fleet-wide device inventory and health monitoring
- License pool management (assign/revoke)
- Centralized AS3 deployment to multiple devices
- Backup/restore across fleet
- Audit log queries and change history

**Key Value:** Manage dozens or hundreds of BIG-IP devices through one interface.

#### Tool Groups

| Group | Tools |
|-------|-------|
| Device Management | `list_devices`, `get_device`, `get_device_health` |
| License Management | `list_license_pools`, `assign_license`, `revoke_license` |
| AS3 Management | `list_as3_declarations`, `deploy_as3`, `delete_as3_declaration` |
| Backup/Restore | `list_backups`, `backup_device`, `backup_fleet`, `restore_backup` |
| Audit | `get_audit_logs`, `get_change_history` |

#### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BIGIQ_HOST` | Yes | BIG-IQ hostname/IP |
| `BIGIQ_USER` | No | Username (default: admin) |
| `BIGIQ_PASS` | Yes | Password |
| `BIGIQ_VERIFY_SSL` | No | Verify SSL certificates (default: true) |

See [full specification](./bigiq-mcp-spec.md) for tool interfaces, workflows, and implementation plan.

---

### 1.3 NGINX

**Package name:** `flipperagents-nginx-mcp`  
**Priority:** Low (Deferred)  
**Rationale:** Wait for user demand

#### Notes

- Target NGINX Open Source via SSH/config file management
- Similar approach to NetScaler SSH batch commands
- Limited API surface without NGINX Plus
- Consider NGINX Plus API if customers have it

#### Potential Tools (if implemented)

| Tool | Description |
|------|-------------|
| `get_config` | Get nginx.conf contents |
| `get_config_file` | Get specific include file |
| `test_config` | Run nginx -t to validate |
| `reload_config` | Reload NGINX gracefully |
| `get_status` | Get NGINX process status |
| `list_upstreams` | Parse upstream blocks from config |
| `list_servers` | Parse server blocks from config |
| `get_upstream` | Get specific upstream details |
| `get_server` | Get specific server block |

#### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NGINX_HOST` | Yes | NGINX server hostname/IP |
| `NGINX_SSH_USER` | Yes | SSH username |
| `NGINX_SSH_KEY` | No | Path to SSH private key |
| `NGINX_CONFIG_PATH` | No | Path to nginx.conf (default: /etc/nginx/nginx.conf) |

---

## 2. Advanced MCP Features

These features leverage capabilities in the MCP specification that go beyond simple request/response tools.

### 2.1 Resource Subscriptions

**Status:** 🟡 Planned  
**MCP Spec:** [Resources](https://spec.modelcontextprotocol.io/specification/server/resources/)

#### Concept

Current MCP interaction is request/response only — you ask, it answers. The MCP spec supports **resource subscriptions** where servers can push updates to clients when resources change.

#### Use Cases

| Use Case | Description |
|----------|-------------|
| Drift detection | Subscribe to vserver config; alert if someone modifies it outside your workflow |
| Migration monitoring | Watch source device during migration; pause if unexpected changes occur |
| Audit logging | Stream all config changes to a log/SIEM |
| Health monitoring | Subscribe to pool member health; notify on status changes |
| Sync verification | After migration, subscribe to both source and target; alert on divergence |

#### Implementation Approach

```
Resource URI pattern:
  netscaler://{device}/lbvserver/{name}
  tmos://{device}/ltm/virtual/{name}
  xc://{tenant}/{namespace}/load_balancer/{name}

Subscription flow:
  1. Client calls resources/subscribe with URI
  2. Server tracks subscription, polls device or uses event stream
  3. On change, server sends notifications/resources/updated
  4. Client can fetch updated resource or react to change
```

#### Potential Resources to Expose

| Server | Resource Type | URI Pattern |
|--------|--------------|-------------|
| NetScaler | LB vServer | `netscaler://{device}/lbvserver/{name}` |
| NetScaler | CS vServer | `netscaler://{device}/csvserver/{name}` |
| NetScaler | Service Group | `netscaler://{device}/servicegroup/{name}` |
| TMOS | Virtual Server | `tmos://{device}/ltm/virtual/{name}` |
| TMOS | Pool | `tmos://{device}/ltm/pool/{name}` |
| TMOS | iRule | `tmos://{device}/ltm/rule/{name}` |
| XC | Load Balancer | `xc://{tenant}/{ns}/load_balancer/{name}` |
| XC | Origin Pool | `xc://{tenant}/{ns}/origin_pool/{name}` |
| BIG-IQ | Device | `bigiq://{host}/device/{id}` |
| BIG-IQ | License Pool | `bigiq://{host}/license_pool/{id}` |

#### Technical Considerations

- Polling interval vs event-driven (device API limitations)
- Connection persistence for SSE transport
- Subscription lifecycle management
- Rate limiting to avoid hammering devices
- Delta vs full resource on update notification

---

### 2.2 Prompt Templates

**Status:** 🟡 Planned  
**MCP Spec:** [Prompts](https://spec.modelcontextprotocol.io/specification/server/prompts/)

#### Concept

MCP servers can expose **prompt templates** — reusable, parameterized workflows that the LLM can invoke. Instead of re-explaining a complex task each time, you invoke a template with parameters and get a structured workflow.

#### Use Cases

| Template | Description |
|----------|-------------|
| `netscaler-to-tmos-migration` | Full migration workflow for a single vserver |
| `netscaler-to-xc-migration` | Migrate vserver to F5 Distributed Cloud |
| `fleet-audit` | Audit specific config element across all devices |
| `ssl-cert-renewal` | Check expiring certs, generate CSRs, deploy new certs |
| `pre-migration-assessment` | Analyze source config, identify blockers, estimate effort |

#### Example Template: `netscaler-to-tmos-migration`

```yaml
name: netscaler-to-tmos-migration
description: |
  Migrate a NetScaler LB vServer to F5 BIG-IP LTM.
  Analyzes source config, generates equivalent BIG-IP config,
  validates, and deploys with confirmation.
arguments:
  - name: source_device
    description: NetScaler device name or IP
    required: true
  - name: vserver_name
    description: Name of the LB vServer to migrate
    required: true
  - name: target_device
    description: BIG-IP device name or IP
    required: true
  - name: target_partition
    description: BIG-IP partition for new objects
    required: false
    default: Common
  - name: dry_run
    description: If true, generate config but don't deploy
    required: false
    default: true
```

#### Example Template: `pre-migration-assessment`

```yaml
name: pre-migration-assessment
description: |
  Analyze a NetScaler configuration and produce a migration
  assessment report including: feature inventory, migration
  blockers, manual steps required, and effort estimate.
arguments:
  - name: source_device
    description: NetScaler device name or IP
    required: true
  - name: scope
    description: What to assess - 'all', 'lbvservers', 'csvservers', or specific name
    required: false
    default: all
  - name: target_platform
    description: Target platform - 'tmos', 'xc', or 'both'
    required: false
    default: tmos
```

#### Template Response Structure

Templates should return structured data the LLM can reason about:

```json
{
  "template": "pre-migration-assessment",
  "status": "complete",
  "results": {
    "summary": {
      "total_vservers": 45,
      "migratable": 38,
      "blockers": 7,
      "estimated_hours": 24
    },
    "blockers": [
      {
        "object": "vs_legacy_app",
        "reason": "Uses deprecated RADIUS auth",
        "remediation": "Convert to LDAP or migrate auth separately"
      }
    ],
    "warnings": [...],
    "migration_plan": [...]
  }
}
```

#### Implementation Notes

- Templates are registered via `prompts/list`
- Client invokes via `prompts/get` with arguments
- Server returns structured prompt content
- LLM processes prompt content and executes workflow using available tools

---

### 2.3 Sampling Integration

**Status:** ⚪ Research  
**MCP Spec:** [Sampling](https://spec.modelcontextprotocol.io/specification/server/sampling/)

#### Concept

**Sampling** allows MCP servers to request LLM completions from the client. This enables "agentic" behavior within the server itself — the server can ask the LLM to reason about data, make decisions, or generate content.

#### Use Cases

| Use Case | Description |
|----------|-------------|
| Config interpretation | Server fetches raw config, asks LLM to extract structured data |
| Anomaly explanation | Server detects unusual config pattern, asks LLM to explain risk |
| Migration decision | Server encounters ambiguous mapping, asks LLM which option fits best |
| Documentation generation | Server gathers config data, asks LLM to write human-readable docs |
| Error diagnosis | Server gets error from device, asks LLM to suggest remediation |

#### Example Flow: Intelligent Migration

```
1. Tool called: migrate_vserver(source="vs_app1", target_device="bigip1")
2. Server fetches NetScaler config for vs_app1
3. Server encounters ambiguous policy (could map to iRule OR LTM policy)
4. Server uses sampling to ask LLM:
   "Given this NetScaler responder policy [config], should this 
   become a BIG-IP iRule or LTM Policy? Consider: [context]"
5. LLM responds with recommendation and reasoning
6. Server proceeds with recommended approach
7. Tool returns result to original LLM conversation
```

#### Technical Considerations

- Sampling creates nested LLM calls — cost and latency implications
- Need clear boundaries on when server should sample vs return to client
- Risk of infinite loops if not carefully designed
- Client must support sampling capability
- Consider caching common sampling patterns

#### When to Use Sampling vs Return to Client

| Scenario | Approach |
|----------|----------|
| Simple ambiguity with clear options | Return to client with options |
| Complex reasoning about config semantics | Use sampling |
| User preference question | Return to client |
| Technical best-practice decision | Use sampling |
| Multiple interdependent decisions | Return to client |

---

## 3. Cross-Cutting Enhancements

These enhancements span multiple MCP servers and provide unified capabilities.

### 3.1 Cross-Server Orchestration

**Status:** 🟡 Planned

#### Concept

Today, each MCP server operates in isolation. The LLM orchestrates across servers by calling tools sequentially. **Cross-server orchestration** provides tools that coordinate operations across multiple backends in a single, reliable operation.

#### Why Not Just Let the LLM Orchestrate?

| LLM Orchestration | Dedicated Orchestration Tools |
|-------------------|------------------------------|
| Flexible, handles novel scenarios | Reliable, tested workflows |
| Can make mistakes mid-workflow | Atomic operations with rollback |
| Context window limitations | Handles large configs efficiently |
| Each step visible to user | Clean abstraction, less noise |
| Good for exploration | Good for production operations |

**Recommendation:** Use LLM orchestration for exploration and one-off tasks. Ossify proven patterns into dedicated orchestration tools for production use.

#### Potential Orchestration Tools

| Tool | Source | Target | Description |
|------|--------|--------|-------------|
| `migrate_vserver_to_tmos` | NetScaler | BIG-IP | Full vserver migration including pool, monitors, profiles |
| `migrate_vserver_to_xc` | NetScaler | XC | Migrate to F5 Distributed Cloud |
| `migrate_virtual_to_xc` | BIG-IP | XC | Migrate BIG-IP virtual server to XC |
| `sync_pool_members` | Any | Any | Sync pool membership across platforms |
| `clone_vserver` | NetScaler | NetScaler | Clone vserver to different device |
| `clone_virtual` | BIG-IP | BIG-IP | Clone virtual server to different device |
| `compare_configs` | Any | Any | Semantic comparison across platforms |

#### Example: `migrate_vserver_to_tmos`

```typescript
interface MigrateVserverToTmosParams {
  // Source
  source_device: string;      // NetScaler device
  vserver_name: string;       // vServer to migrate
  
  // Target
  target_device: string;      // BIG-IP device
  target_partition?: string;  // Default: Common
  
  // Options
  name_prefix?: string;       // Prefix for created objects
  include_ssl?: boolean;      // Migrate SSL profiles/certs
  include_persistence?: boolean;
  include_policies?: boolean; // Attempt policy/iRule conversion
  
  // Safety
  dry_run?: boolean;          // Generate config only
  confirm?: boolean;          // Required for actual deployment
}

interface MigrateVserverToTmosResult {
  status: 'success' | 'partial' | 'failed';
  
  // What was created
  created_objects: {
    virtual_server: string;
    pool: string;
    monitors: string[];
    profiles: string[];
    irules: string[];
  };
  
  // What couldn't be migrated
  skipped: {
    object: string;
    reason: string;
    manual_action: string;
  }[];
  
  // Rollback info
  rollback_id: string;
  
  // Validation
  validation: {
    source_config_hash: string;
    target_config_hash: string;
    functional_equivalence: 'verified' | 'unverified' | 'differences_found';
  };
}
```

#### Orchestration Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Orchestration Layer                    │
│  ┌─────────────────────────────────────────────────┐    │
│  │  migrate_vserver_to_tmos                        │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐      │    │
│  │  │ Extract  │→ │ Convert  │→ │  Deploy  │      │    │
│  │  └──────────┘  └──────────┘  └──────────┘      │    │
│  └─────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  NetScaler   │ │    TMOS      │ │   Flipper    │
│  MCP Server  │ │  MCP Server  │ │  Converter   │
└──────────────┘ └──────────────┘ └──────────────┘
```

---

### 3.2 Diff/Compare Tools

**Status:** 🟡 Planned

#### Concept

Go beyond raw config dumps to provide **semantic comparison** — understanding what differences actually mean, not just text changes.

#### Types of Comparison

| Type | Description | Example |
|------|-------------|---------|
| Same device, different time | Before/after a change | "What changed after last night's maintenance?" |
| Same config, different devices | Prod vs staging | "Is prod config in sync with staging?" |
| Cross-platform equivalent | NetScaler vs BIG-IP | "Does the migrated config match source?" |
| Config vs desired state | Actual vs intended | "Does current config match our standard?" |

#### Potential Tools

| Tool | Description |
|------|-------------|
| `snapshot_config` | Capture point-in-time config snapshot |
| `diff_snapshots` | Compare two snapshots |
| `diff_devices` | Compare same object type across devices |
| `diff_cross_platform` | Semantic diff between NetScaler and BIG-IP |
| `diff_to_standard` | Compare config against a standard template |

#### Diff Output Structure

```typescript
interface DiffResult {
  summary: {
    status: 'identical' | 'minor_differences' | 'significant_differences';
    total_differences: number;
    by_severity: {
      critical: number;    // Functional impact
      warning: number;     // Potential issues
      info: number;        // Cosmetic/ordering
    };
  };
  
  differences: Difference[];
  
  // For cross-platform diffs
  unmappable: {
    source_object: string;
    reason: string;
  }[];
}

interface Difference {
  path: string;           // e.g., "pool.members[2].port"
  type: 'added' | 'removed' | 'modified';
  severity: 'critical' | 'warning' | 'info';
  
  source_value: any;
  target_value: any;
  
  explanation: string;    // Human-readable explanation
  recommendation?: string; // What to do about it
}
```

#### Example Diff Output

```json
{
  "summary": {
    "status": "significant_differences",
    "total_differences": 3,
    "by_severity": { "critical": 1, "warning": 1, "info": 1 }
  },
  "differences": [
    {
      "path": "pool.members",
      "type": "modified",
      "severity": "critical",
      "source_value": ["10.1.1.10:80", "10.1.1.11:80", "10.1.1.12:80"],
      "target_value": ["10.1.1.10:80", "10.1.1.11:80"],
      "explanation": "Target pool is missing member 10.1.1.12:80",
      "recommendation": "Add missing pool member or verify intentional removal"
    },
    {
      "path": "monitor.interval",
      "type": "modified",
      "severity": "warning",
      "source_value": 5,
      "target_value": 30,
      "explanation": "Monitor interval is 6x longer on target",
      "recommendation": "Align intervals for consistent health detection"
    },
    {
      "path": "description",
      "type": "modified", 
      "severity": "info",
      "source_value": "Production App Server",
      "target_value": "Production App Server - Migrated",
      "explanation": "Description text differs",
      "recommendation": null
    }
  ]
}
```

#### Semantic Understanding

Raw text diff sees this as "different":
```
# NetScaler
add lb vserver vs_app HTTP 10.1.1.100 80

# BIG-IP  
ltm virtual vs_app {
    destination 10.1.1.100:80
    ip-protocol tcp
}
```

Semantic diff understands they're **equivalent** — same VIP, same port, HTTP implies TCP.

---

### 3.3 Rollback Patterns

**Status:** 🟡 Planned

#### Concept

Every write operation should support rollback. This ranges from simple "undo last change" to sophisticated savepoint management.

#### Rollback Levels

| Level | Description | Complexity |
|-------|-------------|------------|
| **L1: Undo Last** | Revert the most recent change | Low |
| **L2: Named Savepoints** | Create/restore named checkpoints | Medium |
| **L3: Transaction Batches** | Group operations, rollback entire batch | Medium |
| **L4: Cross-Device Transactions** | Coordinated rollback across devices | High |

#### Implementation Approach

```typescript
// Every write tool returns rollback info
interface WriteToolResult {
  success: boolean;
  // ... normal result fields ...
  
  rollback: {
    id: string;                    // Unique rollback ID
    type: 'create' | 'modify' | 'delete';
    target: string;                // What was changed
    previous_state: any;           // State before change (for restore)
    expires_at: string;            // When rollback info is purged
  };
}
```

#### Rollback Tools

| Tool | Description |
|------|-------------|
| `list_rollback_points` | List available rollback points |
| `get_rollback_point` | Get details of specific rollback point |
| `rollback` | Execute rollback to specific point |
| `preview_rollback` | Show what rollback would do without executing |
| `create_savepoint` | Create named savepoint |
| `delete_savepoint` | Remove savepoint |

#### Example: Savepoint Workflow

```
User: Create a savepoint before I make changes to vs_app

Claude: [calls create_savepoint]
Created savepoint "pre-vs_app-changes" (ID: sp_abc123)
This captures current state of all related objects.

User: Now update the pool to add a new member

Claude: [calls add_pool_member]
Added 10.1.1.15:80 to pool_app
Rollback available: rb_def456

User: Actually, also change the monitor interval to 10 seconds

Claude: [calls update_monitor]
Updated monitor_app interval to 10
Rollback available: rb_ghi789

User: Something's wrong, rollback to the savepoint

Claude: [calls preview_rollback(savepoint="pre-vs_app-changes")]
Rollback preview:
- Remove pool member 10.1.1.15:80 from pool_app
- Restore monitor_app interval to 5

[calls rollback(savepoint="pre-vs_app-changes", confirm=true)]
Rolled back to savepoint "pre-vs_app-changes"
2 changes reverted.
```

#### Rollback Storage

Options for storing rollback state:

| Storage | Pros | Cons |
|---------|------|------|
| In-memory | Fast, simple | Lost on restart |
| Local file | Persists restarts | Single server only |
| Redis/KV store | Shared across instances | Additional dependency |
| Device UCS/backup | Authoritative | Slow, heavy |

**Recommendation:** Hybrid approach
- In-memory for recent operations (last N changes)
- Periodic device backup for major savepoints
- Clear expiration policy (e.g., 24 hours for auto-rollback, explicit savepoints persist longer)

#### Transaction Batches

Group related changes into atomic units:

```typescript
// Start a transaction
const tx = await startTransaction({ 
  description: "Migrate vs_app to bigip1" 
});

try {
  // All operations within transaction
  await tx.execute('create_pool', { ... });
  await tx.execute('create_virtual', { ... });
  await tx.execute('create_monitor', { ... });
  
  // Commit if all succeeded
  await tx.commit();
} catch (error) {
  // Rollback entire batch
  await tx.rollback();
}
```

---

### 3.4 AS3 Drift Detection

**Status:** 🟢 In Progress (60%)
**Location:** TMOS MCP Server (tool group)
**Related Projects:** corkscrew, tmos-converter
**Full Specification:** [as3-drift-detection-spec.md](./as3-drift-detection-spec.md)

#### Summary

Detect when live BIG-IP configuration diverges from AS3 source of truth. Uses mini-UCS + corkscrew to extract and abstract applications, then leverages AS3's declarative dry-run to show what would change.

**Key Principle:** AS3 is declarative — you submit the complete desired state, and the AS3 engine determines what changes to make. The `dry-run` endpoint shows exactly what would change.

#### Progress

| Component | Status |
|-----------|--------|
| Tool interfaces defined | ✅ Complete |
| Progress reporting | ✅ Implemented |
| Enhanced dry-run response | ✅ Implemented |
| Field-level change detection | ✅ Implemented |
| Mini-UCS extraction | 🟡 Pending (needs corkscrew) |
| AS3 conversion | 🟡 Pending (needs tmos-converter) |
| End-to-end testing | 🟡 Pending |

#### Tool Chain

| Tool | Description | Status |
|------|-------------|--------|
| `extract_tenant_config` | Pull live config using mini-UCS + corkscrew | 🟢 Interface ready |
| `convert_to_as3` | Convert imperative config to AS3 declaration | 🟡 Pending |
| `parse_as3_declaration` | Validate structure of user-provided AS3 | 🟡 Pending |
| `validate_as3` | Schema validation | 🟡 Pending |
| `dry_run_as3` | POST to `?dry-run=true` to see planned changes | ✅ Enhanced |

See [full specification](./as3-drift-detection-spec.md) for interfaces, workflows, and implementation plan.

---

## 4. Implementation Notes

### 4.1 Scaffolding Checklist

For each new MCP server:

- [ ] Create `mcp/<name>/` directory structure
- [ ] Set up `package.json` with correct name
- [ ] Wire up telemetry with unique `digitalAssetName`
- [ ] Implement basic connection/auth tool
- [ ] Add to root workspace if using workspaces
- [ ] Create README with setup instructions
- [ ] Add environment variable documentation
- [ ] Implement health check / connection test tool

### 4.2 Shared Patterns

All MCP servers should follow established patterns:

| Pattern | Description |
|---------|-------------|
| Telemetry | Via `@flipper/telemetry` package |
| Transport | HTTP/SSE transport option for development |
| Configuration | Environment variable based |
| Write safety | `confirm` parameter for write operations |
| Tool descriptions | Clear descriptions for LLM understanding |
| Error handling | Structured errors with remediation hints |
| Rollback | Return rollback info from write operations |

### 4.3 Cross-Server Shared Code

Consider extracting to shared packages:

| Package | Contents |
|---------|----------|
| `@flipper/mcp-common` | Base MCP server setup, transport, auth patterns |
| `@flipper/config-models` | Normalized config models (VirtualServer, Pool, etc.) |
| `@flipper/diff-engine` | Semantic diff implementation |
| `@flipper/rollback` | Rollback state management |
| `@flipper/orchestration` | Cross-server operation coordination |

### 4.4 Testing Strategy

| Test Type | Scope | Tools |
|-----------|-------|-------|
| Unit | Individual tool logic | Jest |
| Integration | Tool + real/mock device | Jest + test devices |
| Cross-server | Orchestration flows | Custom harness |
| Regression | Migration accuracy | Golden file comparison |

---

## 5. Shared Infrastructure

### 5.1 Customer Audit Logging

**Status:** 🟡 Planned  
**Location:** `@flipper/audit-logger` (shared package)  
**Full Specification:** [audit-logging-spec.md](./audit-logging-spec.md)

#### Summary

Customer-facing audit logging that sends operational logs from MCP servers to enterprise SIEM platforms. Unlike internal telemetry (anonymous product analytics), this provides detailed logs for customer audit, compliance, and troubleshooting.

**Key Principle:** Customer controls destination, format, and filtering. Logs are sanitized.

#### Supported Destinations

| Destination | Protocol | Use Case |
|-------------|----------|----------|
| Splunk | HEC (HTTP) | Enterprise SIEM |
| Elasticsearch | HTTP/Bulk | ELK stack |
| Datadog | HTTP API | Cloud monitoring |
| Syslog | UDP/TCP/TLS | Legacy infrastructure |
| Webhook | HTTP POST | Custom integrations |
| File | Local JSON Lines | Development |

#### Log Categories

| Category | Description |
|----------|-------------|
| `lifecycle` | Server start/stop |
| `connection` | Device connect/disconnect |
| `read` | Get/list operations |
| `write` | Create/modify/delete operations |
| `auth` | Authentication events |
| `error` | Errors and exceptions |

#### Configuration

```bash
# Simple setup via environment variables
FLIPPER_AUDIT_ENABLED=true
FLIPPER_AUDIT_DESTINATION=splunk
FLIPPER_AUDIT_SPLUNK_ENDPOINT=https://splunk.company.com:8088/services/collector
FLIPPER_AUDIT_SPLUNK_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

See [full specification](./audit-logging-spec.md) for schema, filtering, sanitization, and implementation details.

---

### 5.2 Integration Testing

**Status:** 🟡 Planned  
**Location:** `tests/integration/`  
**Full Specification:** [integration-testing-spec.md](./integration-testing-spec.md)

#### Summary

Integration testing using f5-corkscrew's curated test qkview as regression fixtures. Configs are extracted, deployed to a lab BIG-IP, then verified through MCP tools.

**Key Value:** Real-world configs exercising edge cases, maintained as corkscrew evolves.

#### Test Flow

```
Corkscrew Test QKView → Extract Configs → Deploy to Lab BIG-IP → Verify via MCP Tools
```

#### Test Categories

| Category | Description |
|----------|-------------|
| CRUD Operations | Create/read/update/delete for each object type |
| Dependency Tests | Objects with dependencies handled correctly |
| Round-Trip Tests | Deploy from corkscrew, read back, compare |
| Edge Cases | Special characters, long names, large configs |
| AS3 Integration | Deploy, verify, drift detection |
| Error Handling | Graceful handling of errors |

#### Fixture Source

```
Local:    tests/fixtures/corkscrewTestData.qkview  (committed to repo)
Upstream: https://github.com/f5devcentral/f5-corkscrew/releases/download/v1.5.0/f5_corkscrew_test.qkview
```

Fixtures are committed to the repo for reliability. Refresh with `npm run test:fixtures:refresh` when corkscrew updates.

See [full specification](./integration-testing-spec.md) for test architecture, implementation, and CI/CD integration.

---

### 5.3 Corkscrew + TMOS-Converter Merge

**Status:** 📋 Proposal  
**Full Specification:** [corkscrew-converter-merge-spec.md](./corkscrew-converter-merge-spec.md)

#### Summary

Architecture review proposing to merge **tmos-converter** functionality into **f5-corkscrew** for a unified config extraction and AS3 conversion pipeline.

**Benefits:**
- Single dependency instead of two
- Unified type system
- Simpler API: `bigip.toAs3({ tenant: 'MyTenant' })`
- Smaller bundle size (shared code deduplicated)

#### Decision Matrix

| Factor | Keep Separate | Merge |
|--------|---------------|-------|
| Maintenance burden | Higher | Lower ✅ |
| Version coordination | Required | Eliminated ✅ |
| Bundle size | Larger | Smaller ✅ |
| Breaking changes | None | Migration required |

See [full specification](./corkscrew-converter-merge-spec.md) for migration plan and technical details.

---

## 6. Roadmap

### Phase 1: Foundation (Current)
- ✅ NetScaler MCP server
- ✅ TMOS MCP server  
- 🔄 Stabilize core tool set
- 🔄 Document patterns

### Phase 2: Expand Coverage
- [ ] F5 XC MCP server
- [ ] BIG-IQ MCP server
- [ ] Basic diff tools

### Phase 3: Advanced Features
- [ ] Resource subscriptions
- [ ] Prompt templates
- [ ] Cross-server orchestration tools

### Phase 4: Enterprise Ready
- [ ] Rollback patterns
- [ ] Transaction support
- [ ] Audit logging
- [ ] Sampling integration (research)

---

## Appendix A: MCP Spec References

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [Resources](https://spec.modelcontextprotocol.io/specification/server/resources/)
- [Prompts](https://spec.modelcontextprotocol.io/specification/server/prompts/)
- [Sampling](https://spec.modelcontextprotocol.io/specification/server/sampling/)
- [Tools](https://spec.modelcontextprotocol.io/specification/server/tools/)

## Appendix B: Related Documentation

- [NetScaler NITRO API](https://developer-docs.netscaler.com/en-us/netscaler-nitro-api/)
- [F5 iControl REST](https://clouddocs.f5.com/api/icontrol-rest/)
- [F5 XC API](https://docs.cloud.f5.com/docs/api)
- [BIG-IQ API](https://clouddocs.f5.com/products/big-iq/mgmt-api/latest/)
