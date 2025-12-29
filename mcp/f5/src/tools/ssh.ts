/**
 * SSH Tools
 * 
 * Persistent SSH sessions for real-time log streaming and troubleshooting.
 * 
 * USE CASES:
 * 
 * 1. License Activation Monitoring
 *    - Start tailing /var/log/ltm before license operation
 *    - Watch for "license" and "mcpd" messages
 *    - Catch errors immediately instead of post-mortem
 * 
 * 2. Software Upgrade Monitoring  
 *    - Tail /var/log/ltm during image installation
 *    - Watch /var/log/liveinstall for install progress
 *    - Monitor reboot and service startup
 * 
 * 3. HA Failover Monitoring
 *    - Watch /var/log/ltm for failover events
 *    - Monitor traffic flow during transition
 *    - Catch sync errors in real-time
 * 
 * 4. Troubleshooting Sessions
 *    - Long-running tcpdump captures
 *    - Watching multiple log files simultaneously
 *    - Interactive debugging when REST isn't enough
 * 
 * WHY SSH INSTEAD OF REST?
 * - REST bash_execute is stateless (no streaming)
 * - Some operations need persistent shell (tail -f, tcpdump)
 * - Real-time output vs polling
 * - Interactive commands
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { SSHClient, SSHConfig } from '../lib/ssh-client.js';

// Global SSH client instance
let sshClient: SSHClient | null = null;

export const sshTools: Tool[] = [
  {
    name: 'ssh_connect',
    description: `Establish SSH connection to BIG-IP for shell access.

Separate from REST API connection - used for:
- Real-time log streaming (tail -f)
- Long-running commands (tcpdump, watch)
- Interactive troubleshooting
- Operations that don't work well over REST

Credentials default to root with same password as REST connection.
SSH is on port 22 (vs 443 for REST).

>>> REQUIRED before using other ssh_* tools <<<

Related tools:
- ssh_execute: Run shell commands
- ssh_tail_start: Start log streaming
- ssh_disconnect: Close SSH session
- connect: REST API connection (separate)`,
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'BIG-IP hostname/IP (defaults to REST connection host)',
        },
        port: {
          type: 'number',
          description: 'SSH port (default: 22)',
        },
        username: {
          type: 'string',
          description: 'SSH username (default: root)',
        },
        password: {
          type: 'string',
          description: 'SSH password (defaults to REST connection password)',
        },
        private_key: {
          type: 'string',
          description: 'Private key content for key-based auth',
        },
      },
    },
  },
  {
    name: 'ssh_disconnect',
    description: `Close SSH connection and stop all tail sessions.

Use when:
- Done with troubleshooting session
- Switching to different device
- Cleaning up resources

All active tail sessions are automatically stopped.

Related tools:
- ssh_connect: Establish new connection
- ssh_tail_list: Check active sessions before disconnect`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ssh_execute',
    description: `Execute a shell command via SSH and return output.

Similar to bash_execute but via SSH instead of REST API.

Use for:
- Commands that need a real shell environment
- When REST API is unresponsive
- Commands with special characters that REST escapes poorly
- Verifying SSH connectivity

For streaming/long-running output, use ssh_tail_start instead.

Related tools:
- bash_execute: REST-based command execution
- ssh_tail_start: For streaming output
- tmsh_execute: For tmsh commands (REST)`,
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute',
        },
        timeout_ms: {
          type: 'number',
          description: 'Command timeout in milliseconds (default: 30000)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'ssh_tail_start',
    description: `Start tailing a log file in the background.

>>> KEY TOOL for monitoring operations in real-time <<<

Returns a session ID. Output buffers in memory until you read it
with ssh_tail_read. Multiple tail sessions can run simultaneously.

Common log files:
- /var/log/ltm - LTM events, licensing, general operations
- /var/log/audit - Configuration changes, logins
- /var/log/liveinstall - Software installation progress
- /var/log/ts/bd.log - ASM/WAF logs
- /var/log/apm - APM authentication logs
- /var/log/gtm - GTM/DNS logs

Example workflow - License Update:
1. ssh_tail_start: /var/log/ltm
2. license_activate_airgapped: Do the activation
3. ssh_tail_read: See what happened
4. ssh_tail_stop: Done monitoring

Example workflow - Software Upgrade:
1. ssh_tail_start: /var/log/ltm
2. ssh_tail_start: /var/log/liveinstall (second session)
3. [install image to volume]
4. ssh_tail_read: Check both sessions periodically
5. [reboot]
6. ssh_tail_stop: Cleanup

Related tools:
- ssh_tail_read: Get buffered output
- ssh_tail_stop: Stop a tail session
- ssh_tail_list: List active sessions
- logs_get: One-shot log retrieval (REST)`,
    inputSchema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Log file path to tail (e.g., /var/log/ltm)',
        },
        max_lines: {
          type: 'number',
          description: 'Maximum lines to buffer (default: 1000). Oldest lines dropped when exceeded.',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'ssh_tail_read',
    description: `Read buffered output from a tail session.

Call periodically during long operations to see log output.
By default, clears the buffer after reading (set clear=false to peek).

Returns:
- lines: Array of log lines since last read
- stats: Session info (total lines seen, buffer size, etc.)

If session not found, returns null - session may have been stopped
or SSH connection lost.

Related tools:
- ssh_tail_start: Start a new session
- ssh_tail_list: Find session IDs
- ssh_tail_stop: Stop when done`,
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Session ID from ssh_tail_start',
        },
        clear: {
          type: 'boolean',
          description: 'Clear buffer after reading (default: true)',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'ssh_tail_stop',
    description: `Stop a tail session.

Always stop sessions when done to free resources.
Returns false if session not found (already stopped or invalid ID).

Related tools:
- ssh_tail_start: Start new session
- ssh_tail_list: Find active sessions
- ssh_disconnect: Stops ALL sessions`,
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Session ID from ssh_tail_start',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'ssh_tail_list',
    description: `List all active tail sessions.

Shows for each session:
- sessionId: For use with ssh_tail_read/stop
- file: Which log file
- startTime: When session started
- totalLines: Total lines seen
- bufferedLines: Lines waiting to be read

Use to find forgotten sessions or verify setup before operations.

Related tools:
- ssh_tail_start: Create new session
- ssh_tail_read: Read from session
- ssh_tail_stop: Stop a session`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export async function handleSSHTool(
  name: string,
  args: Record<string, unknown>,
  restHost?: string,
  restPassword?: string
): Promise<string> {
  switch (name) {
    case 'ssh_connect': {
      // Use REST connection info as defaults
      const host = (args.host as string) || restHost;
      const password = (args.password as string) || restPassword;

      if (!host) {
        return JSON.stringify({
          success: false,
          error: 'No host specified and no REST connection to derive from',
        }, null, 2);
      }

      if (!password && !args.private_key) {
        return JSON.stringify({
          success: false,
          error: 'Either password or private_key required',
        }, null, 2);
      }

      const config: SSHConfig = {
        host,
        port: (args.port as number) || 22,
        username: (args.username as string) || 'root',
        password,
        privateKey: args.private_key as string,
      };

      // Close existing connection if any
      if (sshClient) {
        await sshClient.disconnect();
      }

      sshClient = new SSHClient(config);
      await sshClient.connect();

      return JSON.stringify({
        success: true,
        message: `SSH connected to ${host}:${config.port} as ${config.username}`,
        host,
        port: config.port,
        username: config.username,
      }, null, 2);
    }

    case 'ssh_disconnect': {
      if (!sshClient) {
        return JSON.stringify({
          success: true,
          message: 'No SSH connection to close',
        }, null, 2);
      }

      await sshClient.disconnect();
      sshClient = null;

      return JSON.stringify({
        success: true,
        message: 'SSH disconnected',
      }, null, 2);
    }

    case 'ssh_execute': {
      if (!sshClient?.isConnected()) {
        return JSON.stringify({
          success: false,
          error: 'SSH not connected. Use ssh_connect first.',
        }, null, 2);
      }

      const command = args.command as string;
      const timeoutMs = (args.timeout_ms as number) || 30000;

      const output = await sshClient.execute(command, timeoutMs);

      return JSON.stringify({
        success: true,
        command,
        output,
      }, null, 2);
    }

    case 'ssh_tail_start': {
      if (!sshClient?.isConnected()) {
        return JSON.stringify({
          success: false,
          error: 'SSH not connected. Use ssh_connect first.',
        }, null, 2);
      }

      const file = args.file as string;
      const maxLines = (args.max_lines as number) || 1000;

      const sessionId = await sshClient.tailStart(file, maxLines);

      return JSON.stringify({
        success: true,
        session_id: sessionId,
        file,
        max_lines: maxLines,
        message: `Now tailing ${file}. Use ssh_tail_read with session_id "${sessionId}" to get output.`,
      }, null, 2);
    }

    case 'ssh_tail_read': {
      if (!sshClient?.isConnected()) {
        return JSON.stringify({
          success: false,
          error: 'SSH not connected',
        }, null, 2);
      }

      const sessionId = args.session_id as string;
      const clear = args.clear !== false; // default true

      const result = sshClient.tailRead(sessionId, clear);

      if (!result) {
        return JSON.stringify({
          success: false,
          error: `Session ${sessionId} not found. May have been stopped or SSH disconnected.`,
        }, null, 2);
      }

      return JSON.stringify({
        success: true,
        ...result,
      }, null, 2);
    }

    case 'ssh_tail_stop': {
      if (!sshClient?.isConnected()) {
        return JSON.stringify({
          success: false,
          error: 'SSH not connected',
        }, null, 2);
      }

      const sessionId = args.session_id as string;
      const stopped = sshClient.tailStop(sessionId);

      return JSON.stringify({
        success: stopped,
        session_id: sessionId,
        message: stopped ? 'Tail session stopped' : 'Session not found',
      }, null, 2);
    }

    case 'ssh_tail_list': {
      if (!sshClient?.isConnected()) {
        return JSON.stringify({
          success: true,
          connected: false,
          sessions: [],
          message: 'SSH not connected',
        }, null, 2);
      }

      const sessions = sshClient.tailList();

      return JSON.stringify({
        success: true,
        connected: true,
        count: sessions.length,
        sessions,
      }, null, 2);
    }

    default:
      throw new Error(`Unknown SSH tool: ${name}`);
  }
}

/**
 * Get current SSH client instance (for use by other modules)
 */
export function getSSHClient(): SSHClient | null {
  return sshClient;
}
