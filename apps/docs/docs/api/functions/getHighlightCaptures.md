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

[monaco/src/parser-api.ts:116](https://github.com/salesforce/agentscript/blob/2a9b4427238262399df3e6ef885d5749b8cf7732/packages/monaco/src/parser-api.ts#L116)
