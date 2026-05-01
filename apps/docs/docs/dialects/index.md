# About Dialects

Agent Script is a flexible language that can be adapted to different platforms and use cases through **dialects**. A dialect is a specific flavor of Agent Script that extends the base language with platform-specific features, blocks, and behaviors.

This documentation covers two official dialects:

- **[Agentforce](agentforce/)** - Designed for building conversational AI agents on the Salesforce Agentforce platform
- **[MuleSoft Agent Fabric](agentfabric/)** - Designed for building integration-focused agent orchestration with guided determinism on the MuleSoft Agent Fabric platform

---

## Agentforce

The Agentforce dialect is designed for building conversational AI agents on the Salesforce Agentforce platform. It includes:

- Integration with Salesforce data and actions
- Platform-specific blocks for agent configuration
- Agentforce-optimized reasoning and execution patterns
- Support for Salesforce-native features like subagents, actions, and knowledge bases

The Agentforce dialect is ideal for enterprise agents that need to work with CRM data, business processes, and Salesforce workflows.

[Explore Agentforce dialect documentation →](agentforce/)

## MuleSoft Agent Fabric

The Agent Fabric dialect is designed for orchestrating agents across multiple agents, tools, and systems with guided determinism. It extends Agent Script with capabilities for:

- **A2A (Agent-to-Agent) communication** - Enables agents to collaborate and delegate tasks to each other
- **MCP (Model Context Protocol) integration** - Connect agents to external tools and data sources
- **Multi-LLM support** - Configure different LLMs (OpenAI, Gemini, etc.) for different nodes
- **Structured node types** - Specialized nodes for subagents, generators, routers, and orchestration
- **Schema-driven outputs** - Define expected response structures for reliable downstream processing

Agent Fabric is designed for complex workflows where agents need to coordinate across enterprise systems, invoke external tools and agents, and manage multi-step processes with deterministic control flow.

[Explore Agent Fabric dialect documentation →](agentfabric/)
