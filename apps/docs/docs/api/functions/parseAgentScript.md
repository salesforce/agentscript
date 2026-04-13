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

[monaco/src/parser-api.ts:91](https://github.com/salesforce/agentscript/blob/90ab1dbff7b10e8f9df7f9171b49e51a6d04a0d4/packages/monaco/src/parser-api.ts#L91)
