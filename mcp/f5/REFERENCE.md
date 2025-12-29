# TMOS MCP Server Reference

External references, API patterns, and gotchas for the TMOS MCP server implementation.

> **For AI Agents:** When implementing new tools or debugging edge cases, fetch the relevant Ansible module source from GitHub for patterns. Example: for licensing issues, fetch `https://raw.githubusercontent.com/F5Networks/f5-ansible/devel/ansible_collections/f5networks/f5_modules/plugins/modules/bigip_device_license.py`

---

## Reference Implementations

### F5 Ansible Collection (Primary Reference)

The F5 Ansible collection provides battle-tested patterns for iControl REST API interactions. **AI agents should reference this for edge cases, error handling patterns, and API nuances.**

**Repository:** <https://github.com/F5Networks/f5-ansible>

**Key paths for AI lookup:**

| Need | Path |
|------|------|
| Module implementations | `ansible_collections/f5networks/f5_modules/plugins/modules/` |
| REST client patterns | `ansible_collections/f5networks/f5_modules/plugins/module_utils/bigip.py` |
| Common utilities | `ansible_collections/f5networks/f5_modules/plugins/module_utils/common.py` |
| iControl helpers | `ansible_collections/f5networks/f5_modules/plugins/module_utils/icontrol.py` |

**Useful modules to reference:**

| Module | File | Covers |
|--------|------|--------|
| `bigip_device_license` | `bigip_device_license.py` | Licensing workflows (offline licensing pattern) |
| `bigip_ucs` | `bigip_ucs.py` | UCS backup/restore patterns |
| `bigip_software_install` | `bigip_software_install.py` | Image management, volume operations |
| `bigip_device_ha_group` | `bigip_device_ha_group.py` | HA operations |
| `bigip_pool` | `bigip_pool.py` | LTM object management patterns |
| `bigip_data_group` | `bigip_data_group.py` | Data group handling (large file uploads) |

**Architecture insight:** The collection primarily uses iControl REST, falling back to tmsh for edge cases. This aligns with our approach using f5-conx-core.

### Declarative Collection

**Repository:** <https://github.com/F5Networks/f5-ansible-bigip>

For AS3/DO/TS patterns - uses declarative APIs rather than imperative REST calls.

---

## Documentation Resources for AI Agents

When an AI agent needs additional context for TMOS operations, these resources can be fetched or referenced.

### F5 CloudDocs

| Topic | URL |
|-------|-----|
| iControl REST Reference | <https://clouddocs.f5.com/api/icontrol-rest/> |
| TMSH Reference | <https://clouddocs.f5.com/cli/tmsh-reference/latest/> |
| AS3 Schema Reference | <https://clouddocs.f5.com/products/extensions/f5-appsvcs-extension/latest/refguide/schema-reference.html> |
| DO Schema Reference | <https://clouddocs.f5.com/products/extensions/f5-declarative-onboarding/latest/schema-reference.html> |

### F5 Knowledge Base (K-Articles)

Common gotchas and procedures:

| Article | Topic |
|---------|-------|
| K2595 | Licensing from command line |
| K15055 | Using tmsh to manage licenses |
| K7752 | Licensing overview |
| K13127 | UCS backup best practices |
| K13132 | Restoring UCS archives |
| K14088 | Software upgrade procedures |
| K8986 | HA failover procedures |

**Note:** K-articles often require authentication. The actual procedures can usually be found in CloudDocs.

---

## Implementation Notes

### Licensing Gotchas

**Proxy support:** The `tmsh install sys license` command does NOT honor proxy db variables. For devices behind a proxy, the underlying `/usr/local/bin/SOAPLicenseClient` must be called directly with `--proxy` flag.

**MCP Implementation:** The `license_install` tool handles this automatically:
- Without proxy: Uses `tmsh install sys license`
- With proxy_host: Uses `SOAPLicenseClient --proxy`

### Offline/Air-Gapped Licensing

For BIG-IP devices without any internet access, the MCP server can proxy the license activation:

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│   BIG-IP    │     │ MCP Server  │     │ activate.f5.com  │
│ (no internet)│    │ (has internet)│   │                  │
└──────┬──────┘     └──────┬──────┘     └────────┬─────────┘
       │                   │                      │
       │ 1. get_dossier    │                      │
       │◄──────────────────│                      │
       │                   │                      │
       │   dossier         │                      │
       │──────────────────►│                      │
       │                   │                      │
       │                   │ 2. SOAP getLicense   │
       │                   │─────────────────────►│
       │                   │                      │
       │                   │   license text       │
       │                   │◄─────────────────────│
       │                   │                      │
       │ 3. install license│                      │
       │◄──────────────────│                      │
