[**AgentScript API**](../index.md) • **Docs**

***

# Class: WorkerParserManager

## Constructors

### new WorkerParserManager()

> **new WorkerParserManager**(): [`WorkerParserManager`](WorkerParserManager.md)

#### Returns

[`WorkerParserManager`](WorkerParserManager.md)

## Methods

### clearCrashCache()

> **clearCrashCache**(): `void`

Clear the crash cooldown (e.g., to force retry)

#### Returns

`void`

#### Defined in

[monaco/src/worker-parser.ts:317](https://github.com/salesforce/agentscript/blob/fbe864ab5fc4785e497a92e2c3f6f4575ef8510c/packages/monaco/src/worker-parser.ts#L317)

***

### getErrors()

> **getErrors**(`code`): `Promise`\<[`ErrorResult`](../interfaces/ErrorResult.md)\>

Get parse errors

#### Parameters

• **code**: `string`

#### Returns

`Promise`\<[`ErrorResult`](../interfaces/ErrorResult.md)\>

#### Defined in

[monaco/src/worker-parser.ts:484](https://github.com/salesforce/agentscript/blob/fbe864ab5fc4785e497a92e2c3f6f4575ef8510c/packages/monaco/src/worker-parser.ts#L484)

***

### highlight()

> **highlight**(`code`): `Promise`\<[`HighlightResult`](../interfaces/HighlightResult.md)\>

Get syntax highlighting captures

#### Parameters

• **code**: `string`

#### Returns

`Promise`\<[`HighlightResult`](../interfaces/HighlightResult.md)\>

#### Defined in

[monaco/src/worker-parser.ts:415](https://github.com/salesforce/agentscript/blob/fbe864ab5fc4785e497a92e2c3f6f4575ef8510c/packages/monaco/src/worker-parser.ts#L415)

***

### initialize()

> **initialize**(): `Promise`\<`void`\>

Initialize the worker

#### Returns

`Promise`\<`void`\>

#### Defined in

[monaco/src/worker-parser.ts:90](https://github.com/salesforce/agentscript/blob/fbe864ab5fc4785e497a92e2c3f6f4575ef8510c/packages/monaco/src/worker-parser.ts#L90)

***

### isReady()

> **isReady**(): `boolean`

Check if the worker is initialized

#### Returns

`boolean`

#### Defined in

[monaco/src/worker-parser.ts:79](https://github.com/salesforce/agentscript/blob/fbe864ab5fc4785e497a92e2c3f6f4575ef8510c/packages/monaco/src/worker-parser.ts#L79)

***

### parse()

> **parse**(`code`): `Promise`\<[`ParseResult`](../interfaces/ParseResult.md)\>

Parse AgentScript code
Uses versioning to skip stale requests - no blocking queue

#### Parameters

• **code**: `string`

#### Returns

`Promise`\<[`ParseResult`](../interfaces/ParseResult.md)\>

#### Defined in

[monaco/src/worker-parser.ts:339](https://github.com/salesforce/agentscript/blob/fbe864ab5fc4785e497a92e2c3f6f4575ef8510c/packages/monaco/src/worker-parser.ts#L339)

***

### restart()

> **restart**(): `Promise`\<`boolean`\>

Restart the worker after a crash

#### Returns

`Promise`\<`boolean`\>

#### Defined in

[monaco/src/worker-parser.ts:233](https://github.com/salesforce/agentscript/blob/fbe864ab5fc4785e497a92e2c3f6f4575ef8510c/packages/monaco/src/worker-parser.ts#L233)

***

### terminate()

> **terminate**(): `void`

Terminate the worker

#### Returns

`void`

#### Defined in

[monaco/src/worker-parser.ts:553](https://github.com/salesforce/agentscript/blob/fbe864ab5fc4785e497a92e2c3f6f4575ef8510c/packages/monaco/src/worker-parser.ts#L553)
