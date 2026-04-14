import { describe, test, expect } from 'vitest';
import { parse, parseComponent } from '../src/index.js';
import { StringLiteral } from '@agentscript/language';

describe('Document', () => {
  describe('mutate()', () => {
    test('mutates in-block fields via accessor', () => {
      const doc = parse('system:\n    instructions: "Hello"');
      doc.mutate(ast => {
        const sys = (ast as unknown as Record<string, Record<string, unknown>>)
          .system;
        if (sys) {
          sys.instructions = new StringLiteral('Updated');
        }
      });
      const emitted = doc.emit();
      expect(emitted).toContain('Updated');
    });

    test('marks document dirty after mutation', () => {
      const doc = parse('system:\n    instructions: "Hello"');
      expect(doc.isDirty).toBe(false);
      doc.mutate(ast => {
        const sys = (ast as unknown as Record<string, Record<string, unknown>>)
          .system;
        if (sys) {
          sys.instructions = new StringLiteral('Changed');
        }
      });
      expect(doc.isDirty).toBe(true);
    });

    test('creates undo history entry', () => {
      const doc = parse('system:\n    instructions: "Hello"');
      expect(doc.history.length).toBe(0);
      doc.mutate(() => {}, 'test mutation');
      expect(doc.history.length).toBe(1);
      expect(doc.history[0].label).toBe('test mutation');
    });

    test('returns this for chaining', () => {
      const doc = parse('system:\n    instructions: "Hello"');
      const result = doc.mutate(() => {});
      expect(result).toBe(doc);
    });
  });

  describe('setField() / removeField()', () => {
    test('setField replaces a root-level block', () => {
      const doc = parse('system:\n    instructions: "Hello"');
      const newConfig = parseComponent(
        'config:\n    description: "My agent"',
        'config'
      );
      doc.setField('config', newConfig, 'Add config');
      const emitted = doc.emit();
      expect(emitted).toContain('config');
      expect(emitted).toContain('My agent');
    });

    test('removeField removes a root-level block', () => {
      const source =
        'system:\n    instructions: "Hello"\nconfig:\n    description: "Test"';
      const doc = parse(source);
      doc.removeField('config', 'Remove config');
      const emitted = doc.emit();
      expect(emitted).not.toContain('description');
    });
  });

  describe('addEntry() / removeEntry()', () => {
    test('addEntry adds a named block', () => {
      const doc = parse('system:\n    instructions: "Hello"');
      const topic = parseComponent(
        'topic billing:\n    description: "Handle billing"\n    instructions: "Help"',
        'topic'
      );
      doc.addEntry('topic', 'billing', topic!, 'Add billing topic');
      const emitted = doc.emit();
      expect(emitted).toContain('billing');
      expect(emitted).toContain('Handle billing');
    });

    test('removeEntry removes a named block', () => {
      const source = `system:
    instructions: "Hello"
topic billing:
    description: "Handle billing"
    instructions: "Help"`;
      const doc = parse(source);
      doc.removeEntry('topic', 'billing', 'Remove billing');
      const emitted = doc.emit();
      expect(emitted).not.toContain('billing');
    });
  });

  describe('undo() / redo()', () => {
    test('undo reverts to previous state', () => {
      const doc = parse('system:\n    instructions: "Hello"');
      const originalEmit = doc.emit();
      doc.mutate(ast => {
        const sys = (ast as unknown as Record<string, Record<string, unknown>>)
          .system;
        if (sys) {
          sys.instructions = new StringLiteral('Changed');
        }
      }, 'change instructions');
      expect(doc.emit()).toContain('Changed');

      doc.undo();
      expect(doc.emit()).toBe(originalEmit);
    });

    test('redo re-applies undone mutation', () => {
      const doc = parse('system:\n    instructions: "Hello"');
      doc.mutate(ast => {
        const sys = (ast as unknown as Record<string, Record<string, unknown>>)
          .system;
        if (sys) {
          sys.instructions = new StringLiteral('Changed');
        }
      });
      doc.undo();
      doc.redo();
      expect(doc.emit()).toContain('Changed');
    });

    test('canUndo / canRedo report correctly', () => {
      const doc = parse('system:\n    instructions: "Hello"');
      expect(doc.canUndo).toBe(false);
      expect(doc.canRedo).toBe(false);

      doc.mutate(() => {});
      expect(doc.canUndo).toBe(true);
      expect(doc.canRedo).toBe(false);

      doc.undo();
      expect(doc.canUndo).toBe(false);
      expect(doc.canRedo).toBe(true);
    });

    test('undo is no-op when nothing to undo', () => {
      const doc = parse('system:\n    instructions: "Hello"');
      const before = doc.emit();
      doc.undo();
      expect(doc.emit()).toBe(before);
    });

    test('redo is no-op when nothing to redo', () => {
      const doc = parse('system:\n    instructions: "Hello"');
      const before = doc.emit();
      doc.redo();
      expect(doc.emit()).toBe(before);
    });

    test('new mutation clears redo stack', () => {
      const doc = parse('system:\n    instructions: "Hello"');
      doc.mutate(() => {}, 'first');
      doc.mutate(() => {}, 'second');
      doc.undo();
      expect(doc.canRedo).toBe(true);

      doc.mutate(() => {}, 'third');
      expect(doc.canRedo).toBe(false);
    });
  });

  describe('history', () => {
    test('tracks mutation history with labels', () => {
      const doc = parse('system:\n    instructions: "Hello"');
      doc.mutate(() => {}, 'mutation 1');
      doc.mutate(() => {}, 'mutation 2');
      expect(doc.history.length).toBe(2);
      expect(doc.history[0].label).toBe('mutation 1');
      expect(doc.history[1].label).toBe('mutation 2');
    });

    test('history entries have timestamps', () => {
      const doc = parse('system:\n    instructions: "Hello"');
      const before = Date.now();
      doc.mutate(() => {});
      const after = Date.now();
      expect(doc.history[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(doc.history[0].timestamp).toBeLessThanOrEqual(after);
    });

    test('historyIndex tracks position', () => {
      const doc = parse('system:\n    instructions: "Hello"');
      expect(doc.historyIndex).toBe(0);
      doc.mutate(() => {});
      expect(doc.historyIndex).toBe(1);
      doc.mutate(() => {});
      expect(doc.historyIndex).toBe(2);
    });
  });

  describe('getDiff()', () => {
    test('returns before/after source', () => {
      const doc = parse('system:\n    instructions: "Hello"');
      doc.mutate(ast => {
        const sys = (ast as unknown as Record<string, Record<string, unknown>>)
          .system;
        if (sys) {
          sys.instructions = new StringLiteral('Changed');
        }
      });
      const diff = doc.getDiff();
      expect(diff.before).toContain('Hello');
      expect(diff.after).toContain('Changed');
    });
  });
});
