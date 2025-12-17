/**
 * NetScaler NITRO API Client
 * Session-based authentication with automatic refresh
 */

export interface NSConfig {
  host: string;
  username: string;
  password: string;
  validateSsl?: boolean;
}

export interface NSSession {
  sessionId: string;
  timeout: number;
  createdAt: number;
}

interface NitroBaseResponse {
  errorcode: number;
  message: string;
  severity?: string;
}

export class NitroClient {
  private config: NSConfig;
  private session: NSSession | null = null;
  private baseUrl: string;

  constructor(config: NSConfig) {
    this.config = {
      validateSsl: false,
      ...config,
    };

    if (!this.config.host) {
      throw new Error('NetScaler host is required');
    }

    this.baseUrl = `https://${this.config.host}/nitro/v1`;

    // Disable SSL validation if configured
    if (!this.config.validateSsl) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
  }

  /**
   * Login to NetScaler and establish session
   */
  async login(): Promise<void> {
    interface LoginResponse extends NitroBaseResponse {
      sessionid?: string;
      timeout?: number;
    }

    const response = await this.request<LoginResponse>(
      'POST',
      '/config/login',
      {
        login: {
          username: this.config.username,
          password: this.config.password,
        },
      },
      true // skip auth for login
    );

    if (response.sessionid) {
      this.session = {
        sessionId: response.sessionid,
        timeout: response.timeout || 900, // Default 15 min timeout
        createdAt: Date.now(),
      };
    } else {
      throw new Error('Login failed: No session returned');
    }
  }

  /**
   * Logout and clear session
   */
  async logout(): Promise<void> {
    if (this.session) {
      try {
        await this.request('POST', '/config/logout', { logout: {} });
      } finally {
        this.session = null;
      }
    }
  }

  /**
   * Ensure we have a valid session
   */
  private async ensureSession(): Promise<void> {
    if (!this.session) {
      await this.login();
      return;
    }

    // Check if session might be expired (with 60s buffer)
    const elapsed = Date.now() - this.session.createdAt;
    const timeoutMs = (this.session.timeout - 60) * 1000;

    if (elapsed > timeoutMs) {
      await this.login();
    }
  }

