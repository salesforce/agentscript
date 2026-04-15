# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

## [2.2.2] - 2026-4-10

### Added

- Improved code completions and reference resolution for action references inside nested `run @actions.X` blocks.

### Fixed

- Action parameter data types: `integer` and `long` types now correctly map to their respective types instead of falling back to `String`.
- Template indentation: Fixed parser issue where template continuation lines at varying indentation levels could cause spurious INDENT/DEDENT tokens, preventing sibling blocks from being recognized.
- Compiler handling of variables in templates: `@system_variables` subscript expressions now properly compile.
- Action-missing-input lint rule: Now correctly respects the `is_required: False` property on action inputs. Optional inputs are no longer flagged as missing when omitted.
- Reasoning action reference resolution: `@outputs` references and completions inside nested `run @actions.X` blocks now resolve against the correct action scope.
- Variable default values: Object and list variables now correctly preserve their default values during compilation. Previously, dictionary literal defaults (e.g., `{"key": "value"}`) were incorrectly compiled as empty objects `{}`, and list defaults lost their elements.

### Changed

- Updated dependencies:
  - @agentscript/agentforce@2.5.19
  - @agentscript/lsp-server@2.2.14

## [2.2.0] - 2026-4-8

### Added

- Add unused-variable warning that flags declared variables never referenced in the document, with a quick-fix code action to remove the declaration.

### Changed
  - @agentscript/agentforce@2.5.13
  - @agentscript/lsp@2.2.11
  - @agentscript/lsp-server@2.2.11

## [2.1.0] - 2026-4-6

### Added

- Code completion for blocks, namespaces, variables, and more.
- Hover support for keywords.
- Support for renamed blocks: topic => subagent

### Changed

- Switched to Agent Script v2.0 framework
  - @agentscript/agentforce@2.5.9
  - @agentscript/lsp@2.2.8
  - @agentscript/lsp-server@2.2.8

- Syntax highlighting is now handled by semantic tokens versus a TextMate grammar. Token scopes and colors have changed, and will likely change more in future releases.
- Lint for connected subagents, improve var linting, disallow LLM inputs in router nodes

## [1.2.14] - 2026-03-11

### Added

- Syntax highlighting support for the built-in functions, `len()`, `min()`, and `max()`.
- Syntax highlighting support for the security block feature for Contact ID-based record access filtering.

### Changed

- Consumes js-client-parser v1.2.14
- Adds telemetry for activation, deactivation, agent script doc load, and error events.

## [1.2.13] - 2026-02-26

### Fixed

- `rag_feature_config_id` can now be set to an empty string to allow default values in templates.
- Text files with arbitrary extensions are no longer interpreted as Agent Script and handled by the agent script language server.

### Changed

- Consumes js-client-parser v1.2.13

## [1.2.11] - 2026-02-16

### Added

- Syntax highlighting support for multiline system welcome and error messages.

### Fixed

- Improved support for variable and topic reference and definition navigation.

### Changed

- Consumes js-client-parser v1.2.11
