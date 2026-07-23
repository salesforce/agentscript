[**AgentScript API**](../index.md) • **Docs**

---

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

[monaco/src/parser-api.ts:91](https://github.com/salesforce/agentscript/blob/1ed0538b7e50cde14c4ea7e79c8bd88eb8288c5e/packages/monaco/src/parser-api.ts#L91)
