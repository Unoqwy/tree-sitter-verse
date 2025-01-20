/**
 * @file Verse (Epic Games's new language) grammar for tree-sitter
 * @author Unoqwy <pm@unoqwy.dev>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
  name: "verse",

  rules: {
    // TODO: add the actual grammar rules
    source_file: $ => "hello"
  }
});
