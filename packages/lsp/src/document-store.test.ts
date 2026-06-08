/**
 * Tests for document store
 */

import { describe, test, expect } from 'vitest';
import { DocumentStore } from './document-store.js';
import { processDocument } from './pipeline.js';
import { testConfig } from './test-utils.js';

describe('DocumentStore', () => {
  test('can set and get document', () => {
    const store = new DocumentStore();
    const state = processDocument(
      'test://test.agent',
      'system:\n  instructions: "Test"',
      testConfig
    );

    store.set(state);
    const retrieved = store.get('test://test.agent');

    expect(retrieved).toBeDefined();
    expect(retrieved?.uri).toBe('test://test.agent');
  });

  test('has() returns correct boolean', () => {
    const store = new DocumentStore();
    const state = processDocument(
      'test://test.agent',
      'system:\n  instructions: "Test"',
      testConfig
    );

    expect(store.has('test://test.agent')).toBe(false);
    store.set(state);
    expect(store.has('test://test.agent')).toBe(true);
  });

  test('delete() removes document', () => {
    const store = new DocumentStore();
    const state = processDocument(
      'test://test.agent',
      'system:\n  instructions: "Test"',
      testConfig
    );

    store.set(state);
    expect(store.has('test://test.agent')).toBe(true);

    store.delete('test://test.agent');
    expect(store.has('test://test.agent')).toBe(false);
  });

  test('getAllUris() returns all URIs', () => {
    const store = new DocumentStore();
    store.set(
      processDocument(
        'test://test1.agent',
        'system:\n  instructions: "Test 1"',
        testConfig
      )
    );
    store.set(
      processDocument(
        'test://test2.agent',
        'system:\n  instructions: "Test 2"',
        testConfig
      )
    );

    const uris = store.getAllUris();
    expect(uris).toHaveLength(2);
    expect(uris).toContain('test://test1.agent');
    expect(uris).toContain('test://test2.agent');
  });
});
