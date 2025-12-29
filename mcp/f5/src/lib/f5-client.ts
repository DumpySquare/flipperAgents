/**
 * F5 BIG-IP Client Wrapper
 *
 * Wraps f5-conx-core to provide a simplified interface for MCP tools.
 * Handles device discovery, authentication, and API calls.
 */

import { F5Client as CoreF5Client, type DiscoverInfo, type AxiosResponseWithTimings } from 'f5-conx-core';
import { log } from './logger.js';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface F5ClientConfig {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  provider?: string;
}

export interface DeviceInfo {
  hostname: string;
  version: string;
  product?: string;
  atc?: {
    as3?: string;
    do?: string;
    ts?: string;
    cf?: string;
    fast?: string;
  };
}

export interface UcsFile {
  name: string;
  apiRawValues?: {
    filename?: string;
    file_size?: string;
    file_created_date?: string;
  };
}

export interface QkviewFile {
  name: string;
  apiRawValues?: {
    filename?: string;
    file_size?: string;
  };
}

export interface AtcVersion {
  as3?: string;
  do?: string;
  ts?: string;
  cf?: string;
  fast?: string;
}

/**
 * Wrapper around f5-conx-core F5Client
 */
export class F5Client {
  private client: CoreF5Client | null = null;
  private config: F5ClientConfig;
  private connected = false;
  private discoveryInfo: DiscoverInfo | null = null;
  private cacheDir: string;

  constructor(config: F5ClientConfig) {
    this.config = {
      port: 443,
      username: 'admin',
      provider: 'tmos',
      ...config,
    };
    // Create temp cache dir for file downloads
    this.cacheDir = join(tmpdir(), 'f5-mcp-cache');
    try {
      mkdirSync(this.cacheDir, { recursive: true });
    } catch {
      // Ignore if already exists
    }
  }

  /**
   * Connect to BIG-IP and discover capabilities
   */
  async connect(): Promise<DeviceInfo> {
    log.info('Connecting to BIG-IP', { host: this.config.host });

    this.client = new CoreF5Client(
      this.config.host,
      this.config.username!,
      this.config.password!,
      {
        port: this.config.port,
        provider: this.config.provider,
      }
    );

    // Set cache directory for downloads
    this.client.cacheDir = this.cacheDir;

    // Discover device (connects and gets basic info)
    this.discoveryInfo = await this.client.discover();
    this.connected = true;

    const info = this.getDeviceInfoFromDiscovery();
    log.info('Connected to BIG-IP', {
      hostname: info.hostname,
      version: info.version,
    });

    return info;
  }

  /**
   * Disconnect from BIG-IP
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.clearLogin();
      this.client = null;
      this.connected = false;
      this.discoveryInfo = null;
      log.info('Disconnected from BIG-IP');
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  /**
   * Get connection host (for SSH default)
   */
  getHost(): string {
    return this.config.host;
  }

  /**
   * Get connection password (for SSH default)
   */
  getPassword(): string | undefined {
    return this.config.password;
  }

  /**
   * Get the underlying f5-conx-core client
   */
  getClient(): CoreF5Client {
    if (!this.client) {
      throw new Error('Not connected to BIG-IP. Call connect() first.');
    }
    return this.client;
  }

  /**
   * Get device info from discovery cache
   */
  private getDeviceInfoFromDiscovery(): DeviceInfo {
    return {
      hostname: this.discoveryInfo?.hostname || this.config.host,
      version: this.discoveryInfo?.version || 'unknown',
      product: this.discoveryInfo?.product,
      atc: this.discoveryInfo?.atc,
    };
  }

  /**
   * Get device information
   */
  async getDeviceInfo(): Promise<DeviceInfo> {
    if (this.discoveryInfo) {
      return this.getDeviceInfoFromDiscovery();
    }

    // Re-discover if needed
    const client = this.getClient();
    this.discoveryInfo = await client.discover();
    return this.getDeviceInfoFromDiscovery();
  }

  /**
   * Execute bash command on BIG-IP
   */
  async bashExecute(command: string): Promise<string> {
    const client = this.getClient();

    const response = await client.https('/mgmt/tm/util/bash', {
      method: 'POST',
      data: {
        command: 'run',
        utilCmdArgs: `-c "${command.replace(/"/g, '\\"')}"`,
      },
    });

    return response?.data?.commandResult || '';
  }

  /**
   * Execute tmsh command on BIG-IP
   */
  async tmshExecute(command: string): Promise<string> {
    // tmsh commands run via bash
    return this.bashExecute(`tmsh ${command}`);
  }

