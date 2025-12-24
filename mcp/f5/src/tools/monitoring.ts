/**
 * Monitoring & Diagnostics Tools
 *
 * Stats, health checks, and monitoring operations.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { F5Client } from '../lib/f5-client.js';

export const monitoringTools: Tool[] = [
  {
    name: 'stats_virtual',
    description:
      'Get statistics for virtual servers including connections, bytes, and health status.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Virtual server name (optional, returns all if not specified)',
        },
      },
    },
  },
  {
    name: 'stats_pool',
    description:
      'Get statistics for pools including member status, connections, and health.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Pool name (optional, returns all if not specified)',
        },
      },
    },
  },
  {
    name: 'health_check',
    description:
      'Run a comprehensive health check on the BIG-IP. Checks CPU, memory, disk, and service status.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'image_list',
    description: 'List available software images on the BIG-IP device.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'volume_list',
    description: 'List software installation volumes and their boot status.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export async function handleMonitoringTool(
  name: string,
  args: Record<string, unknown>,
  client: F5Client
): Promise<string> {
  switch (name) {
    case 'stats_virtual': {
      const virtualName = args.name as string | undefined;
      const stats = await client.getVirtualStats(virtualName);
      return JSON.stringify(stats, null, 2);
    }

    case 'stats_pool': {
      const poolName = args.name as string | undefined;
      const stats = await client.getPoolStats(poolName);
      return JSON.stringify(stats, null, 2);
    }

    case 'health_check': {
      // Collect multiple health metrics
      const [cpuInfo, memInfo, diskInfo, deviceInfo] = await Promise.all([
        client.bashExecute('tmsh show sys cpu | head -20'),
        client.bashExecute('tmsh show sys memory | head -20'),
        client.bashExecute('df -h /var /var/log /shared 2>/dev/null || df -h'),
        client.getDeviceInfo(),
      ]);

      // Check critical services
      const services = await client.bashExecute(
        'tmsh show sys service | grep -E "(mcpd|tmm|httpd)" | head -10'
      );

      return JSON.stringify({
        success: true,
        device: {
          hostname: deviceInfo.hostname,
          version: deviceInfo.version,
          product: deviceInfo.product,
        },
        cpu: cpuInfo,
        memory: memInfo,
        disk: diskInfo,
        services,
      }, null, 2);
    }

    case 'image_list': {
      const images = await client.imageList();
      return JSON.stringify({
        success: true,
        count: images.length,
        images,
      }, null, 2);
    }

    case 'volume_list': {
      const volumes = await client.volumeList();
      return JSON.stringify({
        success: true,
        count: volumes.length,
        volumes,
      }, null, 2);
    }

    default:
      throw new Error(`Unknown monitoring tool: ${name}`);
  }
}
