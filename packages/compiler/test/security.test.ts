import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { DiagnosticSeverity } from '../src/diagnostics.js';
import { parseSource } from './test-utils.js';

describe('Security compilation', () => {
  describe('Global security configuration', () => {
    it('compiles verified_customer_record_access with use_default_objects: true', () => {
      const source = `
config:
    developer_name: "test_agent"
    default_agent_user: "test@example.com"

security:
    verified_customer_record_access:
        use_default_objects: True

start_agent main:
    description: "Main topic"
`.trimStart();

      const ast = parseSource(source);
      const { output, diagnostics } = compile(ast);

      const errors = diagnostics.filter(
        d => d.severity === DiagnosticSeverity.Error
      );
      expect(errors).toHaveLength(0);

      expect(output.global_configuration.security).toBeDefined();
      expect(
        output.global_configuration.security?.verified_customer_record_access
      ).toEqual({
        use_default_objects: true,
      });
    });

    it('compiles verified_customer_record_access with use_default_objects: false', () => {
      const source = `
config:
    developer_name: "test_agent"
    default_agent_user: "test@example.com"

security:
    verified_customer_record_access:
        use_default_objects: False

start_agent main:
    description: "Main topic"
`.trimStart();

      const ast = parseSource(source);
      const { output, diagnostics } = compile(ast);

      const errors = diagnostics.filter(
        d => d.severity === DiagnosticSeverity.Error
      );
      expect(errors).toHaveLength(0);

      expect(output.global_configuration.security).toBeDefined();
      expect(
        output.global_configuration.security?.verified_customer_record_access
      ).toEqual({
        use_default_objects: false,
      });
    });

    it('compiles verified_customer_record_access with additional_objects', () => {
      const source = `
config:
    developer_name: "test_agent"
    default_agent_user: "test@example.com"

security:
    verified_customer_record_access:
        use_default_objects: True
        additional_objects:
          - CustomOrder.ShopperId
          - Account.ContactName

start_agent main:
    description: "Main topic"
`.trimStart();

      const ast = parseSource(source);
      const { output, diagnostics } = compile(ast);

      const errors = diagnostics.filter(
        d => d.severity === DiagnosticSeverity.Error
      );
      expect(errors).toHaveLength(0);

      expect(output.global_configuration.security).toBeDefined();
      expect(
        output.global_configuration.security?.verified_customer_record_access
      ).toEqual({
        use_default_objects: true,
        additional_objects: ['CustomOrder.ShopperId', 'Account.ContactName'],
      });
    });

    it('compiles verified_customer_record_access with string literals in additional_objects', () => {
      const source = `
config:
    developer_name: "test_agent"
    default_agent_user: "test@example.com"

security:
    verified_customer_record_access:
        use_default_objects: False
        additional_objects:
          - "CustomEntity.ContactRef"
          - "Order.CustomerId"

start_agent main:
    description: "Main topic"
`.trimStart();

      const ast = parseSource(source);
      const { output, diagnostics } = compile(ast);

      const errors = diagnostics.filter(
        d => d.severity === DiagnosticSeverity.Error
      );
      expect(errors).toHaveLength(0);

      expect(output.global_configuration.security).toBeDefined();
      expect(
        output.global_configuration.security?.verified_customer_record_access
      ).toEqual({
        use_default_objects: false,
        additional_objects: ['CustomEntity.ContactRef', 'Order.CustomerId'],
      });
    });

    it('omits security when not present in AST', () => {
      const source = `
config:
    developer_name: "test_agent"
    default_agent_user: "test@example.com"

start_agent main:
    description: "Main topic"
`.trimStart();

      const ast = parseSource(source);
      const { output, diagnostics } = compile(ast);

      const errors = diagnostics.filter(
        d => d.severity === DiagnosticSeverity.Error
      );
      expect(errors).toHaveLength(0);

      expect(output.global_configuration.security).toBeUndefined();
    });

    it('emits error when verified_customer_record_access is empty (missing use_default_objects)', () => {
      const source = `
config:
    developer_name: "test_agent"
    default_agent_user: "test@example.com"

security:
    verified_customer_record_access:

start_agent main:
    description: "Main topic"
`.trimStart();

      const ast = parseSource(source);
      const { output, diagnostics } = compile(ast);

      const errors = diagnostics.filter(
        d => d.severity === DiagnosticSeverity.Error
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('use_default_objects');

      expect(output.global_configuration.security).toBeUndefined();
    });

    it('compiles security with both use_default_objects and additional_objects', () => {
      const source = `
config:
    developer_name: "test_agent"
    default_agent_user: "test@example.com"

security:
    verified_customer_record_access:
        use_default_objects: True
        additional_objects:
          - CustomEntity.ContactRef
          - Account.ContactId
          - Order.ShopperId

start_agent main:
    description: "Main topic"
`.trimStart();

      const ast = parseSource(source);
      const { output, diagnostics } = compile(ast);

      const errors = diagnostics.filter(
        d => d.severity === DiagnosticSeverity.Error
      );
      expect(errors).toHaveLength(0);

      expect(output.global_configuration.security).toBeDefined();
      expect(
        output.global_configuration.security?.verified_customer_record_access
      ).toEqual({
        use_default_objects: true,
        additional_objects: [
          'CustomEntity.ContactRef',
          'Account.ContactId',
          'Order.ShopperId',
        ],
      });
    });

    it('handles nested member expressions in additional_objects', () => {
      const source = `
config:
    developer_name: "test_agent"
    default_agent_user: "test@example.com"

security:
    verified_customer_record_access:
        use_default_objects: False
        additional_objects:
          - Account.Owner.ContactId

start_agent main:
    description: "Main topic"
`.trimStart();

      const ast = parseSource(source);
      const { output, diagnostics } = compile(ast);

      const errors = diagnostics.filter(
        d => d.severity === DiagnosticSeverity.Error
      );
      expect(errors).toHaveLength(0);

      expect(output.global_configuration.security).toBeDefined();
      expect(
        output.global_configuration.security?.verified_customer_record_access
          ?.additional_objects
      ).toContain('Account.Owner.ContactId');
    });
  });

  describe('Error diagnostics', () => {
    it('emits error when use_default_objects is missing from verified_customer_record_access', () => {
      const source = `
config:
    developer_name: "test_agent"
    default_agent_user: "test@example.com"

security:
    verified_customer_record_access:
        additional_objects:
          - Account.ContactId

start_agent main:
    description: "Main topic"
`.trimStart();

      const ast = parseSource(source);
      const { output, diagnostics } = compile(ast);

      const errors = diagnostics.filter(
        d => d.severity === DiagnosticSeverity.Error
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('use_default_objects');

      // Security should not be emitted when required field is missing
      expect(output.global_configuration.security).toBeUndefined();
    });

    it('emits error for unsupported expression types in additional_objects', () => {
      const source = `
config:
    developer_name: "test_agent"
    default_agent_user: "test@example.com"

security:
    verified_customer_record_access:
        use_default_objects: True
        additional_objects:
          - 42

start_agent main:
    description: "Main topic"
`.trimStart();

      const ast = parseSource(source);
      const { diagnostics } = compile(ast);

      const errors = diagnostics.filter(
        d => d.severity === DiagnosticSeverity.Error
      );
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(
        errors.some(e => e.message.includes('Unsupported expression type'))
      ).toBe(true);
    });
  });

  describe('Integration with full agent', () => {
    it('compiles security in a complete agent definition', () => {
      const source = `
system:
    instructions: "You are a customer service agent."

config:
    developer_name: "customer_service_agent"
    default_agent_user: "support@example.com"
    enable_enhanced_event_logs: True

security:
    verified_customer_record_access:
        use_default_objects: True
        additional_objects:
          - CustomOrder.ShopperId
          - Account.ContactName

variables:
    contact_id: mutable string
        description: "Contact ID"

start_agent ServiceAgent:
    description: "Main service topic"
    reasoning:
        instructions: "Help the customer with their request."
`.trimStart();

      const ast = parseSource(source);
      const { output, diagnostics } = compile(ast);

      const errors = diagnostics.filter(
        d => d.severity === DiagnosticSeverity.Error
      );
      expect(errors).toHaveLength(0);

      // Verify config is compiled
      expect(output.global_configuration.developer_name).toBe(
        'customer_service_agent'
      );

      // Verify security is compiled
      expect(output.global_configuration.security).toBeDefined();
      expect(
        output.global_configuration.security?.verified_customer_record_access
      ).toEqual({
        use_default_objects: true,
        additional_objects: ['CustomOrder.ShopperId', 'Account.ContactName'],
      });

      // Verify agent version is compiled
      expect(output.agent_version.initial_node).toBe('ServiceAgent');
    });
  });
});
