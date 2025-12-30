# TMOS MCP Server Testing Guide

This document walks through testing the TMOS MCP server tools against a live BIG-IP device.

## Prerequisites

- BIG-IP device accessible via HTTPS (management interface)
- Admin credentials for the BIG-IP
- AS3 installed on the BIG-IP (for AS3-related tools)

## Environment Setup

Set these environment variables before starting:

```bash
export F5_HOST=192.168.1.245      # BIG-IP management IP
export F5_USER=admin              # Username (default: admin)
export F5_PASS=your_password      # Password
export HTTP_PORT=3000             # Enable HTTP transport for testing
export LOG_LEVEL=DEBUG            # Optional: verbose logging
```

## Starting the Server

```bash
cd mcp/f5
npm run build
npm start
```

The server will be available at `http://localhost:3000`.

---

## Test Workflow

### Phase 1: Connection & Discovery

#### 1.1 Connect to Device

```
Tool: connect
Args: { "host": "<F5_HOST>", "username": "admin", "password": "<password>" }
```

Expected: Returns device info including hostname, version, and installed ATC packages.

#### 1.2 Get Device Info

```
Tool: device_info
Args: {}
```

Expected: Returns hostname, TMOS version, product info, and ATC versions (AS3, DO, TS).

#### 1.3 Check ATC Versions

```
Tool: atc_versions
Args: {}
```

Expected: Shows installed versions of AS3, DO, TS, CF. Note which are installed for later tests.

---

### Phase 2: Backup Operations

#### 2.1 List Existing UCS Files

```
Tool: ucs_list
Args: {}
```

Expected: Array of UCS files on the device (may be empty).

#### 2.2 Create UCS Backup

```
Tool: ucs_create
Args: { "name": "test-backup" }
```

Expected: Success message, backup created on device.

#### 2.3 Verify Backup Created

```
Tool: ucs_list
Args: {}
```

Expected: Should now include `test-backup.ucs`.

#### 2.4 Create Qkview (Optional - takes time)

```
Tool: qkview_create
Args: { "name": "test-qkview" }
```

Expected: Success message. Note: This can take several minutes.

---

### Phase 3: System Operations

#### 3.1 Execute Bash Command

```
Tool: bash_execute
Args: { "command": "uptime" }
```

Expected: System uptime output.

#### 3.2 Execute TMSH Command

```
Tool: tmsh_execute
Args: { "command": "show sys version" }
```

Expected: TMOS version information.

#### 3.3 Get Running Config

```
Tool: tmsh_execute
Args: { "command": "list ltm virtual" }
```

Expected: LTM virtual server configuration.

#### 3.4 Get License Info

```
Tool: license_get
Args: {}
```

Expected: License details including registration key and licensed modules.

---

### Phase 4: AS3 Deployment (if AS3 installed)

#### 4.1 Get Current AS3 Declaration

```
Tool: as3_get
Args: {}
```

Expected: Current AS3 declaration or empty if none deployed.

#### 4.2 Deploy Test AS3 Declaration

```
Tool: as3_deploy
Args: {
  "declaration": {
    "class": "AS3",
    "action": "deploy",
    "persist": true,
    "declaration": {
      "class": "ADC",
      "schemaVersion": "3.50.0",
      "id": "mcp-test",
      "TestTenant": {
        "class": "Tenant",
        "TestApp": {
          "class": "Application",
          "template": "generic",
          "testVirtual": {
            "class": "Service_HTTP",
            "virtualAddresses": ["10.99.99.99"],
            "virtualPort": 80,
            "pool": "testPool"
          },
          "testPool": {
            "class": "Pool",
            "members": [{
              "servicePort": 80,
              "serverAddresses": ["10.99.99.10", "10.99.99.11"]
            }]
          }
        }
      }
    }
  }
}
```

Expected: Deployment success. Creates TestTenant partition with virtual server and pool.

#### 4.3 Verify Deployment

```
Tool: as3_get
Args: { "tenant": "TestTenant" }
```

