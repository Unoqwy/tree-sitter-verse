/**
 * External scanner for tree-sitter-verse.
 *
 * Handles:
 *   - NEWLINE / INDENT / DEDENT (indentation-sensitive blocks)
 *   - STRING_START / STRING_CONTENT / STRING_END / INTERPOLATION_START / INTERPOLATION_END
 *   - BLOCK_COMMENT / INDENT_COMMENT
 *   - ERROR_SENTINEL (error recovery)
 */

#include "tree_sitter/parser.h"

#include <string.h>
#include <stdbool.h>

// Must match the order in grammar.js externals array
enum TokenType {
    NEWLINE,
    INDENT,
    DEDENT,
    STRING_CONTENT,
    INTERPOLATION_END,
    SPECIFIER_OPEN,    // < immediately after identifier (no space)
    COLON_INDENT,      // : followed by newline + indent
    BRACE_SEP,         // statement boundary before a line-initial ( or [
    ERROR_SENTINEL,
};

#define MAX_INDENT_DEPTH 64
#define MAX_STRING_DEPTH 8

typedef struct {
    uint16_t indent_stack[MAX_INDENT_DEPTH];
    uint8_t indent_depth;
    uint8_t pending_dedents;
    bool pending_newline_before_dedent;
    uint16_t pending_indent_col;  // If > 0, an INDENT is pending at this column
} Scanner;

static void advance(TSLexer *lexer) {
    lexer->advance(lexer, false);
}

static void skip_whitespace(TSLexer *lexer) {
    lexer->advance(lexer, true);
}

void *tree_sitter_verse_external_scanner_create(void) {
    Scanner *scanner = calloc(1, sizeof(Scanner));
    scanner->indent_stack[0] = 0;
    scanner->indent_depth = 0;
    return scanner;
}

void tree_sitter_verse_external_scanner_destroy(void *payload) {
    free(payload);
}

unsigned tree_sitter_verse_external_scanner_serialize(void *payload, char *buffer) {
    Scanner *scanner = (Scanner *)payload;
    unsigned i = 0;

    // indent_depth (1 byte)
    buffer[i++] = (char)scanner->indent_depth;
    // pending_dedents (1 byte)
    buffer[i++] = (char)scanner->pending_dedents;
    // pending_newline_before_dedent (1 byte)
    buffer[i++] = (char)scanner->pending_newline_before_dedent;
    // pending_indent_col (2 bytes)
    buffer[i++] = (char)(scanner->pending_indent_col & 0xFF);
    buffer[i++] = (char)((scanner->pending_indent_col >> 8) & 0xFF);
    // indent_stack (2 bytes each, up to indent_depth+1)
    for (uint8_t j = 0; j <= scanner->indent_depth && j < MAX_INDENT_DEPTH; j++) {
        buffer[i++] = (char)(scanner->indent_stack[j] & 0xFF);
        buffer[i++] = (char)((scanner->indent_stack[j] >> 8) & 0xFF);
    }
    return i;
}

void tree_sitter_verse_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    Scanner *scanner = (Scanner *)payload;

    // Reset state
    memset(scanner, 0, sizeof(Scanner));

    if (length == 0) return;

    unsigned i = 0;
    scanner->indent_depth = (uint8_t)buffer[i++];
    if (i >= length) return;
    scanner->pending_dedents = (uint8_t)buffer[i++];
    if (i >= length) return;
    scanner->pending_newline_before_dedent = (bool)buffer[i++];
    if (i >= length) return;
    scanner->pending_indent_col = (uint16_t)((uint8_t)buffer[i] | ((uint8_t)buffer[i + 1] << 8));
    i += 2;
    if (i >= length) return;
    for (uint8_t j = 0; j <= scanner->indent_depth && j < MAX_INDENT_DEPTH && i + 1 < length; j++) {
        scanner->indent_stack[j] = (uint16_t)((uint8_t)buffer[i] | ((uint8_t)buffer[i + 1] << 8));
        i += 2;
    }
}

