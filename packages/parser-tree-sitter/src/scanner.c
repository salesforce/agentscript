#include "tree_sitter/alloc.h"
#include "tree_sitter/array.h"
#include "tree_sitter/parser.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

enum TokenType {
    NEWLINE,
    INDENT,
    DEDENT,
    TEMPLATE_CONTENT,
    TEMPLATE_END,
    COMMENT,
    ERROR_SENTINEL,
    OPEN_PAREN,
    CLOSE_PAREN,
};

typedef struct {
    Array(uint16_t) indents;
    uint16_t bracket_depth;
} Scanner;

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

bool tree_sitter_agentscript_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    Scanner *scanner = (Scanner *)payload;

    bool error_recovery_mode = valid_symbols[ERROR_SENTINEL];
    if (error_recovery_mode) {
        return false;
    }

    if (valid_symbols[TEMPLATE_CONTENT]) {
        // We're inside of a template.

        // All paths after this point should call lexer->mark_end(lexer);
        // So this doesn't do anything but it makes us infinite loop if we make a mistake.
        lexer->mark_end(lexer);

        bool has_content = false;
        uint16_t out_of_template_indent_length = *array_back(&scanner->indents);
        lexer->log(lexer, "TEMPLATE: out_of_template_indent_length: %d", out_of_template_indent_length);
        while (true) {
            // This if statement assumes that if valid_symbols[TEMPLATE_CONTENT],
            // then '{!' is also acceptable.
            if (lexer->lookahead == '{') {
                lexer->mark_end(lexer);
                advance(lexer);
                if (lexer->lookahead == '!') {
                    lexer->result_symbol = TEMPLATE_CONTENT;
                    return has_content;
                }
                has_content = true;
                continue;
            }

            bool past_carriage_return = false;
            if (lexer->lookahead == '\r') {
                lexer->mark_end(lexer);
                advance(lexer);
                past_carriage_return = true;
            }
            if (lexer->lookahead == '\n') {
                // Mark end, but don't mark it past \n
                // so that indentation logic will be able to find it in the future

                // Only mark the end if we haven't already marked it before the \r
                if (!past_carriage_return) {
                    lexer->mark_end(lexer);
                }
                advance(lexer);
                uint16_t indent_length = 0;
                while (true) {
                    lexer->log(lexer, "TEMPLATE (indent calc): lookahead: %c", lexer->lookahead);
                    if (lexer->lookahead == ' ') {
                        lexer->log(lexer, "TEMPLATE (indent calc): space");
                        indent_length++;
                        advance(lexer);
                    } else if (lexer->lookahead == '\t') {
                        lexer->log(lexer, "TEMPLATE (indent calc): tab");
                        indent_length += 3;
                        advance(lexer);
                    } else if (lexer->lookahead == '\r') {
                        lexer->log(lexer, "TEMPLATE (indent calc): carriage return");
                        indent_length++;
                        advance(lexer);
                    } else if (lexer->lookahead == '\n') {
                        lexer->log(lexer, "TEMPLATE (indent calc): newline");
                        indent_length = 0;
                        advance(lexer);
                    } else if (lexer->eof(lexer)) {
                        lexer->log(lexer, "TEMPLATE (indent calc): eof");
                        indent_length = 0;
                        break;
                    } else {
                        lexer->log(lexer, "TEMPLATE (indent calc): other");
                        break;
                    }
                }

                lexer->log(lexer, "TEMPLATE (indent calc): indent_length: %d", indent_length);

                if (indent_length <= out_of_template_indent_length) {
                    // The preceding line was the last line of the template
                    lexer->result_symbol = has_content ? TEMPLATE_CONTENT : TEMPLATE_END;
                    return true;
                }
                
                continue;
            }

            if (lexer->eof(lexer)) {
                lexer->mark_end(lexer);
                lexer->result_symbol = has_content ? TEMPLATE_CONTENT : TEMPLATE_END;
                return true;
            }

            advance(lexer);
            has_content = true;
        }
    }

    if (valid_symbols[OPEN_PAREN] && lexer->lookahead == '(') {
        advance(lexer);
        lexer->mark_end(lexer);
        lexer->result_symbol = OPEN_PAREN;
        scanner->bracket_depth++;
        return true;
    }
    if (valid_symbols[CLOSE_PAREN] && lexer->lookahead == ')') {
        advance(lexer);
        lexer->mark_end(lexer);
        lexer->result_symbol = CLOSE_PAREN;
        if (scanner->bracket_depth > 0) scanner->bracket_depth--;
        return true;
    }

    lexer->mark_end(lexer);
    
    bool found_end_of_line = false;
    uint16_t indent_length = 0;
    int32_t first_comment_indent_length = -1;

    while (true) {
        if (lexer->lookahead == '\n') {
            found_end_of_line = true;
            indent_length = 0;
            skip(lexer);
        } else if (lexer->lookahead == ' ') {
            indent_length++;
            skip(lexer);
        } else if (lexer->lookahead == '\r' || lexer->lookahead == '\f') {
            // TODO (Allen): do we need to handle form feed at all?
            indent_length = 0;
            skip(lexer);
        } else if (lexer->lookahead == '\t') {
            indent_length += 3;
            skip(lexer);
        } else if (lexer->lookahead == '#' && (valid_symbols[INDENT] || valid_symbols[DEDENT] || valid_symbols[NEWLINE])) {
            // If we haven't found an EOL yet,
            // then this is a comment after an expression:
            //   foo = bar # comment
            // Just return, since we don't want to generate an indent/dedent
            // token.
            if (!found_end_of_line) {
                return false;
            }
            if (first_comment_indent_length == -1) {
                first_comment_indent_length = (int32_t)indent_length;
            }
            while (lexer->lookahead && lexer->lookahead != '\n') {
                skip(lexer);
            }
            skip(lexer);
            indent_length = 0;
        } else if (lexer->lookahead == '\\') {
            skip(lexer);
            if (lexer->lookahead == '\r') {
                skip(lexer);
            }
            if (lexer->lookahead == '\n' || lexer->eof(lexer)) {
                skip(lexer);
            } else {
                return false;
            }
        } else if (lexer->eof(lexer)) {
            indent_length = 0;
            found_end_of_line = true;
            break;
        } else {
            break;
        }
    }

    if (valid_symbols[OPEN_PAREN] && lexer->lookahead == '(') {
        advance(lexer);
        lexer->mark_end(lexer);
        lexer->result_symbol = OPEN_PAREN;
        scanner->bracket_depth++;
        return true;
    }
    if (valid_symbols[CLOSE_PAREN] && lexer->lookahead == ')') {
        advance(lexer);
        lexer->mark_end(lexer);
        lexer->result_symbol = CLOSE_PAREN;
        if (scanner->bracket_depth > 0) scanner->bracket_depth--;
        return true;
    }

    if (found_end_of_line && scanner->bracket_depth == 0) {
        if (scanner->indents.size > 0) {
            uint16_t current_indent_length = *array_back(&scanner->indents);

            if (valid_symbols[INDENT] && indent_length > current_indent_length) {
                array_push(&scanner->indents, indent_length);
                lexer->result_symbol = INDENT;
                return true;
            }

            if ((valid_symbols[DEDENT]) &&
                indent_length < current_indent_length &&

                // Wait to create a dedent token until we've consumed any
                // comments
                // whose indentation matches the current block.
                first_comment_indent_length < (int32_t)current_indent_length) {
                array_pop(&scanner->indents);
                lexer->result_symbol = DEDENT;
                return true;
            }
        }

        if (valid_symbols[NEWLINE] && !error_recovery_mode) {
            lexer->result_symbol = NEWLINE;
            return true;
        }
    }

    return false;
}

