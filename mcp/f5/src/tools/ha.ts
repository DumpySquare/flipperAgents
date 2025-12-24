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
    description:
      'Get HA (High Availability) status including device state, sync status, and peer information.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ha_failover',
    description:
      'Trigger failover to make this device standby. WARNING: This will cause the peer to become active.',
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
    description:
      'Sync configuration to the device group. Pushes config from this device to peers.',
    inputSchema: {
      type: 'object',
      properties: {
        device_group: {
          type: 'string',
          description: 'Name of the device group to sync',
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
