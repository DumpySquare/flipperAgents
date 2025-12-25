/**
 * Telemetry Utilities
 */

/**
 * Classify an error into a category for telemetry
 * Returns a generic category, NOT the actual error message
 */
export function classifyError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'UnknownError';
  }

  const msg = error.message.toLowerCase();
  const name = error.name;

  // Network errors
  if (
    name === 'FetchError' ||
    name === 'AbortError' ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('enetunreach') ||
    msg.includes('socket hang up')
  ) {
    return 'NetworkError';
  }

  // Auth errors
  if (
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('authentication') ||
    msg.includes('unauthorized') ||
    msg.includes('invalid credentials')
  ) {
    return 'AuthError';
  }

  // Validation errors
  if (
    name === 'ValidationError' ||
    name === 'TypeError' ||
    msg.includes('invalid') ||
    msg.includes('required') ||
    msg.includes('must be')
  ) {
    return 'ValidationError';
  }

  // API errors (client side - 4xx)
  if (msg.includes('400') || msg.includes('404') || msg.includes('422')) {
    return 'ApiError';
  }

  // Server errors (5xx)
  if (
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504')
  ) {
    return 'ServerError';
  }

  // Timeout errors
  if (msg.includes('timeout') || name === 'TimeoutError') {
    return 'TimeoutError';
  }

  // Return error name if available, otherwise generic
  return name || 'Error';
}

/**
 * Interface for telemetry client error capture
 */
interface ErrorCapture {
  captureError(error: unknown, context?: string): void;
}

/**
 * Setup global uncaught error handlers
 * Captures uncaughtException and unhandledRejection to telemetry
 */
export function setupGlobalErrorHandlers(telemetry: ErrorCapture): void {
  process.on('uncaughtException', (error) => {
    console.error('[telemetry] Uncaught exception:', error.name, error.message);
    telemetry.captureError(error, 'uncaughtException');
    // Give time for telemetry to flush before exit
    setTimeout(() => process.exit(1), 1000);
  });

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    console.error('[telemetry] Unhandled rejection:', error.name, error.message);
    telemetry.captureError(error, 'unhandledRejection');
  });
}

/**
 * Check if telemetry should be enabled based on environment
 */
export function isTelemetryEnabled(): boolean {
  // Explicit opt-out
  if (process.env.FLIPPER_TELEMETRY_ENABLED === 'false') {
    return false;
  }

  // Respect DO_NOT_TRACK standard
  if (process.env.DO_NOT_TRACK === '1') {
    return false;
  }

  // Disable in CI environments
  if (process.env.CI === 'true') {
    return false;
  }

  return true;
}

/**
 * Check if debug logging is enabled
 */
export function isDebugEnabled(): boolean {
  return process.env.FLIPPER_DEBUG_TELEMETRY === 'true';
}

/**
 * Debug log helper
 */
export function debugLog(message: string, data?: unknown): void {
  if (isDebugEnabled()) {
    if (data !== undefined) {
      console.log(`[telemetry] ${message}`, data);
    } else {
      console.log(`[telemetry] ${message}`);
    }
  }
}