// String content: consumes characters until ", {, \, or EOF
// The grammar handles " (start/end), { (interpolation start), and \ (escapes)
static bool scan_string_content(TSLexer *lexer) {
    bool has_content = false;

    while (true) {
        if (lexer->eof(lexer)) break;

        switch (lexer->lookahead) {
            case '"':
            case '{':
            case '\\':
                goto done;

            default:
                has_content = true;
                advance(lexer);
                break;
        }
    }

done:
    if (has_content) {
        lexer->mark_end(lexer);
        lexer->result_symbol = STRING_CONTENT;
        return true;
    }
    return false;
}

// Interpolation end: consumes } when grammar expects it
static bool scan_interpolation_end(TSLexer *lexer) {
    if (lexer->lookahead != '}') return false;
    advance(lexer);
    lexer->mark_end(lexer);
    lexer->result_symbol = INTERPOLATION_END;
    return true;
}

static uint16_t current_indent(Scanner *scanner) {
    return scanner->indent_stack[scanner->indent_depth];
}

// Peek whether the upcoming word is a block-continuation keyword
// (else / then / do / of). The lexer must be positioned at the first
// content character with mark_end already set, since this advances the
// lexer for lookahead only (the token boundary stays at mark_end).
static bool peek_is_continuation(TSLexer *lexer) {
    char buf[8];
    int n = 0;
    while (n < 7 && lexer->lookahead >= 'a' && lexer->lookahead <= 'z') {
        buf[n++] = (char)lexer->lookahead;
        advance(lexer);
    }
    buf[n] = 0;
    // Must end on a word boundary (not part of a longer identifier).
    if ((lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') ||
        (lexer->lookahead >= '0' && lexer->lookahead <= '9') ||
        lexer->lookahead == '_' ||
        (lexer->lookahead >= 'a' && lexer->lookahead <= 'z')) {
        return false;
    }
    return strcmp(buf, "else") == 0 || strcmp(buf, "then") == 0 ||
           strcmp(buf, "do") == 0 || strcmp(buf, "of") == 0;
}

static bool scan_newline_indent_dedent(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
    // Phase 1: Emit pending NEWLINE before dedents
    if (scanner->pending_newline_before_dedent) {
        if (valid_symbols[NEWLINE]) {
            scanner->pending_newline_before_dedent = false;
            lexer->result_symbol = NEWLINE;
            return true;
        }
    }

    // Phase 2: Emit queued DEDENTs
    if (scanner->pending_dedents > 0) {
        if (valid_symbols[DEDENT]) {
            scanner->pending_dedents--;
            lexer->result_symbol = DEDENT;
            return true;
        }
        return false;
    }

    // Phase 3: Check if grammar wants indent tokens
    if (!valid_symbols[NEWLINE] && !valid_symbols[INDENT] && !valid_symbols[DEDENT] &&
        !valid_symbols[BRACE_SEP]) {
        return false;
    }

    // Phase 4: Skip horizontal whitespace (marking as skipped)
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t' || lexer->lookahead == '\r') {
        skip_whitespace(lexer);
    }

    // Phase 5: Handle EOF
    if (lexer->eof(lexer)) {
        if (valid_symbols[DEDENT] && scanner->indent_depth > 0) {
            scanner->indent_depth--;
            lexer->result_symbol = DEDENT;
            return true;
        }
        if (valid_symbols[NEWLINE]) {
            lexer->result_symbol = NEWLINE;
            return true;
        }
        return false;
    }

    // Phase 6: Require a newline character
    if (lexer->lookahead != '\n') {
        return false;
    }

    // Skip the newline and any blank lines, counting indent of next content line
    skip_whitespace(lexer); // consume \n

    // Skip blank lines and measure indent
    uint16_t indent_col = 0;
    bool found_content = false;

    while (!found_content) {
        indent_col = 0;
        while (!lexer->eof(lexer) && (lexer->lookahead == ' ' || lexer->lookahead == '\t')) {
            if (lexer->lookahead == '\t') {
                indent_col += 4; // Tabs = 4 spaces in Verse
            } else {
                indent_col++;
            }
            skip_whitespace(lexer);
        }

        if (lexer->lookahead == '\r') {
            skip_whitespace(lexer);
            continue;
        }

        if (lexer->lookahead == '\n') {
            skip_whitespace(lexer); // blank line, skip
            continue;
        }

        if (lexer->eof(lexer)) {
            // At EOF after consuming newline(s)
            if (valid_symbols[DEDENT] && scanner->indent_depth > 0) {
                scanner->indent_depth--;
                lexer->result_symbol = DEDENT;
                return true;
            }
            if (valid_symbols[NEWLINE]) {
                lexer->result_symbol = NEWLINE;
                return true;
            }
            return false;
        }

        found_content = true;
    }

    lexer->mark_end(lexer);

    uint16_t cur = current_indent(scanner);

    // Leading-dot method-chain continuation: a line that begins with `.Name`
    // continues the previous expression as a member access, e.g.
    //     Button()
    //         .Bind(S)
    //         .ApplySize(A, B)
    // Suppress the separating NEWLINE/INDENT (return no token) so `.` glues onto
    // the previous expression instead of starting a bogus nested block. Only when
    // the dot line is at the same or deeper indent (never across a real dedent),
    // and not a leading range operator `..`.
    if (lexer->lookahead == '.' && indent_col >= cur) {
        advance(lexer); // peek past the first '.'; mark_end above keeps the boundary
        if (lexer->lookahead != '.') {
            return false;
        }
    }

    // BRACE_SEP: inside a braced/paren body, a line beginning with `(` or `[`
    // is a new statement — NOT a postfix call/subscript on the previous line.
    // Emitting this separator forces the statement boundary so `f()` followed
    // by a line-initial `(...)` does not glue into `f()(...)`.
    if (valid_symbols[BRACE_SEP] && indent_col >= cur &&
        (lexer->lookahead == '(' || lexer->lookahead == '[')) {
        lexer->result_symbol = BRACE_SEP;
        return true;
    }

    // INDENT: next line is more indented
    if (indent_col > cur) {
        if (valid_symbols[INDENT]) {
            // Emit INDENT directly
            if (scanner->indent_depth + 1 < MAX_INDENT_DEPTH) {
                scanner->indent_depth++;
                scanner->indent_stack[scanner->indent_depth] = indent_col;
            }
            lexer->result_symbol = INDENT;
            return true;
        }
        if (valid_symbols[NEWLINE]) {
            // Grammar wants NEWLINE first (e.g., `: _newline _indent`),
            // store pending indent for next call
            scanner->pending_indent_col = indent_col;
            lexer->result_symbol = NEWLINE;
            return true;
        }
    }

    // DEDENT: next line is less indented
    if (indent_col < cur) {
        // Count how many dedents we need
        uint8_t dedent_count = 0;
        while (scanner->indent_depth > 0 && scanner->indent_stack[scanner->indent_depth] > indent_col) {
            scanner->indent_depth--;
            dedent_count++;
        }

        if (dedent_count > 0) {
            // If the next line begins with a block-continuation keyword
            // (else / then / do / of) at the dedented level, suppress the
            // surrounding separator NEWLINEs so the keyword attaches to its
            // parent construct (e.g. `if (c):` <body> dedent `else:` <body>).
            if (valid_symbols[DEDENT] && peek_is_continuation(lexer)) {
                scanner->pending_dedents = dedent_count - 1;
                scanner->pending_newline_before_dedent = false;
                lexer->result_symbol = DEDENT;
                return true;
            }
            // Emit NEWLINE first, then DEDENTs, then another NEWLINE
            // The first NEWLINE separates statements in the inner block
            // The DEDENTs close the inner blocks
            // pending_newline_before_dedent ensures a NEWLINE after all DEDENTs
            // so the outer block can continue with the next statement
            scanner->pending_dedents = dedent_count;
            // Emit trailing NEWLINE after dedent when still inside an
            // indent block (indent_depth > 0 after popping). This provides
            // the separator for the outer _block_body's next statement.
            // At the top level (depth 0), no trailing NEWLINE needed.
            scanner->pending_newline_before_dedent =
                (scanner->indent_depth > 0);
            if (valid_symbols[NEWLINE]) {
                lexer->result_symbol = NEWLINE;
                return true;
            }
            // If grammar doesn't want NEWLINE, emit DEDENT directly
            if (valid_symbols[DEDENT]) {
                scanner->pending_dedents = dedent_count - 1;
                lexer->result_symbol = DEDENT;
                return true;
            }
        }
        return false;
    }

    // Same level: NEWLINE as statement separator.
    // Suppress NEWLINE before continuation keywords (else, then)
    // and closing tokens ()) to allow multiline if-else and conditions.
    if (valid_symbols[NEWLINE]) {
        if (lexer->lookahead == ')') {
            return false; // closing paren — continuation of multiline condition
        }
        // Check for continuation keywords: else, then, of
        if (lexer->lookahead == 'e' || lexer->lookahead == 't' || lexer->lookahead == 'o') {
            // Peek ahead to check full keyword
            // We mark end first so we don't consume if it's not else/then
            lexer->mark_end(lexer);
            char first = lexer->lookahead;
            advance(lexer);
            if (first == 'e' && lexer->lookahead == 'l') {
                advance(lexer);
                if (lexer->lookahead == 's') {
                    advance(lexer);
                    if (lexer->lookahead == 'e') {
                        advance(lexer);
                        // Check it's end of word (not 'elsewhere' etc)
                        if (!((lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
                              (lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') ||
                              (lexer->lookahead >= '0' && lexer->lookahead <= '9') ||
                              lexer->lookahead == '_')) {
                            return false; // suppress NEWLINE before 'else'
                        }
                    }
                }
            } else if (first == 't' && lexer->lookahead == 'h') {
                advance(lexer);
                if (lexer->lookahead == 'e') {
                    advance(lexer);
                    if (lexer->lookahead == 'n') {
                        advance(lexer);
                        if (!((lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
                              (lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') ||
                              (lexer->lookahead >= '0' && lexer->lookahead <= '9') ||
                              lexer->lookahead == '_')) {
                            return false; // suppress NEWLINE before 'then'
                        }
                    }
                }
            } else if (first == 'o' && lexer->lookahead == 'f') {
                advance(lexer);
                if (!((lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
                      (lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') ||
                      (lexer->lookahead >= '0' && lexer->lookahead <= '9') ||
                      lexer->lookahead == '_')) {
                    return false; // suppress NEWLINE before 'of'
                }
            }
            // Not a continuation keyword — emit NEWLINE (mark_end already set before peek)
        }
        lexer->result_symbol = NEWLINE;
        return true;
    }

    return false;
}

bool tree_sitter_verse_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    Scanner *scanner = (Scanner *)payload;

    // Error recovery: if error sentinel is valid, we're in error recovery
    if (valid_symbols[ERROR_SENTINEL]) {
        return false;
    }

    // Priority 0: Pending INDENT (after NEWLINE was emitted for an indent)
    if (scanner->pending_indent_col > 0 && valid_symbols[INDENT]) {
        if (scanner->indent_depth + 1 < MAX_INDENT_DEPTH) {
            scanner->indent_depth++;
            scanner->indent_stack[scanner->indent_depth] = scanner->pending_indent_col;
        }
        scanner->pending_indent_col = 0;
        lexer->result_symbol = INDENT;
        return true;
    }

    // Priority 1: Pending dedents (always process first)
    if (scanner->pending_dedents > 0 && valid_symbols[DEDENT]) {
        scanner->pending_dedents--;
        lexer->result_symbol = DEDENT;
        return true;
    }
    if (scanner->pending_newline_before_dedent && valid_symbols[NEWLINE]) {
        scanner->pending_newline_before_dedent = false;
        lexer->result_symbol = NEWLINE;
        return true;
    }

    // Priority 2: String content (grammar handles " and { tokens)
    if (valid_symbols[STRING_CONTENT]) {
        return scan_string_content(lexer);
    }

    // Priority 3: Interpolation end
    if (valid_symbols[INTERPOLATION_END] && lexer->lookahead == '}') {
        return scan_interpolation_end(lexer);
    }

    // Priority 4: Specifier open (<) — distinguishes C<public> (specifier)
    // from a<b (comparison). A specifier is `<` identifier (`>` | `(` | `{`),
    // i.e. the identifier is immediately followed by the closing `>` or an
    // argument group. A comparison `a<b` is followed by `)`, an operator,
    // whitespace, a separator, etc. — never directly by `>`/`(`/`{`.
    if (valid_symbols[SPECIFIER_OPEN] && lexer->lookahead == '<') {
        advance(lexer);
        // Must start with an identifier character.
        if (!((lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
              (lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') ||
              lexer->lookahead == '_')) {
            return false; // `<` then non-identifier → comparison
        }
        // Consume the identifier (lookahead only; mark_end stays after `<`).
        lexer->mark_end(lexer);
        while ((lexer->lookahead >= 'a' && lexer->lookahead <= 'z') ||
               (lexer->lookahead >= 'A' && lexer->lookahead <= 'Z') ||
               (lexer->lookahead >= '0' && lexer->lookahead <= '9') ||
               lexer->lookahead == '_') {
            advance(lexer);
        }
        // Skip whitespace before the closer/arg group (e.g. `<scoped {Mod}>`).
        // Safe against `a < b` comparisons: those have a space *after* `<`,
        // which already failed the identifier-immediately-after-`<` check.
        while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
            advance(lexer);
        }
        // A real specifier closes with `>` or opens an argument group.
        if (lexer->lookahead == '>' || lexer->lookahead == '(' ||
            lexer->lookahead == '{') {
            lexer->result_symbol = SPECIFIER_OPEN; // mark_end already after `<`
            return true;
        }
        // Otherwise it's a comparison `a < b` — don't consume the `<`.
        return false;
    }

    // Priority 5: COLON_INDENT — : followed by newline + deeper indent
    if (valid_symbols[COLON_INDENT] && lexer->lookahead == ':') {
        // Save position
        lexer->mark_end(lexer);
        advance(lexer);

        // Skip horizontal whitespace after :
        while (lexer->lookahead == ' ' || lexer->lookahead == '\t' || lexer->lookahead == '\r') {
            advance(lexer);
        }

        // Skip line comment if present (# ...)
        if (lexer->lookahead == '#') {
            while (!lexer->eof(lexer) && lexer->lookahead != '\n') {
                advance(lexer);
            }
        }

        // Must have a newline
        if (lexer->lookahead == '\n') {
            advance(lexer);

            // Skip blank lines
            while (true) {
                uint16_t indent = 0;
                while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                    indent += (lexer->lookahead == '\t') ? 4 : 1;
                    advance(lexer);
                }
                if (lexer->lookahead == '\n') {
                    advance(lexer);
                    continue; // blank line
                }
                if (lexer->lookahead == '\r') {
                    advance(lexer);
                    continue;
                }

                // Check if indent is deeper than current
                uint16_t cur = current_indent(scanner);
                if (indent > cur) {
                    // Push new indent level
                    if (scanner->indent_depth + 1 < MAX_INDENT_DEPTH) {
                        scanner->indent_depth++;
                        scanner->indent_stack[scanner->indent_depth] = indent;
                    }
                    lexer->mark_end(lexer);
                    lexer->result_symbol = COLON_INDENT;
                    return true;
                }
                break;
            }
        }

        // Not a colon-indent — return false without consuming
        // (mark_end was set before the : was consumed)
        return false;
    }

    // Priority 6: NEWLINE / INDENT / DEDENT / BRACE_SEP
    if (valid_symbols[NEWLINE] || valid_symbols[INDENT] || valid_symbols[DEDENT] ||
        valid_symbols[BRACE_SEP]) {
        return scan_newline_indent_dedent(scanner, lexer, valid_symbols);
    }

    return false;
}
