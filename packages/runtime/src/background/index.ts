/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Background subagents — a subagent launched with `run_in_background: true`
 * runs detached against an isolated clone of parent state while the parent
 * keeps reasoning. Ported from the reference agent's `agent/background/`. See `types.ts` for
 * the full model.
 */

export {
  isBackgroundTaskTerminal,
  TERMINAL_BACKGROUND_STATUSES,
} from './types.js';
export type {
  BackgroundTaskStatus,
  BackgroundTaskInfo,
  BackgroundChildCheckpoint,
  BackgroundTaskStore,
} from './types.js';

export { BackgroundTaskManager, BackgroundCapacityError } from './manager.js';
export type {
  BackgroundTaskManagerOptions,
  BackgroundLaunchResult,
  BackgroundRunContext,
  BackgroundSpawnRequest,
  BackgroundNotification,
  BackgroundNotificationListener,
} from './manager.js';

export { MemoryBackgroundTaskStore } from './memory-store.js';
