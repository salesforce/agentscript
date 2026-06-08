import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';

function compileSource(source: string) {
  return compile(parseSource(source));
}

describe('SubAgent model_config inheritance', () => {
  describe('Scenario 1: Topic-only model_config', () => {
    it('should apply model_config only to topic with explicit config', () => {
      const source = `
config:
    developer_name: "TestAgent"

topic order_management:
    description: "Order management"
    model_config:
        model: "model://gpt-4"
        params:
            temperature: 0.7
    reasoning:
        instructions: ->
            | Help with orders

topic billing:
    description: "Billing support"
    reasoning:
        instructions: ->
            | Help with billing
`;
      const { output } = compileSource(source);

      const orderNode = output.agent_version.nodes.find(
        n => n.developer_name === 'order_management'
      )!;
      const billingNode = output.agent_version.nodes.find(
        n => n.developer_name === 'billing'
      )!;
      expect(orderNode).toBeDefined();
      expect(orderNode.model_configuration).toBeDefined();
      expect(orderNode.model_configuration.model_ref).toBe('gpt-4');
      expect(orderNode.model_configuration.configuration).toEqual({
        temperature: 0.7,
      });

      // billing should NOT have model_config
      expect(billingNode).toBeDefined();
      expect(billingNode.model_configuration).toBeUndefined();
    });
  });

  describe('Scenario 2: Global-only model_config', () => {
    it('should apply global model_config to all SubAgent nodes', () => {
      const source = `
config:
    developer_name: "TestAgent"

model_config:
    model: "model://gpt-4"
    params:
        temperature: 0.7
        max_tokens: 2000

topic order_management:
    description: "Order management"
    reasoning:
        instructions: ->
            | Help with orders

topic billing:
    description: "Billing support"
    reasoning:
        instructions: ->
            | Help with billing
`;
      const { output } = compileSource(source);

      const orderNode = output.agent_version.nodes.find(
        n => n.developer_name === 'order_management'
      )!;
      const billingNode = output.agent_version.nodes.find(
        n => n.developer_name === 'billing'
      )!;

      // Both nodes should inherit global config
      expect(orderNode).toBeDefined();
      expect(orderNode.model_configuration).toBeDefined();
      expect(orderNode.model_configuration.model_ref).toBe('gpt-4');
      expect(orderNode.model_configuration.configuration).toEqual({
        temperature: 0.7,
        max_tokens: 2000,
      });

      expect(billingNode).toBeDefined();
      expect(billingNode.model_configuration).toBeDefined();
      expect(billingNode.model_configuration.model_ref).toBe('gpt-4');
      expect(billingNode.model_configuration.configuration).toEqual({
        temperature: 0.7,
        max_tokens: 2000,
      });
    });
  });

  describe('Scenario 3: Mixed inheritance (global + overrides)', () => {
    it('should merge global and topic configs with topic winning', () => {
      const source = `
config:
    developer_name: "TestAgent"

model_config:
    model: "model://gpt-4"
    params:
        temperature: 0.7
        max_tokens: 2000

topic order_management:
    description: "Order management"
    model_config:
        params:
            temperature: 0.9
    reasoning:
        instructions: ->
            | Help with orders

topic billing:
    description: "Billing support"
    reasoning:
        instructions: ->
            | Help with billing
`;
      const { output } = compileSource(source);

      const orderNode = output.agent_version.nodes.find(
        n => n.developer_name === 'order_management'
      )!;
      const billingNode = output.agent_version.nodes.find(
        n => n.developer_name === 'billing'
      )!;

      // order_management: topic params override global (temperature), inherit max_tokens
      expect(orderNode).toBeDefined();
      expect(orderNode.model_configuration).toBeDefined();
      expect(orderNode.model_configuration.model_ref).toBe('gpt-4');
      expect(orderNode.model_configuration.configuration).toEqual({
        temperature: 0.9,
        max_tokens: 2000,
      });

      // billing: inherits global config unchanged
      expect(billingNode).toBeDefined();
      expect(billingNode.model_configuration).toBeDefined();
      expect(billingNode.model_configuration.model_ref).toBe('gpt-4');
      expect(billingNode.model_configuration.configuration).toEqual({
        temperature: 0.7,
        max_tokens: 2000,
      });
    });

    it('should override model_ref when topic specifies different model', () => {
      const source = `
config:
    developer_name: "TestAgent"

model_config:
    model: "model://gpt-4"
    params:
        temperature: 0.7

topic order_management:
    description: "Order management"
    model_config:
        model: "model://gpt-3.5-turbo"
    reasoning:
        instructions: ->
            | Help with orders
`;
      const { output } = compileSource(source);

      const orderNode = output.agent_version.nodes.find(
        n => n.developer_name === 'order_management'
      )!;

      // Topic model_ref overrides global
      expect(orderNode).toBeDefined();
      expect(orderNode.model_configuration).toBeDefined();
      expect(orderNode.model_configuration.model_ref).toBe('gpt-3.5-turbo');
      // Global params still inherited
      expect(orderNode.model_configuration.configuration).toEqual({
        temperature: 0.7,
      });
    });

    it('should handle topic params without model_ref', () => {
      const source = `
config:
    developer_name: "TestAgent"

model_config:
    model: "model://gpt-4"
    params:
        temperature: 0.7
        max_tokens: 2000

topic order_management:
    description: "Order management"
    model_config:
        params:
            temperature: 0.5
            top_p: 0.9
    reasoning:
        instructions: ->
            | Help with orders
`;
      const { output } = compileSource(source);

      const orderNode = output.agent_version.nodes.find(
        n => n.developer_name === 'order_management'
      )!;

      // Should inherit global model_ref, merge params
      expect(orderNode).toBeDefined();
      expect(orderNode.model_configuration).toBeDefined();
      expect(orderNode.model_configuration.model_ref).toBe('gpt-4');
      expect(orderNode.model_configuration.configuration).toEqual({
        temperature: 0.5, // Topic override
        max_tokens: 2000, // Inherited from global
        top_p: 0.9, // New param from topic
      });
    });
  });

  describe('RouterNode compatibility', () => {
    it('should not break existing router node behavior', () => {
      const source = `
config:
    developer_name: "TestAgent"
    default_agent_user: "test@example.com"

model_config:
    model: "model://gpt-4"
    params:
        temperature: 0.7

start_agent router:
    description: "Router"
    model_config:
        model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"
        params:
            temperature: 0.9
    reasoning:
        instructions: ->
            | Route
        actions:
            go_support: @utils.transition to @topic.support
                description: "Go to support"

topic support:
    description: "Support"
    reasoning:
        instructions: ->
            | Help
`;
      const { output } = compileSource(source);

      const routerNode = output.agent_version.nodes.find(
        n => n.developer_name === 'router'
      )!;
      const supportNode = output.agent_version.nodes.find(
        n => n.developer_name === 'support'
      )!;

      // Router should use its own config (override global)
      expect(routerNode).toBeDefined();
      expect(routerNode.type).toBe('router');
      expect(routerNode.model_configuration).toBeDefined();
      expect(routerNode.model_configuration.model_ref).toBe(
        'sfdc_ai__DefaultEinsteinHyperClassifier'
      );
      expect(routerNode.model_configuration.configuration).toEqual({
        temperature: 0.9,
      });

      // Support (SubAgent) inherits global
      expect(supportNode).toBeDefined();
      expect(supportNode.type).toBe('subagent');
      expect(supportNode.model_configuration).toBeDefined();
      expect(supportNode.model_configuration.model_ref).toBe('gpt-4');
      expect(supportNode.model_configuration.configuration).toEqual({
        temperature: 0.7,
      });
    });

    it('should handle router with global config but no topic override', () => {
      const source = `
config:
    developer_name: "TestAgent"
    default_agent_user: "test@example.com"

model_config:
    model: "model://gpt-4"
    params:
        temperature: 0.7

start_agent router:
    description: "Router"
    model_config:
        model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"
    reasoning:
        instructions: ->
            | Route
        actions:
            go_support: @utils.transition to @topic.support
                description: "Go to support"

topic support:
    description: "Support"
    reasoning:
        instructions: ->
            | Help
`;
      const { output } = compileSource(source);

      const routerNode = output.agent_version.nodes.find(
        n => n.developer_name === 'router'
      )!;

      // Router should use its model but inherit global params
      expect(routerNode).toBeDefined();
      expect(routerNode.model_configuration.model_ref).toBe(
        'sfdc_ai__DefaultEinsteinHyperClassifier'
      );
      expect(routerNode.model_configuration.configuration).toEqual({
        temperature: 0.7,
      });
    });
  });

  describe('Edge cases', () => {
    it('should return undefined when neither global nor topic has config', () => {
      const source = `
config:
    developer_name: "TestAgent"

topic order_management:
    description: "Order management"
    reasoning:
        instructions: ->
            | Help with orders
`;
      const { output } = compileSource(source);

      const orderNode = output.agent_version.nodes.find(
        n => n.developer_name === 'order_management'
      )!;

      expect(orderNode).toBeDefined();
      expect(orderNode.model_configuration).toBeUndefined();
    });

    it('should have undefined model_configuration on all nodes when no config defined', () => {
      const source = `
config:
    developer_name: "TestAgent"

topic topic1:
    description: "Topic 1"
    reasoning:
        instructions: -> | Help 1

topic topic2:
    description: "Topic 2"
    reasoning:
        instructions: -> | Help 2

topic topic3:
    description: "Topic 3"
    reasoning:
        instructions: -> | Help 3
`;
      const { output } = compileSource(source);

      const topic1 = output.agent_version.nodes.find(
        n => n.developer_name === 'topic1'
      )!;
      const topic2 = output.agent_version.nodes.find(
        n => n.developer_name === 'topic2'
      )!;
      const topic3 = output.agent_version.nodes.find(
        n => n.developer_name === 'topic3'
      )!;

      expect(topic1).toBeDefined();
      expect(topic1.model_configuration).toBeUndefined();

      expect(topic2).toBeDefined();
      expect(topic2.model_configuration).toBeUndefined();

      expect(topic3).toBeDefined();
      expect(topic3.model_configuration).toBeUndefined();
    });

    it('should reject model URI without scheme', () => {
      const source = `
config:
    developer_name: "TestAgent"

model_config:
    model: "gpt-4"

topic order_management:
    description: "Order management"
    reasoning:
        instructions: ->
            | Help with orders
`;
      const { output, diagnostics } = compileSource(source);

      const orderNode = output.agent_version.nodes.find(
        n => n.developer_name === 'order_management'
      )!;

      // Should have undefined model_config due to validation error
      expect(orderNode).toBeDefined();
      expect(orderNode.model_configuration).toBeUndefined();

      // Should have error diagnostic
      expect(
        diagnostics.some(
          d =>
            d.message.includes('Model URI must include a scheme') &&
            d.message.includes('gpt-4')
        )
      ).toBe(true);
    });

    it('should handle multiple topics with mixed configs', () => {
      const source = `
config:
    developer_name: "TestAgent"

model_config:
    model: "model://gpt-4"
    params:
        temperature: 0.7
        max_tokens: 2000

topic topic1:
    description: "Topic 1"
    reasoning:
        instructions: -> | Help 1

topic topic2:
    description: "Topic 2"
    model_config:
        params:
            temperature: 0.9
    reasoning:
        instructions: -> | Help 2

topic topic3:
    description: "Topic 3"
    model_config:
        model: "model://gpt-3.5-turbo"
        params:
            max_tokens: 1000
    reasoning:
        instructions: -> | Help 3

topic topic4:
    description: "Topic 4"
    reasoning:
        instructions: -> | Help 4
`;
      const { output } = compileSource(source);

      const topic1 = output.agent_version.nodes.find(
        n => n.developer_name === 'topic1'
      )!;
      const topic2 = output.agent_version.nodes.find(
        n => n.developer_name === 'topic2'
      )!;
      const topic3 = output.agent_version.nodes.find(
        n => n.developer_name === 'topic3'
      )!;
      const topic4 = output.agent_version.nodes.find(
        n => n.developer_name === 'topic4'
      )!;

      // topic1: inherits global config
      expect(topic1.model_configuration).toEqual({
        model_ref: 'gpt-4',
        configuration: { temperature: 0.7, max_tokens: 2000 },
      });

      // topic2: inherits model_ref, overrides temperature, keeps max_tokens
      expect(topic2.model_configuration).toEqual({
        model_ref: 'gpt-4',
        configuration: { temperature: 0.9, max_tokens: 2000 },
      });

      // topic3: overrides model and max_tokens, inherits temperature
      expect(topic3.model_configuration).toEqual({
        model_ref: 'gpt-3.5-turbo',
        configuration: { temperature: 0.7, max_tokens: 1000 },
      });

      // topic4: inherits global config
      expect(topic4.model_configuration).toEqual({
        model_ref: 'gpt-4',
        configuration: { temperature: 0.7, max_tokens: 2000 },
      });
    });
  });
});
