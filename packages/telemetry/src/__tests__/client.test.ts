/**
 * Tests for TelemetryClient
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelemetryClient } from '../index.js';

describe('TelemetryClient', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Enable telemetry for tests
    process.env.FLIPPER_TELEMETRY_ENABLED = 'true';
    process.env.POSTHOG_API_KEY = 'test-api-key';
    delete process.env.DO_NOT_TRACK;
    delete process.env.CI;
    
    // Mock fetch to prevent actual network calls
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('creates client with package info', () => {
      const client = new TelemetryClient('test-package', '1.0.0');
      expect(client).toBeDefined();
      expect(client.getContext().packageName).toBe('test-package');
      expect(client.getContext().packageVersion).toBe('1.0.0');
    });

    it('generates unique instance ID', () => {
      const client1 = new TelemetryClient('test', '1.0.0');
      const client2 = new TelemetryClient('test', '1.0.0');
      expect(client1.getInstanceId()).not.toBe(client2.getInstanceId());
    });

    it('captures runtime context', () => {
      const client = new TelemetryClient('test', '1.0.0');
      const ctx = client.getContext();
      expect(ctx.nodeVersion).toBe(process.version);
      expect(ctx.platform).toBeDefined();
      expect(ctx.arch).toBeDefined();
    });
  });

  describe('isEnabled', () => {
    it('returns true when enabled', () => {
      process.env.FLIPPER_TELEMETRY_ENABLED = 'true';
      const client = new TelemetryClient('test', '1.0.0');
      expect(client.isEnabled()).toBe(true);
    });

    it('returns false when disabled', () => {
      process.env.FLIPPER_TELEMETRY_ENABLED = 'false';
      const client = new TelemetryClient('test', '1.0.0');
      expect(client.isEnabled()).toBe(false);
    });

    it('returns false in CI', () => {
      process.env.CI = 'true';
      const client = new TelemetryClient('test', '1.0.0');
      expect(client.isEnabled()).toBe(false);
    });
  });

  describe('capture', () => {
    it('records events when enabled', async () => {
      const client = new TelemetryClient('test', '1.0.0');
      client.capture('test_event', 100, true);
      
      // Flush and verify fetch was called
      await client.flush();
      expect(fetch).toHaveBeenCalled();
    });

    it('does not record events when disabled', async () => {
      process.env.FLIPPER_TELEMETRY_ENABLED = 'false';
      const client = new TelemetryClient('test', '1.0.0');
      client.capture('test_event', 100, true);
      
      await client.flush();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('captures with all parameters', async () => {
      const client = new TelemetryClient('test', '1.0.0');
      client.capture('my_tool', 250, true, undefined, { custom: 'prop' });
      
      await client.flush();
      
      // Verify fetch was called with the event data
      expect(fetch).toHaveBeenCalled();
      const calls = vi.mocked(fetch).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });

    it('captures failed events with error type', async () => {
      const client = new TelemetryClient('test', '1.0.0');
      client.capture('failing_tool', 500, false, 'NetworkError');
      
      await client.flush();
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    it('captures startup event', async () => {
      const client = new TelemetryClient('test', '1.0.0');
      client.lifecycle('startup', { transport: 'stdio' });
      
      await client.flush();
      expect(fetch).toHaveBeenCalled();
    });

    it('captures shutdown event', async () => {
      const client = new TelemetryClient('test', '1.0.0');
      client.lifecycle('shutdown');
      
      await client.flush();
      expect(fetch).toHaveBeenCalled();
    });

    it('captures error event as failure', async () => {
      const client = new TelemetryClient('test', '1.0.0');
      client.lifecycle('error', { reason: 'crash' });
      
      await client.flush();
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('captureError', () => {
    it('captures error with classification', async () => {
      const client = new TelemetryClient('test', '1.0.0');
      const error = new Error('Connection refused ECONNREFUSED');
      
      client.captureError(error, 'connect_device');
      
      // captureError triggers immediate flush
      // Give it a moment to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('flush', () => {
    it('does nothing when journal is empty', async () => {
      const client = new TelemetryClient('test', '1.0.0');
      await client.flush();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('clears journal after flush', async () => {
      const client = new TelemetryClient('test', '1.0.0');
      client.capture('event1', 100, true);
      
      await client.flush();
      expect(fetch).toHaveBeenCalledTimes(2); // TEEM + PostHog
      
      // Reset mock
      vi.mocked(fetch).mockClear();
      
      // Second flush should do nothing
      await client.flush();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('sends to both transports', async () => {
      const client = new TelemetryClient('test', '1.0.0');
      client.capture('test_event', 100, true);
      
      await client.flush();
      
      // Should call fetch twice (TEEM + PostHog)
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('batch behavior', () => {
    it('auto-flushes at batch size', async () => {
      const client = new TelemetryClient('test', '1.0.0');
      
      // Capture 50 events (MAX_BATCH_SIZE)
      for (let i = 0; i < 50; i++) {
        client.capture(`event_${i}`, i, true);
      }
      
      // Should have triggered auto-flush
      // Give async flush time to complete
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(fetch).toHaveBeenCalled();
    });
  });
});
