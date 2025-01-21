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

  extras: _ => [INLINE_WHITESPACE],
  inline: $ => [$.expr],

  conflicts: $ => [
    [$.function_call, $.function_declaration],
    [$.macro_call, $.argument_list],
  ],

  rules: {
    source_file: $ => repeat($._expression_line),
    _expression_line: $ => seq(ANYLINE_WHITESPACE, $.expr, choice(';', '\n')), // FIXME:

    //#region Expression Kinds
    expr: $ => choice(
      $._stdexpr,
      $._non_attributable_expr,
    ),
    // in Verse, *everything* is an expression
    // you can write mad stuff like ```verse
    // (((class_name))<internal>):=((class)<(final)>(){})
    // ```
    // so, among other considerations, parenthesized expressions
    // are transparent to keep workable trees
    _stdexpr: $ => prec.right(seq(
      choice(
        seq('(', ANYLINE_WHITESPACE, $.expr, /\s*[)]/),
        $._standalone_expr,
      ),
      optional($.attributes),
    )),
    // the official parser deals with ```verse
    // if. (0 < 1 > 0)
    // ``` by reading 0<1> and unknown trailing "0"
    attributes: $ => prec.right(repeat1(prec.left(PREC.cmp, seq(
      '<',
      $.expr,
      '>',
    )))),

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
    string_template: $ => seq(
      /[{]\s*/,
      $.expr,
      /\s*[}]/,
    ),
    //#endregion

    body: $ => seq( // TODO:
      /\s*[{]\s*/,
      optional($.expr),
      /\s*[}]/,
    ),

    declaration: $ => prec.left(PREC.decl, seq(
      field('lhs', $.expr),
      choice(
        seq(':', field('type_hint', $.expr), '='),
        ':='
      ),
      field('rhs', $.expr),
    )),

    //#region Functions
    macro_call: $ => prec.left(0, seq(
      field('macro', $._stdexpr),
      optional(seq(
        '(',
        //ANYLINE_WHITESPACE,
        field('param', $.expr),
        /\s*[)]/,
      )),
      $.body,
    )),

    function_call: $ => seq(
      field('function', $._stdexpr),
      '(',
      optional(field('arguments', $.argument_list)),
      /\s*[)]/,
    ),
    argument_list: $ => separated1(
      ",",
      choice(
        $.expr,
        $.named_argument,
      ),
      optional(","),
    ),
    named_argument: $ => prec.left(PREC.decl, seq(
      '?',
      field('name', $.identifier),
      ':=',
      $.expr,
    )),

    function_declaration: $ => seq(
      field('name', $._stdexpr),
      '(',
      // TODO : parameters
      /\s*[)]/,
      optional(field('effects', $.attributes)),
      ':',
      field('ret_type', $.expr),
      optional(seq(
        choice('=', ':='),
        $.body,
      )),
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
          field('left', $.expr),
          field('operator', op),
          field('right', $.expr) 
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
            field('operand', $.expr),
           )))
        .concat(suffix_table.map(
          ([op, pval]) => prec.left(pval, seq(
            field('operand', $.expr),
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
  const rules = [rule, repeat(seq(separator, rule))];
  if (trail) {
    rules.push(trail);
  }
  return seq(...rules);
}

