/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Working memory — small, durable, human-readable state the agent maintains
 * *across turns* within a scope (a thread, or a resource shared by threads).
 *
 * Unlike semantic recall (which retrieves past messages by similarity),
 * working memory is a single evolving document the agent reads at the start of
 * every turn and rewrites when facts change: the user's name, preferences,
 * open tasks. It is deliberately tiny and stringly-typed so it can be injected
 * verbatim into the system prompt.
 */
export interface WorkingMemoryStore {
  get(scope: string): Promise<string | null>;
  set(scope: string, content: string): Promise<void>;
  clear(scope: string): Promise<void>;
}

/** In-process working-memory store. */
export class MemoryWorkingMemoryStore implements WorkingMemoryStore {
  private readonly byScope = new Map<string, string>();

  async get(scope: string): Promise<string | null> {
    return this.byScope.get(scope) ?? null;
  }

  async set(scope: string, content: string): Promise<void> {
    this.byScope.set(scope, content);
  }

  async clear(scope: string): Promise<void> {
    this.byScope.delete(scope);
  }
}

export interface WorkingMemoryOptions {
  store?: WorkingMemoryStore;
  /** Max characters retained; longer content is truncated (oldest tail dropped). */
  maxChars?: number;
  /** How a scope key is derived. Defaults to `resource:<id>` ?? `thread:<id>`. */
  scopeOf?: (ref: WorkingMemoryRef) => string;
}

export interface WorkingMemoryRef {
  threadId: string;
  resourceId?: string;
}

/**
 * Manages a working-memory document per scope, with a character cap so it can
 * never blow up the prompt budget.
 */
export class WorkingMemory {
  private readonly store: WorkingMemoryStore;
  private readonly maxChars: number;
  private readonly scopeOf: (ref: WorkingMemoryRef) => string;

  constructor(options: WorkingMemoryOptions = {}) {
    this.store = options.store ?? new MemoryWorkingMemoryStore();
    this.maxChars = options.maxChars ?? 2000;
    this.scopeOf = options.scopeOf ?? defaultScope;
  }

  async read(ref: WorkingMemoryRef): Promise<string | null> {
    return this.store.get(this.scopeOf(ref));
  }

  /** Replace the working-memory document for a scope (truncating to the cap). */
  async write(ref: WorkingMemoryRef, content: string): Promise<void> {
    await this.store.set(this.scopeOf(ref), this.truncate(content));
  }

  /** Append a line to the existing document, then re-cap. */
  async append(ref: WorkingMemoryRef, line: string): Promise<void> {
    const scope = this.scopeOf(ref);
    const existing = (await this.store.get(scope)) ?? '';
    const next = existing ? `${existing}\n${line}` : line;
    await this.store.set(scope, this.truncate(next));
  }

  async clear(ref: WorkingMemoryRef): Promise<void> {
    await this.store.clear(this.scopeOf(ref));
  }

  /** Keep the most recent `maxChars`, dropping the oldest characters. */
  private truncate(content: string): string {
    if (content.length <= this.maxChars) return content;
    return content.slice(content.length - this.maxChars);
  }
}

function defaultScope(ref: WorkingMemoryRef): string {
  return ref.resourceId
    ? `resource:${ref.resourceId}`
    : `thread:${ref.threadId}`;
}
