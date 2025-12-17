import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NitroClient } from '../src/lib/nitro-client.js';

/**
 * Integration tests for NITRO client
 * These tests require a live NetScaler instance
 *
 * Run with: npm run test:integration
 *
 * Environment variables:
 *   NS_HOST - NetScaler hostname/IP (default: 52.180.146.197)
 *   NS_USER - Username (default: nsroot)
 *   NS_PASS - Password (required, or uses test default)
 */

// Required environment variables - no defaults for security
const HOST = process.env.NS_HOST;
const USER = process.env.NS_USER || 'nsroot';
const PASS = process.env.NS_PASS;

if (!HOST || !PASS) {
  throw new Error('Integration tests require NS_HOST and NS_PASS environment variables');
}

describe('NitroClient Integration', () => {
  let client: NitroClient;

  beforeAll(() => {
    client = new NitroClient({
      host: HOST,
      username: USER,
      password: PASS,
      validateSsl: false,
    });
  });

  afterAll(async () => {
    await client.logout();
  });

  describe('Authentication', () => {
    it('should login successfully', async () => {
      await expect(client.login()).resolves.not.toThrow();
    });

    it('should handle invalid credentials', async () => {
      const badClient = new NitroClient({
        host: HOST,
        username: 'invalid',
        password: 'invalid',
        validateSsl: false,
      });

      await expect(badClient.login()).rejects.toThrow();
    });
  });

  describe('Virtual Servers', () => {
    it('should list LB vservers', async () => {
      const vservers = await client.getLbVservers();

      expect(Array.isArray(vservers)).toBe(true);

      if (vservers.length > 0) {
        const vs = vservers[0];
        expect(vs).toHaveProperty('name');
        expect(vs).toHaveProperty('servicetype');
        expect(vs).toHaveProperty('ipv46');
        expect(vs).toHaveProperty('port');
        expect(vs).toHaveProperty('curstate');
      }
    });

    it('should list CS vservers', async () => {
      const vservers = await client.getCsVservers();
      expect(Array.isArray(vservers)).toBe(true);
    });

    it('should get vserver stats when vserver exists', async () => {
      const vservers = await client.getLbVservers();

      if (vservers.length > 0) {
        const stats = await client.getLbVserverStats(vservers[0].name);
        expect(stats).toHaveProperty('name');
        expect(stats).toHaveProperty('actsvcs');
      }
    });

    it('should throw for non-existent vserver', async () => {
      await expect(
        client.getLbVserverStats('nonexistent_vserver_12345')
      ).rejects.toThrow();
    });
  });

  describe('SSL Certificates', () => {
    it('should list SSL certificates', async () => {
      const certs = await client.getSSLCertKeys();

      expect(Array.isArray(certs)).toBe(true);

      if (certs.length > 0) {
        const cert = certs[0];
        expect(cert).toHaveProperty('certkey');
        expect(cert).toHaveProperty('daystoexpiration');
      }
    });
  });

  describe('Configuration', () => {
    it('should get running config', async () => {
      const config = await client.getConfig();

      expect(typeof config).toBe('string');
      expect(config.length).toBeGreaterThan(0);
      expect(config).toContain('#NS'); // NetScaler config starts with version comment
    });

    it('should save config without error', async () => {
      await expect(client.saveConfig()).resolves.not.toThrow();
    });
  });

  describe('Session Management', () => {
    it('should auto-login when session is needed', async () => {
      // Create fresh client without explicit login
      const freshClient = new NitroClient({
        host: HOST,
        username: USER,
        password: PASS,
        validateSsl: false,
      });

      // Should auto-login when making a request
      const vservers = await freshClient.getLbVservers();
      expect(Array.isArray(vservers)).toBe(true);

      await freshClient.logout();
    });

    it('should handle logout gracefully', async () => {
      const tempClient = new NitroClient({
        host: HOST,
        username: USER,
        password: PASS,
        validateSsl: false,
      });

      await tempClient.login();
      await expect(tempClient.logout()).resolves.not.toThrow();

      // Logout on already logged out client should not throw
      await expect(tempClient.logout()).resolves.not.toThrow();
    });
  });
});
