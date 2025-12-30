# AS3 Drift Detection Specification

**Status:** ✅ Complete
**Location:** TMOS MCP Server (tool group)
**Related Projects:** corkscrew, tmos-converter
**Parent Doc:** [future-mcp-servers.md](./future-mcp-servers.md)
**Implementation:** [mcp/f5/src/tools/as3-drift.ts](../mcp/f5/src/tools/as3-drift.ts)

---

## Progress Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Tool interfaces | ✅ Complete | TypeScript interfaces defined |
| Progress reporting | ✅ Complete | `ProgressTracker` class in `lib/progress.ts` |
| Enhanced dry-run | ✅ Complete | Field-level changes with impact assessment |
| `extract_tenant_config` | ✅ Complete | Mini-UCS + corkscrew parsing |
| `convert_to_as3` | ✅ Complete | Generates AS3 with conversion notes |
| `parse_as3_declaration` | ✅ Complete | JSON parsing + tenant extraction |
| `validate_as3` | ✅ Complete | Structural validation |
| `dry_run_as3` | ✅ Complete | PlannedChange[] with FieldChange[] |
| End-to-end testing | ✅ Complete | Tested 2025-12-29 on bigip-tparty05 |

---

## Summary

A toolchain within the TMOS MCP server that detects when live BIG-IP configuration diverges from AS3 source of truth. Extracts live config, converts to AS3 format, and presents both declarations to the user for review and merge into their source of truth.

**Key Principle:** Leverage AS3's declarative model. The AS3 engine handles diffing and applies only necessary changes — we don't need to replicate that logic.

---

## Table of Contents

