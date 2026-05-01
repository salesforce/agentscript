# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

## [2.4.0] - 2026-5-1

### Added

- Support for `@VoiceCall` context variables for voice channel integrations.
- Support for `@utils.end_session` as a callable tool to programmatically end agent sessions.
- Enhanced code completion that works inside partially-typed `with` statements and uses indentation-based fallback for better accuracy.
- Validation for `routes.when` expressions - now requires boolean-like expressions (comparisons, logical operators, or boolean literals).
- New lint rule that flags spreading non-iterable literals (None, numbers, booleans, strings) which will fail at runtime.
- Validation for duplicate `with` and `set` statements within the same scope.
- Enhanced code snippets for collection blocks and enum types with example-based suggestions.

### Changed

- The `topic` block keyword now shows a deprecation warning suggesting to use `subagent` instead.
- Connection `response_tools` renamed to `response_actions` throughout.
- Connection instructions now use template-only syntax (`|` instead of `->`).
- Renamed `action_definitions` to `actions` in AgentFabric dialect for consistency.
- Removed the lint requirement that variables must be linked on connected agents.
- Code completions for `reasoning.instructions` actions now correctly resolve action references.
- LLM `kind` values now have canonical enum constraints for validation.

### Fixed

- Position range calculation for cursor-based operations now correctly handles boundary conditions.

### Changed

- Updated dependencies:
  - @agentscript/lsp-server@2.2.25
  - @agentscript/lsp@2.2.25
  - @agentscript/agentforce@2.5.31

## [2.2.4] - 2026-4-23

### Added

- Syntax support for connection inputs and structured response format definitions.
- Validation for unbound connected subagent inputs.
- Support for placeholder (stub) actions.
- Commerce Cloud Shopper Agent custom subagent support.

### Fixed

- Syntax highlighting now works correctly with light themes and third-party color themes.
- Special character escaping in string literals during compilation.

### Changed

- Removed `unused-variable` lint warnings (now shown as informational diagnostics).
- Removed non-existent `@utils.supervise` from language completions.
- Updated dependencies:
  - @agentscript/agentforce@2.5.19
  - @agentscript/lsp-server@2.2.14

## [2.2.3] - 2026-4-14

### Added

- Syntax support for `on_init` and `on_exit` properties on custom subagents.
- Syntax support for the spread operator (`*expr`) to unpack arrays in function calls and list literals. For example: `fn(*@variables.items)` or `[*@variables.existing, new_item]`.
- Enhanced validation and code completion for custom subagent schemas.

### Changed

- Action parameter type mismatches now appear as warnings instead of errors, allowing for more flexible type handling.
- Updated dependencies:
  - @agentscript/agentforce@2.5.19
  - @agentscript/lsp-server@2.2.14

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
