/**
 * Backup & Recovery Tools
 *
 * UCS and Qkview operations for backup and diagnostics.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { F5Client } from '../lib/f5-client.js';

export const backupTools: Tool[] = [
  // === UCS Backup Tools ===
  {
    name: 'ucs_create',
    description: `Create a UCS (User Configuration Set) backup archive.

A UCS backup is a COMPLETE system backup including:
- All configuration (bigip.conf, bigip_base.conf)
- SSL certificates and private keys
- License file
- Custom monitors and iRules
- User accounts

Use for:
- Pre-change backups before upgrades or major changes
- Disaster recovery snapshots
- Hardware migration (RMA replacement)
- Cloning config to new device

Best practice: Always create a backup before:
- Software upgrades
- Major configuration changes
- HA pair modifications

Related tools:
- ucs_download: Download the backup file
- ucs_restore: Restore from backup
- config_save: Just save running config (not a full backup)`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the UCS file (without .ucs extension). Suggest: hostname-YYYYMMDD-purpose',
        },
        passphrase: {
          type: 'string',
          description: 'Optional passphrase to encrypt the archive (recommended for sensitive environments)',
        },
        no_private_keys: {
          type: 'boolean',
          description: 'Exclude private keys from backup. Use if sharing backup (default: false)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'ucs_list',
    description: `List all UCS backup files stored on the BIG-IP.

Shows backups in /var/local/ucs/ including name, size, and creation date.

Use for:
- Finding existing backups before restore
- Checking backup history
- Identifying old backups to delete

Related tools:
- ucs_create: Create new backup
- ucs_download: Download a backup
- ucs_delete: Remove old backups`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ucs_download',
    description: `Download a UCS backup file from the BIG-IP.

Returns the file as base64-encoded content. Can be large (100MB+).

Use for:
- Offsite backup storage
- Transferring config between environments
- Archiving before major changes

The downloaded file can be:
- Decoded and saved locally
- Re-uploaded to another BIG-IP via ucs_upload

Related tools:
- ucs_create: Create backup first
- ucs_upload: Upload backup to another device
- ucs_list: Find available backups`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the UCS file to download (with or without .ucs extension)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'ucs_upload',
    description: `Upload a UCS backup file to the BIG-IP.

Use for:
- Restoring from offsite backup
- Migrating config from another device
- Staging backup before restore

The file should be base64-encoded. After upload, use ucs_restore to apply.

Related tools:
- ucs_download: Download backup from source device
- ucs_restore: Apply the uploaded backup
- ucs_list: Verify upload succeeded`,
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
    description: `Restore configuration from a UCS backup.

>>> WARNING: DESTRUCTIVE OPERATION <<<
This REPLACES the entire running configuration.

Use for:
- Disaster recovery
- Rolling back failed changes
- Hardware replacement (RMA)

Pre-restore checklist:
1. Verify you have the correct UCS file (ucs_list)
2. If HA pair: Consider restoring standby first
3. Know the passphrase if UCS is encrypted

Options:
- no_license: Keep current license instead of restoring old one
- reset_trust: Required when restoring to different hardware

Related tools:
- ucs_list: Find available backups
- ucs_create: Create backup of current config first
- ha_status: Check HA state before restore`,
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
          description: 'Keep current license instead of restoring from UCS (default: false)',
        },
        reset_trust: {
          type: 'boolean',
          description: 'Reset device trust - required for HA when restoring to different hardware',
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
    description: `Delete a UCS backup file from the BIG-IP.

Use for:
- Cleaning up old backups
- Freeing disk space
- Removing sensitive backups after download

Related tools:
- ucs_list: Find backups to delete
- ucs_download: Download before deleting if needed`,
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

  // === Qkview Diagnostic Tools ===
  {
    name: 'qkview_create',
    description: `Generate a qkview diagnostic file.

A qkview is a comprehensive diagnostic snapshot for F5 Support including:
- System configuration
- Log files
- Performance stats
- Hardware/software info

Use for:
- Opening F5 support cases
- Pre-emptive diagnostics before changes
- Troubleshooting complex issues

Note: Generation can take several minutes on busy systems.

Related tools:
- qkview_download: Download after creation
- qkview_list: Find existing qkviews
- logs_get: Quick log access without full qkview`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Optional custom name for the qkview file',
        },
      },
    },
  },
  {
    name: 'qkview_list',
    description: `List all qkview diagnostic files on the BIG-IP.

Shows qkviews in /var/tmp/ including name and size.

Use for:
- Finding existing qkviews to download
- Checking if qkview generation completed
- Identifying old qkviews to clean up

Related tools:
- qkview_create: Generate new qkview
- qkview_download: Download for support case`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'qkview_download',
    description: `Download a qkview file from the BIG-IP.

Returns base64-encoded content. Qkviews are typically 50-200MB.

Use for:
- Uploading to F5 iHealth (https://ihealth.f5.com)
- Attaching to F5 support cases
- Offline analysis

Related tools:
- qkview_create: Generate qkview first
- qkview_list: Find available qkviews`,
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
