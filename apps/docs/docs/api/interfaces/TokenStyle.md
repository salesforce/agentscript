[**AgentScript API**](../index.md) • **Docs**

***

# Interface: TokenStyle

AgentScript theme color definitions — SINGLE SOURCE OF TRUTH.

All syntax highlighting colors for both Monaco and VS Code are defined here.
Monaco imports these directly. VS Code's package.json is synced via:

  pnpm sync-theme

Run that command after changing any colors here.

## Properties

### bold?

> `optional` **bold**: `boolean`

#### Defined in

[monaco/src/theme.ts:21](https://github.com/salesforce/agentscript/blob/fbe864ab5fc4785e497a92e2c3f6f4575ef8510c/packages/monaco/src/theme.ts#L21)

***

### foreground?

> `optional` **foreground**: `string`

#### Defined in

[monaco/src/theme.ts:20](https://github.com/salesforce/agentscript/blob/fbe864ab5fc4785e497a92e2c3f6f4575ef8510c/packages/monaco/src/theme.ts#L20)

***

### italic?

> `optional` **italic**: `boolean`

#### Defined in

[monaco/src/theme.ts:22](https://github.com/salesforce/agentscript/blob/fbe864ab5fc4785e497a92e2c3f6f4575ef8510c/packages/monaco/src/theme.ts#L22)
