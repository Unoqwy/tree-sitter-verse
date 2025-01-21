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
    INCOMPLETE_STRING,
    BEST_GUESS_ATTR_START,
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

bool tree_sitter_verse_external_scanner_scan(
    void *payload,
    TSLexer *lexer,
    const bool *valid_symbols
) {
    Scanner *scanner = (Scanner *)payload;
    bool error_recovery = valid_symbols[ERROR_SENTINEL];

    if (valid_symbols[INCOMPLETE_STRING] && !error_recovery) {
        lexer->mark_end(lexer);
        for (;;) {
            if (lexer->lookahead == ' ') {
                lexer->advance(lexer, true);
                continue;
            } else if (lexer->lookahead == '\n') {
                break;
            } else {
                return false;
            }
        }
        lexer->result_symbol = INCOMPLETE_STRING;
        return true;
    }
    if (valid_symbols[AUTO_TERMINATOR]
            && scanner->indent_block_close > 0
            && !valid_symbols[INDENT]
            && !valid_symbols[DEDENT]
    ) {
        scanner->indent_block_close -= 1;
        lexer->result_symbol = AUTO_TERMINATOR;
        return true;
    }

    lexer->mark_end(lexer);

    uint16_t prev_indent_len;
    if (scanner->indents.size > 0) {
        prev_indent_len = *array_back(&scanner->indents);
    } else {
        prev_indent_len = 0;
    }
    if (valid_symbols[DEDENT] && !error_recovery && prev_indent_len > 0) {
        array_pop(&scanner->indents);
        lexer->result_symbol = DEDENT;
        return true;
    }

    bool met_newline = false;
    bool compat_with_terminator = true;
    int indent_len = 0;
    bool check_other_lines = valid_symbols[OPEN_BRACED_BLOCK] || valid_symbols[INDENT];
    for (;;) {
        if (lexer->lookahead == ' ') {
            indent_len += 1;
            lexer->advance(lexer, true);
        } else if (lexer->lookahead == '\n') {
            indent_len = 0;
            lexer->advance(lexer, true);
            if (met_newline) {
                continue;
            }
            met_newline = true;

            if (valid_symbols[INDENT]
                    && valid_symbols[AUTO_TERMINATOR]
                    && !error_recovery) {
                lexer->mark_end(lexer);
                lexer->result_symbol = AUTO_TERMINATOR;
                return scan_auto_terminator(lexer, true);
            } else if (valid_symbols[INDENT]
                    && valid_symbols[CLOSE_INDENT_BLOCK]
                    && !error_recovery) {
                compat_with_terminator = false;
            } else {
                lexer->mark_end(lexer);
            }
            if (valid_symbols[OPEN_INDENT_BLOCK] && !error_recovery) {
                lexer->result_symbol = OPEN_INDENT_BLOCK;
                return true;
            }
            if (!check_other_lines) {
                break;
            }
        } else {
            break;
        }
    }

    if (valid_symbols[INDENT] && !error_recovery) {
        if (indent_len > prev_indent_len) {
            array_push(&scanner->indents, indent_len);
            lexer->mark_end(lexer);
            lexer->result_symbol = INDENT;
            return true;
        } else if (valid_symbols[CLOSE_INDENT_BLOCK]) {
            scanner->indent_block_close += 1;
            lexer->result_symbol = CLOSE_INDENT_BLOCK;
            return true;
        }
    }

    if (valid_symbols[OPEN_BRACED_BLOCK] && lexer->lookahead == '{') {
        lexer->advance(lexer, false);
        lexer->mark_end(lexer);
        lexer->result_symbol = OPEN_BRACED_BLOCK;
        return true;
    } else if (valid_symbols[AUTO_TERMINATOR]
            && compat_with_terminator
            && scan_auto_terminator(lexer, met_newline)
            && !error_recovery) {
        lexer->result_symbol = AUTO_TERMINATOR;
        return true;
    }

    if (valid_symbols[BEST_GUESS_ATTR_START] && lexer->lookahead == '<') {
        // FIXME : find a proper way to avoid this hack
        lexer->mark_end(lexer);
        lexer->result_symbol = BEST_GUESS_ATTR_START;

        size_t cursor = 0;
        for (;;) {
            lexer->advance(lexer, false);
            cursor += 1;
            switch (lexer->lookahead) {
                case ' ':
                    break;
                case '\n':
                case ')':
                case ']':
                case '}':
                    return false;
                case '>':
                    if (cursor == 1) {
                        return false;
                    }
                    return true;
                case '(':
                case '[':
                case '{':
                    return true;
            }
        }
    }

    return false;
}

