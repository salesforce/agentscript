/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Worker Parser Manager
 *
 * Manages the parser Web Worker lifecycle:
 * - Spawns and initializes the worker
 * - Sends parse requests with request IDs
 * - Handles responses via Promise resolution
 * - Detects crashes (via timeout) and restarts worker
 * - Implements exponential backoff for repeated crashes
 */

import type {
  WorkerRequest,
  WorkerResponse,
  SerializedNode,
  HighlightCapture,
  ParseError,
} from './parser-worker';

// Re-export types for consumers
export type { SerializedNode, HighlightCapture, ParseError };

export interface ParseResult {
  success: boolean;
  rootNode?: SerializedNode;
  error?: string;
}

export interface HighlightResult {
  success: boolean;
  captures?: HighlightCapture[];
  error?: string;
}

export interface ErrorResult {
  success: boolean;
  errors?: ParseError[];
  error?: string;
}

interface PendingRequest {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// Configuration
const DEFAULT_TIMEOUT_MS = 2000; // 2 second timeout - fast fail
const MAX_RESTART_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 50;

class WorkerParserManager {
  private worker: Worker | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private requestIdCounter = 0;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private restartPromise: Promise<boolean> | null = null;
  private restartAttempts = 0;

  // Instead of a queue, just track the latest pending parse
  // New requests supersede old ones - no blocking queue
  private currentParseVersion = 0;

  // Cooldown after crashes to prevent rapid re-crash loops
  private crashCooldownUntil = 0;
  private readonly CRASH_COOLDOWN_MS = 1000; // 1 second after crash, then retry

  /**
   * Check if the worker is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.worker !== null;
  }

  // Track when init started for timeout detection
  private initStartedAt: number | null = null;
  private readonly INIT_STUCK_TIMEOUT_MS = 5000; // 5 seconds max for init

  /**
   * Initialize the worker
   */
  async initialize(): Promise<void> {
    // If already initialized, return immediately
    if (this.isInitialized && this.worker) {
      return;
    }

    // If initialization is in progress, check if it's been stuck too long
    if (this.initPromise) {
      // Detect stuck init promise (can happen after HMR or silent failures)
      if (
        this.initStartedAt &&
        Date.now() - this.initStartedAt > this.INIT_STUCK_TIMEOUT_MS
      ) {
        this.initPromise = null;
        this.initStartedAt = null;
        this.restartPromise = null;
        if (this.worker) {
          this.worker.terminate();
          this.worker = null;
        }
      } else {
        return this.initPromise;
      }
    }

    // Also check for stuck restart promise (can block sendRequest)
    if (this.restartPromise) {
      this.restartPromise = null;
    }

    this.initStartedAt = Date.now();
    this.initPromise = this.doInitialize();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
      this.initStartedAt = null;
    }
  }

  private async doInitialize(): Promise<void> {
    // Set up ready promise BEFORE creating worker to avoid race condition
    // The worker sends 'ready' immediately on load
    let resolveReady: () => void;
    let rejectReady: (error: Error) => void;
    const readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    const readyTimeout = setTimeout(() => {
      rejectReady(new Error('Worker initialization timeout'));
    }, DEFAULT_TIMEOUT_MS);

    // Create the worker using Vite's worker import syntax
    this.worker = new Worker(new URL('./parser-worker.ts', import.meta.url), {
      type: 'module',
    });

    // Set up message handler that also handles 'ready'
    this.worker.onmessage = (event: MessageEvent) => {
      const data = event.data;

      // Handle ready signal
      if (data?.type === 'ready') {
        clearTimeout(readyTimeout);
        resolveReady();
        return;
      }

      // Handle other messages
      this.handleMessage(event);
    };

    // Set up error handler - MUST reject readyPromise to unblock initialization
    this.worker.onerror = error => {
      clearTimeout(readyTimeout);
      rejectReady(new Error('Worker error: ' + error.message));
      this.handleWorkerCrash('Worker error: ' + error.message);
    };

    // Wait for worker to be ready
    await readyPromise;

    // Send init message (no-op for parser-javascript, but keeps protocol consistent)
    const response = await this.sendRequest({ type: 'init' });

    if (!response.success) {
      throw new Error(response.error || 'Failed to initialize parser');
    }

    this.isInitialized = true;
    this.restartAttempts = 0;
  }

