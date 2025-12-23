# MCP Server Enhancement Proposals

## Summary

Proposed enhancements for the NetScaler MCP server based on testing bren.ns.conf and other configs. Focus areas: config validation, deduplication, and RMA-ready backups.

## Status

| Enhancement | Status | Notes |
| ------------- | -------- | ------- |
| Config deduplication | ✅ Done | Line 186-188 in config-reorder.ts uses `Set` |
| validate_config tool | ❌ Remaining | Pre-flight validation |
| analyze_config exposure | ❌ Remaining | Function exists, not exposed as tool |
| dry_run mode | ❌ Remaining | Preview reordered config |
| full_backup/restore | ✅ Done | `create_system_backup`, `list_system_backups`, `download_system_backup` |
| provision_test_certs | ✅ Done | Standalone tool + integrated into `deploy_config` |

## Remaining Gaps

| Gap | Impact |
| ----- | -------- |
| No pre-flight validation | Errors discovered at deploy time |
| No dry-run mode | Can't preview what will deploy |
| analyze_config not exposed | Can't get config stats via MCP |

---

## Proposed Enhancements

### 1. Config Deduplication ✅ DONE

**Location:** `mcp/netscaler/src/lib/config-reorder.ts`

**Implementation:** Lines 186-188 use `Set` to dedupe each command group:

```typescript
// Dedupe each group using Set to remove exact duplicate commands
for (const group of groups) {
  if (group.commands.length > 0) {
    output.push(...[...new Set(group.commands)]);
  }
}
```

**Benefit:** Prevents "Resource already exists" errors from duplicate definitions in source configs.

---

### 2. validate_config Tool (NEW)

**Purpose:** Pre-flight validation before deployment.

```typescript
{
  name: 'validate_config',
  description: 'Validate a configuration for issues before deployment',
  inputSchema: {
    type: 'object',
    properties: {
      config: {
        type: 'string',
        description: 'NetScaler configuration commands to validate',
      },
    },
    required: ['config'],
  },
}
```

**Checks to perform:**

- Duplicate resource definitions
- Services referencing non-existent servers
- SSL bindings referencing non-existent certkeys
- VServer bindings referencing non-existent services
- Syntax validation (balanced quotes, valid command structure)

**Return format:**

```json
{
  "valid": false,
  "errors": [
    { "line": 21, "type": "duplicate", "message": "Server 'prodserv11' already defined at line 5" },
    { "line": 46, "type": "missing_dependency", "message": "Service references non-existent server 'websvr01'" }
  ],
  "warnings": [
    { "line": 107, "type": "cipher_group", "message": "Cipher group 'ITNET' may not exist on target" }
  ],
  "summary": {
    "servers": 15,
    "services": 12,
    "vservers": 8,
    "duplicates_removed": 3
  }
}
```

---

### 3. analyze_config Tool (EXPOSE EXISTING)

The `analyzeConfig()` function already exists in config-reorder.ts but isn't exposed as an MCP tool.

```typescript
{
  name: 'analyze_config',
  description: 'Analyze a configuration and return counts by resource type',
  inputSchema: {
    type: 'object',
    properties: {
      config: {
        type: 'string',
        description: 'NetScaler configuration to analyze',
      },
    },
    required: ['config'],
  },
}
```

---

### 4. dry_run Mode for deploy_config

Add `dry_run` parameter to existing `deploy_config` tool:

```typescript
{
  name: 'deploy_config',
  inputSchema: {
    properties: {
      config: { type: 'string' },
      clear_first: { type: 'boolean', default: false },
      dry_run: {
        type: 'boolean',
        description: 'Return reordered config without deploying',
        default: false,
      },
    },
  },
}
```

**Benefit:** Preview exactly what will be sent to the NetScaler.

---

### 5. RMA-Ready Backup/Restore ✅ DONE

**Implementation:** System backup tools using NetScaler's native backup mechanism.

**Tools implemented:**

| Tool | Description |
| ------ | ------------- |
| `create_system_backup` | Create full system backup (.tgz) including ns.conf, SSL certs/keys, custom monitors |
| `list_system_backups` | List backups in /var/ns_sys_backup/ |
| `download_system_backup` | Download backup file (base64 encoded) |
| `delete_system_backup` | Remove old backups |

**Backup contents:** ns.conf, SSL certificates/keys, custom monitor scripts, and other nsconfig files.

**Storage location:** `/var/ns_sys_backup/` on the NetScaler device.

---

### 6. provision_test_certs Tool ✅ DONE

**Implementation:** Standalone tool + integrated into `deploy_config`.

**Standalone tool:**

```typescript
{
  name: 'provision_test_certs',
  description: 'Generate self-signed test certificates for config testing',
  inputSchema: {
    type: 'object',
    properties: {
      config: {
        type: 'string',
        description: 'Config to scan for certificate references',
      },
      common_name: {
        type: 'string',
        description: 'Common name for generated certs',
        default: 'test.local',
      },
    },
    required: ['config'],
  },
}
```

**Integrated in deploy_config:**

```typescript
provision_test_certs: {
  type: 'boolean',
  description: 'Generate self-signed test certificates before deploying',
  default: false,
}
```

**How it works:**

1. Parses config for `add ssl certKey` commands
2. Extracts cert/key paths
3. Generates self-signed cert for each
4. Uploads to NetScaler via SSH

---

## Implementation Priority

| Enhancement | Priority | Effort | Impact | Status |
| ------------- | ---------- | -------- | -------- | -------- |
| Config deduplication | P1 | Low | High - fixes common failures | ✅ Done |
| validate_config tool | P1 | Medium | High - catch errors early | ❌ Remaining |
| dry_run mode | P2 | Low | Medium - debugging aid | ❌ Remaining |
| full_backup/restore | P2 | High | High - RMA readiness | ✅ Done |
| analyze_config exposure | P3 | Low | Low - nice to have | ❌ Remaining |
| provision_test_certs | P3 | Medium | Medium - testing aid | ✅ Done |

---

## Files to Modify

| File | Changes |
| ------ | --------- |
| `mcp/netscaler/src/lib/config-reorder.ts` | Add deduplication, export validation |
| `mcp/netscaler/src/index.ts` | Add new tools, dry_run param |
| `mcp/netscaler/src/lib/ssh-client.ts` | Add readFile(), listDir() for backup |
| `mcp/netscaler/src/lib/backup.ts` | New file for backup/restore logic |

---

## Related

- [CONFIG_FIX_PLAN.md](CONFIG_FIX_PLAN.md) - Test config status
- [FLIPPER_INTEGRATION_NOTES.md](FLIPPER_INTEGRATION_NOTES.md) - Abstraction patterns