  /**
   * Make a NITRO API request
   */
  private async request<T extends NitroBaseResponse>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    skipAuth = false
  ): Promise<T> {
    if (!skipAuth) {
      await this.ensureSession();
    }

    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.session && !skipAuth) {
      headers['Cookie'] = `NITRO_AUTH_TOKEN=${this.session.sessionId}`;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      // Check for session expiry
      if (response.status === 401 && !skipAuth) {
        this.session = null;
        await this.ensureSession();
        return this.request(method, path, body, skipAuth);
      }
      // Try to extract error details from response body
      let errorDetails = '';
      try {
        const errorBody = await response.text();
        if (errorBody) {
          const errorData = JSON.parse(errorBody);
          if (errorData.message) {
            errorDetails = `: ${errorData.message}`;
          } else if (errorData.errorcode) {
            errorDetails = `: errorcode ${errorData.errorcode}`;
          }
        }
      } catch {
        // Ignore parse errors
      }
      throw new Error(`NITRO API error: ${response.status} ${response.statusText}${errorDetails}`);
    }

    // Handle empty responses (e.g., logout)
    const text = await response.text();
    if (!text) {
      return { errorcode: 0, message: 'Done' } as T;
    }

    const data = JSON.parse(text) as T;

    if (data.errorcode !== 0) {
      throw new Error(`NITRO error ${data.errorcode}: ${data.message}`);
    }

    return data;
  }

  /**
   * GET request helper
   */
  async get<T extends NitroBaseResponse>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  /**
   * POST request helper
   */
  async post<T extends NitroBaseResponse>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  /**
   * PUT request helper
   */
  async put<T extends NitroBaseResponse>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  /**
   * DELETE request helper
   */
  async delete<T extends NitroBaseResponse>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  // ============ High-level API methods ============

  /**
   * Get running configuration
   */
  async getConfig(section?: string): Promise<string> {
    interface ConfigResponse extends NitroBaseResponse {
      nsrunningconfig?: { response: string };
    }

    // Note: some NetScaler versions don't support args, try simple endpoint first
    const path = section
      ? `/config/nsrunningconfig/${encodeURIComponent(section)}`
      : '/config/nsrunningconfig';

    const response = await this.get<ConfigResponse>(path);
    return response.nsrunningconfig?.response || '';
  }

  /**
   * Get all LB virtual servers
   */
  async getLbVservers(): Promise<LbVserver[]> {
    interface LbVserverResponse extends NitroBaseResponse {
      lbvserver?: LbVserver[];
    }

    const response = await this.get<LbVserverResponse>('/config/lbvserver');
    return response.lbvserver || [];
  }

  /**
   * Get all CS virtual servers
   */
  async getCsVservers(): Promise<CsVserver[]> {
    interface CsVserverResponse extends NitroBaseResponse {
      csvserver?: CsVserver[];
    }

    const response = await this.get<CsVserverResponse>('/config/csvserver');
    return response.csvserver || [];
  }

  /**
   * Get LB vserver stats
   */
  async getLbVserverStats(name: string): Promise<LbVserverStats> {
    interface LbVserverStatsResponse extends NitroBaseResponse {
      lbvserver?: LbVserverStats[];
    }

    const response = await this.get<LbVserverStatsResponse>(
      `/stat/lbvserver/${encodeURIComponent(name)}`
    );
    if (!response.lbvserver?.[0]) {
      throw new Error(`VServer not found: ${name}`);
    }
    return response.lbvserver[0];
  }

  /**
   * Get services bound to a vserver
   */
  async getLbVserverBindings(name: string): Promise<LbVserverBinding> {
    interface LbVserverBindingResponse extends NitroBaseResponse {
      lbvserver_binding?: LbVserverBinding;
    }

    const response = await this.get<LbVserverBindingResponse>(
      `/config/lbvserver_binding/${encodeURIComponent(name)}`
    );
    return response.lbvserver_binding || {};
  }

  /**
   * Get SSL certificate keys
   */
  async getSSLCertKeys(): Promise<SSLCertKey[]> {
    interface SSLCertKeyResponse extends NitroBaseResponse {
      sslcertkey?: SSLCertKey[];
    }

    const response = await this.get<SSLCertKeyResponse>('/config/sslcertkey');
    return response.sslcertkey || [];
  }

  /**
   * Save config (write memory)
   */
  async saveConfig(): Promise<void> {
    await this.post<NitroBaseResponse>('/config/nsconfig?action=save', { nsconfig: {} });
  }

  /**
   * Get system information (version, hardware, license, HA status)
   */
  async getSystemInfo(): Promise<SystemInfo> {
    const info: SystemInfo = {
      connected: false,
      host: this.config.host,
    };

    try {
      // Test connectivity by getting version
      interface VersionResponse extends NitroBaseResponse {
        nsversion?: { version: string; mode: string };
      }
      const versionResp = await this.get<VersionResponse>('/config/nsversion');
      info.connected = true;
      info.version = versionResp.nsversion?.version;
      info.mode = versionResp.nsversion?.mode;

      // Get hardware info
      interface HardwareResponse extends NitroBaseResponse {
        nshardware?: { hwdescription: string; host: string; hostid: string; serialno: string };
      }
      try {
        const hwResp = await this.get<HardwareResponse>('/config/nshardware');
        info.hardware = hwResp.nshardware?.hwdescription;
        info.hostname = hwResp.nshardware?.host;
        info.serialNumber = hwResp.nshardware?.serialno;
        info.hostId = hwResp.nshardware?.hostid;
      } catch { /* hardware info may not be available */ }

      // Get license info
      interface LicenseResponse extends NitroBaseResponse {
        nslicense?: { modelid: string; isstandardlic: boolean; isenterpriselic: boolean; isplatinumlic: boolean };
      }
      try {
        const licResp = await this.get<LicenseResponse>('/config/nslicense');
        const lic = licResp.nslicense;
        info.modelId = lic?.modelid;
        info.licenseType = lic?.isplatinumlic ? 'Platinum' :
                          lic?.isenterpriselic ? 'Enterprise' :
                          lic?.isstandardlic ? 'Standard' : 'Unknown';
      } catch { /* license info may not be available */ }

      // Get system stats (CPU/memory)
      interface SystemStatResponse extends NitroBaseResponse {
        system?: { cpuusagepcnt: number; memusagepcnt: number; numcpus: number; starttime: string };
      }
      try {
        const statResp = await this.get<SystemStatResponse>('/stat/system');
        const stat = statResp.system;
        info.cpuUsage = stat?.cpuusagepcnt;
        info.memoryUsage = stat?.memusagepcnt;
        info.cpuCount = stat?.numcpus;
        info.uptime = stat?.starttime;
      } catch { /* stats may not be available */ }

      // Get HA status
      interface HANodeResponse extends NitroBaseResponse {
        hanode?: Array<{ state: string; hastatus: string; hasync: string }>;
      }
      try {
        const haResp = await this.get<HANodeResponse>('/config/hanode');
        const ha = haResp.hanode?.[0];
        if (ha) {
          info.haState = ha.state;
          info.haStatus = ha.hastatus;
        }
      } catch { /* HA info may not be available */ }

    } catch (error) {
      info.connected = false;
      info.error = error instanceof Error ? error.message : String(error);
    }

    return info;
  }
}

export interface SystemInfo {
  connected: boolean;
  host: string;
  hostname?: string;
  version?: string;
  mode?: string;
  hardware?: string;
  serialNumber?: string;
  hostId?: string;
  modelId?: string;
  licenseType?: string;
  cpuUsage?: number;
  memoryUsage?: number;
  cpuCount?: number;
  uptime?: string;
  haState?: string;
  haStatus?: string;
  error?: string;
}

// ============ Type definitions for NITRO responses ============

export interface LbVserver {
  name: string;
  servicetype: string;
  ipv46: string;
  port: number;
  state: string;
  curstate: string;
  status: number;
  health: number;
  comment?: string;
}

export interface CsVserver {
  name: string;
  servicetype: string;
  ipv46: string;
  port: number;
  state: string;
  curstate: string;
  status: number;
  comment?: string;
}

export interface LbVserverStats {
  name: string;
  state: string;
  health: number;
  actsvcs: number;
  inactsvcs: number;
  tothits: number;
  hitsrate: number;
  totalrequests: number;
  requestsrate: number;
  totalresponses: number;
  responsesrate: number;
  curclntconnections: number;
  cursrvrconnections: number;
}

export interface LbVserverBinding {
  lbvserver_service_binding?: ServiceBinding[];
  lbvserver_servicegroup_binding?: ServiceGroupBinding[];
}

export interface ServiceBinding {
  servicename: string;
  ipv46: string;
  port: number;
  svrstate: string;
  curstate: string;
}

export interface ServiceGroupBinding {
  servicegroupname: string;
}

export interface SSLCertKey {
  certkey: string;
  cert: string;
  key?: string;
  serial: string;
  signaturealg: string;
  issuer: string;
  subject: string;
  clientcertnotbefore: string;
  clientcertnotafter: string;
  daystoexpiration: number;
  status: string;
}
