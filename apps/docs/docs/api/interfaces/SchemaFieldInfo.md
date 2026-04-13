[**AgentScript API**](../index.md) • **Docs**

***

# Interface: SchemaFieldInfo

Interface for navigating the schema tree during hover resolution.
FieldType structurally satisfies this interface so no cast is needed
when passing a dialect schema to resolveSchemaField.

## Properties

### \_\_isCollection?

> `optional` **\_\_isCollection**: `boolean`

#### Defined in

language/dist/core/analysis/schema-hover.d.ts:17

***

### \_\_isTypedMap?

> `optional` **\_\_isTypedMap**: `boolean`

#### Defined in

language/dist/core/analysis/schema-hover.d.ts:20

***

### \_\_metadata?

> `optional` **\_\_metadata**: `FieldMetadata`

#### Defined in

language/dist/core/analysis/schema-hover.d.ts:19

***

### \_\_modifiers?

> `optional` **\_\_modifiers**: readonly `KeywordInfo`[]

#### Defined in

language/dist/core/analysis/schema-hover.d.ts:22

***

### \_\_primitiveTypes?

> `optional` **\_\_primitiveTypes**: readonly `KeywordInfo`[]

#### Defined in

language/dist/core/analysis/schema-hover.d.ts:23

***

### isNamed?

> `optional` **isNamed**: `boolean`

#### Defined in

language/dist/core/analysis/schema-hover.d.ts:16

***

### propertiesSchema?

> `optional` **propertiesSchema**: `Record`\<`string`, [`SchemaFieldInfo`](SchemaFieldInfo.md) \| [`SchemaFieldInfo`](SchemaFieldInfo.md)[]\>

#### Defined in

language/dist/core/analysis/schema-hover.d.ts:21

***

### schema?

> `optional` **schema**: `Record`\<`string`, [`SchemaFieldInfo`](SchemaFieldInfo.md) \| [`SchemaFieldInfo`](SchemaFieldInfo.md)[]\>

#### Defined in

language/dist/core/analysis/schema-hover.d.ts:18