unsigned tree_sitter_agentscript_external_scanner_serialize(void *payload, char *buffer) {
    Scanner *scanner = (Scanner *)payload;

    size_t size = 0;

    buffer[size++] = (char)(scanner->bracket_depth & 0xFF);
    buffer[size++] = (char)((scanner->bracket_depth >> 8) & 0xFF);

    uint32_t iter = 1;
    for (; iter < scanner->indents.size && size < TREE_SITTER_SERIALIZATION_BUFFER_SIZE; ++iter) {
        uint16_t indent_value = *array_get(&scanner->indents, iter);
        buffer[size++] = (char)(indent_value & 0xFF);
        buffer[size++] = (char)((indent_value >> 8) & 0xFF);
    }

    return size;
}

void tree_sitter_agentscript_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    Scanner *scanner = (Scanner *)payload;

    // TODO (Allen): could be replaced with array_clear
    array_delete(&scanner->indents);
    array_push(&scanner->indents, 0);
    scanner->bracket_depth = 0;

    if (length == 0) {
        return;
    }

    size_t size = 0;

    scanner->bracket_depth = (unsigned char)buffer[size] | ((unsigned char)buffer[size + 1] << 8);
    size += 2;

    for (; size < length; size += 2) {
        uint16_t indent_value = (unsigned char)buffer[size] | ((unsigned char)buffer[size + 1] << 8);
        array_push(&scanner->indents, indent_value);
    }
}

void *tree_sitter_agentscript_external_scanner_create() {
    Scanner *scanner = ts_calloc(1, sizeof(Scanner));
    array_init(&scanner->indents);
    scanner->bracket_depth = 0;
    tree_sitter_agentscript_external_scanner_deserialize(scanner, NULL, 0);
    return scanner;
}

void tree_sitter_agentscript_external_scanner_destroy(void *payload) {
    Scanner *scanner = (Scanner *)payload;
    array_delete(&scanner->indents);
    ts_free(scanner);
}