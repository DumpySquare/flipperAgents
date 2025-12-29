/**
 * Connection & Discovery Tools
 *
 * Tools for connecting to BIG-IP devices and getting device info.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { F5Client } from '../lib/f5-client.js';

export const connectionTools: Tool[] = [
  {
    name: 'connect',
    description: `Connect to a BIG-IP device and establish a management session.

This is the FIRST tool to use when working with a BIG-IP. It:
- Authenticates and creates a session token
- Discovers device capabilities (version, modules, HA state)
- Returns device info for planning subsequent operations

If F5_HOST, F5_USERNAME, F5_PASSWORD env vars are set, connection 
happens automatically - this tool is only needed to connect to a 
different device or reconnect.

Returns: hostname, version, platform, serial number, HA status, licensed modules.

Related tools:
- device_info: Get device details after connecting
- check_connection: Verify connectivity without full connect
- disconnect: Release session when done`,
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'BIG-IP hostname or IP address (management interface)',
        },
        username: {
          type: 'string',
          description: 'Username (default: admin)',
        },
        password: {
          type: 'string',
          description: 'Password for authentication',
        },
        port: {
          type: 'number',
          description: 'Management port (default: 443)',
        },
      },
      required: ['host', 'password'],
    },
  },
  {
    name: 'disconnect',
    description: `Disconnect from the current BIG-IP and release the session.

Use when:
- Switching to a different BIG-IP device
- Cleaning up after operations complete
- Troubleshooting connection issues (disconnect then reconnect)

The session token is invalidated on the BIG-IP side.

Related tools:
- connect: Establish new connection`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'device_info',
    description: `Get detailed information about the connected BIG-IP.

Returns:
- Version and build info
- Platform (hardware model or VE)
- Hostname and management IP
- Serial number
- HA state (standalone, active, standby)
- Licensed modules

Use for:
- Verifying you're connected to the correct device
- Checking version before upgrades
- Confirming HA state before changes
- Inventory/documentation

Related tools:
- check_connection: Quick connectivity test
- ha_status: Detailed HA information
- license_get: Full license details`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'check_connection',
    description: `Test connectivity to the BIG-IP and measure latency.

Use for:
- Quick health check before operations
- Verifying network connectivity
- Measuring response time
- Confirming device is responsive

Returns connection status, latency in ms, and basic device info.
Does NOT establish a new session - just tests existing connection.

Related tools:
- connect: Establish connection if not connected
- device_info: Full device details`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export async function handleConnectionTool(
  name: string,
  args: Record<string, unknown>,
  client: F5Client,
  setClient: (client: F5Client | null) => void
): Promise<string> {
  switch (name) {
    case 'connect': {
      // Import dynamically to avoid circular deps
      const { F5Client: F5ClientClass } = await import('../lib/f5-client.js');
      const newClient = new F5ClientClass({
        host: args.host as string,
        username: (args.username as string) || 'admin',
        password: args.password as string,
        port: (args.port as number) || 443,
      });

      const info = await newClient.connect();
      setClient(newClient);

      return JSON.stringify({
        success: true,
        message: 'Connected to BIG-IP',
        device: info,
      }, null, 2);
    }

    case 'disconnect': {
      if (client?.isConnected()) {
        await client.disconnect();
        setClient(null);
      }
      return JSON.stringify({
        success: true,
        message: 'Disconnected from BIG-IP',
      });
    }

    case 'device_info': {
      const info = await client.getDeviceInfo();
      return JSON.stringify(info, null, 2);
    }

    case 'check_connection': {
      const startTime = Date.now();
      try {
        const info = await client.getDeviceInfo();
        const latencyMs = Date.now() - startTime;
        return JSON.stringify({
          status: 'ok',
          connected: true,
          latencyMs,
          hostname: info.hostname,
          version: info.version,
        }, null, 2);
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        return JSON.stringify({
          status: 'unreachable',
          connected: false,
          latencyMs,
          error: error instanceof Error ? error.message : String(error),
        }, null, 2);
      }
    }

    default:
      throw new Error(`Unknown connection tool: ${name}`);
  }
}
