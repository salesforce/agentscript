[**AgentScript API**](../index.md) • **Docs**

***

# Function: parseAgentScript()

> **parseAgentScript**(`code`): `Promise`\<[`SerializedNode`](../interfaces/SerializedNode.md) \| `null`\>

Parse AgentScript source code

## Parameters

• **code**: `string`

The AgentScript source code to parse

## Returns

`Promise`\<[`SerializedNode`](../interfaces/SerializedNode.md) \| `null`\>

The serialized parse tree root node, or null if parsing fails

## Defined in

[monaco/src/parser-api.ts:91](https://github.com/salesforce/agentscript/blob/fbe864ab5fc4785e497a92e2c3f6f4575ef8510c/packages/monaco/src/parser-api.ts#L91)
