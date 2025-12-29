/**
 * HA Management Tools
 *
 * High Availability status, failover, and sync operations.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { F5Client } from '../lib/f5-client.js';

export const haTools: Tool[] = [
  {
    name: 'ha_status',
    description: `Get High Availability status for the BIG-IP.

Returns:
- Device state: active, standby, or standalone
- Sync status: in-sync, awaiting-sync, or sync-failed
- Failover state: active-takeover, standby, etc.
- Peer device information
- Device group membership

Use for:
- Checking if device is active or standby before changes
- Verifying sync status before/after config changes
- Confirming HA pair health
- Pre-failover verification

ALWAYS check ha_status before:
- Making config changes (prefer changes on standby)
- Triggering failover
- Rebooting a device

Related tools:
- ha_failover: Switch active/standby roles
- ha_sync: Push config to peer
- device_info: Basic device info including HA state`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ha_failover',
    description: `Trigger failover to make THIS device go standby.

>>> TRAFFIC IMPACT: Brief interruption during failover <<<

The peer device becomes active and handles all traffic.
Use for:
- Pre-maintenance: Move traffic away before reboot/upgrade
- Testing: Verify HA failover works correctly
- Load balancing: Manual traffic distribution

Pre-failover checklist:
1. ha_status: Verify peer is healthy and ready
2. ha_status: Confirm sync is current (in-sync)
3. Verify peer can handle full traffic load

Post-failover:
- Verify traffic is flowing through new active
- Check for any connection drops in logs

Related tools:
- ha_status: Check state before/after failover
- ha_sync: Sync config before failover if needed
- reboot: After failover, safe to reboot this (now standby) device`,
    inputSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm failover',
        },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'ha_sync',
    description: `Sync configuration from this device to the device group.

Pushes configuration changes to peer device(s).

Use AFTER making config changes to ensure peers have the same config.

Sync behavior:
- "config-sync": Syncs LTM/network config
- Certs and keys sync separately (check sync-group settings)

Common device groups:
- "device_trust_group": Auto-created trust group
- "Sync-Failover": Typical sync-failover group name
- Custom names: Check your specific setup

Use ha_status to find the correct device_group name.

Related tools:
- ha_status: Find device group name, check sync status
- config_save: Save config before syncing`,
    inputSchema: {
      type: 'object',
      properties: {
        device_group: {
          type: 'string',
          description: 'Device group name to sync (use ha_status to find available groups)',
        },
      },
      required: ['device_group'],
    },
  },
];

export async function handleHaTool(
  name: string,
  args: Record<string, unknown>,
  client: F5Client
): Promise<string> {
  switch (name) {
    case 'ha_status': {
      const status = await client.haStatus();
      return JSON.stringify(status, null, 2);
    }

    case 'ha_failover': {
      if (!args.confirm) {
        return JSON.stringify({
          error: 'Must set confirm=true to trigger failover',
        });
      }
      const output = await client.haFailover();
      return JSON.stringify({
        success: true,
        message: 'Failover initiated - this device is now standby',
        output,
      }, null, 2);
    }

    case 'ha_sync': {
      const deviceGroup = args.device_group as string;
      const result = await client.haSync(deviceGroup);
      return JSON.stringify({
        success: true,
        message: `Config sync initiated to device group: ${deviceGroup}`,
        result,
      }, null, 2);
    }

    default:
      throw new Error(`Unknown HA tool: ${name}`);
  }
}
