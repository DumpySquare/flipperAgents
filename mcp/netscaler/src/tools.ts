/**
 * NetScaler MCP Server Tool Definitions
 * 
 * Enhanced tool descriptions following F5 MCP patterns:
 * - Detailed "Use for" sections
 * - Related tools for discoverability  
 * - Warnings on destructive operations
 * - Workflow examples where appropriate
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tools: Tool[] = [
  // === Connection & Discovery ===
  {
    name: 'check_connection',
    description: `Test connectivity to NetScaler via both NITRO API and SSH.

Use this FIRST when:
- Starting a new session to verify device is reachable
- Troubleshooting "connection refused" or timeout errors
- Before major operations to confirm both protocols work
- Diagnosing which connection method is failing

Returns:
- status: "ok" (both work), "degraded" (one works), "unreachable" (neither)
- nitro: API connectivity with latency
- ssh: SSH connectivity with latency
- host: Target NetScaler address

Related tools:
- get_system_info: Full device details after connectivity confirmed
- get_running_config: View current configuration`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_system_info',
    description: `Get NetScaler system information including version, hardware, license, and HA status.

Returns:
- Version and build info
- Hardware platform or VE type
- License edition and features
- CPU/memory utilization
- HA state (primary, secondary, standalone)

Use for:
- Verifying you're connected to the correct device
- Checking version before upgrades or config changes
- Confirming license supports required features
- Capacity planning (CPU/memory baseline)

Related tools:
- check_connection: Verify connectivity first
- list_vservers: See configured applications
- get_running_config: Full configuration details`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // === Virtual Server Management ===
  {
    name: 'list_vservers',
    description: `List all load balancer virtual servers on the NetScaler.

Returns for each vserver:
- Name and type (HTTP, SSL, TCP, etc.)
- IP address and port
- State (UP, DOWN, OUT OF SERVICE)
- Service type and protocol

With include_stats=true, also returns:
- Current/total connections
- Bytes in/out
- Health status

Use for:
- Inventory of configured applications
- Quick health check of all vservers
- Finding vserver names before detailed queries
- Pre-migration documentation

Related tools:
- get_vserver_status: Detailed single vserver info with bindings
- get_running_config: Full vserver configuration syntax
- backup_config: Capture before making changes`,
    inputSchema: {
      type: 'object',
      properties: {
        include_stats: {
          type: 'boolean',
          description: 'Include health and traffic statistics (slower, more data)',
          default: false,
        },
      },
    },
  },
  {
    name: 'get_vserver_status',
    description: `Get detailed status and bindings for a specific virtual server.

Returns:
- Current state and effective state
- All service/servicegroup bindings with health status
- SSL certificate bindings
- Policy bindings (responder, rewrite, etc.)
- Persistence configuration
- Traffic statistics

Use for:
- Troubleshooting why a vserver is DOWN
- Verifying all backend services are healthy
- Checking SSL certificate bindings
- Understanding full vserver configuration

Related tools:
- list_vservers: Find vserver names
- get_running_config: See actual CLI config
- list_certificates: Check certificate details`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Exact name of the virtual server',
        },
      },
      required: ['name'],
    },
  },

  // === Configuration Management ===
  {
    name: 'get_running_config',
    description: `Get the current running configuration (ns.conf equivalent).

Returns NetScaler CLI commands that recreate the current config.
Can filter by section for targeted output.

Sections:
- "lb" - Load balancing (vservers, services, servicegroups)
- "cs" - Content switching
- "ssl" - SSL certificates and profiles
- "server" - Backend server definitions
- "monitor" - Health monitors
- (omit for full config)

Use for:
- Documenting current state
- Extracting config for migration
- Comparing before/after changes
- Backup verification

Related tools:
- backup_config: Timestamped config snapshot
- deploy_config: Apply configuration
- save_config: Persist running config to startup`,
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description: 'Filter by section: "lb", "cs", "ssl", "server", "monitor" (omit for full config)',
        },
      },
    },
  },
  {
    name: 'backup_config',
    description: `Create a timestamped backup of the current running configuration.

Returns:
- Timestamp of backup
- Description (custom or default)
- Full configuration content
- Line count

This captures config in memory - for persistent backups, use create_system_backup.

Use for:
- Quick snapshot before making changes
- Comparing config at different points in time
- Documenting current state with description

Related tools:
- create_system_backup: Full system backup archive (certs, scripts, etc.)
- get_running_config: Raw config without metadata
- deploy_config: Restore or apply config`,
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Description for this backup (e.g., "pre-upgrade", "before SSL changes")',
        },
      },
    },
  },
  {
    name: 'deploy_config',
    description: `Deploy configuration commands to the NetScaler.

>>> MODIFIES DEVICE CONFIGURATION <<<

Config is automatically reordered for dependency safety:
1. Servers and monitors first
2. Services and servicegroups
3. Vservers and bindings
4. Policies and actions

Options:
- clear_first: Wipe application config before deploying (clean slate)
- provision_test_certs: Auto-generate self-signed certs for SSL certKeys

Use for:
- Applying extracted/migrated configuration
- Deploying from templates or automation
- Restoring from backup
- Initial device setup

Pre-deploy checklist:
1. backup_config or create_system_backup first
2. Review config for environment-specific values (IPs, hostnames)
3. Consider test certs for lab/dev environments

Related tools:
- backup_config: Backup before deploying
- clear_config: Manual config wipe (if not using clear_first)
- provision_test_certs: Generate certs separately
- save_config: Persist changes after deploy`,
    inputSchema: {
      type: 'object',
      properties: {
        config: {
          type: 'string',
          description: 'NetScaler CLI commands (one per line). Will be reordered for dependencies.',
        },
        clear_first: {
          type: 'boolean',
          description: 'Clear existing application config before deploying. Removes vservers, services, certs.',
          default: false,
        },
        provision_test_certs: {
          type: 'boolean',
          description: 'Generate self-signed test certs for SSL certKey entries. Good for lab/dev.',
          default: false,
        },
      },
      required: ['config'],
    },
  },
  {
    name: 'clear_config',
    description: `Clear all application configuration from the NetScaler.

>>> DESTRUCTIVE OPERATION - REMOVES ALL VSERVERS, SERVICES, CERTS <<<

Preserves:
- Network settings (NSIP, SNIP, VLANs, routes)
- System settings (hostname, DNS, NTP)
- User accounts

Removes:
- All virtual servers (LB, CS, GSLB)
- All services and servicegroups
- All backend server definitions
- All SSL certificates and keys
- All custom monitors
- All policies and actions

Use for:
- Complete device reset before migration
- Lab cleanup between tests
- Starting fresh after failed deployment

Pre-clear checklist:
1. create_system_backup (full backup)
2. Verify this is the intended device
3. Confirm no production traffic

Related tools:
- create_system_backup: Backup before clearing
- deploy_config: Apply new config after clearing
- check_connection: Verify device after clear`,
    inputSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm this DESTRUCTIVE operation',
        },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'save_config',
    description: `Save the running configuration to persistent storage (ns.conf).

Without this, changes are lost on reboot.
Equivalent to: save ns config

Use AFTER any configuration changes you want to keep:
- After deploy_config
- After manual CLI changes
- Before creating system backups
- Before reboots

Related tools:
- deploy_config: Apply configuration
- create_system_backup: Full backup (auto-saves first)
- get_running_config: View current config`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // === SSL Certificate Management ===
  {
    name: 'list_certificates',
    description: `List SSL certificates with expiration status.

Returns for each certificate:
- Certificate name (certkey)
- Subject and issuer
- Valid from/to dates
- Days until expiration
- Bound to which vservers

Use for:
- Certificate expiration monitoring
- Finding certificates to renew
- Audit of SSL configuration
- Pre-migration certificate inventory

Related tools:
- upload_certificate: Add new certificate
- get_vserver_status: See cert bindings for specific vserver
- download_file: Export certificate files`,
    inputSchema: {
      type: 'object',
      properties: {
        expiring_within_days: {
          type: 'number',
          description: 'Only show certificates expiring within N days (e.g., 30 for next month)',
        },
      },
    },
  },
  {
    name: 'upload_certificate',
    description: `Upload an SSL certificate and private key to the NetScaler.

Creates:
- Certificate file in /nsconfig/ssl/
- Key file in /nsconfig/ssl/
- SSL certKey object binding them together

Use for:
- Installing new SSL certificates
- Replacing expired certificates
- Migration of certificates from another device

The certkey can then be bound to SSL vservers.

Related tools:
- list_certificates: Verify upload succeeded
- get_vserver_status: Check current cert bindings
- provision_test_certs: Generate test certs instead`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the certkey (used as identifier)',
        },
        cert_content: {
          type: 'string',
          description: 'PEM-encoded certificate (including BEGIN/END CERTIFICATE)',
        },
        key_content: {
          type: 'string',
          description: 'PEM-encoded private key (including BEGIN/END PRIVATE KEY)',
        },
      },
      required: ['name', 'cert_content', 'key_content'],
    },
  },
  {
    name: 'provision_test_certs',
    description: `Generate self-signed test certificates for SSL certKey entries in config.

Parses configuration to find SSL certKey entries and generates
self-signed certificates directly on the NetScaler for each one.

Use for:
- Lab/dev environments where real certs aren't needed
- Testing configuration before obtaining production certs
- Migration testing without transferring private keys

Generated certs are:
- 2048-bit RSA keys
- Self-signed (not CA-issued)
- Valid for 365 days
- Named to match certkey entries in config

Related tools:
- deploy_config: Can use provision_test_certs=true option
- upload_certificate: Upload real certificates
- list_certificates: Verify generated certs`,
    inputSchema: {
      type: 'object',
      properties: {
        config: {
          type: 'string',
          description: 'NetScaler configuration to scan for SSL certKey entries',
        },
      },
      required: ['config'],
    },
  },

  // === System Backup ===
  {
    name: 'create_system_backup',
    description: `Create a full system backup archive (.tgz) on the NetScaler.

>>> RECOMMENDED before any major changes <<<

Includes:
- ns.conf (running configuration)
- SSL certificates and private keys
- Custom monitor scripts
- License files
- All /nsconfig content

Backup levels:
- "basic": ns.conf only (fast, small)
- "full": Everything (slower, complete)

Backups stored in /var/ns_sys_backup/ on device.

Use for:
- Pre-upgrade backups
- Disaster recovery preparation
- Hardware migration/RMA
- Compliance/audit requirements

Related tools:
- list_system_backups: Find existing backups
- download_system_backup: Retrieve backup file
- backup_config: Quick config-only snapshot`,
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Prefix for backup filename (e.g., "pre-upgrade", "daily")',
        },
        level: {
          type: 'string',
          enum: ['basic', 'full'],
          description: '"basic" for ns.conf only, "full" for complete backup (default: full)',
        },
        comment: {
          type: 'string',
          description: 'Optional comment stored with backup metadata',
        },
      },
    },
  },
  {
    name: 'list_system_backups',
    description: `List all system backup files on the NetScaler.

Shows backups in /var/ns_sys_backup/:
- Filename
- Size
- Creation date
- NetScaler version at backup time
- Comment (if provided)

Use for:
- Finding backups to download or restore
- Checking backup history
- Identifying old backups to delete for space

Related tools:
- create_system_backup: Create new backup
- download_system_backup: Retrieve for offsite storage
- delete_system_backup: Remove old backups`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'download_system_backup',
    description: `Download a system backup archive from the NetScaler.

Returns backup as base64-encoded content.
Backups can be 10-100MB+ depending on content.

Use for:
- Offsite backup storage
- Transferring to new device
- Archiving before device decommission

The downloaded .tgz can be:
- Stored in version control or backup system
- Restored to same or different NetScaler
- Extracted to examine contents

Related tools:
- list_system_backups: Find backup filename
- create_system_backup: Create backup first
- upload_file: Upload backup to different device`,
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Backup filename (e.g., "backup_ns01_20240115.tgz")',
        },
      },
      required: ['filename'],
    },
  },
  {
    name: 'delete_system_backup',
    description: `Delete a system backup file from the NetScaler.

Use for:
- Freeing disk space
- Removing old/obsolete backups
- Cleanup after successful restore elsewhere

Backup is permanently deleted from /var/ns_sys_backup/.

Related tools:
- list_system_backups: Find backups to delete
- download_system_backup: Download before deleting if needed`,
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Backup filename to delete',
        },
      },
      required: ['filename'],
    },
  },

  // === File Operations ===
  {
    name: 'upload_file',
    description: `Upload a file to the NetScaler filesystem.

Common locations:
- /nsconfig/monitors/ - Custom monitor scripts
- /nsconfig/ssl/ - Certificates and keys
- /nsconfig/nstemplates/ - AppExpert templates

Use for:
- Custom health monitor scripts
- Certificates and keys
- Configuration templates
- Custom scripts

Related tools:
- download_file: Retrieve files
- upload_certificate: Simpler flow for SSL certs`,
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Name for the file on the NetScaler',
        },
        location: {
          type: 'string',
          description: 'Directory path (e.g., "/nsconfig/monitors", "/nsconfig/ssl")',
        },
        content: {
          type: 'string',
          description: 'File content (text or base64 for binary)',
        },
        encoding: {
          type: 'string',
          enum: ['text', 'base64'],
          description: '"text" for scripts/configs, "base64" for binary files',
        },
      },
      required: ['filename', 'location', 'content'],
    },
  },
  {
    name: 'download_file',
    description: `Download a file from the NetScaler filesystem.

Common use cases:
- Retrieving certificates for migration
- Downloading log files
- Exporting custom scripts
- Getting ns.conf directly

Requires SSH (key or password auth).

Related tools:
- upload_file: Upload files
- list_system_backups: For backup files specifically
- get_running_config: For configuration (structured)`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Full path on NetScaler (e.g., "/nsconfig/ssl/cert.pem", "/var/nslog/newnslog")',
        },
        encoding: {
          type: 'string',
          enum: ['text', 'base64'],
          description: '"text" for readable files, "base64" for binary files',
        },
      },
      required: ['path'],
    },
  },
];