```

**Tools:**

| Tool | Description |
|------|-------------|
| `license_get_dossier` | Get dossier from BIG-IP (`get_dossier -b <key>`) |
| `license_activate_offline` | MCP calls activate.f5.com SOAP API |
| `license_install_text` | Write license to `/config/bigip.license` + reload |

**SOAP Endpoint:** `https://activate.f5.com/license/services/urn:com.f5.license.v5b.ActivationService`

**Workflow:**
1. `license_get_dossier` with registration key → returns dossier
2. `license_activate_offline` with dossier → returns EULA (first call)
3. `license_activate_offline` with dossier + eula_text → returns license
4. `license_install_text` with license → installs and reloads

**Commands (for reference):**

```bash
# Direct licensing (device has internet)
tmsh install sys license registration-key XXXXX-XXXXX-XXXXX-XXXXX-XXXXXXX

# Via SOAPLicenseClient (with proxy)
/usr/local/bin/SOAPLicenseClient --proxy proxy:8080 --basekey XXXXX-XXXXX-XXXXX-XXXXX-XXXXXXX
```

**Alternative approaches:**
1. Ansible `bigip_device_license` module - handles licensing from the Ansible controller, not the BIG-IP itself
2. iControl REST to install a pre-obtained license file

### Common REST Endpoints

| Operation | Endpoint | Method |
|-----------|----------|--------|
| Device info | `/mgmt/tm/sys/version` | GET |
| License info | `/mgmt/tm/sys/license` | GET |
| HA status | `/mgmt/tm/cm/device` | GET |
| Config sync | `/mgmt/tm/cm/config-sync` | POST |
| Bash command | `/mgmt/tm/util/bash` | POST |
| UCS create | `/mgmt/tm/sys/ucs` | POST |
| Software images | `/mgmt/tm/sys/software/image` | GET |
| Software volumes | `/mgmt/tm/sys/software/volume` | GET |

### tmsh vs REST Decision Matrix

| Operation | Use REST | Use tmsh (via bash) |
|-----------|----------|---------------------|
| Read config/stats | ✅ | |
| Create/modify LTM objects | ✅ | |
| UCS operations | ✅ | |
| Reboot | | ✅ `tmsh reboot` |
| Failover | | ✅ `tmsh run sys failover standby` |
| Load UCS | | ✅ `tmsh load sys ucs <file>` |
| Save config | Both work | `tmsh save sys config` |
| Merge config | | ✅ `tmsh load sys config merge file <path>` |

---

## MCP Resources Capability

The MCP protocol supports exposing documentation as **resources** that AI agents can fetch on-demand.

### Proposed Resource URIs

```
tmos://docs/licensing      → Licensing procedures and gotchas
tmos://docs/ha             → HA operations reference  
tmos://docs/upgrade        → Software upgrade procedures
tmos://docs/backup         → UCS backup/restore best practices
tmos://schema/as3          → AS3 schema summary
tmos://schema/do           → DO schema summary
```

### Implementation Pattern

```typescript
// In index.ts - add to server capabilities
capabilities: {
  tools: {},
  resources: {
    listChanged: true,  // Support notifications
  },
}

// Resource list handler
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'tmos://docs/licensing',
      name: 'BIG-IP Licensing Reference',
      description: 'Licensing procedures, proxy workarounds, and common issues',
      mimeType: 'text/markdown',
    },
    // ... more resources
  ],
}));

// Resource read handler  
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  // Return content based on URI
});
```

---

## SSH Session Architecture

### Why SSH Alongside REST?

The REST API (via iControl) is stateless - each request is independent. This works well for CRUD operations but fails for:

1. **Streaming output** - `tail -f` logs during operations
2. **Long-running commands** - tcpdump, watch commands
3. **Real-time monitoring** - Watching progress during upgrades/licensing
4. **Interactive debugging** - When REST isn't showing the full picture

### SSH vs REST Bash Execution

| Feature | REST `bash_execute` | SSH `ssh_execute` |
|---------|--------------------|-----------------|
| Connection | Per-request | Persistent session |
| Streaming | No | Yes (via tail) |
| Long-running | Timeout limited | Runs indefinitely |
| Multiple commands | Multiple API calls | Reuses session |
| Shell environment | Clean each time | Persistent |

### Use Cases for SSH

#### License Activation Monitoring

