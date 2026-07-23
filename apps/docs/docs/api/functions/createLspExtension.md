[**AgentScript API**](../index.md) • **Docs**

---

# Function: createLspExtension()

> **createLspExtension**(`config`): `object`

## Parameters

• **config**: [`LspExtensionConfig`](../interfaces/LspExtensionConfig.md)

## Returns

`object`

### activate()

> **activate**: (`vscodeWrapper`) => `Promise`\<`object`\>

#### Parameters

• **vscodeWrapper**: [`VscodeWrapper`](../interfaces/VscodeWrapper.md)

#### Returns

`Promise`\<`object`\>

##### languageClientConfig

> **languageClientConfig**: `object`

##### languageClientConfig.clientOptions

> **clientOptions**: `object`

##### languageClientConfig.clientOptions.documentSelector

> **documentSelector**: (`object` \| `object`)[]

##### languageClientConfig.clientOptions.initializationOptions

> **initializationOptions**: `object`

##### languageClientConfig.clientOptions.initializationOptions.dialect

> **dialect**: `string`

##### languageClientConfig.connection

> **connection**: `object`

##### languageClientConfig.connection.messageTransports

> **messageTransports**: `object`

##### languageClientConfig.connection.messageTransports.reader

> **reader**: `any`

##### languageClientConfig.connection.messageTransports.writer

> **writer**: `any`

##### languageClientConfig.connection.options

> **options**: `object`

##### languageClientConfig.connection.options.$type

> **$type**: `string` = `'MessageChannel'`

##### languageClientConfig.connection.options.worker

> **worker**: `any`

##### languageClientConfig.languageId

> **languageId**: `string`

### config

> **config**: [`ExtensionManifest`](../interfaces/ExtensionManifest.md) = `manifest`

## Defined in

[monaco/src/lsp-extension.ts:60](https://github.com/salesforce/agentscript/blob/1ed0538b7e50cde14c4ea7e79c8bd88eb8288c5e/packages/monaco/src/lsp-extension.ts#L60)
