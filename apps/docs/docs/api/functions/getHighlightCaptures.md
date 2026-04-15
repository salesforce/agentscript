[**AgentScript API**](../index.md) • **Docs**

***

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

[monaco/src/parser-api.ts:116](https://github.com/salesforce/agentscript/blob/fbe864ab5fc4785e497a92e2c3f6f4575ef8510c/packages/monaco/src/parser-api.ts#L116)
