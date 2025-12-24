/**
 * System Management Tools
 *
 * Bash/tmsh execution, config management, reboot, and logs.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { F5Client } from '../lib/f5-client.js';

export const systemTools: Tool[] = [
  {
    name: 'bash_execute',
    description:
      'Execute a bash command on the BIG-IP device. Use with caution.',
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
    description:
      'Execute a tmsh (Traffic Management Shell) command on the BIG-IP device.',
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
  {
    name: 'config_save',
    description:
      'Save the running configuration to persistent storage (tmsh save sys config).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'config_merge',
    description:
      'Merge a configuration snippet into the running config. Useful for applying partial configs.',
    inputSchema: {
      type: 'object',
      properties: {
        config: {
          type: 'string',
          description: 'Configuration snippet to merge (tmsh commands)',
        },
      },
      required: ['config'],
    },
  },
  {
    name: 'reboot',
    description:
      'Reboot the BIG-IP device. WARNING: This will cause a service interruption.',
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
    description:
      'Retrieve log file content from the BIG-IP device.',
    inputSchema: {
      type: 'object',
      properties: {
        log_file: {
          type: 'string',
          description: 'Log file name (e.g., "ltm", "gtm", "apm", "asm", "audit"). Defaults to "ltm".',
        },
        lines: {
          type: 'number',
          description: 'Number of lines to retrieve (default: 100)',
        },
      },
    },
  },
  {
    name: 'license_get',
    description: 'View current license information for the BIG-IP device.',
    inputSchema: {
      type: 'object',
      properties: {},
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

    default:
      throw new Error(`Unknown system tool: ${name}`);
  }
}
