[**AgentScript API**](../index.md) • **Docs**

***

# Function: parseAndGetErrors()

> **parseAndGetErrors**(`code`): `Promise`\<[`ParseError`](../interfaces/ParseError.md)[]\>

Parse AgentScript and extract syntax errors

## Parameters

• **code**: `string`

The AgentScript source code to parse

## Returns

`Promise`\<[`ParseError`](../interfaces/ParseError.md)[]\>

Array of syntax errors

## Defined in

[monaco/src/parser-api.ts:141](https://github.com/salesforce/agentscript/blob/fbe864ab5fc4785e497a92e2c3f6f4575ef8510c/packages/monaco/src/parser-api.ts#L141)
