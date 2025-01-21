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

  externals: $ => [
    $._auto_terminator,
    $._open_braced_block,
    $._open_indent_block,
    $._close_indent_block,
    $._indent,
    $._dedent,
    $._incomplete_string,
    $._best_guess_attr_start,
    $._error_sentinel,
  ],

  // TODO : figure out if strict newline handling is needed
  // extras: _ => [INLINE_WHITESPACE],

  conflicts: $ => [
    [$.function_call, $.function_declaration],
  ],

  rules: {
    source_file: $ => repeat($._complete_expr),

    _complete_expr: $ => seq(
      $._expr,
      choice(';', $._auto_terminator)
    ),

    //#region Expression Kinds
    _expr: $ => choice(
      $._stdexpr,
      $._non_attributable_expr,
    ),
    // in Verse, *everything* is an expression
    // you can write mad stuff like ```verse
    // (((class_name))<internal>):=((class)<(final)>(){})
    // ```
    // so, among other considerations, parenthesized expressions
    // are kept transparent to keep workable trees
    _stdexpr: $ => prec.right(seq(
      choice(
        seq('(', ANYLINE_WHITESPACE, $._expr, /\s*[)]/),
        $._standalone_expr,
      ),
      optional($.attributes),
    )),
    // the official parser deals with ```verse
    // if. (0 < 1 > 0)
    // ``` by reading 0<1> and unknown trailing "0"
    attributes: $ => prec.right(seq(
      $._best_guess_attr_start,
      repeat1(prec.left(PREC.cmp, seq(
        '<', $._expr, '>',
      ))),
    )),

    comma_separated_group: $ => prec.right(seq(
      $._expr,
      repeat1(prec.left(seq(
        ",",
        $._expr,
      ))),
      optional(",")
    )),

    _standalone_expr: $ => choice(
      $.identifier,
      $.path_literal,
      $.logic_literal,
      $.integer,
      $.float,
      $.string,

      $.macro_call,
      $.function_call,
    ),
    _non_attributable_expr: $ => choice(
      $.declaration,
      $.function_declaration,

      $.unary_expression,
      $.binary_expression,

      $.comma_separated_group,
    ),
    //#endregion

    identifier: _ => /[A-Za-z_][A-Za-z0-9_]*/,
    path_literal: _ => /[/][A-Za-z0-9_][A-Za-z0-9_\-.]*(\/[A-Za-z0-9_][A-Za-z0-9_\-.]*)*/,
    logic_literal: _ => choice('true', 'false'),

    //#region Numbers
    integer: $ => choice(
      /0x[0-9A-Fa-f]+/,
      seq(
        /[0-9]+/,
        optional($.number_suffix),
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
        optional($.number_suffix),
      );
    },
    number_suffix: _ => token.immediate(/[A-Za-z_][A-Za-z0-9_]*/),
    //#endregion

    //#region Strings
    string: $ => seq(
      '"',
      repeat(choice(
        $.string_fragment,
        $.string_template,
      )),
      choice('"', $._incomplete_string),
    ),
    string_fragment: _ => prec.right(repeat1(choice(/[^"{]/, "\\{"))),
    string_template: $ => seq(
      /[{]\s*/,
      $._expr,
      /\s*[}]/,
    ),
    //#endregion

    declaration: $ => prec.left(PREC.decl, seq(
      field('lhs', $._expr),
      choice(
        seq(':', field('type_hint', $._expr), '='),
        ':='
      ),
      field('rhs', $._expr),
    )),

    //#region Blocks
    macro_call: $ => prec.left(1, seq(
      field('macro', $._stdexpr),
      alias($.macro_block, $.block),
    )),

    macro_block: $ => prec.right(choice(
      seq(
        $._open_braced_block,
        repeat($._complete_expr),
        /\s*[}]/,
      ),
      seq(
        ":",
        $._open_indent_block,
        repeat(seq(
          $._indent,
          $._complete_expr,
          $._dedent,
        )),
        $._close_indent_block,
      ),
    )),

    _inline_body: $ => prec.left(10, choice(
      $.block,
      $._expr,
    )),
    block: $ => choice(
      seq(
        $._open_braced_block,
        repeat($._complete_expr),
        /\s*[}]/,
      ),
      seq(
        $._open_indent_block,
        repeat(seq(
          $._indent,
          $._complete_expr,
          $._dedent,
        )),
        $._close_indent_block,
      ),
    ),
    //#endregion

    //#region Functions
    function_call: $ => {
      const inner = optional(field('arguments', $.argument_list));
      return seq(
        field('function', $._stdexpr),
        choice(
          seq('(', inner, /\s*[)]/),
          seq('[', inner, /\s*\]/),
        ),
      );
    },
    argument_list: $ => separated1(
      ",",
      choice(
        $._expr,
        $.named_argument
      ),
      optional(","),
    ),
    named_argument: $ => prec.left(PREC.decl, seq(
      '?',
      field('name', $.identifier),
      ':=',
      $._expr,
    )),

    function_declaration: $ => prec.left(seq(
      field('name', $._stdexpr),
      '(',
      // TODO : parameters
      /\s*[)]/,
      optional(field('effects', $.attributes)),
      ':',
      field('ret_type', $._expr),
      optional(seq(
        choice('=', ':='),
        $._inline_body,
      )),
    )),
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
        ['set', PREC.decl],
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

/**
  * Creates a rule for array-like elements with a separator.
  * @param {RuleOrLiteral} separator
  * @param {RuleOrLiteral} rule
  * @param {RuleOrLiteral?} trail
  * @returns {SeqRule}
  */
function separated1(separator, rule, trail) {
  const rules = [rule, repeat(prec.left(1, seq(separator, rule)))];
  if (trail) {
    rules.push(trail);
  }
  return seq(...rules);
}