  /**
   * Make raw HTTPS request to BIG-IP
   */
  async https(
    path: string,
    options?: {
      method?: string;
      data?: unknown;
    }
  ): Promise<AxiosResponseWithTimings> {
    const client = this.getClient();
    return client.https(path, options);
  }

  // ========== UCS Operations ==========

  /**
   * Create UCS backup
   */
  async ucsCreate(
    name: string,
    options?: { passphrase?: string; noPrivateKeys?: boolean }
  ): Promise<string> {
    const client = this.getClient();

    if (!client.ucs) {
      throw new Error('UCS client not available');
    }

    await client.ucs.create({
      fileName: name,
      passPhrase: options?.passphrase,
      noPrivateKeys: options?.noPrivateKeys,
    });

    return name;
  }

  /**
   * List UCS files on device
   */
  async ucsList(): Promise<UcsFile[]> {
    const client = this.getClient();

    if (!client.ucs) {
      throw new Error('UCS client not available');
    }

    const response = await client.ucs.list();
    return response?.data?.items || [];
  }

  /**
   * Download UCS file - returns file path
   */
  async ucsDownload(name: string): Promise<Buffer> {
    const client = this.getClient();

    if (!client.ucs) {
      throw new Error('UCS client not available');
    }

    const localPath = join(this.cacheDir, `${name}.ucs`);
    await client.ucs.download(name, localPath);

    // Read the downloaded file
    return readFileSync(localPath);
  }

  /**
   * Upload UCS file
   */
  async ucsUpload(name: string, content: Buffer): Promise<void> {
    const client = this.getClient();

    // Write to temp file first
    const localPath = join(this.cacheDir, name);
    writeFileSync(localPath, content);

    // Upload via F5 client
    await client.upload(localPath, 'UCS');
  }

  /**
   * Delete UCS file
   */
  async ucsDelete(name: string): Promise<void> {
    const client = this.getClient();

    if (!client.ucs) {
      throw new Error('UCS client not available');
    }

    await client.ucs.delete(name);
  }

  /**
   * Restore from UCS
   */
  async ucsRestore(
    name: string,
    options?: { passphrase?: string; noLicense?: boolean; resetTrust?: boolean }
  ): Promise<string> {
    let cmd = `load sys ucs ${name}`;
    if (options?.passphrase) {
      cmd += ` passphrase "${options.passphrase}"`;
    }
    if (options?.noLicense) {
      cmd += ' no-license';
    }
    if (options?.resetTrust) {
      cmd += ' reset-trust';
    }

    return this.bashExecute(`tmsh ${cmd}`);
  }

  // ========== Qkview Operations ==========

  /**
   * Create qkview diagnostic
   */
  async qkviewCreate(name?: string): Promise<string> {
    const client = this.getClient();

    if (!client.qkview) {
      throw new Error('Qkview client not available');
    }

    const qkviewName = name || `qkview_${Date.now()}.qkview`;
    await client.qkview.create(qkviewName);
    return qkviewName;
  }

  /**
   * List qkview files
   */
  async qkviewList(): Promise<QkviewFile[]> {
    const client = this.getClient();

    if (!client.qkview) {
      throw new Error('Qkview client not available');
    }

    const response = await client.qkview.list();
    return response?.data?.items || [];
  }

  /**
   * Download qkview file
   */
  async qkviewDownload(name: string): Promise<Buffer> {
    const client = this.getClient();

    if (!client.qkview) {
      throw new Error('Qkview client not available');
    }

    const localPath = join(this.cacheDir, name);
    await client.qkview.download(name, localPath);

    return readFileSync(localPath);
  }

  // ========== ATC Services ==========

  /**
   * Get installed ATC versions
   */
  async atcGetVersions(): Promise<AtcVersion> {
    // Use discovery info which already has ATC versions
    if (this.discoveryInfo?.atc) {
      return this.discoveryInfo.atc;
    }

    // Re-discover
    const client = this.getClient();
    this.discoveryInfo = await client.discover();
    return this.discoveryInfo?.atc || {};
  }

  /**
   * Get current AS3 declaration
   */
  async as3Get(tenant?: string): Promise<unknown> {
    const client = this.getClient();
    const path = tenant
      ? `/mgmt/shared/appsvcs/declare/${tenant}`
      : '/mgmt/shared/appsvcs/declare';
    const response = await client.https(path);
    return response.data;
  }

