[**AgentScript API**](../index.md) • **Docs**

---

# Interface: VscodeWrapper

LSP Extension factory for Monaco editors using VSCode API compatibility layers.

This enables full LSP support (hover, completion, diagnostics, etc.) in browser-based
Monaco editors that provide a VSCode-compatible API surface.

## Properties

### vscode?

> `optional` **vscode**: `object`

#### workspace?

> `optional` **workspace**: `object`

#### workspace.getConfiguration()

##### Parameters

• **section**: `string`

##### Returns

`any`

#### Defined in

[monaco/src/lsp-extension.ts:22](https://github.com/salesforce/agentscript/blob/1ed0538b7e50cde14c4ea7e79c8bd88eb8288c5e/packages/monaco/src/lsp-extension.ts#L22)

---

### vscodeApi

> **vscodeApi**: `object`

#### VSCodeLanguageClientBrowser

> **VSCodeLanguageClientBrowser**: `object`

#### VSCodeLanguageClientBrowser.BrowserMessageReader

> **BrowserMessageReader**: `any`

#### VSCodeLanguageClientBrowser.BrowserMessageWriter

> **BrowserMessageWriter**: `any`

#### Defined in

[monaco/src/lsp-extension.ts:16](https://github.com/salesforce/agentscript/blob/1ed0538b7e50cde14c4ea7e79c8bd88eb8288c5e/packages/monaco/src/lsp-extension.ts#L16)