  /**
   * Handle messages from the worker
   */
  private handleMessage(
    event: MessageEvent<WorkerResponse | { type: 'ready' }>
  ) {
    const data = event.data;

    // Ignore ready message (handled in initialization)
    if (data.type === 'ready') {
      return;
    }

    const response = data;
    const pending = this.pendingRequests.get(response.id);

    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.id);
      pending.resolve(response);
    }
  }

  /**
   * Handle worker crash/timeout
   */
  private handleWorkerCrash(reason: string): void {
    // Reject all pending requests (ones sent to worker but no response yet)
    for (const [_id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Worker crashed: ${reason}`));
    }
    this.pendingRequests.clear();

    // Terminate the worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.isInitialized = false;
    // CRITICAL: Clear initPromise so subsequent initialize() calls don't hang
    this.initPromise = null;
  }

  /**
   * Restart the worker after a crash
   */
  async restart(): Promise<boolean> {
    // If already restarting, wait for that to complete
    if (this.restartPromise) {
      return this.restartPromise;
    }

    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      return false;
    }

    this.restartPromise = this.doRestart();
    try {
      return await this.restartPromise;
    } finally {
      this.restartPromise = null;
    }
  }

  private async doRestart(): Promise<boolean> {
    this.restartAttempts++;
    const backoffMs = BASE_BACKOFF_MS * Math.pow(2, this.restartAttempts - 1);

    await new Promise(resolve => setTimeout(resolve, backoffMs));

    try {
      await this.initialize();
      return true;
    } catch (_error) {
      return false;
    }
  }

  /**
   * Send a request to the worker
   */
  private async sendRequest(
    request: Omit<WorkerRequest, 'id'>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<WorkerResponse> {
    // Wait for any pending restart to complete (with timeout to prevent deadlock)
    if (this.restartPromise) {
      try {
        await Promise.race([
          this.restartPromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Restart wait timeout')), 5000)
          ),
        ]);
      } catch (_error) {
        this.restartPromise = null;
      }
    }

    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }

      const id = String(++this.requestIdCounter);
      const fullRequest: WorkerRequest = { ...request, id };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        this.handleWorkerCrash(`Request ${id} timed out after ${timeoutMs}ms`);
        reject(new Error(`Parse timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.worker.postMessage(fullRequest);
    });
  }

  /**
   * Check if an error indicates a worker crash
   */
  private isWorkerCrash(error: string | undefined): boolean {
    if (!error) return false;
    return error.includes('timeout') || error.includes('crashed');
  }

  /**
   * Clear the crash cooldown (e.g., to force retry)
   */
  public clearCrashCache(): void {
    this.crashCooldownUntil = 0;
  }

  /**
   * Check if we're in crash cooldown period
   */
  private isInCrashCooldown(): boolean {
    return Date.now() < this.crashCooldownUntil;
  }

  /**
   * Start crash cooldown period
   */
  private startCrashCooldown(): void {
    this.crashCooldownUntil = Date.now() + this.CRASH_COOLDOWN_MS;
  }

  /**
   * Parse AgentScript code
   * Uses versioning to skip stale requests - no blocking queue
   */
  async parse(code: string): Promise<ParseResult> {
    // Increment version - this request is now "current"
    ++this.currentParseVersion;

    // Do the actual parse
    const result = await this.doParse(code);

    // Return the result (even if superseded - caller may still use it)
    return result;
  }

  /**
   * Internal parse implementation
   */
  private async doParse(code: string): Promise<ParseResult> {
    // Check if we're in crash cooldown (prevents rapid re-crashes)
    if (this.isInCrashCooldown()) {
      return {
        success: false,
        error: 'Parser recovering from crash. Will retry in a moment.',
      };
    }

    // Auto-initialize if needed
    if (!this.isInitialized) {
      try {
        await this.initialize();
      } catch (error) {
        return {
          success: false,
          error: `Initialization failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    try {
      const response = await this.sendRequest({
        type: 'parse',
        payload: { code },
      });

      if (response.success) {
        return {
          success: true,
          rootNode: response.payload?.rootNode,
        };
      } else {
        if (this.isWorkerCrash(response.error)) {
          this.startCrashCooldown();
          this.handleWorkerCrash(response.error || 'Worker crash');
          await this.restart();
        }
        return {
          success: false,
          error: response.error,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (this.isWorkerCrash(errorMessage)) {
        this.startCrashCooldown();
        await this.restart();
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get syntax highlighting captures
   */
  async highlight(code: string): Promise<HighlightResult> {
    return this.doHighlight(code);
  }

  /**
   * Internal highlight implementation
   */
  private async doHighlight(code: string): Promise<HighlightResult> {
    // Check if we're in crash cooldown
    if (this.isInCrashCooldown()) {
      return {
        success: false,
        error: 'Parser recovering from crash',
      };
    }

    // Auto-initialize if needed
    if (!this.isInitialized) {
      try {
        await this.initialize();
      } catch (error) {
        return {
          success: false,
          error: `Initialization failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    try {
      const response = await this.sendRequest({
        type: 'highlight',
        payload: { code },
      });

      if (response.success) {
        return {
          success: true,
          captures: response.payload?.captures,
        };
      } else {
        if (this.isWorkerCrash(response.error)) {
          this.startCrashCooldown();
          this.handleWorkerCrash(response.error || 'Worker crash');
          await this.restart();
        }
        return {
          success: false,
          error: response.error,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (this.isWorkerCrash(errorMessage)) {
        this.startCrashCooldown();
        await this.restart();
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get parse errors
   */
  async getErrors(code: string): Promise<ErrorResult> {
    return this.doGetErrors(code);
  }

  /**
   * Internal getErrors implementation
   */
  private async doGetErrors(code: string): Promise<ErrorResult> {
    // Check if we're in crash cooldown
    if (this.isInCrashCooldown()) {
      return {
        success: false,
        error: 'Parser recovering from crash',
      };
    }

    // Auto-initialize if needed
    if (!this.isInitialized) {
      try {
        await this.initialize();
      } catch (error) {
        return {
          success: false,
          error: `Initialization failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    try {
      const response = await this.sendRequest({
        type: 'getErrors',
        payload: { code },
      });

      if (response.success) {
        return {
          success: true,
          errors: response.payload?.errors,
        };
      } else {
        if (this.isWorkerCrash(response.error)) {
          this.startCrashCooldown();
          this.handleWorkerCrash(response.error || 'Worker crash');
          await this.restart();
        }
        return {
          success: false,
          error: response.error,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (this.isWorkerCrash(errorMessage)) {
        this.startCrashCooldown();
        await this.restart();
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Terminate the worker
   */
  terminate(): void {
    if (this.worker) {
      // Reject all pending requests
      for (const [_id, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Worker terminated'));
      }
      this.pendingRequests.clear();

      this.worker.terminate();
      this.worker = null;
    }

    this.isInitialized = false;
  }
}

// Export singleton instance
export const workerParser = new WorkerParserManager();

// Export the class for testing
export { WorkerParserManager };
