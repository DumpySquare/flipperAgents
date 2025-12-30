/**
 * System Management Tools
 *
 * Bash/tmsh execution, config management, reboot, logs, and licensing.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { F5Client } from '../lib/f5-client.js';
import { activateLicense } from '../lib/licensing.js';

export const systemTools: Tool[] = [
  // === Command Execution ===
  {
    name: 'bash_execute',
    description: `Execute a bash command on the BIG-IP device.

Use for:
- Running diagnostic commands (tcpdump, netstat, df)
- Checking file contents (cat, grep)
- System operations not available via tmsh or REST API

Caution: Commands run as root. Avoid destructive operations.

Related tools:
- tmsh_execute: For TMOS configuration commands
- logs_get: For retrieving log files (safer than cat)`,
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Bash command to execute',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'tmsh_execute',
    description: `Execute a tmsh (Traffic Management Shell) command on the BIG-IP.

Use for:
- Viewing configuration: "list ltm virtual", "show sys version"
- Making config changes: "modify ltm pool my_pool members add { ... }"
- System commands: "save sys config", "show sys failover"

The "tmsh" prefix is added automatically - just provide the command.

Related tools:
- bash_execute: For shell commands outside tmsh
- config_save: Shortcut for "save sys config"
- config_merge: For loading config snippets`,
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'tmsh command to execute (without "tmsh" prefix)',
        },
      },
      required: ['command'],
    },
  },

  // === Configuration Management ===
  {
    name: 'config_save',
    description: `Save the running configuration to persistent storage.

Use after making changes to ensure they survive a reboot.
Equivalent to: tmsh save sys config

Use for:
- After any configuration changes you want to keep
- Before creating a UCS backup (ensures backup has latest config)
- After deploying AS3/DO declarations

Related tools:
- config_merge: Load config snippets into running config
- ucs_create: Full system backup (includes saved config)`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'config_merge',
    description: `Merge a configuration snippet into the running config.

Use for:
- Applying partial configurations
- Loading saved config fragments
- Bulk configuration changes

The config should be tmsh commands or SCF (Single Configuration File) format.
Changes are applied to running config - use config_save to persist.

Related tools:
- config_save: Persist changes after merge
- tmsh_execute: For individual commands
- as3_deploy: For declarative app deployments`,
    inputSchema: {
      type: 'object',
      properties: {
        config: {
          type: 'string',
          description: 'Configuration snippet to merge (tmsh commands or SCF format)',
        },
      },
      required: ['config'],
    },
  },

  // === System Operations ===
  {
    name: 'reboot',
    description: `Reboot the BIG-IP device.

WARNING: Causes service interruption. Traffic will be dropped during reboot.

Use for:
- After software upgrades
- When system is unresponsive to normal commands
- After major configuration changes requiring restart

Pre-reboot checklist:
1. Save config (config_save)
2. Create backup (ucs_create)
3. If HA pair: Ensure standby can handle traffic (ha_failover first)

Related tools:
- ha_failover: Move traffic to peer before rebooting
- ucs_create: Backup before reboot
- config_save: Ensure config is saved`,
    inputSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm reboot',
        },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'logs_get',
    description: `Retrieve log file content from the BIG-IP.

Use for:
- Troubleshooting traffic issues (ltm log)
- Checking authentication/login events (audit log)
- Debugging GTM/DNS issues (gtm log)
- APM access issues (apm log)

Available logs: ltm, gtm, apm, asm, audit, daemon, kern

Related tools:
- bash_execute: For custom log queries (grep, tail -f)
- health_check: Overall system health including log indicators`,
    inputSchema: {
      type: 'object',
      properties: {
        log_file: {
          type: 'string',
          description: 'Log file: "ltm", "gtm", "apm", "asm", "audit", "daemon", "kern" (default: ltm)',
        },
        lines: {
          type: 'number',
          description: 'Number of lines to retrieve (default: 100)',
        },
      },
    },
  },

  // === Licensing - View ===
  {
    name: 'license_get',
    description: `View current license information for the BIG-IP device.

Shows:
- Registration key
- Licensed modules (LTM, GTM, ASM, APM, etc.)
- License expiration date
- Platform info

Use for:
- Checking what modules are available
- Verifying license status before/after activation
- Confirming license expiration dates

Related tools:
- license_install: Activate new license (device has internet)
- license_activate_airgapped: Activate license (device has NO internet)`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // === Licensing - Online (device has internet) ===
  {
    name: 'license_install',
    description: `Install or reactivate a license when BIG-IP HAS internet access.

Use when:
- BIG-IP can reach activate.f5.com directly
- BIG-IP can reach activate.f5.com via proxy

If device has NO internet access, use license_activate_airgapped instead.

NOTE: tmsh does NOT honor proxy db variables. If using a proxy, you MUST
set proxy_host/proxy_port parameters - they trigger SOAPLicenseClient.

Related tools:
- license_get: Check current license status
- license_activate_airgapped: For air-gapped/offline devices`,
    inputSchema: {
      type: 'object',
      properties: {
        registration_key: {
          type: 'string',
          description: 'License registration key (format: XXXXX-XXXXX-XXXXX-XXXXX-XXXXXXX)',
        },
        add_on_keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional add-on registration keys',
        },
        proxy_host: {
          type: 'string',
          description: 'Proxy hostname/IP (required if device uses proxy for internet)',
        },
        proxy_port: {
          type: 'number',
          description: 'Proxy port (default: 8080 if proxy_host is set)',
        },
      },
      required: ['registration_key'],
    },
  },

  // === Licensing - Offline/Air-Gapped (RECOMMENDED) ===
  {
    name: 'license_activate_airgapped',
    description: `Complete offline license activation for BIG-IP without internet access.

>>> USE THIS for air-gapped devices. One tool does everything. <<<

The MCP server (which has internet) proxies the activation to activate.f5.com.
Handles the entire workflow automatically:
1. Gets dossier from BIG-IP
2. Fetches EULA from F5 license server
3. Submits dossier+EULA to get license
4. Installs license on BIG-IP
5. Verifies activation

Use when:
- BIG-IP has no internet access (lab, secure environment)
- BIG-IP cannot reach activate.f5.com even via proxy
- You want simple one-step licensing

Related tools:
- license_install: Use this if device HAS internet access
- license_get: Verify license after activation`,
    inputSchema: {
      type: 'object',
      properties: {
        registration_key: {
          type: 'string',
          description: 'Base registration key (format: XXXXX-XXXXX-XXXXX-XXXXX-XXXXXXX)',
        },
        add_on_keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional add-on registration keys',
        },
      },
      required: ['registration_key'],
    },
  },

  // === Licensing - Manual Offline Steps (advanced) ===
  {
    name: 'license_get_dossier',
    description: `Get license dossier from BIG-IP (manual offline licensing step 1/3).

For most cases, use license_activate_airgapped instead - it does everything.

The dossier is a device fingerprint required for offline activation.
Only use this if you need manual control over the licensing steps.

Workflow (manual):
  license_get_dossier → license_activate_offline → license_install_text

Related tools:
- license_activate_airgapped: Does all steps automatically (RECOMMENDED)
- license_activate_offline: Step 2 - exchange dossier for license
- license_install_text: Step 3 - install the license`,
    inputSchema: {
      type: 'object',
      properties: {
        registration_key: {
          type: 'string',
          description: 'Base registration key (format: XXXXX-XXXXX-XXXXX-XXXXX-XXXXXXX)',
        },
        add_on_keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional add-on registration keys',
        },
      },
      required: ['registration_key'],
    },
  },
  {
    name: 'license_activate_offline',
    description: `Exchange dossier for license via MCP server (manual offline licensing step 2/3).

For most cases, use license_activate_airgapped instead - it does everything.

This calls activate.f5.com to exchange the dossier for a license.
First call returns EULA - call again with eula_text to get license.

Workflow (manual):
  license_get_dossier → license_activate_offline → license_install_text

Related tools:
- license_activate_airgapped: Does all steps automatically (RECOMMENDED)
- license_get_dossier: Step 1 - get dossier from device
- license_install_text: Step 3 - install the license`,
    inputSchema: {
      type: 'object',
      properties: {
        dossier: {
          type: 'string',
          description: 'Dossier string from license_get_dossier',
        },
        eula_text: {
          type: 'string',
          description: 'EULA text from first call - required to complete activation',
        },
      },
      required: ['dossier'],
    },
  },
  {
    name: 'license_install_text',
    description: `Install license from text (manual offline licensing step 3/3).

For most cases, use license_activate_airgapped instead - it does everything.

Writes license text to /config/bigip.license and reloads.
Only use if you have license text from manual activation.

Workflow (manual):
  license_get_dossier → license_activate_offline → license_install_text

Related tools:
- license_activate_airgapped: Does all steps automatically (RECOMMENDED)
- license_get_dossier: Step 1 - get dossier from device
- license_activate_offline: Step 2 - exchange dossier for license`,
    inputSchema: {
      type: 'object',
      properties: {
        license_text: {
          type: 'string',
          description: 'Full license text to install',
        },
      },
      required: ['license_text'],
    },
  },

];

export async function handleSystemTool(
  name: string,
  args: Record<string, unknown>,
  client: F5Client
): Promise<string> {
  switch (name) {
    case 'bash_execute': {
      const command = args.command as string;
      const output = await client.bashExecute(command);
      return JSON.stringify({
        success: true,
        command,
        output,
      }, null, 2);
    }

    case 'tmsh_execute': {
      const command = args.command as string;
      const output = await client.tmshExecute(command);
      return JSON.stringify({
        success: true,
        command: `tmsh ${command}`,
        output,
      }, null, 2);
    }

    case 'config_save': {
      const output = await client.saveConfig();
      return JSON.stringify({
        success: true,
        message: 'Configuration saved',
        output,
      }, null, 2);
    }

    case 'config_merge': {
      const config = args.config as string;
      // Write config to temp file and merge
      const tempFile = `/tmp/mcp-merge-${Date.now()}.conf`;
      await client.bashExecute(`cat > ${tempFile} << 'MCPEOF'\n${config}\nMCPEOF`);
      const output = await client.bashExecute(`tmsh load sys config merge file ${tempFile}; rm -f ${tempFile}`);
      return JSON.stringify({
        success: true,
        message: 'Configuration merged',
        output,
      }, null, 2);
    }

    case 'reboot': {
      if (!args.confirm) {
        return JSON.stringify({
          error: 'Must set confirm=true to reboot (causes service interruption)',
        });
      }
      const output = await client.bashExecute('tmsh reboot');
      return JSON.stringify({
        success: true,
        message: 'Reboot initiated',
        output,
      }, null, 2);
    }

    case 'logs_get': {
      const logFile = (args.log_file as string) || 'ltm';
      const lines = (args.lines as number) || 100;
      const output = await client.getLogs(logFile, lines);
      return JSON.stringify({
        success: true,
        logFile,
        lines,
        content: output,
      }, null, 2);
    }

    case 'license_get': {
      const license = await client.getLicense();
      return JSON.stringify(license, null, 2);
    }

    case 'license_install': {
      const regKey = args.registration_key as string;
      const addOnKeys = args.add_on_keys as string[] | undefined;
      const proxyHost = args.proxy_host as string | undefined;
      const proxyPort = (args.proxy_port as number) || (proxyHost ? 8080 : undefined);

      let output: string;

      if (proxyHost) {
        // Use SOAPLicenseClient directly - tmsh doesn't honor proxy db vars
        const proxyArg = proxyPort ? `${proxyHost}:${proxyPort}` : proxyHost;
        let cmd = `/usr/local/bin/SOAPLicenseClient --proxy ${proxyArg} --basekey ${regKey}`;
        if (addOnKeys && addOnKeys.length > 0) {
          cmd += ` --addkey ${addOnKeys.join(' --addkey ')}`;
        }
        output = await client.bashExecute(cmd);
      } else {
        // Use tmsh for direct internet access
        let cmd = `tmsh install sys license registration-key ${regKey}`;
        if (addOnKeys && addOnKeys.length > 0) {
          cmd += ` add-on-keys { ${addOnKeys.join(' ')} }`;
        }
        output = await client.bashExecute(cmd);
      }

      // Verify license was installed
      const license = await client.getLicense();

      return JSON.stringify({
        success: true,
        message: 'License installed',
        method: proxyHost ? 'SOAPLicenseClient (proxy)' : 'tmsh',
        output,
        license,
      }, null, 2);
    }

    case 'license_activate_airgapped': {
      const regKey = args.registration_key as string;
      const addOnKeys = args.add_on_keys as string[] | undefined;

      // Step 1: Get dossier from BIG-IP
      let dossierCmd = `get_dossier -b ${regKey}`;
      if (addOnKeys && addOnKeys.length > 0) {
        dossierCmd += ` -a ${addOnKeys.join(' -a ')}`;
      }

      const dossierOutput = await client.bashExecute(dossierCmd);
      const dossier = dossierOutput.trim();

      if (!dossier || dossier.length < 100) {
        return JSON.stringify({
          success: false,
          error: 'Failed to generate dossier from device',
          output: dossierOutput,
        }, null, 2);
      }

      // Step 2: Call F5 license server - may return license directly or require EULA
      let licenseResult = await activateLicense({ dossier });

      // If EULA required, submit with EULA to get license
      if (licenseResult.eulaRequired && licenseResult.eula) {
        licenseResult = await activateLicense({
          dossier,
          eula: licenseResult.eula,
        });
      }

      // Check if we got a license
      if (!licenseResult.success || !licenseResult.license) {
        return JSON.stringify({
          success: false,
          error: licenseResult.error || 'Failed to get license from server',
          state: licenseResult.state,
        }, null, 2);
      }

      // Step 4: Install license on BIG-IP
      await client.bashExecute('cp /config/bigip.license /config/bigip.license.bak 2>/dev/null || true');
      
      await client.bashExecute(`cat > /config/bigip.license << 'LICENSEEOF'
${licenseResult.license}
LICENSEEOF`);

      const reloadOutput = await client.bashExecute('reloadlic');

      // Step 5: Verify
      const license = await client.getLicense();

      return JSON.stringify({
        success: true,
        message: 'License activated and installed (air-gapped mode)',
        registration_key: regKey,
        add_on_keys: addOnKeys,
        reload_output: reloadOutput,
        license,
      }, null, 2);
    }

    case 'license_get_dossier': {
      const regKey = args.registration_key as string;
      const addOnKeys = args.add_on_keys as string[] | undefined;

      // Build get_dossier command
      let cmd = `get_dossier -b ${regKey}`;
      if (addOnKeys && addOnKeys.length > 0) {
        // Add-on keys use -a flag
        cmd += ` -a ${addOnKeys.join(' -a ')}`;
      }

      const output = await client.bashExecute(cmd);
      
      // The dossier is the output - should be a long base64-like string
      const dossier = output.trim();
      
      if (!dossier || dossier.length < 100) {
        return JSON.stringify({
          success: false,
          error: 'Failed to generate dossier',
          output,
        }, null, 2);
      }

      return JSON.stringify({
        success: true,
        registration_key: regKey,
        add_on_keys: addOnKeys,
        dossier,
      }, null, 2);
    }

    case 'license_activate_offline': {
      const dossier = args.dossier as string;
      const eulaText = args.eula_text as string | undefined;

      const result = await activateLicense({
        dossier,
        eula: eulaText,
      });

      if (result.eulaRequired) {
        return JSON.stringify({
          success: false,
          eula_required: true,
          eula: result.eula,
          message: 'EULA acceptance required. Call again with eula_text parameter set to the EULA above.',
        }, null, 2);
      }

      if (!result.success) {
        return JSON.stringify({
          success: false,
          error: result.error,
        }, null, 2);
      }

      return JSON.stringify({
        success: true,
        license: result.license,
        message: 'License obtained. Use license_install_text to install it.',
      }, null, 2);
    }

    case 'license_install_text': {
      const licenseText = args.license_text as string;

      // Backup existing license
      await client.bashExecute('cp /config/bigip.license /config/bigip.license.bak 2>/dev/null || true');

      // Write new license file
      await client.bashExecute(`cat > /config/bigip.license << 'LICENSEEOF'
${licenseText}
LICENSEEOF`);

      // Reload the license
      const reloadOutput = await client.bashExecute('reloadlic');

      // Verify license
      const license = await client.getLicense();

      return JSON.stringify({
        success: true,
        message: 'License installed from text',
        reload_output: reloadOutput,
        license,
      }, null, 2);
    }

    default:
      throw new Error(`Unknown system tool: ${name}`);
  }
}
