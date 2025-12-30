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
    description: `Run comprehensive health checks on the BIG-IP device.

Returns status (ok/warning/critical) for:
- Disk space (/var, /shared, /) - critical for UCS, mini-UCS, AS3 operations
- Memory utilization
- CPU load average
- License status and expiration
- AS3 service availability
- HA sync status
- Unsaved configuration changes
- Stale mini-UCS files (from extract_tenant_config)
- Certificate expiration (optional, within 30 days)

Use this BEFORE:
- Creating UCS backups (need disk space)
- Running extract_tenant_config (creates ~500MB mini-UCS)
- AS3 dry-run operations (need temp space)
- Any major configuration changes

Each check returns: ok, warning, or critical status with actionable recommendations.

Related tools:
- logs_get: For detailed log analysis
- ha_status: Detailed HA information
- license_get: Full license details`,
    inputSchema: {
      type: 'object',
      properties: {
        include_certs: {
          type: 'boolean',
          description: 'Check SSL certificate expiration (adds ~2-3 seconds)',
        },
      },
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
      const includeCerts = args.include_certs as boolean | undefined;

      type CheckStatus = 'ok' | 'warning' | 'critical';
      interface Check {
        status: CheckStatus;
        value?: string;
        message: string;
      }

      const checks: Record<string, Check> = {};
      const recommendations: string[] = [];

      // Helper to determine overall status
      const getOverallStatus = (): CheckStatus => {
        const statuses = Object.values(checks).map(c => c.status);
        if (statuses.includes('critical')) return 'critical';
        if (statuses.includes('warning')) return 'warning';
        return 'ok';
      };

      // 1. Disk space checks
      try {
        const dfOutput = await client.bashExecute("df -h / /var /shared 2>/dev/null | awk 'NR>1 {print $6, $5}'");
        const lines = dfOutput.trim().split('\n');
        for (const line of lines) {
          const [mount, usage] = line.split(' ');
          if (!mount || !usage) continue;
          const percent = parseInt(usage.replace('%', ''), 10);
          const key = `disk_${mount.replace(/\//g, '_') || 'root'}`;

          if (percent >= 90) {
            checks[key] = { status: 'critical', value: usage, message: `${mount} at ${usage} - critically low space` };
            recommendations.push(`Clear space on ${mount} immediately - operations may fail`);
          } else if (percent >= 75) {
            checks[key] = { status: 'warning', value: usage, message: `${mount} at ${usage} - space getting low` };
            recommendations.push(`Consider clearing old files from ${mount}`);
          } else {
            checks[key] = { status: 'ok', value: usage, message: `${mount} at ${usage}` };
          }
        }
      } catch {
        checks['disk'] = { status: 'warning', message: 'Could not check disk space' };
      }

      // 2. Memory check
      try {
        const memOutput = await client.bashExecute("free -m | awk '/^Mem:/ {printf \"%.0f\", $3/$2*100}'");
        const memPercent = parseInt(memOutput.trim(), 10);
        if (memPercent >= 90) {
          checks['memory'] = { status: 'critical', value: `${memPercent}%`, message: `Memory at ${memPercent}%` };
          recommendations.push('Memory critically high - consider restarting services or rebooting');
        } else if (memPercent >= 80) {
          checks['memory'] = { status: 'warning', value: `${memPercent}%`, message: `Memory at ${memPercent}%` };
        } else {
          checks['memory'] = { status: 'ok', value: `${memPercent}%`, message: `Memory at ${memPercent}%` };
        }
      } catch {
        checks['memory'] = { status: 'warning', message: 'Could not check memory' };
      }

      // 3. CPU load
      try {
        const loadOutput = await client.bashExecute("cat /proc/loadavg | awk '{print $1}'");
        const load = parseFloat(loadOutput.trim());
        const cpuOutput = await client.bashExecute("nproc");
        const cpuCount = parseInt(cpuOutput.trim(), 10) || 1;
        const loadPerCpu = load / cpuCount;

        if (loadPerCpu >= 2) {
          checks['cpu_load'] = { status: 'critical', value: load.toFixed(2), message: `Load ${load.toFixed(2)} (${cpuCount} CPUs)` };
          recommendations.push('CPU load very high - operations may be slow');
        } else if (loadPerCpu >= 1) {
          checks['cpu_load'] = { status: 'warning', value: load.toFixed(2), message: `Load ${load.toFixed(2)} (${cpuCount} CPUs)` };
        } else {
          checks['cpu_load'] = { status: 'ok', value: load.toFixed(2), message: `Load ${load.toFixed(2)} (${cpuCount} CPUs)` };
        }
      } catch {
        checks['cpu_load'] = { status: 'warning', message: 'Could not check CPU load' };
      }

      // 4. License check
      try {
        const license = await client.getLicense() as Record<string, unknown>;
        const entries = license?.entries as Record<string, unknown> | undefined;
        const licenseEntry = entries?.['https://localhost/mgmt/tm/sys/license/0'] as { nestedStats?: { entries?: Record<string, { description?: string }> } } | undefined;
        const licenseEndDate = licenseEntry?.nestedStats?.entries?.['licenseEndDate']?.description;

        if (licenseEndDate) {
          const expiry = new Date(licenseEndDate.replace(/\//g, '-'));
          const daysUntilExpiry = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

          if (daysUntilExpiry <= 0) {
            checks['license'] = { status: 'critical', value: licenseEndDate, message: 'License EXPIRED' };
            recommendations.push('License expired - renew immediately');
          } else if (daysUntilExpiry <= 30) {
            checks['license'] = { status: 'warning', value: licenseEndDate, message: `License expires in ${daysUntilExpiry} days` };
            recommendations.push(`License expires ${licenseEndDate} - plan renewal`);
          } else {
            checks['license'] = { status: 'ok', value: licenseEndDate, message: `License valid until ${licenseEndDate}` };
          }
        } else {
          checks['license'] = { status: 'ok', message: 'License active' };
        }
      } catch {
        checks['license'] = { status: 'warning', message: 'Could not check license' };
      }

      // 5. AS3 availability
      try {
        const atcVersions = await client.atcGetVersions();
        if (atcVersions.as3) {
          checks['as3'] = { status: 'ok', value: atcVersions.as3, message: `AS3 ${atcVersions.as3} available` };
        } else {
          checks['as3'] = { status: 'warning', message: 'AS3 not installed' };
        }
      } catch {
        checks['as3'] = { status: 'warning', message: 'Could not check AS3 status' };
      }

      // 6. HA sync status
      try {
        const syncOutput = await client.bashExecute("tmsh show cm sync-status | grep -E '^Status|^Mode' | head -2");
        const isStandalone = syncOutput.includes('standalone');
        const inSync = syncOutput.includes('In Sync') || syncOutput.includes('Standalone');

        if (isStandalone) {
          checks['ha_sync'] = { status: 'ok', message: 'Standalone device (no HA)' };
        } else if (inSync) {
          checks['ha_sync'] = { status: 'ok', message: 'HA in sync' };
        } else {
          checks['ha_sync'] = { status: 'warning', message: 'HA not in sync' };
          recommendations.push('Sync configuration to HA peer before making changes');
        }
      } catch {
        checks['ha_sync'] = { status: 'warning', message: 'Could not check HA status' };
      }

      // 7. Unsaved config changes
      try {
        const configOutput = await client.bashExecute("tmsh show sys config-status | grep -i 'currently saved'");
        const isSaved = configOutput.toLowerCase().includes('yes');

        if (!isSaved) {
          checks['config_saved'] = { status: 'warning', message: 'Configuration has unsaved changes' };
          recommendations.push('Run config_save to persist recent changes');
        } else {
          checks['config_saved'] = { status: 'ok', message: 'Configuration is saved' };
        }
      } catch {
        checks['config_saved'] = { status: 'warning', message: 'Could not check config status' };
      }

      // 8. Certificate expiration (optional)
      if (includeCerts) {
        try {
          const certOutput = await client.bashExecute(`
            tmsh list sys crypto cert /Common/* one-line 2>/dev/null | while read line; do
              name=$(echo "$line" | grep -oP '/Common/[^\\s{]+')
              expiry=$(echo "$line" | grep -oP 'expiration-date \\K[0-9]+')
              if [ -n "$expiry" ]; then
                days=$(( (expiry - $(date +%s)) / 86400 ))
                if [ "$days" -lt 30 ]; then
                  echo "$name:$days"
                fi
              fi
            done
          `);

          const expiringCerts = certOutput.trim().split('\n').filter(l => l.includes(':'));
          if (expiringCerts.length > 0) {
            const certList = expiringCerts.map(c => {
              const [certName, days] = c.split(':');
              return `${certName} (${days} days)`;
            }).join(', ');
            checks['certificates'] = {
              status: 'warning',
              value: `${expiringCerts.length} expiring`,
              message: `Certificates expiring soon: ${certList}`
            };
            recommendations.push(`Renew expiring certificates: ${expiringCerts.map(c => c.split(':')[0]).join(', ')}`);
          } else {
            checks['certificates'] = { status: 'ok', message: 'No certificates expiring within 30 days' };
          }
        } catch {
          checks['certificates'] = { status: 'warning', message: 'Could not check certificates' };
        }
      }

      // 9. Check for stale mini-UCS files
      try {
        const miniUcsOutput = await client.bashExecute("ls -la /var/local/ucs/*.mini_ucs.tar.gz 2>/dev/null | wc -l");
        const miniUcsCount = parseInt(miniUcsOutput.trim(), 10);
        if (miniUcsCount > 0) {
          checks['stale_mini_ucs'] = {
            status: 'warning',
            value: `${miniUcsCount} files`,
            message: `${miniUcsCount} stale mini-UCS files in /var/local/ucs/`
          };
          recommendations.push(`Delete stale mini-UCS files: rm -f /var/local/ucs/*.mini_ucs.tar.gz`);
        }
      } catch {
        // No mini-UCS files or error - that's fine
      }

      return JSON.stringify({
        status: getOverallStatus(),
        checks,
        recommendations: recommendations.length > 0 ? recommendations : undefined,
        timestamp: new Date().toISOString(),
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
