[**AgentScript API**](../index.md) • **Docs**

---

# Interface: LspExtensionConfig

## Properties

### dialectConfig()?

> `optional` **dialectConfig**: () => `string`

Function to read dialect configuration

#### Returns

`string`

#### Defined in

[monaco/src/lsp-extension.ts:39](https://github.com/salesforce/agentscript/blob/1ed0538b7e50cde14c4ea7e79c8bd88eb8288c5e/packages/monaco/src/lsp-extension.ts#L39)

---

### documentPatterns?

> `optional` **documentPatterns**: `string`[]

Document glob patterns to match (e.g., ['**/*.agent'])

#### Defined in

[monaco/src/lsp-extension.ts:37](https://github.com/salesforce/agentscript/blob/1ed0538b7e50cde14c4ea7e79c8bd88eb8288c5e/packages/monaco/src/lsp-extension.ts#L37)

---

### languageId?

> `optional` **languageId**: `string`

Language ID (default: 'agentscript')

#### Defined in

[monaco/src/lsp-extension.ts:33](https://github.com/salesforce/agentscript/blob/1ed0538b7e50cde14c4ea7e79c8bd88eb8288c5e/packages/monaco/src/lsp-extension.ts#L33)

---

### serverUrl

> **serverUrl**: `string`

URL to the LSP server worker bundle

#### Defined in

[monaco/src/lsp-extension.ts:31](https://github.com/salesforce/agentscript/blob/1ed0538b7e50cde14c4ea7e79c8bd88eb8288c5e/packages/monaco/src/lsp-extension.ts#L31)

---

### version?

> `optional` **version**: `string`

Extension version

#### Defined in

[monaco/src/lsp-extension.ts:35](https://github.com/salesforce/agentscript/blob/1ed0538b7e50cde14c4ea7e79c8bd88eb8288c5e/packages/monaco/src/lsp-extension.ts#L35)
