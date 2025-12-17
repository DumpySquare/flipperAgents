/**
 * SSH Client for NetScaler operations
 * Used for batch command execution and file operations
 */

import { Client, ConnectConfig } from 'ssh2';
import { readFileSync } from 'fs';

export interface SSHConfig {
  host: string;
  port?: number;
  username: string;
  privateKeyPath?: string;
  password?: string;
}

export class SSHClient {
  private config: SSHConfig;

  constructor(config: SSHConfig) {
    this.config = {
      port: 22,
      ...config,
    };
  }

  /**
   * Execute a command via SSH with timeout
   */
  async execute(command: string, timeoutMs: number = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let timedOut = false;

      // Timeout handler
      const timeout = setTimeout(() => {
        timedOut = true;
        conn.end();
        reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            conn.end();
            reject(err);
            return;
          }

          let stdout = '';
          let stderr = '';

          stream.on('close', (code: number) => {
            clearTimeout(timeout);
            conn.end();
            if (timedOut) return; // Already rejected
            if (code !== 0 && stderr) {
              reject(new Error(`Command failed (exit ${code}): ${stderr}`));
            } else {
              resolve(stdout);
            }
          });

          stream.on('data', (data: Buffer) => {
            stdout += data.toString();
          });

          stream.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        if (!timedOut) reject(err);
      });

      const connectConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        readyTimeout: 10000, // 10 second connection timeout
      };

      if (this.config.privateKeyPath) {
        connectConfig.privateKey = readFileSync(this.config.privateKeyPath);
      } else if (this.config.password) {
        connectConfig.password = this.config.password;
      }

      conn.connect(connectConfig);
    });
  }

  /**
   * Quick connectivity test - just tries to connect and disconnect
   */
  async testConnection(timeoutMs: number = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      const conn = new Client();

      const timeout = setTimeout(() => {
        conn.end();
        resolve(false);
      }, timeoutMs);

      conn.on('ready', () => {
        clearTimeout(timeout);
        conn.end();
        resolve(true);
      });

      conn.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });

      const connectConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        readyTimeout: timeoutMs,
      };

      if (this.config.privateKeyPath) {
        try {
          connectConfig.privateKey = readFileSync(this.config.privateKeyPath);
        } catch {
          resolve(false);
          return;
        }
      } else if (this.config.password) {
        connectConfig.password = this.config.password;
      }

      conn.connect(connectConfig);
    });
  }

  /**
   * Execute NetScaler batch commands
   * Pipes config directly to batch command via stdin
   */
  async executeBatch(configContent: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();

      conn.on('ready', () => {
        // Use batch command with stdin
        conn.exec('batch -fileName /dev/stdin', (err, stream) => {
          if (err) {
            conn.end();
            reject(err);
            return;
          }

          let stdout = '';
          let stderr = '';

          stream.on('close', (code: number) => {
            conn.end();
            // Batch command may have warnings, check for actual errors
            const errors = stdout.split('\n').filter(l => l.startsWith('ERROR:'));
            if (errors.length > 0) {
              reject(new Error(`Batch errors:\n${errors.join('\n')}`));
            } else {
              resolve(stdout);
            }
          });

          stream.on('data', (data: Buffer) => {
            stdout += data.toString();
          });

          stream.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });

          // Write config to stdin
          // Ensure trailing newline so batch processes the last command
          const content = configContent.endsWith('\n') ? configContent : configContent + '\n';
          stream.write(content);
          stream.end();
        });
      });

      conn.on('error', (err) => {
        reject(err);
      });

      const connectConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        readyTimeout: 30000,  // 30 second connection timeout
      };

      if (this.config.privateKeyPath) {
        connectConfig.privateKey = readFileSync(this.config.privateKeyPath);
      } else if (this.config.password) {
        connectConfig.password = this.config.password;
      }

      // Add overall timeout
      const timeout = setTimeout(() => {
        conn.end();
        reject(new Error('SSH batch execution timed out after 90 seconds'));
      }, 90000);

      conn.on('close', () => clearTimeout(timeout));

      conn.connect(connectConfig);
    });
  }

  /**
   * Upload a file to NetScaler via SFTP
   */
  async uploadFile(remotePath: string, content: Buffer | string): Promise<void> {
    return new Promise((resolve, reject) => {
      const conn = new Client();

      const timeout = setTimeout(() => {
        conn.end();
        reject(new Error('SFTP upload timed out after 30 seconds'));
      }, 30000);

      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            clearTimeout(timeout);
            conn.end();
            reject(err);
            return;
          }

          const writeStream = sftp.createWriteStream(remotePath);

          writeStream.on('close', () => {
            clearTimeout(timeout);
            conn.end();
            resolve();
          });

          writeStream.on('error', (err: Error) => {
            clearTimeout(timeout);
            conn.end();
            reject(err);
          });

          // Write content and close
          const buffer = typeof content === 'string' ? Buffer.from(content) : content;
          writeStream.end(buffer);
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      const connectConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
      };

      if (this.config.privateKeyPath) {
        connectConfig.privateKey = readFileSync(this.config.privateKeyPath);
      } else if (this.config.password) {
        connectConfig.password = this.config.password;
      }

      conn.connect(connectConfig);
    });
  }

  /**
   * Download a file from NetScaler via SFTP
   */
  async downloadFile(remotePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const conn = new Client();

      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            conn.end();
            reject(err);
            return;
          }

          let content = '';
          const readStream = sftp.createReadStream(remotePath);

          readStream.on('data', (data: Buffer) => {
            content += data.toString();
          });

          readStream.on('end', () => {
            conn.end();
            resolve(content);
          });

          readStream.on('error', (err: Error) => {
            conn.end();
            reject(err);
          });
        });
      });

      conn.on('error', (err) => {
        reject(err);
      });

      const connectConfig: ConnectConfig = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
      };

      if (this.config.privateKeyPath) {
        connectConfig.privateKey = readFileSync(this.config.privateKeyPath);
      } else if (this.config.password) {
        connectConfig.password = this.config.password;
      }

      conn.connect(connectConfig);
    });
  }
}
