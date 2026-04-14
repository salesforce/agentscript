import { describe, test, expect } from 'vitest';
import { customSubagentFields, baseSubagentFields } from '../schema.js';

describe('customSubagentFields', () => {
  test('includes all base fields', () => {
    const baseKeys = Object.keys(baseSubagentFields);
    const customKeys = Object.keys(customSubagentFields);

    // All base fields should be present in custom
    for (const key of baseKeys) {
      expect(customKeys).toContain(key);
    }
  });

  test('includes parameters field', () => {
    expect(customSubagentFields).toHaveProperty('parameters');
  });

  test('does not include reasoning fields', () => {
    expect(customSubagentFields).not.toHaveProperty('before_reasoning');
    expect(customSubagentFields).not.toHaveProperty('after_reasoning');
    expect(customSubagentFields).not.toHaveProperty('reasoning');
  });

  test('has correct field count', () => {
    const customKeys = Object.keys(customSubagentFields);
    const baseKeys = Object.keys(baseSubagentFields);

    // customSubagentFields = baseSubagentFields + parameters + on_init + on_exit
    expect(customKeys.length).toBe(baseKeys.length + 3);
  });

  test('parameters field has correct structure', () => {
    const parametersField = customSubagentFields.parameters;

    expect(parametersField).toBeDefined();
    expect(parametersField.kind).toBe('ParametersBlock');
    expect(typeof parametersField.describe).toBe('function');
  });

  test('schema field is present from base', () => {
    expect(customSubagentFields).toHaveProperty('schema');
    expect(customSubagentFields.schema).toBe(baseSubagentFields.schema);
  });

  test('label field is present from base', () => {
    expect(customSubagentFields).toHaveProperty('label');
    expect(customSubagentFields.label).toBe(baseSubagentFields.label);
  });

  test('description field is present from base', () => {
    expect(customSubagentFields).toHaveProperty('description');
    expect(customSubagentFields.description).toBe(
      baseSubagentFields.description
    );
  });

  test('system field is present from base', () => {
    expect(customSubagentFields).toHaveProperty('system');
    expect(customSubagentFields.system).toBe(baseSubagentFields.system);
  });

  test('actions field is present from base', () => {
    expect(customSubagentFields).toHaveProperty('actions');
    expect(customSubagentFields.actions).toBe(baseSubagentFields.actions);
  });

  test('includes on_init field', () => {
    expect(customSubagentFields).toHaveProperty('on_init');
  });

  test('on_init field has correct structure', () => {
    const onInitField = customSubagentFields.on_init;

    expect(onInitField).toBeDefined();
    expect(typeof onInitField.describe).toBe('function');
  });

  test('includes on_exit field', () => {
    expect(customSubagentFields).toHaveProperty('on_exit');
  });

  test('on_exit field has correct structure', () => {
    const onExitField = customSubagentFields.on_exit;

    expect(onExitField).toBeDefined();
    expect(typeof onExitField.describe).toBe('function');
  });
});
