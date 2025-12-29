/**
 * ATC Deployment Tools
 *
 * AS3, DO, and TS declarative deployment operations.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { F5Client } from '../lib/f5-client.js';

export const deploymentTools: Tool[] = [
  // === AS3 (Application Services) ===
  {
    name: 'as3_get',
    description: `Get current AS3 declarations from the BIG-IP.

AS3 manages application configurations declaratively:
- Virtual servers, pools, profiles
- iRules, policies, certificates
- Organized by tenant (partition)

Use for:
- Viewing current application configuration
- Extracting config for backup or migration
- Verifying deployment succeeded
- Comparing expected vs actual state

Returns the full declaration or single tenant if specified.

Related tools:
- as3_deploy: Deploy new/updated configuration
- as3_delete: Remove a tenant
- atc_versions: Check AS3 is installed`,
    inputSchema: {
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          description: 'Tenant name to filter (omit for all tenants)',
        },
      },
    },
  },
  {
    name: 'as3_deploy',
    description: `Deploy an AS3 declaration to configure applications.

AS3 is the RECOMMENDED way to deploy application configurations:
- Declarative: Describe desired state, AS3 makes it happen
- Idempotent: Safe to re-deploy same declaration
- Tenant isolation: Each tenant is independent

What AS3 configures:
- Virtual servers (L4-L7)
- Pools and pool members
- Profiles (HTTP, SSL, persistence, etc.)
- iRules and policies
- Certificates and keys

Declaration structure:
{
  "class": "AS3",
  "action": "deploy",
  "declaration": {
    "class": "ADC",
    "schemaVersion": "3.0.0",
    "MyTenant": {
      "class": "Tenant",
      "MyApp": {
        "class": "Application",
        ...
      }
    }
  }
}

Related tools:
- as3_get: View current configuration
- as3_delete: Remove a tenant
- config_save: Save after AS3 deploy (AS3 auto-saves by default)`,
    inputSchema: {
      type: 'object',
      properties: {
        declaration: {
          type: 'object',
          description: 'AS3 declaration object (see AS3 schema documentation)',
        },
      },
      required: ['declaration'],
    },
  },
  {
    name: 'as3_delete',
    description: `Delete an AS3 tenant and all its applications.

>>> WARNING: Removes all configuration in the tenant <<<

This removes:
- All virtual servers in the tenant
- All pools, profiles, iRules
- The partition itself (if AS3-managed)

Use for:
- Decommissioning applications
- Cleanup after migration
- Removing test configurations

Pre-delete checklist:
1. Verify tenant name is correct (as3_get)
2. Confirm no production traffic (stats_virtual)
3. Backup if needed (ucs_create)

Related tools:
- as3_get: Verify what will be deleted
- as3_deploy: Re-deploy if deleted by mistake
- stats_virtual: Check for active traffic`,
    inputSchema: {
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          description: 'Tenant name to delete',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm deletion',
        },
      },
      required: ['tenant', 'confirm'],
    },
  },

  // === DO (Declarative Onboarding) ===
  {
    name: 'do_get',
    description: `Get current Declarative Onboarding (DO) configuration.

DO manages system-level settings:
- Hostname, DNS, NTP
- VLANs, self-IPs, routes
- Users and authentication
- Licensing (via BIG-IQ)
- Device trust and HA setup

Use for:
- Viewing system configuration
- Documenting current state
- Comparing across devices
- Pre-change baseline

Related tools:
- do_deploy: Apply DO configuration
- device_info: Quick device summary
- license_get: View license details`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'do_deploy',
    description: `Deploy a Declarative Onboarding (DO) declaration.

DO configures system/network settings declaratively:
- Initial device setup (day 0/1)
- System settings: hostname, DNS, NTP, syslog
- Network: VLANs, self-IPs, routes
- Authentication: users, remote auth
- HA: device trust, failover config

>>> May require reboot for some changes <<<

Use for:
- Initial device provisioning
- Standardizing system config across fleet
- HA pair setup
- Changing system settings consistently

Declaration structure:
{
  "class": "DO",
  "declaration": {
    "schemaVersion": "1.0.0",
    "class": "Device",
    "Common": {
      "class": "Tenant",
      "hostname": "bigip1.example.com",
      ...
    }
  }
}

Related tools:
- do_get: View current system config
- atc_versions: Verify DO is installed
- ha_status: Check HA after DO deployment`,
    inputSchema: {
      type: 'object',
      properties: {
        declaration: {
          type: 'object',
          description: 'DO declaration object (see DO schema documentation)',
        },
      },
      required: ['declaration'],
    },
  },

  // === TS (Telemetry Streaming) ===
  {
    name: 'ts_get',
    description: `Get current Telemetry Streaming (TS) configuration.

TS sends metrics and logs to external systems:
- Splunk, Azure Log Analytics, AWS CloudWatch
- ElasticSearch, Kafka, generic HTTP endpoints
- StatsD, Graphite, Prometheus

Use for:
- Viewing current telemetry setup
- Troubleshooting missing metrics
- Documenting observability config

Related tools:
- ts_deploy: Configure telemetry destinations
- ts_delete: Remove telemetry config
- atc_versions: Check TS is installed`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ts_deploy',
    description: `Deploy a Telemetry Streaming (TS) declaration.

Configure where BIG-IP sends metrics and logs:
- System metrics (CPU, memory, connections)
- Traffic statistics
- Log messages (LTM, ASM, APM)
- Event-driven data

Supported consumers:
- Splunk (HEC)
- Azure Log Analytics
- AWS CloudWatch
- ElasticSearch
- Kafka
- Generic HTTP/HTTPS endpoints

Declaration structure:
{
  "class": "Telemetry",
  "My_Consumer": {
    "class": "Telemetry_Consumer",
    "type": "Splunk",
    "host": "splunk.example.com",
    ...
  }
}

Related tools:
- ts_get: View current configuration
- ts_delete: Remove telemetry config
- logs_get: Check local logs for TS errors`,
    inputSchema: {
      type: 'object',
      properties: {
        declaration: {
          type: 'object',
          description: 'TS declaration object (see TS schema documentation)',
        },
      },
      required: ['declaration'],
    },
  },
  {
    name: 'ts_delete',
    description: `Delete Telemetry Streaming configuration.

Stops all telemetry data export. Metrics/logs will no longer
be sent to configured consumers.

Use for:
- Disabling telemetry export
- Cleanup before reconfiguration
- Troubleshooting (remove then re-add)

Related tools:
- ts_get: View before deleting
- ts_deploy: Reconfigure after delete`,
    inputSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm deletion',
        },
      },
      required: ['confirm'],
    },
  },

  // === ATC Management ===
  {
    name: 'atc_versions',
    description: `List installed F5 Automation Toolchain (ATC) packages.

Shows version info for:
- AS3 (Application Services 3)
- DO (Declarative Onboarding)
- TS (Telemetry Streaming)
- CF (Cloud Failover - if installed)

Use for:
- Verifying ATC packages are installed
- Checking versions before using ATC tools
- Planning upgrades
- Troubleshooting "endpoint not found" errors

If a package shows "not installed", install the RPM from:
https://github.com/F5Networks/f5-appsvcs-extension/releases (AS3)
https://github.com/F5Networks/f5-declarative-onboarding/releases (DO)
https://github.com/F5Networks/f5-telemetry-streaming/releases (TS)

Related tools:
- as3_get, do_get, ts_get: Use after confirming installed
- bash_execute: Install RPM packages`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export async function handleDeploymentTool(
  name: string,
  args: Record<string, unknown>,
  client: F5Client
): Promise<string> {
  switch (name) {
    // AS3
    case 'as3_get': {
      const tenant = args.tenant as string | undefined;
      const declaration = await client.as3Get(tenant);
      return JSON.stringify(declaration, null, 2);
    }

    case 'as3_deploy': {
      const declaration = args.declaration as unknown;
      const result = await client.as3Deploy(declaration);
      return JSON.stringify({
        success: true,
        message: 'AS3 declaration deployed',
        result,
      }, null, 2);
    }

    case 'as3_delete': {
      if (!args.confirm) {
        return JSON.stringify({
          error: 'Must set confirm=true to delete tenant',
        });
      }
      const tenant = args.tenant as string;
      const result = await client.as3Delete(tenant);
      return JSON.stringify({
        success: true,
        message: `AS3 tenant deleted: ${tenant}`,
        result,
      }, null, 2);
    }

    // DO
    case 'do_get': {
      const declaration = await client.doGet();
      return JSON.stringify(declaration, null, 2);
    }

    case 'do_deploy': {
      const declaration = args.declaration as unknown;
      const result = await client.doDeploy(declaration);
      return JSON.stringify({
        success: true,
        message: 'DO declaration deployed',
        result,
      }, null, 2);
    }

    // TS
    case 'ts_get': {
      const declaration = await client.tsGet();
      return JSON.stringify(declaration, null, 2);
    }

    case 'ts_deploy': {
      const declaration = args.declaration as unknown;
      const result = await client.tsDeploy(declaration);
      return JSON.stringify({
        success: true,
        message: 'TS declaration deployed',
        result,
      }, null, 2);
    }

    case 'ts_delete': {
      if (!args.confirm) {
        return JSON.stringify({
          error: 'Must set confirm=true to delete TS configuration',
        });
      }
      const result = await client.tsDelete();
      return JSON.stringify({
        success: true,
        message: 'TS configuration deleted',
        result,
      }, null, 2);
    }

    // ATC versions
    case 'atc_versions': {
      const versions = await client.atcGetVersions();
      return JSON.stringify({
        success: true,
        versions,
      }, null, 2);
    }

    default:
      throw new Error(`Unknown deployment tool: ${name}`);
  }
}
