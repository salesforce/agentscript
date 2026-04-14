[**AgentScript API**](../index.md) • **Docs**

***

# Function: resolveHoverInfo()

> **resolveHoverInfo**(`root`, `line`, `character`, `schema`): [`HoverInfo`](../type-aliases/HoverInfo.md) \| `null`

Resolve hover info for a position in the CST.

## Parameters

• **root**: [`SerializedNode`](../interfaces/SerializedNode.md)

The serialized CST root node

• **line**: `number`

0-based line number

• **character**: `number`

0-based character offset

• **schema**: `Record`\<`string`, [`SchemaFieldInfo`](../interfaces/SchemaFieldInfo.md)\>

The root schema object

## Returns

[`HoverInfo`](../type-aliases/HoverInfo.md) \| `null`

Hover info with metadata and range, or null

## Defined in

[monaco/src/schema-resolver.ts:63](https://github.com/salesforce/agentscript/blob/2a9b4427238262399df3e6ef885d5749b8cf7732/packages/monaco/src/schema-resolver.ts#L63)
