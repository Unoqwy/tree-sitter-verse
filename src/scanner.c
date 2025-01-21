#include "tree_sitter/parser.h"
#include "tree_sitter/alloc.h"
#include "tree_sitter/array.h"

enum TokenType {
    AUTO_TERMINATOR,
    OPEN_BRACED_BLOCK,
    OPEN_INDENT_BLOCK,
    CLOSE_INDENT_BLOCK,
    INDENT,
    DEDENT,
    ERROR_SENTINEL,
};

typedef struct {
    char indent_block_close;
    Array(uint16_t) indents;
} Scanner;

void * tree_sitter_verse_external_scanner_create() {
    Scanner *scanner = calloc(1, sizeof(Scanner));
    array_init(&scanner->indents);
    return scanner;
}

void tree_sitter_verse_external_scanner_destroy(void *payload) {
    Scanner *scanner = (Scanner *)payload;
    array_delete(&scanner->indents);
    free(scanner);
}

unsigned tree_sitter_verse_external_scanner_serialize(
    void *payload,
    char *buffer
) {
    Scanner *scanner = (Scanner *)payload;
    size_t length = 0;

    buffer[length++] = scanner->indent_block_close;
    for (size_t i = 0; i < scanner->indents.size && length < TREE_SITTER_SERIALIZATION_BUFFER_SIZE; ++i) {
        uint16_t indent_value = *array_get(&scanner->indents, i);
        buffer[length++] = (char)(indent_value & 0xFF);
        buffer[length++] = (char)((indent_value >> 8) & 0xFF);
    }

    return length;
}

void tree_sitter_verse_external_scanner_deserialize(
    void *payload,
    const char *buffer,
    unsigned length
) {
    Scanner *scanner = (Scanner *)payload;

    scanner->indent_block_close = 0;
    array_delete(&scanner->indents);

    if (length > 0) {
        size_t cursor = 0;

        scanner->indent_block_close = buffer[cursor++];

         for (; cursor + 1 < length; cursor += 2) {
             uint16_t indent_value = (unsigned char)buffer[cursor] | ((unsigned char)buffer[cursor + 1] << 8);
             array_push(&scanner->indents, indent_value);
         }
    }
}

static bool scan_auto_terminator(
    TSLexer *lexer,
    bool met_newline
) {
    if (lexer->eof(lexer)) {
        lexer->mark_end(lexer);
    } else if (!met_newline) {
        switch (lexer->lookahead) {
            case 0:
            case ')':
            case ']':
            case '}':
                lexer->mark_end(lexer);
                break;
            case '\n':
            case '\r':
                lexer->advance(lexer, false);
                lexer->mark_end(lexer);
                break;
            default:
                return false;
        }
    }

    return true;
}

static bool handle_indent_dedent(
    Scanner *scanner,
    TSLexer *lexer,
    const bool *valid_symbols
) {
    lexer->mark_end(lexer);

    uint16_t prev_indent_len;
    if (scanner->indents.size > 0) {
        prev_indent_len = *array_back(&scanner->indents);
    } else {
        prev_indent_len = 0;
    }

    if (valid_symbols[INDENT] && !valid_symbols[DEDENT]) {
        int indent_len = 0;
        for (;;) {
            if (lexer->lookahead == ' ') {
                indent_len += 1;
                lexer->advance(lexer, true);
            } else if (lexer->lookahead == '\n') {
                if (valid_symbols[AUTO_TERMINATOR]) {
                    lexer->mark_end(lexer);
                    return scan_auto_terminator(lexer, true);
                }
                indent_len = 0;
                lexer->advance(lexer, true);
            } else if (indent_len == 0) {
                if (valid_symbols[AUTO_TERMINATOR]) {
                    return scan_auto_terminator(lexer, false);
                }
                if (valid_symbols[CLOSE_INDENT_BLOCK]) {
                    scanner->indent_block_close += 1;
                    lexer->result_symbol = CLOSE_INDENT_BLOCK;
                    return true;
                }
                return false;
            } else {
                break;
            }
        }

        if (indent_len <= prev_indent_len) {
            if (valid_symbols[CLOSE_INDENT_BLOCK]) {
                scanner->indent_block_close += 1;
                lexer->result_symbol = CLOSE_INDENT_BLOCK;
                return true;
            }
            return false;
        }

        lexer->mark_end(lexer);
        array_push(&scanner->indents, indent_len);
        lexer->result_symbol = INDENT;
        return true;
    } else if (prev_indent_len > 0) {
        array_pop(&scanner->indents);
        lexer->result_symbol = DEDENT;
        return true;
    }
    return false;
}

bool tree_sitter_verse_external_scanner_scan(
    void *payload,
    TSLexer *lexer,
    const bool *valid_symbols
) {
    Scanner *scanner = (Scanner *)payload;
    if (valid_symbols[INDENT] || valid_symbols[DEDENT]) {
        return handle_indent_dedent(scanner, lexer, valid_symbols);
    }

    if (valid_symbols[AUTO_TERMINATOR] && scanner->indent_block_close > 0) {
        scanner->indent_block_close -= 1;
        lexer->mark_end(lexer);
        lexer->result_symbol = AUTO_TERMINATOR;
        return true;
    }

    bool met_newline = false;
    for (;;) {
        if (lexer->lookahead == ' ') {
            lexer->advance(lexer, true);
        } else if (lexer->lookahead == '\n') {
            lexer->advance(lexer, true);
            if (!met_newline) {
                met_newline = true;
                lexer->mark_end(lexer);
                if (valid_symbols[OPEN_INDENT_BLOCK]) {
                    lexer->result_symbol = OPEN_INDENT_BLOCK;
                    return true;
                }
                if (!valid_symbols[OPEN_BRACED_BLOCK]) {
                    break;
                }
            }
        } else {
            break;
        }
    }

    if (valid_symbols[OPEN_BRACED_BLOCK] && lexer->lookahead == '{') {
        lexer->advance(lexer, false);
        lexer->mark_end(lexer);
        lexer->result_symbol = OPEN_BRACED_BLOCK;
        return true;
    } else if (valid_symbols[AUTO_TERMINATOR]
            && scan_auto_terminator(lexer, met_newline)) {
        lexer->result_symbol = AUTO_TERMINATOR;
        return true;
    }

    return false;
}

