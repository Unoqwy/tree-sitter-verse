/**
 * @file Verse (Epic Games's new language) grammar for tree-sitter
 * @author Unoqwy <pm@unoqwy.dev>
 * @license MIT
 * vim: fmr=#region,#endregion
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const INLINE_WHITESPACE = /[ ]+/;
const ANYLINE_WHITESPACE = /\s*/;

/**
  * Creates a seq rule that allows multiline whitespace.
  * @param {RuleOrLiteral[]} rules
  * @return {SeqRule}
  */
function anyseq(...rules) {
  return seq(...rules.flatMap((rule, index, array) =>
    index < array.length - 1 ? [rule, ANYLINE_WHITESPACE] : [rule]));
}

/**
  * Precedence table.
  * @type {Object.<string, number>}
  */
const PREC = {
  query: 9,
  opt: 9,
  not: 8,
  sign: 8,
  mult: 7,
  add: 6,
  eq: 4,
  cmp: 4,
  and: 3,
  or: 2,
  decl: 1,
};

module.exports = grammar({
  name: "verse",

  extras: _ => [INLINE_WHITESPACE],

  conflicts: $ => [
    [$.function_call, $.function_declaration],
  ],

  rules: {
    source_file: $ => repeat($._expression_line),
    _expression_line: $ => seq(ANYLINE_WHITESPACE, $._expr, choice(';', '\n')), // FIXME:

    // in Verse, *everything* is an expression
    // you can write mad stuff like ```verse
    // (((class_name))<internal>):=((class)<(final)>(){})
    // ```
    // so, among other considerations, parenthesized expressions
    // are transparent to keep workable trees
    _expr: $ => prec.right(seq(
      choice(anyseq('(', $._expr, ')'), $._expr_root),
      optional($.attributes),
    )),
    _expr_root: $ => choice(
      $.identifier,
      $.path_literal,
      $.logic_literal,
      $.integer,
      $.float,
      $.string,

      $.declaration,

      $.macro_call,
      $.function_call,
      $.function_declaration,

      $.unary_expression,
      $.binary_expression,
    ),
    attributes: $ => prec.right(repeat1(prec.left(PREC.cmp, seq(
      '<',
      $._expr,
      '>',
    )))),

    identifier: _ => /[A-Za-z_][A-Za-z0-9_]*/,
    path_literal: _ => /[/][A-Za-z0-9_][A-Za-z0-9_\-.]*(\/[A-Za-z0-9_][A-Za-z0-9_\-.]*)*/,
    logic_literal: _ => choice('true', 'false'),

    //#region Numbers
    integer: $ => choice(
      /0x[0-9A-Fa-f]+/,
      seq(
        /[0-9]+/,
        optional(field('suffix', $._number_suffix)),
      ),
    ),
    float: $ => {
      const digits = /[0-9]+/;
      const exponent = seq(/[eE][\+-]?/, digits);

      return seq(
        token(choice(
          seq(digits, '.', digits, optional(exponent)),
          seq(digits, exponent),
        )),
        optional(field('suffix', $._number_suffix)),
      );
    },
    _number_suffix: _ => token.immediate(/[A-Za-z_][A-Za-z0-9_]*/),
    //#endregion

    //#region Strings
    string: $ => seq(
      '"',
      repeat(choice(
        $.string_fragment,
        $.string_template,
      )),
      '"',
    ),
    string_fragment: _ => prec.right(repeat1(choice(/[^"{]/, "\\{"))),
    string_template: $ => anyseq(
      "{",
      $._expr,
      "}",
    ),
    //#endregion

    body: $ => anyseq( // TODO:
      '{',
      $._expr,
      '}',
    ),

    declaration: $ => prec.left(PREC.decl, seq(
      field('lhs', $._expr),
      choice(
        seq(
          ':',
          field('type_hint', $._expr),
          '='
        ),
        ':='
      ),
      field('rhs', $._expr),
    )),

    //#region Functions
    macro_call: $ => prec.left(0, seq(
      field('macro', $._expr),
      optional(seq(
        '(',
        ANYLINE_WHITESPACE,
        field('param', $._expr),
        ANYLINE_WHITESPACE,
        ')',
      )),
      $.body,
    )),

    function_call: $ => seq(
      field('name', $._expr),
      '(',
      // TODO : parameters
      ANYLINE_WHITESPACE,
      ')'
    ),

    function_declaration: $ => seq(
      field('name', $._expr),
      '(',
      // TODO : parameters
      ANYLINE_WHITESPACE,
      ')',
      optional(field('effects', $.attributes)),
      ':',
      field('ret_type', $._expr),
      choice('=', ':='),
      $.body
    ),
    //#endregion

    //#region Operators
    binary_expression: $ => {
      /** @type [string, number][] */
      const binary_table = [
        ['*'  , PREC.mult],
        ['/'  , PREC.mult],
        ['+'  , PREC.add ],
        ['-'  , PREC.add ],
        ['='  , PREC.eq  ],
        ['<>' , PREC.eq  ],
        ['<'  , PREC.cmp ],
        ['>'  , PREC.cmp ],
        ['<=' , PREC.cmp ],
        ['>=' , PREC.cmp ],
        ['and', PREC.and ],
        ['or' , PREC.or  ],
      ];
      return choice(...binary_table.map(
        ([op, pval]) => prec.left(pval, seq(
          field('left', $._expr),
          field('operator', op),
          field('right', $._expr) 
         )),
      ));
    },

    unary_expression: $ => {
      /** @type [string, number][] */
      const prefix_table = [
        ['?'  , PREC.opt ],
        ['not', PREC.not ],
        ['+'  , PREC.sign],
        ['-'  , PREC.sign],
      ];
      /** @type [string, number][] */
      const suffix_table = [
        ['?', PREC.query],
      ];
      return choice(...
        prefix_table.map(
          ([op, pval]) => prec.left(pval, seq(
            field('operator', op),
            field('operand', $._expr),
           )))
        .concat(suffix_table.map(
          ([op, pval]) => prec.left(pval, seq(
            field('operand', $._expr),
            field('operator', op),
           ))))
      );
    },
    //#endregion
  }
});

