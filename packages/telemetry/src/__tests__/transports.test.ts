/**
 * Tests for telemetry transports
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TeemTransport } from '../teem.js';
import { PostHogTransport } from '../posthog.js';
import type { TelemetryContext, TelemetryEvent } from '../types.js';

const mockContext: TelemetryContext = {
  packageName: 'test-package',
  packageVersion: '1.0.0',
  nodeVersion: 'v20.0.0',
  platform: 'linux',
  arch: 'x64',
  instanceId: 'test-instance-id',
};

const mockEvents: TelemetryEvent[] = [
  {
    event: 'test_tool',
    timestamp: '2024-01-15T10:00:00.000Z',
    duration_ms: 100,
    success: true,
  },
  {
    event: 'failed_tool',
    timestamp: '2024-01-15T10:00:01.000Z',
    duration_ms: 500,
    success: false,
    error_type: 'NetworkError',
  },
];

describe('TeemTransport', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends events to TEEM endpoint', async () => {
    const transport = new TeemTransport(mockContext);
    await transport.send(mockEvents);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    
    expect(url).toBe('https://product.apis.f5.com/ee/v1/telemetry');
    expect(options?.method).toBe('POST');
    expect(options?.headers).toMatchObject({
      'Content-Type': 'application/json',
    });
  });

  it('includes required headers', async () => {
    const transport = new TeemTransport(mockContext);
    await transport.send(mockEvents);

    const [, options] = vi.mocked(fetch).mock.calls[0];
    const headers = options?.headers as Record<string, string>;

    expect(headers['F5-ApiKey']).toBeDefined();
    expect(headers['F5-DigitalAssetId']).toBe('test-instance-id');
    expect(headers['F5-TraceId']).toBeDefined();
  });

  it('formats payload correctly', async () => {
    const transport = new TeemTransport(mockContext);
    await transport.send(mockEvents);

    const [, options] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(options?.body as string);

    expect(body.documentType).toBe('F5 MCP Telemetry Data');
    expect(body.documentVersion).toBe('1');
    expect(body.digitalAssetId).toBe('test-instance-id');
    expect(body.digitalAssetName).toBe('test-package');
    expect(body.digitalAssetVersion).toBe('1.0.0');
    expect(body.telemetryRecords).toHaveLength(2);
    expect(body.telemetryRecords[0].command).toBe('test_tool');
    expect(body.telemetryRecords[1].error_type).toBe('NetworkError');
  });

  it('handles network errors silently', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const transport = new TeemTransport(mockContext);
    
    // Should not throw
    await expect(transport.send(mockEvents)).resolves.toBeUndefined();
  });

  it('handles non-ok responses silently', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);

    const transport = new TeemTransport(mockContext);
    
    // Should not throw
    await expect(transport.send(mockEvents)).resolves.toBeUndefined();
  });
});

describe('PostHogTransport', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Set API key so transport doesn't skip
    process.env.POSTHOG_API_KEY = 'test-api-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('skips when not configured', async () => {
    delete process.env.POSTHOG_API_KEY;
    const transport = new PostHogTransport(mockContext);
    await transport.send(mockEvents);

    // Should not call fetch when no API key
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends events to PostHog batch endpoint', async () => {
    const transport = new PostHogTransport(mockContext);
    await transport.send(mockEvents);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    
    expect(url).toContain('/batch');
    expect(options?.method).toBe('POST');
    expect(options?.headers).toMatchObject({
      'Content-Type': 'application/json',
    });
  });

  it('formats batch payload correctly', async () => {
    const transport = new PostHogTransport(mockContext);
    await transport.send(mockEvents);

    const [, options] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(options?.body as string);

    expect(body.api_key).toBe('test-api-key');
    expect(body.batch).toHaveLength(2);
    
    const event1 = body.batch[0];
    expect(event1.event).toBe('test_tool');
    expect(event1.distinct_id).toBe('test-instance-id');
    expect(event1.properties.$lib).toBe('test-package');
    expect(event1.properties.$lib_version).toBe('1.0.0');
    expect(event1.properties.duration_ms).toBe(100);
    expect(event1.properties.success).toBe(true);

    const event2 = body.batch[1];
    expect(event2.properties.error_type).toBe('NetworkError');
  });

  it('includes runtime context in properties', async () => {
    const transport = new PostHogTransport(mockContext);
    await transport.send(mockEvents);

    const [, options] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(options?.body as string);
    const props = body.batch[0].properties;

    expect(props.node_version).toBe('v20.0.0');
    expect(props.platform).toBe('linux');
    expect(props.arch).toBe('x64');
  });

  it('handles network errors silently', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const transport = new PostHogTransport(mockContext);
    
    // Should not throw
    await expect(transport.send(mockEvents)).resolves.toBeUndefined();
  });

  it('handles non-ok responses silently', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 400 } as Response);

    const transport = new PostHogTransport(mockContext);
    
    // Should not throw
    await expect(transport.send(mockEvents)).resolves.toBeUndefined();
  });
});
