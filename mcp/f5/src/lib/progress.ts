/**
 * Progress Reporting Utilities
 * 
 * Provides progress notification support for long-running MCP operations.
 * Uses MCP's standard notifications/progress mechanism.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { log } from './logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ProgressStep {
  step: number;
  name: string;
  weight: number;  // Percentage weight of total operation
}

export interface ProgressContext {
  operationId: string;
  tool: string;
  steps: ProgressStep[];
  currentStep: number;
  server?: Server;
}

export interface ProgressUpdate {
  percent: number;
  currentStep: string;
  stepsCompleted: number;
  stepsTotal: number;
}

export type ProgressCallback = (step: string, percent: number) => void;

// ============================================================================
// Progress Step Definitions
// ============================================================================

export const EXTRACTION_STEPS: ProgressStep[] = [
  { step: 1, name: 'Connecting to device', weight: 5 },
  { step: 2, name: 'Creating mini-UCS archive', weight: 40 },
  { step: 3, name: 'Downloading mini-UCS', weight: 25 },
  { step: 4, name: 'Parsing with corkscrew', weight: 20 },
  { step: 5, name: 'Filtering tenant objects', weight: 5 },
  { step: 6, name: 'Building response', weight: 5 },
];

export const UCS_CREATE_STEPS: ProgressStep[] = [
  { step: 1, name: 'Initiating backup', weight: 5 },
  { step: 2, name: 'Creating UCS archive', weight: 80 },
  { step: 3, name: 'Verifying backup', weight: 10 },
  { step: 4, name: 'Completing', weight: 5 },
];

export const DRY_RUN_STEPS: ProgressStep[] = [
  { step: 1, name: 'Validating declaration', weight: 10 },
  { step: 2, name: 'Submitting to AS3', weight: 60 },
  { step: 3, name: 'Parsing response', weight: 20 },
  { step: 4, name: 'Building change report', weight: 10 },
];

// ============================================================================
// Progress Tracker Class
// ============================================================================

export class ProgressTracker {
  private operationId: string;
  private tool: string;
  private steps: ProgressStep[];
  private currentStepIndex: number = 0;
  private server?: Server;
  private startTime: number;
  private callbacks: ProgressCallback[] = [];

  constructor(tool: string, steps: ProgressStep[], server?: Server) {
    this.operationId = `${tool}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.tool = tool;
    this.steps = steps;
    this.server = server;
    this.startTime = Date.now();
  }

  /**
   * Add a callback to be notified of progress updates
   */
  onProgress(callback: ProgressCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Calculate cumulative percentage at current step
   */
  private calculatePercent(): number {
    let percent = 0;
    for (let i = 0; i < this.currentStepIndex; i++) {
      percent += this.steps[i].weight;
    }
    return Math.min(percent, 100);
  }

  /**
   * Update progress to a specific step
   */
  async update(stepNumber: number, customMessage?: string): Promise<void> {
    const stepIndex = stepNumber - 1;
    if (stepIndex < 0 || stepIndex >= this.steps.length) {
      log.warn('Invalid step number', { stepNumber, totalSteps: this.steps.length });
      return;
    }

    this.currentStepIndex = stepIndex + 1;  // Mark step as complete
    const step = this.steps[stepIndex];
    const percent = this.calculatePercent();
    const message = customMessage || step.name;

    log.debug('Progress update', {
      operationId: this.operationId,
      tool: this.tool,
      step: stepNumber,
      stepName: step.name,
      percent,
      elapsed: Date.now() - this.startTime,
    });

    // Notify callbacks
    for (const callback of this.callbacks) {
      try {
        callback(message, percent);
      } catch (e) {
        log.warn('Progress callback error', { error: e });
      }
    }

    // Send MCP notification if server available
    if (this.server) {
      try {
        await this.server.notification({
          method: 'notifications/progress',
          params: {
            progressToken: this.operationId,
            progress: percent,
            total: 100,
            message,
          },
        });
      } catch (e) {
        // MCP progress notifications are best-effort
        log.debug('Could not send MCP progress notification', { error: e });
      }
    }
  }

  /**
   * Mark operation as complete
   */
  async complete(): Promise<void> {
    const elapsed = Date.now() - this.startTime;
    log.info('Operation complete', {
      operationId: this.operationId,
      tool: this.tool,
      elapsed,
    });

    // Final 100% update
    for (const callback of this.callbacks) {
      try {
        callback('Complete', 100);
      } catch (e) {
        // Ignore
      }
    }

    if (this.server) {
      try {
        await this.server.notification({
          method: 'notifications/progress',
          params: {
            progressToken: this.operationId,
            progress: 100,
            total: 100,
            message: 'Complete',
          },
        });
      } catch (e) {
        // Best-effort
      }
    }
  }

  /**
   * Get current progress state
   */
  getState(): ProgressUpdate {
    const currentStep = this.currentStepIndex > 0 && this.currentStepIndex <= this.steps.length
      ? this.steps[this.currentStepIndex - 1].name
      : 'Starting';

    return {
      percent: this.calculatePercent(),
      currentStep,
      stepsCompleted: this.currentStepIndex,
      stepsTotal: this.steps.length,
    };
  }

  /**
   * Get operation ID for tracking
   */
  getId(): string {
    return this.operationId;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a progress tracker for extract_tenant_config
 */
export function createExtractionTracker(server?: Server): ProgressTracker {
  return new ProgressTracker('extract_tenant_config', EXTRACTION_STEPS, server);
}

/**
 * Create a progress tracker for ucs_create
 */
export function createUcsTracker(server?: Server): ProgressTracker {
  return new ProgressTracker('ucs_create', UCS_CREATE_STEPS, server);
}

/**
 * Create a progress tracker for dry_run_as3
 */
export function createDryRunTracker(server?: Server): ProgressTracker {
  return new ProgressTracker('dry_run_as3', DRY_RUN_STEPS, server);
}

// ============================================================================
// Exports
// ============================================================================

export default ProgressTracker;
