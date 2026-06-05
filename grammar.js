/**
 * @file Tree-sitter grammar for the Verse programming language (Unreal Engine)
 * @author Unoqwy
 * @license MIT
 * vim: fmr=#region,#endregion
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const PREC = {
  DEF: 1,        // :=  +=  -=  *=  /=  =>
  CONTROL: 2,    // where  when  while  over
  OR: 3,
  AND: 4,
  NOT: 5,
  CMP: 6,        // =  <>  <=  >=
  RANGE: 7,      // ..  to  ->
  ADD: 8,
  MUL: 9,
  PREFIX: 10,         // value/binding prefixes: + - not &, set, ref, live (looser than `:`)
  // `:` type annotation. Looser than the type-construction operators below so a
  // member/call/array/optional type groups into the `type` field:
  //   x:a.b   => x:(a.b)    not (x:a).b   (e.g. `for (M:Plot.GetMembers())`)
  //   x:[]t   => x:([]t)
  // but still tighter than the binding prefixes above so `live Y:int` => live(Y:int).
  TYPE_ANN_LOOSE: 11,
  TYPE_PREFIX: 12,    // type-construction prefixes: ?T  []T  [K]V
  CALL: 13,           // .  ()  []  {}  ?  ^
  TYPE_ANN: 14,       // base for indented/dot/var block offsets, and type_prefix
  FUNC_DEF: 15,       // function definition (: type = body after call)
};

export default grammar({
  name: 'verse',

  externals: $ => [
    $._newline,
    $._indent,
    $._dedent,
    $._string_content,       // raw string content (external scanner)
    $._interpolation_end,    // } closing interpolation (external scanner)
    $._specifier_open,       // < immediately after identifier (no space)
    $._colon_indent,         // : followed by newline+indent (starts indented block)
    $._brace_sep,            // statement boundary before a line-initial ( or [
    $._error_sentinel,
  ],

  extras: $ => [
    /[ \t\r\n]/,
    $.line_comment,
    $.block_comment,
  ],

  word: $ => $.identifier,

  supertypes: $ => [
    $._expression,
  ],

  conflicts: $ => [
    [$._func_signature, $._expression],
    [$._expression, $.argument],
    [$._var_name, $._expression],
    [$._var_name, $._func_signature, $._expression],
  ],

  rules: {
    source_file: $ => optional($._block_body_braced),

    // Block body for indented blocks (newline, ; or , as separator)
    _block_body: $ => prec.left(seq(
      $._statement,
      repeat(seq(choice($._newline, ';', ','), $._statement)),
      optional(choice($._newline, ';', ',')),
    )),

    // Block body for braced/paren blocks, no _newline separator.
    // Newlines handled by extras. This enables } else chaining and
    // multiline expressions without scanner NEWLINE interference.
    _block_body_braced: $ => repeat1(seq(
      $._statement,
      optional(choice(';', ',', $._brace_sep)),
    )),

    _statement: $ => choice(
      $.using_statement,
      $.var_definition,
      $.annotation,
      $._expression,
    ),

    indented_block: $ => prec(PREC.TYPE_ANN + 2, seq(
      $._colon_indent,
      optional($._block_body),
      $._dedent,
    )),

    // Bare indented block (no leading colon), used for `=`-introduced
    // function bodies and other significant-whitespace bodies.
    block_indent: $ => seq(
      $._indent,
      optional($._block_body),
      $._dedent,
    ),

    braced_block: $ => seq(
      '{',
      optional($._block_body_braced),
      '}',
    ),

    dot_block: $ => prec.right(PREC.TYPE_ANN + 1, seq(
      '.',
      $._expression,
    )),

    _body_block: $ => choice(
      $.indented_block,
      $.block_indent,
      $.braced_block,
      $.dot_block,
    ),

    var_definition: $ => prec.dynamic(10, prec.right(PREC.TYPE_ANN + 1, seq(
      'var',
      optional(field('specifiers', $.specifier_list)),
      optional('live'),
      field('name', $._var_name),
      choice(
        // typed: var X:T [= v | := v]
        seq(
          ':',
          field('type', $._expression),
          optional(seq(choice('=', ':='), field('value', $._expression))),
        ),
        // inferred: var X := v | var X = v
        seq(choice('=', ':='), field('value', $._expression)),
      ),
    ))),

    // Variable name (lvalue), restricted so a trailing `:type` is taken by
    // the var's type slot rather than absorbed into a type_annotation.
    _var_name: $ => choice(
      $.identifier,
      $.decorated_expression,
      $.qualified_access,
      $.member_expression,
      $.subscript_expression,
    ),

    // Postfix on a call signature: after `F(args)`, a trailing `:type = body` or
    // `= body` triggers this. Abstract `F():void` is instead a type_annotation.
    function_definition: $ => prec.dynamic(10, prec.right(PREC.FUNC_DEF, choice(
      // signature : type = body
      seq(
        field('signature', $._func_signature),
        ':',
        field('return_type', $._type),
        '=',
        field('body', $._fn_body),
      ),
      // signature = body  (no return type)
      seq(
        field('signature', $._func_signature),
        '=',
        field('body', $._fn_body),
      ),
    ))),

    // Return type: a plain identifier or a container form ([]int, ?int,
    // [key]value, tuple(...)). Container forms have distinctive leading tokens
    // so they don't collide with the trailing `=` body terminator.
    _type: $ => choice(
      $.identifier,
      $.array_type,
      $.optional_type,
      $.map_type,
      $.tuple_expression,
    ),

    // Function body: an inline expression, a braced block (via _expression),
    // or a bare indented block introduced by the newline after `=`.
    _fn_body: $ => choice(
      $._expression,
      $.block_indent,
    ),

    // Macro / labeled block: `head: <colon-indented block>` (e.g. `assert:`,
    // `verse_vm_only:`). The _colon_indent external token distinguishes this
    // from a plain `x:type` annotation, which uses a bare `:`.
    macro_block: $ => prec.dynamic(-1, prec.right(seq(
      field('head', $._macro_head),
      field('body', $.indented_block),
    ))),

    // Restricted to tight, callable forms so the body binds to the nearest
    // primary rather than swallowing a whole `x := primary:` assignment.
    _macro_head: $ => choice(
      $.identifier,
      $.call_expression,
      $.decorated_expression,
      $.member_expression,
      $.qualified_access,
      $.subscript_expression,
    ),

    // Type constructors (bind tighter than the `:` annotation so they group into the type)
    array_type: $ => prec(PREC.TYPE_PREFIX, seq('[', ']', $._expression)),
    map_type: $ => prec(PREC.TYPE_PREFIX, seq('[', $._expression, ']', $._expression)),
    optional_type: $ => prec.right(PREC.TYPE_PREFIX, seq('?', $._expression)),

    // :type, unnamed parameter, or bare : for a qualified prefix (super:)
    type_prefix: $ => prec.right(PREC.TYPE_ANN, seq(':', optional($._expression))),

    // Function signature: must end with (), call, decorated call, etc.
    _func_signature: $ => choice(
      $.call_expression,
      $.decorated_expression,
    ),

    _expression: $ => choice(
      $.function_definition,
      $.macro_block,
      $.assignment_expression,
      $.comparison_expression,
      $.arrow_block,
      $.binary_expression,
      $.type_annotation,
      $.unary_expression,
      $.member_expression,
      $.call_expression,
      $.subscript_expression,
      $.archetype_instantiation,
      $.postfix_query,
      $.postfix_deref,
      $.decorated_expression,
      $.qualified_access,
      $.if_expression,
      $.for_expression,
      $.loop_expression,
      $.case_expression,
      $.block_expression,
      $.return_expression,
      $.break_expression,
      $.continue_expression,
      $.yield_expression,
      $.spawn_expression,
      $.sync_expression,
      $.branch_expression,
      $.defer_expression,
      $.set_expression,
      $.ref_expression,
      $.live_binding,
      $.class_expression,
      $.struct_expression,
      $.interface_expression,
      $.enum_expression,
      $.module_expression,
      $.identifier,
      alias(choice('task', 'weak_map', 'event', 'logic'), $.identifier),
      $.integer_literal,
      $.float_literal,
      $.boolean_literal,
      $.char_literal,
      $.string,
      $.path_literal,
      $.parenthesized_expression,
      $.array_literal,
      $.option_literal,
      $.map_literal,
      $.tuple_expression,
      $.braced_block,
      $.array_type,
      $.map_type,
      $.optional_type,
      $.type_prefix,
    ),

    assignment_expression: $ => prec.dynamic(5, prec.right(PREC.DEF, seq(
      field('left', $._expression),
      field('operator', choice(':=', '+=', '-=', '*=', '/=')),
      field('right', $._expression),
    ))),

    comparison_expression: $ => prec.left(PREC.CMP, seq(
      field('left', $._expression),
      field('operator', choice('=', '<>', '<', '<=', '>', '>=')),
      field('right', $._expression),
    )),

    binary_expression: $ => {
      /** @type {Array<[number, string, string]>} */
      const table = [
        [PREC.OR, 'or', 'right'],
        [PREC.AND, 'and', 'right'],
        [PREC.ADD, '+', 'left'],
        [PREC.ADD, '-', 'left'],
        [PREC.MUL, '*', 'left'],
        [PREC.MUL, '/', 'left'],
        [PREC.MUL, '&', 'left'],
        [PREC.MUL, '|', 'left'],
        [PREC.RANGE, '..', 'right'],
        [PREC.RANGE, 'to', 'right'],
        [PREC.RANGE, '->', 'right'],
        [PREC.DEF, '=>', 'right'],
        [PREC.CONTROL, 'where', 'left'],
        [PREC.CONTROL, 'when', 'left'],
        [PREC.CONTROL, 'while', 'left'],
        [PREC.CONTROL, 'over', 'left'],
        [PREC.CONTROL, 'of', 'left'],
        [PREC.CONTROL, 'is', 'left'],
        [PREC.CONTROL, 'in', 'left'],
      ];

      return choice(...table.map(([prec_val, op, assoc]) => {
        const rule = seq(
          field('left', $._expression),
          field('operator', op),
          field('right', $._expression),
        );
        return assoc === 'right'
          ? prec.right(prec_val, rule)
          : prec.left(prec_val, rule);
      }));
    },

    // x:T type annotation, also handles (path:) qualified prefix when type is empty.
    // Binds looser than CALL so member-path types group correctly: x:a.b => x:(a.b),
    // not (x:a).b (which would mis-parse `for (M:Plot.GetMembers())`).
    type_annotation: $ => prec.right(PREC.TYPE_ANN_LOOSE, seq(
      field('value', $._expression),
      ':',
      optional(field('type', $._expression)),
    )),

    unary_expression: $ => prec.right(PREC.PREFIX, seq(
      field('operator', choice('+', '-', 'not', '&')),
      field('operand', $._expression),
    )),

    member_expression: $ => prec.left(PREC.CALL, seq(
      field('object', $._expression),
      '.',
      field('member', choice($.identifier, $.qualified_access)),
    )),

    call_expression: $ => prec.left(PREC.CALL, seq(
      field('function', $._expression),
      '(',
      optional(field('arguments', $.argument_list)),
      ')',
    )),

    subscript_expression: $ => prec.left(PREC.CALL, seq(
      field('object', $._expression),
      '[',
      optional(field('arguments', $.argument_list)),
      ']',
    )),

    archetype_instantiation: $ => prec.left(PREC.CALL, seq(
      field('type', $._expression),
      '{',
      optional($._block_body_braced),
      '}',
    )),

    postfix_query: $ => prec.left(PREC.CALL, seq(
      field('operand', $._expression),
      '?',
    )),

    postfix_deref: $ => prec.left(PREC.CALL, seq(
      field('operand', $._expression),
      '^',
    )),

    // (path:)Name, qualified access, parenthesized prefix + identifier
    qualified_access: $ => prec.left(PREC.CALL + 1, seq(
      field('qualifier', $.parenthesized_expression),
      field('name', $.identifier),
    )),

    // identifier<spec> or expr<spec>, specifiers attached to expressions
    decorated_expression: $ => prec.dynamic(-1, prec.left(PREC.CALL + 2, seq(
      field('operand', $._expression),
      field('specifiers', $.specifier_list),
    ))),

    argument_list: $ => commaSep1($.argument),

    argument: $ => choice(
      // Named argument `?Name := value`. Outranks the generic expression parse
      // (which would otherwise read `?Name` as an optional_type) via dynamic prec.
      prec.dynamic(20, seq('?', field('name', $.identifier), ':=', field('value', $._expression))),
      $._expression,
    ),

    set_expression: $ => prec.right(PREC.PREFIX, seq(
      'set',
      optional('live'),
      field('target', $._expression),
      field('operator', choice('=', '+=', '-=', '*=', '/=')),
      field('value', $._expression),
    )),

    ref_expression: $ => prec.right(PREC.PREFIX, seq(
      'ref',
      field('operand', $._expression),
    )),

    // `live X:int = v`, a live (observable) binding without `var`
    live_binding: $ => prec.right(PREC.PREFIX, seq(
      'live',
      field('binding', $._expression),
    )),

    class_expression: $ => prec.dynamic(3, prec.right(seq(
      'class',
      optional(field('specifiers', $.specifier_list)),
      optional(field('supertypes', $.supertype_clause)),
      optional($._body_block),
    ))),

    struct_expression: $ => prec.dynamic(3, prec.right(seq(
      'struct',
      optional(field('specifiers', $.specifier_list)),
      optional(field('supertypes', $.supertype_clause)),
      $._body_block,
    ))),

    interface_expression: $ => prec.dynamic(3, prec.right(seq(
      'interface',
      optional(field('specifiers', $.specifier_list)),
      optional(field('supertypes', $.supertype_clause)),
      $._body_block,
    ))),

    enum_expression: $ => prec.dynamic(3, prec.right(seq(
      'enum',
      optional(field('specifiers', $.specifier_list)),
      optional(field('supertypes', $.supertype_clause)),
      optional($._body_block),
    ))),

    module_expression: $ => prec.dynamic(3, prec.right(seq(
      'module',
      optional(field('specifiers', $.specifier_list)),
      $._body_block,
    ))),

    supertype_clause: $ => seq(
      '(',
      optional(commaSep1($._expression)),
      ')',
    ),

    if_expression: $ => choice(
      // if-else with body (REQUIRED else, higher dynamic prec)
      prec.dynamic(2, prec.right(seq(
        'if', '(', field('condition', $._block_body_braced), ')',
        $._body_block, 'else', choice($.if_expression, $._body_block)))),
      // if-then-else inline (else optional)
      prec.dynamic(2, prec.right(seq(
        'if', '(', field('condition', $._block_body_braced), ')', 'then',
        field('then', $._expression),
        optional(seq('else', field('else', $._expression)))))),
      // if with body (no else)
      prec.dynamic(1, prec.right(seq(
        'if', '(', field('condition', $._block_body_braced), ')',
        $._body_block))),
      // bare if (cond)
      prec.dynamic(0, prec.right(seq(
        'if', '(', field('condition', $._block_body_braced), ')'))),
      // if: block [then: block] [else: block]
      prec.right(seq('if', $._body_block, optional(seq('then', $._body_block)),
        optional(seq('else', optional($._body_block))))),
    ),

    for_expression: $ => prec.right(seq(
      'for',
      choice(
        seq(
          '(',
          field('clauses', $._block_body_braced),
          ')',
          optional($._body_block),
        ),
        seq($._body_block, optional(seq('do', $._body_block))),
      ),
    )),

    loop_expression: $ => seq('loop', $._body_block),

    case_expression: $ => seq(
      'case',
      '(',
      field('value', $._expression),
      ')',
      $._body_block,
    ),

    // `pattern => <indented block>`: a case arm (or lambda) whose body spans
    // multiple lines, e.g.
    //   _ =>
    //     Log("x")
    //     0.0
    // The plain single-line `pattern => expr` form is a binary_expression.
    arrow_block: $ => prec.dynamic(1, prec.right(PREC.DEF, seq(
      field('pattern', $._expression),
      '=>',
      field('body', $.block_indent),
    ))),

    block_expression: $ => seq('block', $._body_block),

    return_expression: $ => prec.right(PREC.PREFIX, seq(
      'return',
      optional($._expression),
    )),

    break_expression: $ => 'break',
    continue_expression: $ => 'continue',
    yield_expression: $ => prec.right(seq('yield', optional($._expression))),

    spawn_expression: $ => seq('spawn', $._body_block),
    sync_expression: $ => seq('sync', $._body_block),
    branch_expression: $ => seq('branch', $._body_block),
    defer_expression: $ => seq('defer', $._body_block),

    parenthesized_expression: $ => seq(
      '(',
      optional($._block_body_braced),
      ')',
    ),

    array_literal: $ => prec.right(seq(
      'array',
      choice(
        seq('{', optional($._block_body_braced), '}'),
        $.indented_block,
      ),
    )),

    option_literal: $ => prec.right(seq(
      'option',
      choice(
        seq('{', optional($._block_body_braced), '}'),
        $.indented_block,
        $.dot_block,
      ),
    )),

    map_literal: $ => prec.right(seq(
      'map',
      choice(
        seq('{', optional($._map_body), '}'),
        $.indented_block,
      ),
    )),

    _map_body: $ => repeat1(seq(
      $.map_entry,
      optional(choice(';', ',')),
    )),

    map_entry: $ => seq(
      field('key', $._expression),
      '=>',
      field('value', $._expression),
    ),

    tuple_expression: $ => seq(
      'tuple',
      '(',
      optional(commaSep1($._expression)),
      ')',
    ),

    specifier_list: $ => prec.right(repeat1($.specifier)),

    specifier: $ => prec(PREC.CALL + 2, seq(
      alias($._specifier_open, '<'),
      field('name', $.identifier),
      optional(choice(
        seq('{', optional(commaSep1($._expression)), '}'),
        seq('(', optional(commaSep1($._expression)), ')'),
      )),
      '>',
    )),

    annotation: $ => prec.right(seq(
      '@',
      field('name', $.identifier),
      optional(seq('(', optional(field('arguments', $.argument_list)), ')')),
      optional($._body_block),
    )),

    using_statement: $ => seq(
      'using',
      '{',
      commaSep1(choice($.path_literal, $.identifier, $.member_expression)),
      '}',
    ),

    integer_literal: $ => token(seq(
      choice(
        /0[xX][0-9a-fA-F]+/,
        /0[bB][01]+/,
        /0[oO][0-9a-fA-F]+/,
        /0[uU][0-9a-fA-F]+/,
        /[0-9]+/,
      ),
      optional(/[a-zA-Z_][a-zA-Z0-9_]*/),  // units suffix
    )),

    float_literal: $ => token(seq(
      choice(
        seq(/[0-9]*/, '.', /[0-9]+/, optional(seq(/[eE]/, optional(/[+-]/), /[0-9]+/))),
        seq(/[0-9]+/, /[eE]/, optional(/[+-]/), /[0-9]+/),
      ),
      optional(/[a-zA-Z_][a-zA-Z0-9_]*/),  // units suffix
    )),

    boolean_literal: $ => choice('true', 'false'),

    char_literal: $ => token(seq(
      "'",
      choice(
        /[^'\\]/,
        /\\[tnr\\'"\{\}<>&\#~0]/,
        /\\x[0-9a-fA-F]{2}/,
      ),
      "'",
    )),

    string: $ => seq(
      '"',
      repeat(choice(
        $._string_content,
        $.interpolation,
        $.escape_sequence,
      )),
      token.immediate('"'),
    ),

    interpolation: $ => seq(
      token.immediate('{'),
      optional($._expression),
      alias($._interpolation_end, '}'),
    ),

    escape_sequence: $ => token.immediate(choice(
      /\\[tnr\\'"\{\}<>&\#~0]/,
      /\\x[0-9a-fA-F]{2}/,
      /\\u[0-9a-fA-F]{4}/,
      /\\U[0-9a-fA-F]{8}/,
    )),

    path_literal: $ => token(seq(
      '/',
      /[a-zA-Z_][a-zA-Z0-9_.@-]*/,
      repeat(seq('/', /[a-zA-Z_][a-zA-Z0-9_]*/)),
    )),

    line_comment: $ => token(seq('#', /.*/)),

    block_comment: $ => token(choice(
      seq('<#', /([^#]|#[^>])*/, '#>'),
      seq('<#>', /[^\n]*/),  // <#> indented comment (consumes line)
    )),

    // Identifier: Alpha {Alnum} [' quoted_chars ']
    // e.g., prefix'-', operator'+', MyFunc'special'
    identifier: $ => token(seq(
      /[a-zA-Z_][a-zA-Z0-9_]*/,
      optional(seq("'", /[^'\\{}\"<>#]+/, "'")),
    )),
  },
});

/**
 * @param {RuleOrLiteral} rule
 */
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}
