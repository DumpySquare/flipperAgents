#!/usr/bin/env node
/**
 * NetScaler MCP Server
 *
 * Provides tools for managing NetScaler ADC via Claude Desktop or any MCP client.
 *
 * Configuration via environment variables:
 *   NS_HOST     - NetScaler hostname/IP (required)
 *   NS_USER     - Username (default: nsroot)
 *   NS_PASS     - Password (required for NITRO API, also used for SSH if no key)
 *   SSH_KEY     - Path to SSH private key (optional, preferred over password for SSH)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { NitroClient } from './lib/nitro-client.js';
import { SSHClient } from './lib/ssh-client.js';
import { reorderConfig } from './lib/config-reorder.js';
import { startHttpTransport, setToolHandler, setConnectionChecker, setShutdownHandler } from './transports/http.js';
import { log, logToolCall } from './lib/logger.js';
import { TelemetryClient, classifyError, setupGlobalErrorHandlers } from '@flipper/telemetry';

// Initialize telemetry (singleton)
const telemetry = new TelemetryClient('flipperagents-ns-mcp', '0.1.0');
setupGlobalErrorHandlers(telemetry);

// Tool definitions
const tools: Tool[] = [
  {
    name: 'get_system_info',
    description: 'Get NetScaler system information including version, hardware, license, CPU/memory usage, and HA status. Use this to verify connectivity and understand device capabilities.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_vservers',
    description: 'List all load balancer virtual servers on the NetScaler',
    inputSchema: {
      type: 'object',
      properties: {
        include_stats: {
          type: 'boolean',
          description: 'Include health and traffic statistics',
          default: false,
        },
      },
    },
  },
  {
    name: 'get_vserver_status',
    description: 'Get detailed status and bindings for a specific virtual server',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the virtual server',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'backup_config',
    description: 'Create a backup of the current NetScaler configuration',
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Description for this backup',
        },
      },
    },
  },
  {
    name: 'deploy_config',
    description: 'Deploy a configuration to the NetScaler. Config will be automatically reordered for dependency safety.',
    inputSchema: {
      type: 'object',
      properties: {
        config: {
          type: 'string',
          description: 'NetScaler configuration commands (one per line)',
        },
        clear_first: {
          type: 'boolean',
          description: 'Clear existing application config before deploying (includes cert files)',
          default: false,
        },
        provision_test_certs: {
          type: 'boolean',
          description: 'Generate self-signed test certificates before deploying. Parses config for SSL certKey entries and creates them on the NetScaler.',
          default: false,
        },
      },
      required: ['config'],
    },
  },
  {
    name: 'clear_config',
    description: 'Clear all application configuration (vservers, services, servers). Preserves system settings.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm this destructive operation',
        },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'list_certificates',
    description: 'List SSL certificates with expiration status',
    inputSchema: {
      type: 'object',
      properties: {
        expiring_within_days: {
          type: 'number',
          description: 'Only show certificates expiring within N days',
        },
      },
    },
  },
  {
    name: 'upload_certificate',
    description: 'Upload an SSL certificate and key to the NetScaler',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the certificate (used as certkey name)',
        },
        cert_content: {
          type: 'string',
          description: 'PEM-encoded certificate content',
        },
        key_content: {
          type: 'string',
          description: 'PEM-encoded private key content',
        },
      },
      required: ['name', 'cert_content', 'key_content'],
    },
  },
  {
    name: 'get_running_config',
    description: 'Get the current running configuration',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description: 'Optional section to filter (e.g., "lb", "cs", "ssl")',
        },
      },
    },
  },
  {
    name: 'save_config',
    description: 'Save the running configuration to persistent storage',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'provision_test_certs',
    description: 'Generate self-signed test certificates on NetScaler for SSL certkey entries that reference missing files. Parses config to find missing certs and creates them directly on the device.',
    inputSchema: {
      type: 'object',
      properties: {
        config: {
          type: 'string',
          description: 'NetScaler configuration to scan for SSL certKey entries',
        },
      },
      required: ['config'],
    },
  },
  {
    name: 'check_connection',
    description: 'Test connectivity to NetScaler via both NITRO API and SSH. Use this before operations to verify the device is reachable, or to diagnose connection issues. Returns status of both connection methods.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_system_backup',
    description: 'Create a full system backup archive on the NetScaler. The backup includes ns.conf, SSL certificates/keys, custom monitor scripts, and other nsconfig files. Backups are stored in /var/ns_sys_backup/ on the device. Default filename: <description>_<hostname>_<date>.tgz',
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Description/prefix for the backup filename (e.g., "pre-upgrade", "daily"). Default: "backup"',
        },
        level: {
          type: 'string',
          enum: ['basic', 'full'],
          description: 'Backup level: "basic" (ns.conf only) or "full" (includes certs, scripts, etc.). Default: full',
        },
        comment: {
          type: 'string',
          description: 'Optional comment stored with the backup metadata',
        },
      },
    },
  },
  {
    name: 'list_system_backups',
    description: 'List all system backup files available on the NetScaler in /var/ns_sys_backup/',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'download_system_backup',
    description: 'Download a system backup archive from the NetScaler. Returns the backup as base64-encoded content that can be saved locally.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Name of the backup file to download (e.g., "backup_ns01_20240115.tgz")',
        },
      },
      required: ['filename'],
    },
  },
  {
    name: 'delete_system_backup',
    description: 'Delete a system backup file from the NetScaler',
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Name of the backup file to delete',
        },
      },
      required: ['filename'],
    },
  },
  {
    name: 'upload_file',
    description: 'Upload a file to the NetScaler filesystem. Useful for uploading custom monitor scripts, certificates, or other files.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Name for the file on the NetScaler',
        },
        location: {
          type: 'string',
          description: 'Directory path on NetScaler (e.g., "/nsconfig/monitors", "/nsconfig/ssl")',
        },
        content: {
          type: 'string',
          description: 'File content (text or base64-encoded for binary)',
        },
        encoding: {
          type: 'string',
          enum: ['text', 'base64'],
          description: 'Content encoding: "text" (default) or "base64" for binary files',
        },
      },
      required: ['filename', 'location', 'content'],
    },
  },
  {
    name: 'download_file',
    description: 'Download a file from the NetScaler filesystem. Useful for retrieving certificates, configs, backups, or log files. Requires SSH (key or password auth).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Full path to the file on NetScaler (e.g., "/nsconfig/ssl/cert.pem", "/var/nslog/newnslog")',
        },
        encoding: {
          type: 'string',
          enum: ['text', 'base64'],
          description: 'Output encoding: "text" (default) for text files, "base64" for binary files',
        },
      },
      required: ['path'],
    },
  },
];

// Initialize clients
let nitroClient: NitroClient | null = null;
let sshClient: SSHClient | null = null;

function getNitroClient(): NitroClient {
  if (!nitroClient) {
    nitroClient = new NitroClient({
      host: process.env.NS_HOST || '',
      username: process.env.NS_USER || 'nsroot',
      password: process.env.NS_PASS || '',
    });
  }
  return nitroClient;
}

function getSSHClient(): SSHClient {
  if (!sshClient) {
    sshClient = new SSHClient({
      host: process.env.NS_HOST || '',
      username: process.env.NS_USER || 'nsroot',
      privateKeyPath: process.env.SSH_KEY || '',
      password: process.env.NS_PASS || '',
    });
  }
  return sshClient;
}

/**
 * Check NetScaler connectivity via both NITRO API and SSH
 * Used by check_connection tool and /check HTTP endpoint
 */