Expected: Returns the TestTenant declaration.

---

### Phase 5: AS3 Drift Detection

#### 5.1 Extract Tenant Config

```
Tool: extract_tenant_config
Args: { "tenant": "TestTenant" }
```

Expected: Returns extracted applications from the TestTenant partition including:
- List of applications with pools, monitors, profiles
- References to /Common objects
- Stats about extraction

#### 5.2 Convert to AS3

```
Tool: convert_to_as3
Args: {
  "extracted_config": <output from 5.1>
}
```

Expected: Returns AS3 declaration generated from extracted config, plus:
- Conversion notes (confidence levels)
- Unsupported features list

#### 5.3 Parse AS3 Declaration

```
Tool: parse_as3_declaration
Args: {
  "declaration": <AS3 declaration from 4.2 or 5.2>
}
```

Expected: Validates structure and returns:
- valid: true/false
- schema_version detected
- List of tenants found

#### 5.4 Validate AS3

```
Tool: validate_as3
Args: {
  "declaration": <AS3 declaration>
}
```

Expected: Schema validation results with any errors or warnings.

#### 5.5 Dry Run AS3

```
Tool: dry_run_as3
Args: {
  "declaration": <AS3 declaration from 4.2>
}
```

Expected: Shows what would change if deployed:
- "no change" if declaration matches current state
- List of create/modify/delete operations otherwise

---

### Phase 6: Monitoring & Stats

#### 6.1 Get Virtual Server Stats

```
Tool: stats_virtual
Args: {}
```

Expected: Statistics for all virtual servers (connections, bytes, etc.).

#### 6.2 Get Pool Stats

```
Tool: stats_pool
Args: {}
```

Expected: Statistics for all pools including member health status.

#### 6.3 Get Logs

```
Tool: logs_get
Args: { "log_file": "ltm", "lines": 50 }
```

Expected: Last 50 lines from /var/log/ltm.

---

### Phase 7: HA Operations (if HA configured)

#### 7.1 Check HA Status

```
Tool: ha_status
Args: {}
```

Expected: HA state (active/standby), sync status, device group info.

#### 7.2 Sync Config (if changes made)

```
Tool: ha_sync
Args: { "device_group": "<device-group-name>" }
```

Expected: Config sync initiated to peer.

---

### Phase 8: Cleanup

#### 8.1 Delete Test AS3 Tenant

```
Tool: as3_delete
Args: { "tenant": "TestTenant", "confirm": true }
```

Expected: TestTenant removed from device.

#### 8.2 Delete Test Backup

```
Tool: ucs_delete
Args: { "name": "test-backup.ucs" }
```

Expected: Backup file removed.

#### 8.3 Disconnect

```
Tool: disconnect
Args: {}
```

Expected: Session closed.

---

## Troubleshooting

### Connection Issues

- Verify F5_HOST is reachable: `curl -k https://<F5_HOST>/mgmt/tm/sys/version`
- Check credentials are correct
- Ensure management interface allows API access

### AS3 Not Found

- Check AS3 is installed: `atc_versions` tool
- Install AS3 RPM if missing: https://github.com/F5Networks/f5-appsvcs-extension/releases

### UCS Operations Fail

- Ensure sufficient disk space on BIG-IP
- Check `/var/local/ucs/` permissions

### Drift Detection Issues

- Mini-UCS requires sufficient memory
- Large configs may take longer to process
- Check corkscrew can parse the TMOS version

---

## Expected Tool Count

The TMOS MCP server exposes these tool categories:

| Category | Tools |
|----------|-------|
| connection | 4 |
| backup | 9 |
| system | 10+ |
| deployment | 9 |
| ha | 3 |
| monitoring | 5 |
| ssh | 7 |
| as3-drift | 5 |

**Total: 50+ tools**

Verify tool count with:

```bash
grep -h "name:" src/tools/*.ts | grep -oP "name: '[^']+'" | wc -l
```
