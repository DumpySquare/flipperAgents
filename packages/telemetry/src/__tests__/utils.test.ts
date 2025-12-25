/**
 * Tests for telemetry utility functions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { classifyError, isTelemetryEnabled } from '../utils.js';

describe('classifyError', () => {
  it('returns UnknownError for non-Error types', () => {
    expect(classifyError(null)).toBe('UnknownError');
    expect(classifyError(undefined)).toBe('UnknownError');
    expect(classifyError('string error')).toBe('UnknownError');
    expect(classifyError(42)).toBe('UnknownError');
    expect(classifyError({ message: 'object' })).toBe('UnknownError');
  });

  describe('NetworkError classification', () => {
    it('classifies FetchError', () => {
      const error = new Error('fetch failed');
      error.name = 'FetchError';
      expect(classifyError(error)).toBe('NetworkError');
    });

    it('classifies AbortError', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      expect(classifyError(error)).toBe('NetworkError');
    });

    it('classifies ECONNREFUSED', () => {
      expect(classifyError(new Error('connect ECONNREFUSED 127.0.0.1:443'))).toBe('NetworkError');
    });

    it('classifies ETIMEDOUT', () => {
      expect(classifyError(new Error('connect ETIMEDOUT'))).toBe('NetworkError');
    });

    it('classifies ENOTFOUND', () => {
      expect(classifyError(new Error('getaddrinfo ENOTFOUND example.com'))).toBe('NetworkError');
    });
  });

  describe('AuthError classification', () => {
    it('classifies 401 errors', () => {
      expect(classifyError(new Error('Request failed with status 401'))).toBe('AuthError');
    });

    it('classifies 403 errors', () => {
      expect(classifyError(new Error('403 Forbidden'))).toBe('AuthError');
    });

    it('classifies authentication errors', () => {
      expect(classifyError(new Error('Authentication failed'))).toBe('AuthError');
    });

    it('classifies unauthorized errors', () => {
      expect(classifyError(new Error('Unauthorized access'))).toBe('AuthError');
    });
  });

  describe('ValidationError classification', () => {
    it('classifies ValidationError by name', () => {
      const error = new Error('invalid input');
      error.name = 'ValidationError';
      expect(classifyError(error)).toBe('ValidationError');
    });

    it('classifies TypeError', () => {
      expect(classifyError(new TypeError('Cannot read property'))).toBe('ValidationError');
    });

    it('classifies invalid messages', () => {
      expect(classifyError(new Error('Invalid parameter: name'))).toBe('ValidationError');
    });

    it('classifies required field errors', () => {
      expect(classifyError(new Error('Field "host" is required'))).toBe('ValidationError');
    });
  });

  describe('ApiError classification', () => {
    it('classifies 400 errors', () => {
      expect(classifyError(new Error('400 Bad Request'))).toBe('ApiError');
    });

    it('classifies 422 errors', () => {
      expect(classifyError(new Error('422 Unprocessable Entity'))).toBe('ApiError');
    });
  });

  describe('ServerError classification', () => {
    it('classifies 500 errors', () => {
      expect(classifyError(new Error('500 Internal Server Error'))).toBe('ServerError');
    });

    it('classifies 502 errors', () => {
      expect(classifyError(new Error('502 Bad Gateway'))).toBe('ServerError');
    });

    it('classifies 503 errors', () => {
      expect(classifyError(new Error('503 Service Unavailable'))).toBe('ServerError');
    });
  });

  describe('Default classification', () => {
    it('returns error name for unknown errors', () => {
      const error = new Error('something happened');
      error.name = 'CustomError';
      expect(classifyError(error)).toBe('CustomError');
    });

    it('returns Error for generic errors', () => {
      expect(classifyError(new Error('generic error'))).toBe('Error');
    });
  });
});

describe('isTelemetryEnabled', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env vars before each test
    delete process.env.FLIPPER_TELEMETRY_ENABLED;
    delete process.env.DO_NOT_TRACK;
    delete process.env.CI;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it('returns true by default', () => {
    expect(isTelemetryEnabled()).toBe(true);
  });

  it('returns false when FLIPPER_TELEMETRY_ENABLED=false', () => {
    process.env.FLIPPER_TELEMETRY_ENABLED = 'false';
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('returns true when FLIPPER_TELEMETRY_ENABLED=true', () => {
    process.env.FLIPPER_TELEMETRY_ENABLED = 'true';
    expect(isTelemetryEnabled()).toBe(true);
  });

  it('returns false when DO_NOT_TRACK=1', () => {
    process.env.DO_NOT_TRACK = '1';
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('returns true when DO_NOT_TRACK=0', () => {
    process.env.DO_NOT_TRACK = '0';
    expect(isTelemetryEnabled()).toBe(true);
  });

  it('returns false when CI=true', () => {
    process.env.CI = 'true';
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('returns true when CI=false', () => {
    process.env.CI = 'false';
    expect(isTelemetryEnabled()).toBe(true);
  });

  it('FLIPPER_TELEMETRY_ENABLED=false takes precedence', () => {
    process.env.FLIPPER_TELEMETRY_ENABLED = 'false';
    process.env.DO_NOT_TRACK = '0';
    process.env.CI = 'false';
    expect(isTelemetryEnabled()).toBe(false);
  });
});