async function checkNetScalerConnection(): Promise<{
  status: 'ok' | 'degraded' | 'unreachable';
  nitro: { ok: boolean; error?: string; latencyMs?: number };
  ssh: { ok: boolean; error?: string; latencyMs?: number };
  host: string;
}> {
  const host = process.env.NS_HOST || '';
  const results = {
    status: 'ok' as 'ok' | 'degraded' | 'unreachable',
    nitro: { ok: false, error: undefined as string | undefined, latencyMs: undefined as number | undefined },
    ssh: { ok: false, error: undefined as string | undefined, latencyMs: undefined as number | undefined },
    host,
  };

  // Test NITRO API connectivity
  const nitroStart = Date.now();
  try {
    const client = getNitroClient();
    await client.getSystemInfo();
    results.nitro.ok = true;
    results.nitro.latencyMs = Date.now() - nitroStart;
  } catch (error) {
    results.nitro.ok = false;
    results.nitro.error = error instanceof Error ? error.message : String(error);
    results.nitro.latencyMs = Date.now() - nitroStart;
  }

  // Test SSH connectivity (if SSH_KEY or NS_PASS is configured)
  const sshStart = Date.now();
  const hasSSHAuth = process.env.SSH_KEY || process.env.NS_PASS;
  if (hasSSHAuth) {
    try {
      const ssh = getSSHClient();
      const sshOk = await ssh.testConnection(5000);
      results.ssh.ok = sshOk;
      results.ssh.latencyMs = Date.now() - sshStart;
      if (!sshOk) {
        results.ssh.error = 'Connection failed or timed out';
      }
    } catch (error) {
      results.ssh.ok = false;
      results.ssh.error = error instanceof Error ? error.message : String(error);
      results.ssh.latencyMs = Date.now() - sshStart;
    }
  } else {
    results.ssh.error = 'SSH_KEY or NS_PASS required for SSH';
  }

  // Determine overall status
  if (results.nitro.ok && results.ssh.ok) {
    results.status = 'ok';
  } else if (results.nitro.ok || results.ssh.ok) {
    results.status = 'degraded';
  } else {
    results.status = 'unreachable';
  }

  return results;
}