  /**
   * Deploy AS3 declaration
   */
  async as3Deploy(declaration: unknown): Promise<unknown> {
    const client = this.getClient();
    const response = await client.https('/mgmt/shared/appsvcs/declare', {
      method: 'POST',
      data: declaration,
    });
    return response.data;
  }

  /**
   * Delete AS3 tenant
   */
  async as3Delete(tenant: string): Promise<unknown> {
    const client = this.getClient();
    const response = await client.https(`/mgmt/shared/appsvcs/declare/${tenant}`, {
      method: 'DELETE',
    });
    return response.data;
  }

  /**
   * Get current DO declaration
   */
  async doGet(): Promise<unknown> {
    const client = this.getClient();
    const response = await client.https('/mgmt/shared/declarative-onboarding');
    return response.data;
  }

  /**
   * Deploy DO declaration
   */
  async doDeploy(declaration: unknown): Promise<unknown> {
    const client = this.getClient();
    const response = await client.https('/mgmt/shared/declarative-onboarding', {
      method: 'POST',
      data: declaration,
    });
    return response.data;
  }

  /**
   * Get current TS declaration
   */
  async tsGet(): Promise<unknown> {
    const client = this.getClient();
    const response = await client.https('/mgmt/shared/telemetry/declare');
    return response.data;
  }

  /**
   * Deploy TS declaration
   */
  async tsDeploy(declaration: unknown): Promise<unknown> {
    const client = this.getClient();
    const response = await client.https('/mgmt/shared/telemetry/declare', {
      method: 'POST',
      data: declaration,
    });
    return response.data;
  }

  /**
   * Delete TS configuration
   */
  async tsDelete(): Promise<unknown> {
    const client = this.getClient();
    const response = await client.https('/mgmt/shared/telemetry/declare', {
      method: 'DELETE',
    });
    return response.data;
  }

  // ========== HA Operations ==========

  /**
   * Get HA status
   */
  async haStatus(): Promise<unknown> {
    const client = this.getClient();

    const [devices, syncStatus] = await Promise.all([
      client.https('/mgmt/tm/cm/device'),
      client.https('/mgmt/tm/cm/sync-status'),
    ]);

    return {
      devices: devices?.data?.items || [],
      syncStatus: syncStatus?.data,
    };
  }

  /**
   * Trigger failover to standby
   */
  async haFailover(): Promise<string> {
    return this.bashExecute('tmsh run sys failover standby');
  }

  /**
   * Sync config to peer
   */
  async haSync(deviceGroup: string): Promise<unknown> {
    const client = this.getClient();
    const response = await client.https('/mgmt/tm/cm/config-sync', {
      method: 'POST',
      data: {
        command: 'run',
        utilCmdArgs: `to-group ${deviceGroup}`,
      },
    });
    return response.data;
  }

  // ========== Image Management ==========

  /**
   * List software images
   */
  async imageList(): Promise<unknown[]> {
    const client = this.getClient();
    const response = await client.https('/mgmt/tm/sys/software/image');
    return response?.data?.items || [];
  }

  /**
   * List software volumes
   */
  async volumeList(): Promise<unknown[]> {
    const client = this.getClient();
    const response = await client.https('/mgmt/tm/sys/software/volume');
    return response?.data?.items || [];
  }

  // ========== Stats & Monitoring ==========

  /**
   * Get virtual server stats
   */
  async getVirtualStats(name?: string): Promise<unknown> {
    const client = this.getClient();
    const path = name
      ? `/mgmt/tm/ltm/virtual/${name}/stats`
      : '/mgmt/tm/ltm/virtual/stats';
    const response = await client.https(path);
    return response.data;
  }

  /**
   * Get pool stats
   */
  async getPoolStats(name?: string): Promise<unknown> {
    const client = this.getClient();
    const path = name
      ? `/mgmt/tm/ltm/pool/${name}/stats`
      : '/mgmt/tm/ltm/pool/stats';
    const response = await client.https(path);
    return response.data;
  }

  /**
   * Get log content
   */
  async getLogs(logFile: string, lines = 100): Promise<string> {
    return this.bashExecute(`tail -n ${lines} /var/log/${logFile}`);
  }

  /**
   * Save running config
   */
  async saveConfig(): Promise<string> {
    return this.bashExecute('tmsh save sys config');
  }

  /**
   * Get license info
   */
  async getLicense(): Promise<unknown> {
    const client = this.getClient();
    const response = await client.https('/mgmt/tm/sys/license');
    return response.data;
  }
}