```
1. ssh_connect
2. ssh_tail_start: /var/log/ltm
3. license_activate_airgapped (REST)
4. ssh_tail_read → see "License installed" or errors
5. ssh_tail_stop
```

**What to look for in /var/log/ltm:**
- `license` - License events
- `mcpd` - Master control process events
- `crit`, `err` - Errors

#### Software Upgrade Monitoring

```
1. ssh_tail_start: /var/log/ltm
2. ssh_tail_start: /var/log/liveinstall
3. [install image via tmsh]
4. ssh_tail_read both sessions periodically
5. [reboot]
6. Reconnect SSH after device comes back
```

**What to look for:**
- `/var/log/liveinstall` - Installation progress, extraction, validation
- `/var/log/ltm` - Service stops/starts, reboot messages

#### HA Failover Monitoring

```
1. ssh_tail_start: /var/log/ltm on BOTH devices
2. ha_failover (REST)
3. ssh_tail_read → watch failover messages
4. Verify traffic moved to peer
```

**What to look for:**
- `SOD` - State of device changes
- `failover` - Failover events
- `active`, `standby` - State transitions

### Common Log Files

| Log File | Contents |
|----------|----------|
| `/var/log/ltm` | LTM events, licensing, mcpd, general operations |
| `/var/log/audit` | Configuration changes, logins, security events |
| `/var/log/liveinstall` | Software installation progress |
| `/var/log/ts/bd.log` | ASM/WAF events |
| `/var/log/apm` | APM authentication logs |
| `/var/log/gtm` | GTM/DNS logs |
| `/var/log/daemon.log` | Daemon messages |
| `/var/log/kern.log` | Kernel messages |

### SSH Authentication

The SSH tools default to:
- **Host:** Same as REST connection
- **Port:** 22 (standard SSH)
- **Username:** `root` (not `admin` - SSH uses root)
- **Password:** Same as REST connection

Key-based auth is also supported via `private_key` parameter.

**Note:** BIG-IP SSH access as root may require:
```bash
tmsh modify auth user admin shell bash
```
Or ensure root login is enabled in sshd config.

---

## Testing Resources

### Lab Setup

For testing the MCP server:
- BIG-IP VE trial licenses available from F5
- Use F5's UDF (Unified Demo Framework) for ephemeral lab environments
- Docker-based BIG-IP VE for local testing (limited, but works for API testing)

### Test Scenarios

1. **Connection** - Connect/disconnect, handle auth failures
2. **UCS** - Create, list, download, restore (test with HA pair)
3. **HA** - Status check, failover, sync (requires HA pair)
4. **ATC** - Deploy AS3 declaration, validate, delete
5. **Licensing** - Only testable with actual license keys

---

## Quick Reference URLs (for AI agents)

Direct raw URLs for fetching Ansible module source:

```
# Base URL
https://raw.githubusercontent.com/F5Networks/f5-ansible/devel/ansible_collections/f5networks/f5_modules/plugins/modules/

# Common modules
bigip_device_license.py    - Licensing (offline pattern)
bigip_ucs.py               - UCS backup/restore
bigip_software_install.py  - Image/volume management  
bigip_device_ha_group.py   - HA operations
bigip_pool.py              - Pool management
bigip_virtual_server.py    - Virtual server management
bigip_node.py              - Node management
bigip_ssl_certificate.py   - SSL cert management
bigip_ssl_key.py           - SSL key management
bigip_data_group.py        - Data groups
bigip_command.py           - tmsh command execution

# Utilities
https://raw.githubusercontent.com/F5Networks/f5-ansible/devel/ansible_collections/f5networks/f5_modules/plugins/module_utils/bigip.py
https://raw.githubusercontent.com/F5Networks/f5-ansible/devel/ansible_collections/f5networks/f5_modules/plugins/module_utils/common.py
https://raw.githubusercontent.com/F5Networks/f5-ansible/devel/ansible_collections/f5networks/f5_modules/plugins/module_utils/icontrol.py
```

---

## Changelog

- 2024-12-29: Added SSH session architecture
  - SSH vs REST comparison
  - Use cases for log monitoring during operations
  - Common log files reference
  - Authentication details
- 2024-12-29: Initial document created
  - Added F5 Ansible collection as primary reference
  - Added documentation URLs for AI agents
  - Added licensing gotchas from SOAPLicenseClient investigation
  - Added REST vs tmsh decision matrix
  - Proposed MCP resources capability for on-demand docs
  - Updated to reflect license_install tool implementation with proxy support
