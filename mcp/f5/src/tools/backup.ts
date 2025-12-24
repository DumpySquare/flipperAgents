/**
 * Backup & Recovery Tools
 *
 * UCS and Qkview operations for backup and diagnostics.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { F5Client } from '../lib/f5-client.js';

export const backupTools: Tool[] = [
  // UCS Tools
  {
    name: 'ucs_create',
    description:
      'Create a UCS (User Configuration Set) backup archive. Includes config, certificates, keys, and optionally private keys.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the UCS file (without .ucs extension)',
        },
        passphrase: {
          type: 'string',
          description: 'Optional passphrase to encrypt the archive',
        },
        no_private_keys: {
          type: 'boolean',
          description: 'Exclude private keys from backup (default: false)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'ucs_list',
    description: 'List all UCS backup files stored on the BIG-IP device.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ucs_download',
    description:
      'Download a UCS backup file from the BIG-IP. Returns base64-encoded content.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the UCS file to download',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'ucs_upload',
    description: 'Upload a UCS backup file to the BIG-IP device.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the UCS file on the device',
        },
        content: {
          type: 'string',
          description: 'Base64-encoded UCS file content',
        },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'ucs_restore',
    description:
      'Restore configuration from a UCS backup. WARNING: This will replace the current configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the UCS file to restore',
        },
        passphrase: {
          type: 'string',
          description: 'Passphrase if the UCS is encrypted',
        },
        no_license: {
          type: 'boolean',
          description: 'Do not restore the license (default: false)',
        },
        reset_trust: {
          type: 'boolean',
          description: 'Reset device trust (for HA pairs)',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm this destructive operation',
        },
      },
      required: ['name', 'confirm'],
    },
  },
  {
    name: 'ucs_delete',
    description: 'Delete a UCS backup file from the BIG-IP device.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the UCS file to delete',
        },
      },
      required: ['name'],
    },
  },
  // Qkview Tools
  {
    name: 'qkview_create',
    description:
      'Generate a qkview diagnostic file. Qkviews contain comprehensive system state for troubleshooting.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Optional name for the qkview file',
        },
      },
    },
  },
  {
    name: 'qkview_list',
    description: 'List all qkview diagnostic files on the BIG-IP device.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'qkview_download',
    description:
      'Download a qkview file from the BIG-IP. Returns base64-encoded content.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the qkview file to download',
        },
      },
      required: ['name'],
    },
  },
];

export async function handleBackupTool(
  name: string,
  args: Record<string, unknown>,
  client: F5Client
): Promise<string> {
  switch (name) {
    // UCS handlers
    case 'ucs_create': {
      const ucsName = args.name as string;
      await client.ucsCreate(ucsName, {
        passphrase: args.passphrase as string | undefined,
        noPrivateKeys: args.no_private_keys as boolean | undefined,
      });
      return JSON.stringify({
        success: true,
        message: `UCS backup created: ${ucsName}.ucs`,
        name: `${ucsName}.ucs`,
      }, null, 2);
    }

    case 'ucs_list': {
      const files = await client.ucsList();
      return JSON.stringify({
        success: true,
        count: files.length,
        files: files.map((f) => ({
          name: f.name,
          size: f.apiRawValues?.file_size,
          created: f.apiRawValues?.file_created_date,
        })),
      }, null, 2);
    }

    case 'ucs_download': {
      const ucsName = args.name as string;
      const content = await client.ucsDownload(ucsName);
      return JSON.stringify({
        success: true,
        name: ucsName,
        encoding: 'base64',
        content: content.toString('base64'),
        size: content.length,
      }, null, 2);
    }

    case 'ucs_upload': {
      const ucsName = args.name as string;
      const content = Buffer.from(args.content as string, 'base64');
      await client.ucsUpload(ucsName, content);
      return JSON.stringify({
        success: true,
        message: `UCS uploaded: ${ucsName}`,
        name: ucsName,
        size: content.length,
      }, null, 2);
    }

    case 'ucs_restore': {
      if (!args.confirm) {
        return JSON.stringify({
          error: 'Must set confirm=true to restore UCS (destructive operation)',
        });
      }
      const ucsName = args.name as string;
      const output = await client.ucsRestore(ucsName, {
        passphrase: args.passphrase as string | undefined,
        noLicense: args.no_license as boolean | undefined,
        resetTrust: args.reset_trust as boolean | undefined,
      });
      return JSON.stringify({
        success: true,
        message: `UCS restored: ${ucsName}`,
        output,
      }, null, 2);
    }

    case 'ucs_delete': {
      const ucsName = args.name as string;
      await client.ucsDelete(ucsName);
      return JSON.stringify({
        success: true,
        message: `UCS deleted: ${ucsName}`,
      });
    }

    // Qkview handlers
    case 'qkview_create': {
      const qkviewName = await client.qkviewCreate(args.name as string | undefined);
      return JSON.stringify({
        success: true,
        message: `Qkview created: ${qkviewName}`,
        name: qkviewName,
      }, null, 2);
    }

    case 'qkview_list': {
      const files = await client.qkviewList();
      return JSON.stringify({
        success: true,
        count: files.length,
        files: files.map((f) => ({
          name: f.name,
          size: f.apiRawValues?.file_size,
        })),
      }, null, 2);
    }

    case 'qkview_download': {
      const qkviewName = args.name as string;
      const content = await client.qkviewDownload(qkviewName);
      return JSON.stringify({
        success: true,
        name: qkviewName,
        encoding: 'base64',
        content: content.toString('base64'),
        size: content.length,
      }, null, 2);
    }

    default:
      throw new Error(`Unknown backup tool: ${name}`);
  }
}
