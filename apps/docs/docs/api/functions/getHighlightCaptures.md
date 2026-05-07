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

[monaco/src/parser-api.ts:116](https://github.com/salesforce/agentscript/blob/621b2c63cf0e97f60ebf2b569f1b2cb6a2a2bacd/packages/monaco/src/parser-api.ts#L116)