| Section | Description |
|---------|-------------|
| [1. Problem Statement](#1-problem-statement) | Why drift is dangerous |
| [2. Solution Overview](#2-solution-overview) | High-level workflow |
| [3. Design Decisions](#3-design-decisions) | Key choices and rationale |
| [4. Tool Chain](#4-tool-chain) | All tools with interfaces |
| [5. Example Workflow](#5-example-workflow) | Complete conversation flow |
| [6. Edge Cases](#6-edge-cases) | /Common, unsupported features |
| [7. Integration Points](#7-integration-points) | Existing projects, future features |
| [8. Implementation Plan](#8-implementation-plan) | Phases and milestones |

---

## 1. Problem Statement

AS3 enables declarative, source-controlled BIG-IP configuration. But reality intrudes:

1. Someone makes a "quick fix" via GUI during an outage
2. They forget to update the AS3 declaration in Git
3. Next CI/CD pipeline run deploys the AS3 source of truth
4. The fix is nuked. Outage returns. Chaos ensues.

This is **config drift** — the live device diverges from the declared state.

### Why Drift is Dangerous

| Property | Problem |
|----------|---------|
| **Silent** | No alert when drift occurs |
| **Invisible** | AS3 deploy succeeds (it doesn't know about the drift) |
| **Destructive** | Drift is overwritten, not merged |
| **Cumulative** | Multiple drifts compound over time |
| **Blame-shifting** | "The automation broke it" vs "Someone made a manual change" |

### Who This Affects

- **NetOps teams** using AS3 for config management
- **DevOps pipelines** deploying AS3 via CI/CD
- **Migration projects** where source and target must stay in sync
- **Audit/compliance** requiring config consistency verification

---

## 2. Solution Overview

A toolchain within the TMOS MCP server that:

1. Extracts current BIG-IP config (imperative)
2. Converts to AS3-equivalent structure (declarative)
3. Presents converted AS3 alongside user's source declaration
4. User reviews and merges changes into their source of truth
5. Validates updated declaration via schema and dry-run
6. User commits to Git and deploys via their pipeline

**Why no diff/patch tools?** AS3 is declarative — you submit the complete desired state, and the AS3 engine figures out what changes to make. The `dry-run` endpoint shows exactly what would change. We don't need to replicate this logic.

### Workflow Diagram

```text
┌─────────────────┐           ┌─────────────────┐
│  BIG-IP Device  │           │  AS3 Source     │
│  (live config)  │           │  of Truth       │
└────────┬────────┘           └────────┬────────┘
         │                             │
         ▼                             ▼
   ┌───────────┐                ┌───────────┐
   │ mini-UCS  │                │   Parse   │
   │  export   │                │   AS3     │
   └─────┬─────┘                └─────┬─────┘
         │                             │
         ▼                             │
   ┌───────────┐                       │
   │ corkscrew │                       │
   │ (abstract)│                       │
   └─────┬─────┘                       │
         │                             │
         ▼                             │
   ┌───────────┐                       │
   │  tmos-    │                       │
   │ converter │                       │
   └─────┬─────┘                       │
         │                             │
         └─────────────┬───────────────┘
                       ▼
                ┌─────────────┐
                │   Present   │
                │ Both to User│  ◀── User reviews & merges
                └──────┬──────┘
                       │
                       ▼
                ┌─────────────┐
                │  Validate   │
                │  & Dry-Run  │
                └──────┬──────┘
                       │
                       ▼
                ┌─────────────┐
                │ User Commits│
                │  to Git     │
                └─────────────┘
```

---

## 3. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Source of truth location | User-provided (typically Git repo) | We don't manage their repo; they paste/upload declaration |
| Scope | Single tenant per operation | Keep blast radius small; AI can loop for full device |
| Conflict resolution | Always present to user | Never auto-apply; risk of outages too high |
| History tracking | Not supported | AI agent is stateless; recommend external audit logging |
| Integration with subscriptions | Future | Link to Resource Subscriptions for real-time drift alerts |
| Conversion engine | Combine corkscrew + tmos-converter | Leverage existing proven logic |

### What We Don't Do

- **Manage Git repos** — User's responsibility
- **Auto-apply patches** — Too risky for production
- **Track drift history** — Stateless agent; use external logging
- **Handle HA sync** — Focus on single device; user handles HA

---

## 4. Tool Chain

| Tool | Description |
|------|-------------|
| `extract_tenant_config` | Pull live config for a specific AS3 tenant from BIG-IP |
| `convert_to_as3` | Convert extracted imperative config to AS3 declaration structure |
| `parse_as3_declaration` | Parse user-provided AS3 declaration (validate structure) |
| `validate_as3` | Schema validation via AS3 validator |
| `dry_run_as3` | POST to `/declare?dry-run=true` — test without applying |

### Why No Diff/Patch Tools?

AS3 is declarative by design:

- You submit the **complete desired state**
- The AS3 engine determines what changes are needed
- The `dry-run` endpoint shows exactly what would change

We don't need `diff_as3` or `generate_as3_patch` tools because:

1. **AS3 handles diffing internally** — it compares your declaration against current state
2. **dry-run shows planned changes** — `?dry-run=true` returns what would be created/modified/deleted
3. **User merges manually** — they review both declarations and update their source of truth
4. **Simpler implementation** — fewer tools to maintain, fewer bugs

---

### 4.1 `extract_tenant_config`

Pulls all objects associated with an AS3 tenant from the live BIG-IP using a mini-UCS export.

**Workflow:**

1. User specifies which AS3 tenant to check
2. Tool uses f5-conx-core's mini-UCS function to extract config (faster than full UCS - excludes keys, certs, large binaries)
3. Corkscrew parses the mini-UCS and filters to the specified partition
4. Corkscrew abstracts the applications within that partition
5. Returns structured config ready for conversion

```typescript
interface ExtractTenantConfigParams {
  device: string;           // BIG-IP host
  tenant: string;           // AS3 tenant name (maps to partition)
  include_common?: boolean; // Include /Common objects referenced by tenant
}

interface ExtractTenantConfigResult {
  tenant: string;
  extracted_at: string;     // ISO timestamp
  ucs_snapshot: string;     // Reference to mini-UCS (temp file or in-memory)
  applications: {
    name: string;
    virtuals: VirtualServer[];
    pools: Pool[];
    monitors: Monitor[];
    profiles: Profile[];
    irules: iRule[];
    policies: Policy[];
    // ... other object types
  }[];
  common_references: string[];  // /Common objects this tenant uses
}
```

#### Implementation Notes

- Use f5-conx-core's mini-UCS extraction (not CLI - requires programmatic access)
- Mini-UCS includes all partitions but is faster/smaller (no keys, certs, binaries)
- Use corkscrew to parse the extracted config and filter to the requested partition
- Corkscrew identifies application boundaries by analyzing virtual server dependencies
- Returns structured applications that map 1:1 to AS3 Application classes

---

### 4.2 `convert_to_as3`

Transforms extracted imperative config into AS3 declaration structure using tmos-converter.

**Workflow:**

1. Takes corkscrew-abstracted applications from `extract_tenant_config`
2. tmos-converter maps each object type to its AS3 equivalent
3. Generates complete AS3 declaration with proper structure

This is the "reverse compiler" — uses proven logic from:

- **corkscrew**: Already parsed and grouped the config into applications
- **tmos-converter**: Object-to-AS3 mapping rules

```typescript
interface ConvertToAs3Params {
  extracted_config: ExtractTenantConfigResult;
  target_schema_version?: string;  // AS3 schema version (default: latest)
}

interface ConvertToAs3Result {
  declaration: AS3Declaration;  // Full AS3 declaration
  
  conversion_notes: {
    object: string;
    note: string;           // e.g., "iRule converted to LTM Policy"
    confidence: 'high' | 'medium' | 'low';
  }[];
  
  unsupported: {
    object: string;
    reason: string;         // e.g., "APM policy not supported in AS3"
    recommendation: string;
  }[];
}
```

#### Conversion Confidence Levels

| Level | Meaning | Example |
|-------|---------|---------|
| **high** | Direct mapping exists | Pool → Pool |
| **medium** | Equivalent exists with caveats | iRule → Endpoint_Policy (some features lost) |
| **low** | Best-effort approximation | Complex iRule with TCL logic |

---

### 4.3 `parse_as3_declaration`

Parse and validate user-provided AS3 declaration.

```typescript
interface ParseAs3DeclarationParams {
  declaration: string | object;  // JSON string or object
}

interface ParseAs3DeclarationResult {
  valid: boolean;
  declaration: AS3Declaration;   // Parsed declaration
  schema_version: string;        // Detected schema version
  tenants: string[];             // List of tenants in declaration
  
  parse_errors?: {
    message: string;
    location?: string;
  }[];
}
```

---

### 4.4 `validate_as3`

Schema validation without touching the device.

```typescript
interface ValidateAs3Params {
  declaration: AS3Declaration;
  schema_version?: string;
}

interface ValidateAs3Result {
  valid: boolean;
  errors: {
    path: string;
    message: string;
    schema_path: string;
  }[];
  warnings: {
    path: string;
    message: string;
  }[];
}
```

#### Validation Options

| Option | Description |
|--------|-------------|
| Local schema | Validate against bundled AS3 schema |
| Remote validator | Use F5's online AS3 schema validator |
| Device validator | POST to device with `?dry-run=true` |

---

### 4.5 `dry_run_as3`

Test declaration against actual device without applying.

```typescript
interface DryRunAs3Params {
  device: string;
  declaration: AS3Declaration;
  tenant: string;
}

interface DryRunAs3Result {
  success: boolean;
  
  // What would happen
  planned_changes: PlannedChange[];
  
  // Problems detected
  errors: {
    message: string;
    object: string;
    remediation: string;
  }[];
  
  warnings: string[];
  
  // Raw AS3 response for advanced users
  raw_response?: object;
}

interface PlannedChange {
  action: 'create' | 'modify' | 'delete' | 'none';
  object_type: 'tenant' | 'application' | 'virtual' | 'pool' | 'monitor' | 'profile' | 'irule' | 'policy' | 'other';
  object_path: string;           // Full path: /Tenant/App/ObjectName
  summary: string;               // Human-readable summary
  
  // Detailed field-level changes (for 'modify' action)
  field_changes?: FieldChange[];
}

interface FieldChange {
  field: string;                 // e.g., "members", "interval", "persistence"
  from: any;                     // Current value on device
  to: any;                       // Value in declaration
  impact: 'low' | 'medium' | 'high';  // Potential service impact
}
```

#### API Call

```
POST https://{device}/mgmt/shared/appsvcs/declare?controls.dryRun=true
Content-Type: application/json

{declaration}
```

**Note:** AS3 3.30+ uses `controls.dryRun=true` (not `dry-run=true`).

#### Response Parsing

AS3 dry-run returns a results array with change information. The tool parses this into structured `PlannedChange` objects:

**AS3 Response Structure:**
```json
{
  "results": [
    {
      "code": 200,
      "message": "success",
      "tenant": "TestTenant",
      "runTime": 1234,
      "declarationId": "abc123",
      "dryRun": true
    }
  ],
  "declaration": { ... }
}
```

**Parsing Logic:**

| AS3 Response | Interpretation |
|--------------|----------------|
| `code: 200`, `message: "success"` | Changes planned (or no changes) |
| `code: 200`, `message: "no change"` | Already in sync |
| `code: 422` | Validation error |
| `code: 503` | AS3 busy |

**Enhanced Change Detection:**

To provide field-level change details, compare the declaration against current state:

```typescript
async function parseAsyncDryRunResponse(
  response: AS3Response,
  declaration: AS3Declaration,
  currentConfig: ExtractedConfig
): Promise<PlannedChange[]> {
  const changes: PlannedChange[] = [];
  
  for (const result of response.results) {
    if (result.message === 'no change') {
      changes.push({
        action: 'none',
        object_type: 'tenant',
        object_path: `/${result.tenant}`,
        summary: 'No changes required - configuration matches desired state',
        field_changes: []
      });
      continue;
    }
    
    // Compare declaration objects against extracted config
    const tenantDecl = declaration.declaration[result.tenant];
    const tenantCurrent = currentConfig.applications;
    
    for (const [appName, appDecl] of Object.entries(tenantDecl)) {
      if (appDecl.class !== 'Application') continue;
      
      const fieldChanges = detectFieldChanges(appDecl, tenantCurrent, appName);
      
      if (fieldChanges.length > 0) {
        changes.push({
          action: 'modify',
          object_type: 'application',
          object_path: `/${result.tenant}/${appName}`,
          summary: `${fieldChanges.length} field(s) will be modified`,
          field_changes: fieldChanges
        });
      }
    }
  }
  
  return changes;
}
```

**Impact Assessment:**

| Field Type | Impact Level | Rationale |
|------------|--------------|-----------|
| Pool members | High | Traffic routing changes |
| Virtual addresses | High | Service availability |
| Persistence | Medium | Session handling |
| Monitor interval | Low | Health check timing |
| Description | Low | Metadata only |

**Example Enhanced Output:**

```json
{
  "success": true,
  "planned_changes": [
    {
      "action": "modify",
      "object_type": "pool",
      "object_path": "/TestTenant/TestApp/web_pool",
      "summary": "Pool will be modified: 1 member removed",
      "field_changes": [
        {
          "field": "members",
          "from": ["10.1.1.10:80", "10.1.1.11:80", "10.1.1.12:80"],
          "to": ["10.1.1.10:80", "10.1.1.11:80"],
          "impact": "high"
        }
      ]
    },
    {
      "action": "modify",
      "object_type": "virtual",
      "object_path": "/TestTenant/TestApp/serviceMain",
      "summary": "Virtual server will be modified: persistence type changed",
      "field_changes": [
        {
          "field": "persistenceMethods",
          "from": "source_addr",
          "to": "cookie",
          "impact": "medium"
        }
      ]
    }
  ],
  "errors": [],
  "warnings": []
}
```

This enhanced output gives the AI agent clear context to explain changes to users and assess deployment risk.

---

## 5. Example Workflow

### Basic Drift Check

```
User: Check if my production tenant has drifted from our AS3 source.
Here's our current declaration: [pastes AS3 JSON]

Claude: I'll extract the live config and convert it to AS3 format.

[calls extract_tenant_config(device="bigip-prod", tenant="production")]
Extracted 3 virtual servers, 5 pools, 8 monitors from production tenant.

[calls convert_to_as3(extracted_config)]
Converted to AS3 format. 2 notes:
- irule_redirect converted to Endpoint_Policy (medium confidence)
- profile_custom_tcp has no AS3 equivalent (flagged as unsupported)

[calls parse_as3_declaration(user_provided_declaration)]
Source declaration parsed successfully. Schema version 3.50.0.

Here's the AS3 declaration representing your live config:
[shows converted AS3 JSON]

Comparing with your source declaration, I notice these differences:
- pool_web has 4 members on device vs 3 in your source (10.1.1.50:443 was added)
- vs_web uses source_addr persistence on device vs cookie in your source
- monitor_api interval is 15 on device vs 5 in your source

If you deploy your current source declaration, these live changes will be overwritten.

Would you like me to:
1. Run a dry-run to see exactly what AS3 would change?
2. Help you merge these changes into your source declaration?
```

### Validating Before Deploy

```text
User: Run a dry-run to see what would change if I deploy my source

[calls validate_as3(source_declaration)]
✅ Schema validation passed

[calls dry_run_as3(device="bigip-prod", source_declaration, tenant="production")]
✅ Dry-run successful. Planned changes:

| Action | Object | Details |
|--------|--------|---------|
| DELETE | pool_web/member | Remove 10.1.1.50:443 |
| MODIFY | vs_web | Change persistence from source_addr to cookie |
| MODIFY | monitor_api | Change interval from 15 to 5 |

⚠️ Warning: This will remove the pool member that was manually added.

If you want to preserve the live changes, update your source declaration
to include them, then commit to Git. Your CI/CD pipeline will deploy the
updated declaration, and the dry-run will show no changes (already in sync).
```

### Full-Device Scan (AI-Driven)

```text
User: Check all tenants on bigip-prod for drift against our repo.

Claude: I'll extract and convert each tenant's config to AS3.

[loops through tenants, calling extract/convert for each]

I've converted all 5 tenants to AS3 format. To check for drift, I'll run
dry-run against each tenant using your source declarations.

[runs dry_run_as3 for each tenant]

Summary of what would change if you deploy your source declarations:

| Tenant      | Status      | Changes                       |
|-------------|-------------|-------------------------------|
| production  | 🔴 Changes  | 3 objects would be modified   |
| staging     | ✅ In Sync  | No changes                    |
| development | 🟡 Minor    | 1 object would be modified    |
| shared      | ✅ In Sync  | No changes                    |
| legacy      | 🔴 Changes  | 8 objects would be modified   |

Would you like details on production or legacy?
```

---

## 6. Edge Cases

### 6.1 Shared Objects (/Common)

Shared objects in `/Common` partition complicate drift detection:

| Scenario | Handling |
|----------|----------|
| Tenant references /Common object | Include in extraction, flag as shared |
| /Common object modified | Report drift, but warn: "affects multiple tenants" |
| /Common object in AS3 declaration | Support via `Common` tenant in AS3 |
| Ownership ambiguous | Ask user which tenant "owns" the shared object |

### 6.2 Unsupported Features

Some BIG-IP features have no AS3 equivalent:

| Feature | Handling |
|---------|----------|
| APM policies | Flag as unsupported, recommend separate management |
| Custom iApps | Flag, provide tmsh export |
| GTM/DNS | Separate AS3 schema (AS3 DNS class) |
| AFM firewall | Partial support, flag gaps |
| Older profile types | Attempt mapping, flag if no equivalent |

```typescript
interface UnsupportedFeature {
  object: string;
  object_type: string;
  reason: string;
  alternatives: string[];     // What user could do instead
  export_available: boolean;  // Can we at least export raw config?
}
```

### 6.3 Schema Version Mismatches

| Scenario | Handling |
|----------|----------|
| Source uses older schema | Warn, attempt conversion |
| Source uses newer schema | Warn, may fail validation |
| Unknown schema version | Default to latest, warn user |

### 6.4 Large Configurations

| Scenario | Handling |
|----------|----------|
| Tenant > 1000 objects | Warn about performance, proceed |
| Diff > 100 items | Summarize, offer detailed view |
| Declaration > 5MB | Chunk processing if needed |

---

## 7. Integration Points

### 7.1 Existing Projects

| Project | What We Use |
|---------|-------------|
| **corkscrew** | Config extraction, object dependency resolution, UCS parsing |
| **tmos-converter** | Imperative-to-AS3 object mapping, iRule analysis |
| **TMOS MCP Server** | Device connectivity, authentication, existing tools |

### Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                      TMOS MCP Server                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │             AS3 Drift Detection Tools                 │  │
│  │                                                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │  │
│  │  │  extract_   │  │ convert_    │  │   parse_    │    │  │
│  │  │  tenant_    │  │ to_as3      │  │   as3_      │    │  │
│  │  │  config     │  │             │  │ declaration │    │  │
│  │  └──────┬──────┘  └──────┬──────┘  └─────────────┘    │  │
│  │         │                │                            │  │
│  │  ┌─────────────┐  ┌─────────────┐                     │  │
│  │  │ validate_   │  │  dry_run_   │                     │  │
│  │  │ as3         │  │  as3        │                     │  │
│  │  └─────────────┘  └─────────────┘                     │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                  │
│         ┌────────────────┼────────────────┐                 │
│         ▼                ▼                ▼                 │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐           │
│  │ corkscrew  │   │  tmos-     │   │  AS3       │           │
│  │   (lib)    │   │ converter  │   │ Validator  │           │
│  │            │   │   (lib)    │   │  (remote)  │           │
│  │ - UCS parse│   │ - obj map  │   │            │           │
│  │ - app group│   │ - AS3 gen  │   │            │           │
│  └────────────┘   └────────────┘   └────────────┘           │
└─────────────────────────────────────────────────────────────┘

Data Flow:
  BIG-IP ──(mini-UCS)──▶ corkscrew ──(apps)──▶ tmos-converter ──▶ AS3
```

### 7.2 Future: Resource Subscriptions

Connect drift detection to real-time monitoring:

```
1. User sets up subscription: "Watch tenant 'production' for changes"
2. MCP server polls device (or uses iControl REST events if available)
3. On change detection, server sends notification
4. Claude (or automation) triggers drift detection workflow
5. User gets alert: "Drift detected in production tenant"
```

This transforms drift detection from reactive ("let me check") to proactive ("you have drift").

### 7.3 Future: BIG-IQ Integration

For fleet management:

```
1. Use BIG-IQ to list all managed devices
2. Pull AS3 declarations from central repo
3. Run drift detection across entire fleet
4. Generate consolidated drift report
5. Prioritize by severity across devices
```

---

## 8. Implementation Plan

### Phase 1: Core Extraction (mini-UCS + corkscrew)

| Task | Effort | Dependencies |
|------|--------|--------------|
| Implement mini-UCS generation for partition | Low | SSH/tmsh access |
| Integrate corkscrew UCS parser | Medium | corkscrew lib |
| Implement application abstraction logic | Medium | corkscrew lib |
| Implement `extract_tenant_config` tool | Low | Above tasks |
| Unit tests for extraction | Medium | Test UCS files |

### Phase 2: Conversion (tmos-converter)

| Task | Effort | Dependencies |
|------|--------|--------------|
| Integrate tmos-converter | Medium | tmos-converter lib |
| Implement `convert_to_as3` tool | Medium | Extraction output |
| Implement `parse_as3_declaration` | Low | JSON schema |
| Unit tests for conversion | Medium | Test fixtures |

### Phase 3: Validation & Dry-Run

| Task | Effort | Dependencies |
|------|--------|--------------|
| Implement `validate_as3` (local) | Low | AS3 schema |
| Implement `validate_as3` (remote) | Low | F5 validator API |
| Implement `dry_run_as3` | Low | Device connection |
| End-to-end workflow tests | Medium | All tools |

### Phase 4: Polish & Edge Cases

| Task | Effort | Dependencies |
|------|--------|--------------|
| /Common object handling | Medium | Multi-tenant logic |
| Unsupported feature detection | Medium | Feature mapping |
| Large config handling | Low | Chunking logic |
| Documentation & examples | Low | Working tools |

---

## 9. Progress Reporting Pattern

Long-running operations (mini-UCS extraction, corkscrew parsing) need progress feedback to keep users informed and prevent timeout concerns.

### 9.1 Problem

| Operation | Typical Duration | Issue |
|-----------|------------------|-------|
| `extract_tenant_config` | 60-120s | User thinks it's stuck |
| `ucs_create` | 90-180s | No feedback during creation |
| `convert_to_as3` (large) | 30-60s | Silent processing |

### 9.2 Design Options

| Option | Pros | Cons |
|--------|------|------|
| **Polling endpoint** | Simple, stateless | Requires client polling |
| **SSE stream** | Real-time updates | More complex server |
| **Callback/webhook** | Async-friendly | Requires callback URL |
| **Chunked response** | HTTP/1.1 compatible | Limited to single response |

**Recommendation:** Polling endpoint with operation ID.

### 9.3 Implementation

#### Operation Tracking

```typescript
interface OperationStatus {
  operation_id: string;
  tool: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: {
    percent: number;          // 0-100
    current_step: string;     // Human-readable step
    steps_completed: number;
    steps_total: number;
  };
  started_at: string;
  updated_at: string;
  completed_at?: string;
  result?: any;               // Final result when completed
  error?: string;             // Error message if failed
}
```

#### Progress Steps for `extract_tenant_config`

```typescript
const EXTRACTION_STEPS = [
  { step: 1, name: 'Connecting to device', weight: 5 },
  { step: 2, name: 'Creating mini-UCS archive', weight: 40 },
  { step: 3, name: 'Downloading mini-UCS', weight: 25 },
  { step: 4, name: 'Parsing with corkscrew', weight: 20 },
  { step: 5, name: 'Filtering tenant objects', weight: 5 },
  { step: 6, name: 'Building response', weight: 5 },
];
```

#### API Endpoints

**Start Long Operation (returns immediately):**
```
POST /api/call
{
  "tool": "extract_tenant_config",
  "args": { "tenant": "Sample_01" },
  "async": true
}

Response:
{
  "operation_id": "op_abc123",
  "status": "pending",
  "poll_url": "/api/operations/op_abc123"
}
```

**Poll for Status:**
```
GET /api/operations/op_abc123

Response (in progress):
{
  "operation_id": "op_abc123",
  "tool": "extract_tenant_config",
  "status": "running",
  "progress": {
    "percent": 45,
    "current_step": "Downloading mini-UCS",
    "steps_completed": 2,
    "steps_total": 6
  },
  "started_at": "2025-12-29T23:00:00Z",
  "updated_at": "2025-12-29T23:01:15Z"
}

Response (completed):
{
  "operation_id": "op_abc123",
  "tool": "extract_tenant_config",
  "status": "completed",
  "progress": {
    "percent": 100,
    "current_step": "Complete",
    "steps_completed": 6,
    "steps_total": 6
  },
  "started_at": "2025-12-29T23:00:00Z",
  "completed_at": "2025-12-29T23:02:30Z",
  "result": { ... }  // Full tool result
}
```

#### MCP Integration

For MCP protocol, use the standard progress notification:

```typescript
// Server sends progress notifications
server.notification({
  method: 'notifications/progress',
  params: {
    progressToken: 'extract_tenant_config_abc123',
    progress: 45,
    total: 100,
    message: 'Downloading mini-UCS'
  }
});
```

#### Implementation in Tool

```typescript
async function extractTenantConfig(
  params: ExtractTenantConfigParams,
  progressCallback?: (step: string, percent: number) => void
): Promise<ExtractTenantConfigResult> {
  
  progressCallback?.('Connecting to device', 5);
  const client = await getF5Client(params.device);
  
  progressCallback?.('Creating mini-UCS archive', 10);
  const miniUcsPath = await client.ucs.createMiniUcs();
  
  progressCallback?.('Downloading mini-UCS', 50);
  const ucsBuffer = await client.ucs.download(miniUcsPath);
  
  progressCallback?.('Parsing with corkscrew', 75);
  const parsed = await corkscrew.parse(ucsBuffer);
  
  progressCallback?.('Filtering tenant objects', 90);
  const tenantApps = filterByTenant(parsed.apps, params.tenant);
  
  progressCallback?.('Building response', 95);
  const result = buildResponse(tenantApps);
  
  progressCallback?.('Complete', 100);
  return result;
}
```

### 9.4 Tools Requiring Progress Reporting

| Tool | Long-Running Step | Estimated Duration |
|------|-------------------|--------------------|
| `extract_tenant_config` | mini-UCS creation + download | 60-120s |
| `ucs_create` | UCS archive creation | 90-180s |
| `ucs_download` | Large file transfer | 30-300s (size dependent) |
| `convert_to_as3` | Large config conversion | 30-60s |
| `dry_run_as3` | AS3 processing | 5-30s |

### 9.5 Timeout Handling

```typescript
interface TimeoutConfig {
  operation_timeout_ms: number;   // Max time for operation (default: 300000 = 5min)
  idle_timeout_ms: number;        // Max time between progress updates (default: 60000)
  poll_interval_ms: number;       // Suggested client poll interval (default: 2000)
}
```

If an operation exceeds `operation_timeout_ms`, mark as failed with timeout error.

---

## Appendix A: AS3 Declaration Structure

```json
{
  "class": "AS3",
  "action": "deploy",
  "persist": true,
  "declaration": {
    "class": "ADC",
    "schemaVersion": "3.50.0",
    "id": "example",
    "tenant_name": {
      "class": "Tenant",
      "app_name": {
        "class": "Application",
        "template": "http",
        "serviceMain": {
          "class": "Service_HTTP",
          "virtualAddresses": ["10.1.1.100"],
          "pool": "pool_web"
        },
        "pool_web": {
          "class": "Pool",
          "members": [
            {
              "servicePort": 80,
              "serverAddresses": ["10.1.1.10", "10.1.1.11"]
            }
          ]
        }
      }
    }
  }
}
```

## Appendix B: Related Documentation

- [AS3 User Guide](https://clouddocs.f5.com/products/extensions/f5-appsvcs-extension/latest/)
- [AS3 Schema Reference](https://clouddocs.f5.com/products/extensions/f5-appsvcs-extension/latest/refguide/schema-reference.html)
- [AS3 API Reference](https://clouddocs.f5.com/products/extensions/f5-appsvcs-extension/latest/refguide/as3-api.html)
- [iControl REST API](https://clouddocs.f5.com/api/icontrol-rest/)
