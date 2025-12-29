/**
 * SSH Client for BIG-IP
 * 
 * Provides persistent SSH sessions for:
 * - Real-time log tailing during operations
 * - Interactive troubleshooting
 * - Commands that don't work well over REST
 * 
 * Uses ssh2 library (pure JS, no native dependencies)
 */

import { Client, ClientChannel } from 'ssh2';
import { EventEmitter } from 'events';

export interface SSHConfig {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface TailSession {
  id: string;
  file: string;
  channel: ClientChannel;
  buffer: string[];
  maxLines: number;
  startTime: Date;
  lineCount: number;
}

export class SSHClient extends EventEmitter {
  private config: SSHConfig;
  private client: Client | null = null;
  private connected = false;
  private tailSessions: Map<string, TailSession> = new Map();
  private sessionIdCounter = 0;

  constructor(config: SSHConfig) {
    super();
    this.config = {
      port: 22,
      username: 'root',
      ...config,
    };
  }

  /**
   * Connect to BIG-IP via SSH
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.client = new Client();

      this.client.on('ready', () => {
        this.connected = true;
        resolve();
      });

      this.client.on('error', (err) => {
        this.connected = false;
        reject(err);
      });

      this.client.on('close', () => {
        this.connected = false;
        this.cleanup();
      });

      const connectConfig: any = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
      };

      if (this.config.password) {
        connectConfig.password = this.config.password;
      }
      if (this.config.privateKey) {
        connectConfig.privateKey = this.config.privateKey;
        if (this.config.passphrase) {
          connectConfig.passphrase = this.config.passphrase;
        }
      }

      this.client.connect(connectConfig);
    });
  }

  /**
   * Disconnect SSH session
   */
  async disconnect(): Promise<void> {
    this.cleanup();
    if (this.client) {
      this.client.end();
      this.client = null;
    }
    this.connected = false;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Execute a command and return output
   */
  async execute(command: string, timeoutMs = 30000): Promise<string> {
    if (!this.client || !this.connected) {
      throw new Error('SSH not connected');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.client!.exec(command, (err, channel) => {
        if (err) {
          clearTimeout(timeout);
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        channel.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        channel.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        channel.on('close', (code: number) => {
          clearTimeout(timeout);
          if (code !== 0 && stderr) {
            resolve(`${stdout}\n[stderr]: ${stderr}\n[exit code]: ${code}`);
          } else {
            resolve(stdout);
          }
        });

        channel.on('error', (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    });
  }

  /**
   * Start tailing a log file
   * Returns session ID for later operations
   */
  async tailStart(file: string, maxLines = 1000): Promise<string> {
    if (!this.client || !this.connected) {
      throw new Error('SSH not connected');
    }

    const sessionId = `tail-${++this.sessionIdCounter}`;

    return new Promise((resolve, reject) => {
      // Use tail -F (capital F) to follow through log rotations
      this.client!.exec(`tail -F ${file}`, (err, channel) => {
        if (err) {
          reject(err);
          return;
        }

        const session: TailSession = {
          id: sessionId,
          file,
          channel,
          buffer: [],
          maxLines,
          startTime: new Date(),
          lineCount: 0,
        };

        channel.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            if (line.trim()) {
              session.buffer.push(line);
              session.lineCount++;
              // Keep buffer size limited
              while (session.buffer.length > session.maxLines) {
                session.buffer.shift();
              }
            }
          }
          this.emit('tail-data', sessionId, data.toString());
        });

        channel.stderr.on('data', (data: Buffer) => {
          this.emit('tail-error', sessionId, data.toString());
        });

        channel.on('close', () => {
          this.tailSessions.delete(sessionId);
          this.emit('tail-close', sessionId);
        });

        this.tailSessions.set(sessionId, session);
        resolve(sessionId);
      });
    });
  }

  /**
   * Read buffered output from a tail session
   * Optionally clear buffer after reading
   */
  tailRead(sessionId: string, clear = true): { lines: string[]; stats: object } | null {
    const session = this.tailSessions.get(sessionId);
    if (!session) {
      return null;
    }

    const result = {
      lines: [...session.buffer],
      stats: {
        sessionId,
        file: session.file,
        startTime: session.startTime.toISOString(),
        totalLines: session.lineCount,
        bufferedLines: session.buffer.length,
        maxLines: session.maxLines,
      },
    };

    if (clear) {
      session.buffer = [];
    }

    return result;
  }

  /**
   * Stop a tail session
   */
  tailStop(sessionId: string): boolean {
    const session = this.tailSessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.channel.close();
    this.tailSessions.delete(sessionId);
    return true;
  }

  /**
   * List active tail sessions
   */
  tailList(): object[] {
    return Array.from(this.tailSessions.values()).map((s) => ({
      sessionId: s.id,
      file: s.file,
      startTime: s.startTime.toISOString(),
      totalLines: s.lineCount,
      bufferedLines: s.buffer.length,
    }));
  }

  /**
   * Cleanup all tail sessions
   */
  private cleanup(): void {
    for (const session of this.tailSessions.values()) {
      try {
        session.channel.close();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.tailSessions.clear();
  }
}
