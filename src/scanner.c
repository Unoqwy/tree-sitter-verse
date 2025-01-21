#include "tree_sitter/parser.h"
#include "tree_sitter/alloc.h"
#include "tree_sitter/array.h"

enum TokenType {
    AUTO_TERMINATOR,
    BODY_OPEN,
    ERROR_SENTINEL,
};

void * tree_sitter_verse_external_scanner_create() {
    return NULL;
}

void tree_sitter_verse_external_scanner_destroy(void *payload) {
}

unsigned tree_sitter_verse_external_scanner_serialize(
    void *payload,
    char *buffer
) {
    return 0;
}

void tree_sitter_verse_external_scanner_deserialize(
    void *payload,
    const char *buffer,
    unsigned length
) {
}

static bool scan_auto_terminator(
        TSLexer *lexer,
        bool met_newline
    ) {
    if (!met_newline) {
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
    bool met_newline = false;
    for (;;) {
        if (lexer->lookahead == ' ') {
            lexer->advance(lexer, true);
        } else if (lexer->lookahead == '\n') {
            lexer->advance(lexer, true);
            if (!met_newline) {
                met_newline = true;
                lexer->mark_end(lexer);
                if (!valid_symbols[BODY_OPEN]) {
                    break;
                }
            }
        } else {
            break;
        }
    }

    if (valid_symbols[BODY_OPEN] && lexer->lookahead == '{') {
        lexer->advance(lexer, false);
        lexer->mark_end(lexer);

        // for (;;) {
        //     if (lexer->lookahead == ' ') {
        //         lexer->advance(lexer, true);
        //         continue;
        //     }
        //     break;
        // }
        // if (lexer->lookahead == '\n') {
        //     lexer->advance(lexer, true);
        //     lexer->mark_end(lexer);
        // }

        lexer->result_symbol = BODY_OPEN;
        return true;
    } else if (valid_symbols[AUTO_TERMINATOR]
            && scan_auto_terminator(lexer, met_newline)) {
        lexer->result_symbol = AUTO_TERMINATOR;
        return true;
    }

    if (valid_symbols[ERROR_SENTINEL]) {
        lexer->mark_end(lexer);
        lexer->result_symbol = AUTO_TERMINATOR;
        return true;
    }

    return false;
}

