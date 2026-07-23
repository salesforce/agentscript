[**AgentScript API**](../index.md) • **Docs**

---

# Function: getHighlightCaptures()

> **getHighlightCaptures**(`code`): `Promise`\<[`HighlightCapture`](../interfaces/HighlightCapture.md)[]\>

Get syntax highlighting captures for AgentScript code

## Parameters

• **code**: `string`

The AgentScript source code

## Returns

`Promise`\<[`HighlightCapture`](../interfaces/HighlightCapture.md)[]\>

Array of highlight captures, or empty array if parsing fails

## Defined in

[monaco/src/parser-api.ts:116](https://github.com/salesforce/agentscript/blob/1ed0538b7e50cde14c4ea7e79c8bd88eb8288c5e/packages/monaco/src/parser-api.ts#L116)