// Tool handlers (internal implementation)
async function handleToolCallImpl(name: string, args: Record<string, unknown>): Promise<string> {
  const client = getNitroClient();

  switch (name) {
    case 'get_system_info': {
      const info = await client.getSystemInfo();
      return JSON.stringify(info, null, 2);
    }

    case 'list_vservers': {
      const vservers = await client.getLbVservers();
      if (args.include_stats) {
        const withStats = await Promise.all(
          vservers.map(async (vs) => {
            try {
              const stats = await client.getLbVserverStats(vs.name);
              return { ...vs, stats };
            } catch {
              return vs;
            }
          })
        );
        return JSON.stringify(withStats, null, 2);
      }
      return JSON.stringify(vservers, null, 2);
    }

    case 'get_vserver_status': {
      const name = args.name as string;
      const stats = await client.getLbVserverStats(name);
      const bindings = await client.getLbVserverBindings(name);
      return JSON.stringify({ stats, bindings }, null, 2);
    }

    case 'backup_config': {
      const config = await client.getConfig();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const description = args.description || 'MCP backup';
      return JSON.stringify({
        timestamp,
        description,
        config,
        lines: config.split('\n').length,
      }, null, 2);
    }

    case 'deploy_config': {
      const configContent = args.config as string;
      const clearFirst = args.clear_first as boolean;
      const provisionCerts = args.provision_test_certs as boolean;

      // Reorder config for dependency safety
      const reorderedConfig = reorderConfig(configContent);

      const ssh = getSSHClient();
      let certOutput = '';

      if (clearFirst) {
        // Clear existing config first using SSH (fast, complete)
        await ssh.execute('clear ns config -force basic');
        // Also clean up user cert files
        try {
          await ssh.execute(
            'shell \'cd /nsconfig/ssl && for f in *.pem *.cer *.crt *.key *.req *.pfx; do ' +
            'case "$f" in ns-server.*|ns-sftrust.*|ns-root.*|"*.pem"|"*.cer"|"*.crt"|"*.key"|"*.req"|"*.pfx") ;; *) rm -f "$f" 2>/dev/null ;; esac; done\''
          );
        } catch {
          // Ignore cert cleanup errors
        }
      }

      if (provisionCerts) {
        // Provision test certificates before deploying
        log.info('Provisioning test certificates');
        certOutput = await provisionTestCertificates(configContent, ssh);
        log.info('Certificate provisioning complete', { output: certOutput });
      }

      // Deploy via SSH batch command
      log.info('Deploying config via SSH batch');
      const result = await ssh.executeBatch(reorderedConfig);

      return JSON.stringify({
        success: true,
        message: 'Configuration deployed',
        linesDeployed: reorderedConfig.split('\n').filter(l => l.trim()).length,
        certOutput: certOutput || undefined,
        output: result,
      }, null, 2);
    }

    case 'clear_config': {
      if (!args.confirm) {
        return JSON.stringify({
          error: 'Must set confirm=true to clear configuration',
        });
      }
      const ssh = getSSHClient();

      // If SSH is available, use fast 'clear ns config -force basic' command
      // This preserves network settings (NSIP, SNIP, routes) but clears all app config
      if (ssh) {
        const clearResult = await ssh.execute('clear ns config -force basic');

        // Also clean up user cert files (clear ns config doesn't remove files)
        // Preserves: ns-server.*, ns-sftrust.*, and directories
        let certCleanup = '';
        try {
          certCleanup = await ssh.execute(
            'shell \'cd /nsconfig/ssl && for f in *.pem *.cer *.crt *.key *.req *.pfx; do ' +
            'case "$f" in ns-server.*|ns-sftrust.*|ns-root.*|"*.pem"|"*.cer"|"*.crt"|"*.key"|"*.req"|"*.pfx") ;; *) rm -f "$f" 2>/dev/null ;; esac; done\''
          );
        } catch {
          // Ignore cert cleanup errors
        }

        return JSON.stringify({
          success: true,
          message: 'Application configuration cleared via SSH (basic level + cert cleanup)',
          details: clearResult,
          certCleanup: certCleanup || undefined,
        });
      }

      // Fallback to NITRO API-based selective clearing (slower)
      await clearApplicationConfig(client, ssh);
      return JSON.stringify({
        success: true,
        message: 'Application configuration cleared (including cert files)',
      });
    }

    case 'list_certificates': {
      const certs = await client.getSSLCertKeys();
      const expiringWithin = args.expiring_within_days as number | undefined;

      let filtered = certs;
      if (expiringWithin !== undefined) {
        const cutoff = Date.now() + expiringWithin * 24 * 60 * 60 * 1000;
        filtered = certs.filter(c => {
          const expiry = new Date(c.clientcertnotafter || 0).getTime();
          return expiry < cutoff;
        });
      }

      return JSON.stringify(filtered, null, 2);
    }

    case 'upload_certificate': {
      const certName = args.name as string;
      const certContent = args.cert_content as string;
      const keyContent = args.key_content as string;

      // Sanitize name for file path
      const safeName = certName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const certPath = `/nsconfig/ssl/${safeName}.cert`;
      const keyPath = `/nsconfig/ssl/${safeName}.key`;

      // Upload cert and key files via NITRO systemfile API
      await client.post('/config/systemfile', {
        systemfile: {
          filename: `${safeName}.cert`,
          filelocation: '/nsconfig/ssl',
          filecontent: Buffer.from(certContent).toString('base64'),
          fileencoding: 'BASE64',
        },
      });

      await client.post('/config/systemfile', {
        systemfile: {
          filename: `${safeName}.key`,
          filelocation: '/nsconfig/ssl',
          filecontent: Buffer.from(keyContent).toString('base64'),
          fileencoding: 'BASE64',
        },
      });

      // Add the SSL certkey
      await client.post('/config/sslcertkey', {
        sslcertkey: {
          certkey: certName,
          cert: certPath,
          key: keyPath,
        },
      });

      return JSON.stringify({
        success: true,
        message: `Certificate '${certName}' uploaded and added`,
        certPath,
        keyPath,
      });
    }

    case 'get_running_config': {
      const section = args.section as string | undefined;
      const config = await client.getConfig(section);
      return config;
    }

    case 'save_config': {
      await client.saveConfig();
      return JSON.stringify({ success: true, message: 'Configuration saved' });
    }

    case 'provision_test_certs': {
      const configContent = args.config as string;
      const ssh = getSSHClient();

      // Parse config to find SSL certKey entries
      const certKeyPattern = /^add ssl certKey\s+(\S+)\s+-cert\s+(\S+)\s+-key\s+(\S+)/gm;
      const certKeys: Array<{ name: string; certFile: string; keyFile: string }> = [];

      let match;
      while ((match = certKeyPattern.exec(configContent)) !== null) {
        certKeys.push({
          name: match[1],
          certFile: match[2].replace(/^["']|["']$/g, ''),  // Strip quotes
          keyFile: match[3].replace(/^["']|["']$/g, ''),
        });
      }

      if (certKeys.length === 0) {
        return JSON.stringify({
          success: true,
          message: 'No SSL certKey entries found in config',
          provisioned: [],
        });
      }

      // Build batch commands to generate certs on NetScaler
      const batchCommands: string[] = [];
      const provisioned: string[] = [];

      for (const cert of certKeys) {
        // Derive file paths
        const certPath = cert.certFile.startsWith('/') ? cert.certFile : `/nsconfig/ssl/${cert.certFile}`;
        const keyPath = cert.keyFile.startsWith('/') ? cert.keyFile : `/nsconfig/ssl/${cert.keyFile}`;

        // Use certkey name for the generated files
        const baseName = cert.name.replace(/\.cer$/, '');
        const keyFullPath = keyPath.includes('/') ? keyPath : `/nsconfig/ssl/${baseName}.key`;
        const reqFullPath = `/nsconfig/ssl/${baseName}.req`;
        const certFullPath = certPath.includes('/') ? certPath : `/nsconfig/ssl/${baseName}.cer`;

        // NetScaler native commands to generate self-signed cert
        batchCommands.push(`create ssl rsakey ${keyFullPath} 2048`);
        batchCommands.push(`create ssl certreq ${reqFullPath} -keyfile ${keyFullPath} -countryName US -stateName Test -organizationName TestOrg -commonName ${baseName}`);
        batchCommands.push(`create ssl cert ${certFullPath} ${reqFullPath} ROOT -keyfile ${keyFullPath} -days 365`);
        provisioned.push(cert.name);
      }

      // Execute batch commands via SSH
      const result = await ssh.executeBatch(batchCommands.join('\n'));

      return JSON.stringify({
        success: true,
        message: `Provisioned ${provisioned.length} test certificates`,
        provisioned,
        output: result,
      }, null, 2);
    }

    case 'check_connection': {
      const result = await checkNetScalerConnection();
      return JSON.stringify(result, null, 2);
    }

    case 'create_system_backup': {
      const description = (args.description as string) || 'backup';
      const level = (args.level as string) || 'full';
      const comment = args.comment as string | undefined;

      // Get hostname for filename
      const sysInfo = await client.getSystemInfo();
      const hostname = sysInfo.hostname || process.env.NS_HOST || 'netscaler';
      const safeHostname = hostname.replace(/[^a-zA-Z0-9_-]/g, '_');

      // Generate filename: <description>_<hostname>_<date>
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const backupName = `${description}_${safeHostname}_${date}`;

      // Create backup via SSH (NITRO API has issues with this endpoint)
      const ssh = getSSHClient();
      let cmd = `create system backup ${backupName} -level ${level}`;
      if (comment) {
        cmd += ` -comment "${comment.replace(/"/g, '\\"')}"`;
      }
      const result = await ssh.execute(cmd);

      return JSON.stringify({
        success: true,
        message: `System backup created: ${backupName}.tgz`,
        filename: `${backupName}.tgz`,
        level,
        location: '/var/ns_sys_backup/',
        output: result,
      }, null, 2);
    }

    case 'list_system_backups': {
      interface BackupFile { filename: string; size?: string; creationtime?: string; version?: string; comment?: string }
      interface BackupListResponse { errorcode: number; message: string; systembackup?: BackupFile[] }

      const response = await client.get<BackupListResponse>('/config/systembackup');
      const backups = response.systembackup || [];

      return JSON.stringify({
        success: true,
        count: backups.length,
        backups: backups.map(b => ({
          filename: b.filename,
          size: b.size,
          created: b.creationtime,
          version: b.version,
          comment: b.comment,
        })),
      }, null, 2);
    }

    case 'download_system_backup': {
      const filename = args.filename as string;

      // Remove .tgz extension if provided (NITRO expects name without extension)
      const backupName = filename.replace(/\.tgz$/, '');

      // Get file content via NITRO systemfile API
      interface FileResponse {
        errorcode: number;
        message: string;
        systemfile?: { filename: string; filecontent: string; fileencoding: string }[]
      }

      const response = await client.get<FileResponse>(
        `/config/systemfile/${encodeURIComponent(backupName + '.tgz')}?args=filelocation:${encodeURIComponent('/var/ns_sys_backup')}`
      );

      if (!response.systemfile || response.systemfile.length === 0) {
        throw new Error(`Backup file not found: ${filename}`);
      }

      const file = response.systemfile[0];

      return JSON.stringify({
        success: true,
        filename: file.filename,
        encoding: 'base64',
        content: file.filecontent,
        size: Buffer.from(file.filecontent, 'base64').length,
      }, null, 2);
    }

    case 'delete_system_backup': {
      const filename = args.filename as string;
      const backupName = filename.replace(/\.tgz$/, '');

      await client.delete(`/config/systembackup/${encodeURIComponent(backupName)}`);

      return JSON.stringify({
        success: true,
        message: `Backup deleted: ${filename}`,
      });
    }

    case 'upload_file': {
      const filename = args.filename as string;
      const location = args.location as string;
      const content = args.content as string;
      const encoding = (args.encoding as string) || 'text';

      // Decode content if base64
      const fileContent = encoding === 'base64'
        ? Buffer.from(content, 'base64')
        : content;

      const remotePath = `${location}/${filename}`;
      const ssh = getSSHClient();

      // Prefer SFTP for file uploads (more reliable than NITRO)
      if (ssh) {
        await ssh.uploadFile(remotePath, fileContent);
        return JSON.stringify({
          success: true,
          message: `File uploaded via SFTP: ${remotePath}`,
          path: remotePath,
        });
      }

      // Fallback to NITRO API
      const base64Content = encoding === 'base64'
        ? content
        : Buffer.from(content).toString('base64');

      await client.post('/config/systemfile', {
        systemfile: {
          filename: filename,
          filelocation: location,
          filecontent: base64Content,
          fileencoding: 'BASE64',
        },
      });

      return JSON.stringify({
        success: true,
        message: `File uploaded via NITRO: ${remotePath}`,
        path: remotePath,
      });
    }

    case 'download_file': {
      const filePath = args.path as string;
      const encoding = (args.encoding as string) || 'text';

      const ssh = getSSHClient();
      const content = await ssh.downloadFile(filePath);

      if (encoding === 'base64') {
        return JSON.stringify({
          success: true,
          path: filePath,
          encoding: 'base64',
          content: Buffer.from(content).toString('base64'),
        });
      }

      return JSON.stringify({
        success: true,
        path: filePath,
        encoding: 'text',
        content: content,
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Provision test certificates for SSL certKey entries in config
 * Generates self-signed certs directly on NetScaler using individual commands
 * (batch mode throws on any error, individual commands allow partial success)
 */
async function provisionTestCertificates(configContent: string, ssh: SSHClient): Promise<string> {
  // Parse config to find SSL certKey entries
  const certKeyPattern = /^add ssl certKey\s+(\S+)\s+-cert\s+(\S+)\s+-key\s+(\S+)/gm;
  const certKeys: Array<{ name: string; certFile: string; keyFile: string }> = [];

  let match;
  while ((match = certKeyPattern.exec(configContent)) !== null) {
    certKeys.push({
      name: match[1],
      certFile: match[2].replace(/^["']|["']$/g, ''),  // Strip quotes
      keyFile: match[3].replace(/^["']|["']$/g, ''),
    });
  }

  if (certKeys.length === 0) {
    return '';
  }

  const results: string[] = [];

  for (const cert of certKeys) {
    // Derive file paths
    const certPath = cert.certFile.startsWith('/') ? cert.certFile : `/nsconfig/ssl/${cert.certFile}`;
    const keyPath = cert.keyFile.startsWith('/') ? cert.keyFile : `/nsconfig/ssl/${cert.keyFile}`;

    // Use certkey name for the generated files
    const baseName = cert.name.replace(/\.cer$/, '');
    const keyFullPath = keyPath.includes('/') ? keyPath : `/nsconfig/ssl/${baseName}.key`;
    const reqFullPath = `/nsconfig/ssl/${baseName}.req`;
    const certFullPath = certPath.includes('/') ? certPath : `/nsconfig/ssl/${baseName}.cer`;

    try {
      // Generate RSA key
      await ssh.execute(`create ssl rsakey ${keyFullPath} 2048`);
      // Generate CSR
      await ssh.execute(`create ssl certreq ${reqFullPath} -keyfile ${keyFullPath} -countryName US -stateName Test -organizationName TestOrg -commonName ${baseName}`);
      // Generate self-signed cert
      await ssh.execute(`create ssl cert ${certFullPath} ${reqFullPath} ROOT -keyfile ${keyFullPath} -days 365`);
      results.push(`Created: ${baseName}`);
    } catch (error) {
      results.push(`Failed: ${baseName} - ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Verify files were created
  try {
    const listing = await ssh.execute('shell "ls -la /nsconfig/ssl/*.cer /nsconfig/ssl/*.key 2>/dev/null | grep -v ns-"');
    results.push('Files created:', listing);
  } catch {
    results.push('Warning: Could not verify cert files');
  }

  return results.join('\n');
}

/**
 * Clear application configuration via NITRO API
 * Deletes objects in reverse dependency order
 *
 * WARNING: Do NOT use 'clear ns config -force extended' - it resets the NSIP and breaks Azure NAT!
 */
async function clearApplicationConfig(client: NitroClient, ssh?: SSHClient): Promise<void> {
  const deleteResource = async (path: string): Promise<void> => {
    try {
      await client.delete(path);
    } catch {
      // Ignore errors - resource may not exist or may be protected
    }
  };

  // 1. CS vservers (must be deleted before CS policies/actions)
  const csVservers = await client.getCsVservers();
  for (const vs of csVservers) {
    await deleteResource(`/config/csvserver/${encodeURIComponent(vs.name)}`);
  }

  // 2. LB vservers (must delete before policies that may be bound to them)
  const lbVservers = await client.getLbVservers();
  for (const vs of lbVservers) {
    await deleteResource(`/config/lbvserver/${encodeURIComponent(vs.name)}`);
  }

  // 3. GSLB vservers
  interface GSLBVserverResponse { errorcode: number; message: string; gslbvserver?: Array<{ name: string }> }
  try {
    const gslbVserversResp = await client.get<GSLBVserverResponse>('/config/gslbvserver');
    for (const vs of gslbVserversResp.gslbvserver || []) {
      await deleteResource(`/config/gslbvserver/${encodeURIComponent(vs.name)}`);
    }
  } catch { /* no GSLB vservers */ }

  // 3a. GSLB services (must delete after vservers)
  interface GSLBServiceResponse { errorcode: number; message: string; gslbservice?: Array<{ servicename: string }> }
  try {
    const gslbServicesResp = await client.get<GSLBServiceResponse>('/config/gslbservice');
    for (const svc of gslbServicesResp.gslbservice || []) {
      await deleteResource(`/config/gslbservice/${encodeURIComponent(svc.servicename)}`);
    }
  } catch { /* no GSLB services */ }

  // 3b. GSLB sites (must delete after services)
  interface GSLBSiteResponse { errorcode: number; message: string; gslbsite?: Array<{ sitename: string }> }
  try {
    const gslbSitesResp = await client.get<GSLBSiteResponse>('/config/gslbsite');
    for (const site of gslbSitesResp.gslbsite || []) {
      await deleteResource(`/config/gslbsite/${encodeURIComponent(site.sitename)}`);
    }
  } catch { /* no GSLB sites */ }

  // 4. CS policies
  interface CSPolicyResponse { errorcode: number; message: string; cspolicy?: Array<{ policyname: string }> }
  try {
    const csPoliciesResp = await client.get<CSPolicyResponse>('/config/cspolicy');
    for (const pol of csPoliciesResp.cspolicy || []) {
      await deleteResource(`/config/cspolicy/${encodeURIComponent(pol.policyname)}`);
    }
  } catch { /* no CS policies */ }

  // 3. CS actions
  interface CSActionResponse { errorcode: number; message: string; csaction?: Array<{ name: string }> }
  try {
    const csActionsResp = await client.get<CSActionResponse>('/config/csaction');
    for (const action of csActionsResp.csaction || []) {
      await deleteResource(`/config/csaction/${encodeURIComponent(action.name)}`);
    }
  } catch { /* no CS actions */ }

  // 4. Responder policies
  interface ResponderPolicyResponse { errorcode: number; message: string; responderpolicy?: Array<{ name: string }> }
  try {
    const responderPoliciesResp = await client.get<ResponderPolicyResponse>('/config/responderpolicy');
    for (const pol of responderPoliciesResp.responderpolicy || []) {
      if (!pol.name.startsWith('ns_')) {
        await deleteResource(`/config/responderpolicy/${encodeURIComponent(pol.name)}`);
      }
    }
  } catch { /* no responder policies */ }

  // 5. Responder actions (skip system actions starting with ns_)
  interface ResponderActionResponse { errorcode: number; message: string; responderaction?: Array<{ name: string }> }
  try {
    const responderActionsResp = await client.get<ResponderActionResponse>('/config/responderaction');
    for (const action of responderActionsResp.responderaction || []) {
      if (!action.name.startsWith('ns_')) {
        await deleteResource(`/config/responderaction/${encodeURIComponent(action.name)}`);
      }
    }
  } catch { /* no responder actions */ }

  // 6. Rewrite policies (skip system policies starting with ns_)
  interface RewritePolicyResponse { errorcode: number; message: string; rewritepolicy?: Array<{ name: string }> }
  try {
    const rewritePoliciesResp = await client.get<RewritePolicyResponse>('/config/rewritepolicy');
    for (const pol of rewritePoliciesResp.rewritepolicy || []) {
      if (!pol.name.startsWith('ns_')) {
        await deleteResource(`/config/rewritepolicy/${encodeURIComponent(pol.name)}`);
      }
    }
  } catch { /* no rewrite policies */ }

  // 7. Rewrite actions (skip system actions starting with ns_)
  interface RewriteActionResponse { errorcode: number; message: string; rewriteaction?: Array<{ name: string }> }
  try {
    const rewriteActionsResp = await client.get<RewriteActionResponse>('/config/rewriteaction');
    for (const action of rewriteActionsResp.rewriteaction || []) {
      if (!action.name.startsWith('ns_')) {
        await deleteResource(`/config/rewriteaction/${encodeURIComponent(action.name)}`);
      }
    }
  } catch { /* no rewrite actions */ }

  // 10. Services
  interface ServiceResponse { errorcode: number; message: string; service?: Array<{ name: string }> }
  try {
    const servicesResp = await client.get<ServiceResponse>('/config/service');
    for (const svc of servicesResp.service || []) {
      await deleteResource(`/config/service/${encodeURIComponent(svc.name)}`);
    }
  } catch { /* no services */ }

  // 11. Service groups
  interface SGResponse { errorcode: number; message: string; servicegroup?: Array<{ servicegroupname: string }> }
  try {
    const sgResp = await client.get<SGResponse>('/config/servicegroup');
    for (const sg of sgResp.servicegroup || []) {
      await deleteResource(`/config/servicegroup/${encodeURIComponent(sg.servicegroupname)}`);
    }
  } catch { /* no service groups */ }

  // 12. Servers (skip internal)
  interface ServerResponse { errorcode: number; message: string; server?: Array<{ name: string; internal?: string }> }
  try {
    const serversResp = await client.get<ServerResponse>('/config/server');
    for (const srv of serversResp.server || []) {
      if (srv.internal !== 'True') {
        await deleteResource(`/config/server/${encodeURIComponent(srv.name)}`);
      }
    }
  } catch { /* no servers */ }

  // 13. Custom monitors (skip built-in system monitors)
  const systemMonitors = new Set([
    'ping-default', 'tcp-default', 'arp', 'nd6', 'ping', 'tcp', 'http', 'tcp-ecv',
    'http-ecv', 'udp-ecv', 'dns', 'ftp', 'tcps', 'https', 'tcps-ecv', 'https-ecv',
    'xdm', 'xnc', 'mqtt', 'mqtt-tls', 'http2direct', 'http2ssl', 'ldns-ping',
    'ldns-tcp', 'ldns-dns', 'stasecure', 'sta'
  ]);
  interface MonitorResponse { errorcode: number; message: string; lbmonitor?: Array<{ monitorname: string; type: string }> }
  try {
    const monitorsResp = await client.get<MonitorResponse>('/config/lbmonitor');
    for (const mon of monitorsResp.lbmonitor || []) {
      if (!systemMonitors.has(mon.monitorname)) {
        await deleteResource(`/config/lbmonitor/${encodeURIComponent(mon.monitorname)}?args=type:${mon.type}`);
      }
    }
  } catch { /* no monitors */ }

  // 14. SSL certkeys (skip known system certificates by name)
  const systemCertKeys = new Set(['ns-server-certificate', 'ns-sftrust-certificate']);
  interface SSLCertKeyResponse { errorcode: number; message: string; sslcertkey?: Array<{ certkey: string }> }
  try {
    const sslCertKeysResp = await client.get<SSLCertKeyResponse>('/config/sslcertkey');
    for (const cert of sslCertKeysResp.sslcertkey || []) {
      // Skip known system certificates by name
      if (!systemCertKeys.has(cert.certkey)) {
        await deleteResource(`/config/sslcertkey/${encodeURIComponent(cert.certkey)}`);
      }
    }
  } catch { /* no SSL certkeys */ }

  // 15. Custom SSL cipher groups (skip built-in)
  const builtinCiphers = new Set([
    'DEFAULT', 'DEFAULT_BACKEND', 'AES', 'AES-GCM', 'DES', 'RC2', 'RC4', 'DH',
    'EDH', 'ECDHE', 'eRSA', 'aDH', 'aNULL', 'kRSA', 'EXPORT', 'EXP40', 'EXP56',
    'MD5', 'SHA', 'SHA1', 'SHA256', 'SHA384', 'NULL', 'TLS1', 'TLS11', 'TLS12',
    'TLS13', 'SSLv2', 'SSLv3', 'FIPS', 'MEDIUM', 'HIGH', 'LOW', 'SECURE', 'SECURE_BE'
  ]);
  interface SSLCipherResponse { errorcode: number; message: string; sslcipher?: Array<{ ciphergroupname: string }> }
  try {
    const ciphersResp = await client.get<SSLCipherResponse>('/config/sslcipher');
    for (const cipher of ciphersResp.sslcipher || []) {
      if (!builtinCiphers.has(cipher.ciphergroupname)) {
        await deleteResource(`/config/sslcipher/${encodeURIComponent(cipher.ciphergroupname)}`);
      }
    }
  } catch { /* no custom cipher groups */ }

  // 16. Clean up cert files via SSH (if SSH client provided)
  // Skip system certs: ns-server.*, ns-sftrust.*
  if (ssh) {
    try {
      // Remove non-system cert/key/req files from /nsconfig/ssl/
      // Preserves: ns-server.*, ns-sftrust.*, and directories
      await ssh.execute(
        'cd /nsconfig/ssl && for f in *.pem *.cer *.crt *.key *.req *.pfx; do ' +
        'case "$f" in ns-server.*|ns-sftrust.*) ;; *) rm -f "$f" 2>/dev/null ;; esac; done'
      );
    } catch { /* ignore SSH errors */ }
  }

  // Small delay for NetScaler to process deletions
  await new Promise(resolve => setTimeout(resolve, 1000));
}

// Wrapper function with logging and telemetry
async function handleToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  const startTime = Date.now();
  log.info(`Tool call started: ${name}`, { tool: name, args: redactArgs(args) });

  try {
    const result = await handleToolCallImpl(name, args);
    const durationMs = Date.now() - startTime;
    logToolCall(name, args, { success: true }, durationMs);
    telemetry.capture(name, durationMs, true);
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    logToolCall(name, args, { success: false, error: errorMsg }, durationMs);
    telemetry.capture(name, durationMs, false, classifyError(error));
    throw error;
  }
}

// Redact sensitive data from args for logging
function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...args };
  if ('config' in redacted && typeof redacted.config === 'string') {
    redacted.config = `[${(redacted.config as string).length} chars]`;
  }
  return redacted;
}

// Create and configure MCP server
function createServer(): Server {
  const server = new Server(
    {
      name: 'flipperagents-ns-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await handleToolCall(name, args as Record<string, unknown>);
      return {
        content: [{ type: 'text', text: result }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// Main entry point
async function main(): Promise<void> {
  const httpPort = process.env.HTTP_PORT ? parseInt(process.env.HTTP_PORT, 10) : null;

  if (httpPort) {
    // HTTP/SSE transport mode
    const server = createServer();
    // Register tool handler for synchronous /api/call endpoint
    setToolHandler(handleToolCall);
    // Register connection checker for /check endpoint
    setConnectionChecker(async () => {
      const result = await checkNetScalerConnection();
      return { nitro: result.nitro.ok, ssh: result.ssh.ok };
    });
    // Register shutdown handler for telemetry capture
    setShutdownHandler(async (reason: string) => {
      log.info('Shutdown handler called', { reason });
      telemetry.lifecycle('shutdown', { reason });
      await telemetry.flush();
    });
    telemetry.lifecycle('startup', { transport: 'http', port: httpPort });
    startHttpTransport(server, httpPort);
  } else {
    // Default: stdio transport (for Claude Desktop)
    log.debug('Initializing stdio transport');

    // Preprocess stdin to ensure proper line termination
    // The MCP SDK expects newline-terminated JSON-RPC messages
    const { Transform } = await import('stream');
    let lastChunkRef: Buffer | null = null;
    const lineTerminator = new Transform({
      transform(chunk: Buffer, _encoding: string, callback: (error?: Error | null, data?: Buffer) => void) {
        // Pass through data unchanged - we'll add newline on flush if needed
        lastChunkRef = chunk;
        callback(null, chunk);
      },
      flush(callback: (error?: Error | null, data?: Buffer) => void) {
        // If last chunk didn't end with newline, add one
        if (lastChunkRef && lastChunkRef.length > 0 && lastChunkRef[lastChunkRef.length - 1] !== 0x0a) {
          log.debug('Adding missing newline to stdin stream');
          callback(null, Buffer.from('\n'));
        } else {
          callback();
        }
      }
    });

    // Debug: Monitor stdin for data
    let stdinBytesReceived = 0;
    process.stdin.on('data', (chunk) => {
      stdinBytesReceived += chunk.length;
      log.debug('stdin received data', {
        chunkSize: chunk.length,
        totalReceived: stdinBytesReceived,
        preview: chunk.toString().slice(0, 100) + (chunk.length > 100 ? '...' : '')
      });
    });

    process.stdin.on('end', () => {
      log.debug('stdin stream ended', { totalBytesReceived: stdinBytesReceived });
    });

    process.stdin.on('error', (err) => {
      log.error('stdin error', { error: err.message });
    });

    // Pipe stdin through line terminator
    const processedStdin = process.stdin.pipe(lineTerminator);

    const server = createServer();
    // Use custom readable for stdin with stdout for output
    const transport = new StdioServerTransport(processedStdin, process.stdout);

    log.debug('Connecting server to transport');
    await server.connect(transport);
    log.info('NetScaler MCP server started (stdio)', { pid: process.pid });
    telemetry.lifecycle('startup', { transport: 'stdio' });
  }
}

// Shutdown handlers - capture lifecycle event before telemetry flushes
process.on('SIGINT', async () => {
  log.info('Received SIGINT, shutting down');
  telemetry.lifecycle('shutdown', { reason: 'SIGINT' });
  await telemetry.flush();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log.info('Received SIGTERM, shutting down');
  telemetry.lifecycle('shutdown', { reason: 'SIGTERM' });
  await telemetry.flush();
  process.exit(0);
});

main().catch(console.error);
