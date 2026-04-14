---
sidebar_label: "System Overrides"
---

# Agent Script Pattern: Avoid Conflicting Instructions with Instruction Overrides

Override system-level instructions (or "agent-level" instructions in the UI) within specific subagents to change the agent's behavior and persona dynamically.

By default, all subagents inherit the agent-level `system.instructions`. When you add a `system` block to a specific subagent, those instructions override the system ones for that subagent only.

## Why Use This Pattern

If your agent-level system instructions contradict subagent-level reasoning instructions, your agent can hang or behave unexpectedly. System overrides solve this by explicitly replacing system instructions when needed.

Also, system overrides let a single agent adopt different personalities, tones, or behaviors in different contexts—useful when you need the agent to act differently in specific subagents while maintaining consistent behavior elsewhere.

**Pattern Example**: An event planner agent normally avoids suggesting alcohol, but for an adult-only party subagent, override the system instructions to allow cocktail recommendations.

## Instruction Hierarchy

Agent Script follows this hierarchy when determining which system instructions to use:

1. `Topic-level system instructions (highest priority)` - If a subagent has a `system` block, the agent uses those instructions
2. `Agent-level system instructions (fallback)` - If a subagent has no `system` block, the agent uses the global instructions

## Avoiding Instruction Conflicts

When agent-level system instructions contradict subagent-level reasoning instructions, the agent must resolve the conflict, which can cause unexpected behavior.

**Problem**: An event planning agent has global instructions "Never suggest alcoholic beverages at a children's party" but a subagent for a children's party with adults wants to suggest champagne in its reasoning instructions.

**Solution**: Use a system override to explicitly replace the system instructions for that specific subagent.

```agentscript title="System Override to Resolve Conflict"
system:
  instructions: "You are an event planning assistant. NEVER suggest alcoholic beverages for children's parties or events attended primarily by children."

subagent baby_first_birthday:
  description: "Plan a baby's first birthday celebration with adult guests"

  system:
    instructions: "You are an event planning assistant for a baby's first birthday celebration. While the event is for a baby, adult guests are present. You may suggest beverages including champagne for adult guests, while ensuring child-appropriate food and activities."

  reasoning:
    instructions: ->
      | Help plan a memorable first birthday celebration.
        Consider both the baby's needs and adult guest comfort.
        Suggest food, drinks, decorations, and activities.
```

## Creating Multiple Personas

Create different personas for different contexts.

```agentscript title="Technical Support Override"
subagent technical:
  description: "Technical support specialist"

  system:
    instructions: "You are a technical support specialist. Use precise technical terminology, provide step-by-step troubleshooting, ask diagnostic questions, and explain technical concepts clearly. Be patient and thorough."

  reasoning:
    instructions: ->
      | [Technical Support Mode]
        I am now operating in technical support mode with:
        - Precise technical language
        - Diagnostic approach
        - Step-by-step troubleshooting
        How can I assist you with technical issues?
```

```agentscript title="Creative Mode Override"
subagent creative:
  description: "Creative brainstorming assistant"

  system:
    instructions: "You are a creative brainstorming partner. Think outside the box, suggest unconventional ideas, use enthusiastic language, encourage wild ideas, and help explore possibilities without judgment. Be imaginative and supportive."

  reasoning:
    instructions: ->
      | [Creative Mode Activated]
        I'm now in creative brainstorming mode with:
        - Think big and bold
        - No idea too wild
        - Explore all possibilities
        What shall we dream up together?
```

## When to Use Overrides

Use overrides when:

- **Resolving instruction conflicts**. When agent-level system instructions contradict what a specific subagent needs to do. Conflicting instructions can cause unexpected behavior in agents.
- **Different subagents need different tones**. A casual FAQ subagent vs. a formal compliance subagent. Technical experts vs. non-technical users. Casual tone vs. professional and apologetic tone. A billing specialist vs. a technical support specialist.

## Related Topics

- Pattern: [Agent Router Strategies](ascript-patterns-topic-selector.md)
- Pattern: [Subagent Transitions](ascript-patterns-transitions.md)
- Reference: [System Block](../ascript-blocks.md#system-block)
- Recipe: [System Instruction Overrides](https://developer.salesforce.com/sample-apps/agent-script-recipes/language-essentials/system-instruction-overrides)
