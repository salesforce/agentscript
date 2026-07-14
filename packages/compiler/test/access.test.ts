/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { DiagnosticSeverity } from '../src/diagnostics.js';
import { parseSource } from './test-utils.js';

describe('Access compilation', () => {
  describe('Global access configuration', () => {
    it('compiles verified_customer_record_access with use_default_objects: true', () => {
      const source = `
config:
    developer_name: "test_agent"

access:
    default_agent_user: "test@example.com"
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

access:
    default_agent_user: "test@example.com"
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

access:
    default_agent_user: "test@example.com"
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

access:
    default_agent_user: "test@example.com"
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

    it('omits security when verified_customer_record_access is not set', () => {
      const source = `
config:
    developer_name: "test_agent"

access:
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

access:
    default_agent_user: "test@example.com"
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

    it('handles nested member expressions in additional_objects', () => {
      const source = `
config:
    developer_name: "test_agent"

access:
    default_agent_user: "test@example.com"
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

access:
    default_agent_user: "test@example.com"
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

      expect(output.global_configuration.security).toBeUndefined();
    });

    it('emits error for unsupported expression types in additional_objects', () => {
      const source = `
config:
    developer_name: "test_agent"

access:
    default_agent_user: "test@example.com"
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

  describe('default_agent_user backwards compatibility', () => {
    it('reads default_agent_user from access block', () => {
      const source = `
config:
    developer_name: "test_agent"

access:
    default_agent_user: "new@example.com"

start_agent main:
    description: "Main topic"
`.trimStart();

      const ast = parseSource(source);
      const { output } = compile(ast);

      expect(output.global_configuration.default_agent_user).toBe(
        'new@example.com'
      );
    });

    it('still reads default_agent_user from config block (deprecated)', () => {
      const source = `
config:
    developer_name: "test_agent"
    default_agent_user: "old@example.com"

start_agent main:
    description: "Main topic"
`.trimStart();

      const ast = parseSource(source);
      const { output } = compile(ast);

      expect(output.global_configuration.default_agent_user).toBe(
        'old@example.com'
      );
    });

    it('access.default_agent_user wins when both are set', () => {
      const source = `
config:
    developer_name: "test_agent"
    default_agent_user: "old@example.com"

access:
    default_agent_user: "new@example.com"

start_agent main:
    description: "Main topic"
`.trimStart();

      const ast = parseSource(source);
      const { output } = compile(ast);

      expect(output.global_configuration.default_agent_user).toBe(
        'new@example.com'
      );
    });

    it('omits default_agent_user from output when set to None', () => {
      const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceEmployeeAgent"

access:
    default_agent_user: None

start_agent main:
    description: "Main topic"
`.trimStart();

      const ast = parseSource(source);
      const { output } = compile(ast);

      expect(output.global_configuration.default_agent_user).toBeUndefined();
    });

    it('omits default_agent_user from output when an employee agent omits it entirely', () => {
      const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceEmployeeAgent"

start_agent main:
    description: "Main topic"
`.trimStart();

      const ast = parseSource(source);
      const { output, diagnostics } = compile(ast);

      const errors = diagnostics.filter(
        d => d.severity === DiagnosticSeverity.Error
      );
      expect(errors).toHaveLength(0);
      expect(output.global_configuration.default_agent_user).toBeUndefined();
    });
  });

  describe('Integration with full agent', () => {
    it('compiles access in a complete agent definition', () => {
      const source = `
system:
    instructions: "You are a customer service agent."

config:
    developer_name: "customer_service_agent"
    enable_enhanced_event_logs: True

access:
    default_agent_user: "support@example.com"
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

      expect(output.global_configuration.developer_name).toBe(
        'customer_service_agent'
      );
      expect(output.global_configuration.default_agent_user).toBe(
        'support@example.com'
      );

      expect(output.global_configuration.security).toBeDefined();
      expect(
        output.global_configuration.security?.verified_customer_record_access
      ).toEqual({
        use_default_objects: true,
        additional_objects: ['CustomOrder.ShopperId', 'Account.ContactName'],
      });

      expect(output.agent_version.initial_node).toBe('ServiceAgent');
    });
  });
});
