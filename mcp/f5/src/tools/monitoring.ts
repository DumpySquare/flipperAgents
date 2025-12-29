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
    description: `Get traffic statistics for virtual servers.

Returns per-virtual-server:
- Current/total connections
- Bytes in/out
- Packets in/out  
- Connection rate
- Availability status

Use for:
- Checking if virtual server is receiving traffic
- Troubleshooting "no traffic" issues
- Capacity planning and utilization analysis
- Verifying traffic shift after changes

Specify name for single VS, or omit for all virtual servers.

Related tools:
- stats_pool: Pool/member level statistics
- health_check: Overall system health
- logs_get: Traffic logs for detailed debugging`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Virtual server name (omit for all virtual servers)',
        },
      },
    },
  },
  {
    name: 'stats_pool',
    description: `Get statistics for pools and pool members.

Returns per-pool:
- Active/total member count
- Current/total connections
- Bytes in/out
- Member status (up, down, disabled)
- Health monitor status

Use for:
- Checking pool member health
- Identifying down or slow members
- Load distribution analysis
- Troubleshooting backend connectivity

Specify name for single pool, or omit for all pools.

Related tools:
- stats_virtual: Virtual server statistics
- health_check: Overall system health
- logs_get: Check LTM logs for health monitor failures`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Pool name (omit for all pools)',
        },
      },
    },
  },
  {
    name: 'health_check',
    description: `Run comprehensive health check on the BIG-IP.

Checks:
- CPU utilization
- Memory usage
- Disk space (/var, /var/log, /shared)
- Critical services (mcpd, tmm, httpd)
- Device info summary

Use for:
- Pre-change health verification
- Troubleshooting performance issues
- Regular health monitoring
- Post-change validation

Warning thresholds to watch:
- CPU: >80% sustained
- Memory: >90% used
- Disk: >85% on any partition
- Services: Any not running

Related tools:
- logs_get: Detailed log analysis
- stats_virtual: Traffic-level health
- stats_pool: Backend health`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'image_list',
    description: `List software images available on the BIG-IP.

Shows ISO images in /shared/images/ ready for installation.
Returns image name, version, build, and file size.

Use for:
- Pre-upgrade: Verify target image is uploaded
- Cleanup: Identify old images to delete
- Planning: Check available upgrade paths

Images must be uploaded before they appear here.
Use bash_execute with curl/scp to upload new images.

Related tools:
- volume_list: See installed software versions
- image_list → install to volume → reboot workflow`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'volume_list',
    description: `List software installation volumes on the BIG-IP.

BIG-IP uses multiple boot volumes for upgrades:
- HD1.1, HD1.2, HD1.3 (typical)
- One volume is active (booted)
- Others can have different versions installed

Returns per-volume:
- Volume name
- Software version installed
- Build info
- Active/boot status

Use for:
- Pre-upgrade: Find available volume for new version
- Rollback planning: Identify previous version volumes
- Troubleshooting: Verify correct version is active

Upgrade workflow:
1. image_list: Verify image uploaded
2. volume_list: Find target volume
3. Install image to inactive volume
4. Reboot to new volume

Related tools:
- image_list: Available software images
- reboot: Boot to different volume`,
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
