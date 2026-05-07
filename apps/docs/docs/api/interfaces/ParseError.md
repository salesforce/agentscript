[**AgentScript API**](../index.md) • **Docs**

***

# Interface: ParseError

## Properties

### data?

> `optional` **data**: `object`

Additional diagnostic data for tooling

#### context?

> `optional` **context**: `string`

What construct was being parsed (parent node type)

#### found?

> `optional` **found**: `string`

What was found instead

#### Defined in

[monaco/src/parser-worker.ts:60](https://github.com/salesforce/agentscript/blob/621b2c63cf0e97f60ebf2b569f1b2cb6a2a2bacd/packages/monaco/src/parser-worker.ts#L60)

***

### message

> **message**: `string`

#### Defined in

[monaco/src/parser-worker.ts:57](https://github.com/salesforce/agentscript/blob/621b2c63cf0e97f60ebf2b569f1b2cb6a2a2bacd/packages/monaco/src/parser-worker.ts#L57)

***

### range

> **range**: `object`

#### end

> **end**: `object`

#### end.character

> **character**: `number`

#### end.line

> **line**: `number`

#### start

> **start**: `object`

#### start.character

> **character**: `number`

#### start.line

> **line**: `number`

#### Defined in

[monaco/src/parser-worker.ts:53](https://github.com/salesforce/agentscript/blob/621b2c63cf0e97f60ebf2b569f1b2cb6a2a2bacd/packages/monaco/src/parser-worker.ts#L53)

***

### source

> **source**: `string`

#### Defined in

[monaco/src/parser-worker.ts:58](https://github.com/salesforce/agentscript/blob/621b2c63cf0e97f60ebf2b569f1b2cb6a2a2bacd/packages/monaco/src/parser-worker.ts#L58)
