import { describe, it, expect } from 'vitest';
import { parseWithDiagnostics } from './test-utils.js';

describe('anonymous topic (allowAnonymous)', () => {
  it('creates ILLEGAL_anonymous key and emits warning for topic without name', () => {
    const { value, diagnostics } = parseWithDiagnostics(`
topic:
  description: "No name topic"
  reasoning:
    instructions: ->
      |Do it
`);
    const topicMap = value.topic;
    expect(topicMap).toBeDefined();
    expect(topicMap!.has('ILLEGAL_anonymous_topic_1')).toBe(true);

    const anonDiag = diagnostics.find(d => d.code === 'anonymous-named-block');
    expect(anonDiag).toBeDefined();
    expect(anonDiag!.message).toContain('Anonymous topic');
  });

  it('does not emit anonymous warning for named topic', () => {
    const { diagnostics } = parseWithDiagnostics(`
topic hello:
  description: "Named topic"
  reasoning:
    instructions: ->
      |Do it
`);
    const anonDiag = diagnostics.find(d => d.code === 'anonymous-named-block');
    expect(anonDiag).toBeUndefined();
  });
});
