(comment) @comment @spell

; Literals
(string
  ["\"" "\""] @string)
(string_fragment) @string
(char) @string
(integer) @number
(float) @number
(logic_literal) @keyword
(path_literal) @string.special

(function_call
  function: (identifier) @function)
(field_expression
  field: (identifier) @variable.member)
(function_call
  function: (field_expression
    field: (identifier) @function))

(function_declaration
  name: (_) @function)

(declaration
  lhs: "("*
  lhs: (identifier) @constant)
(declaration
  (var_keyword) @keyword
  lhs: "("*
  lhs: (identifier) @variable)
(set_expression
  lhs: (identifier) @variable)

(named_argument
  name: (identifier) @variable.parameter)

(map_container
  key: (identifier) @type)
(map_container
  value: (identifier) @type)
(function_declaration
  ret_type: (identifier) @type)
(declaration
  type_hint: (identifier) @type)

(map_container
  key: (identifier) @type.builtin
  (#match? @type.builtin "^(void|string|int|float|logic)$"))
(map_container
  value: (identifier) @type.builtin
  (#match? @type.builtin "^(void|string|int|float|logic)$"))
(function_declaration
  ret_type: (identifier) @type.builtin
  (#match? @type.builtin "^(void|string|int|float|logic)$"))
(declaration
  type_hint: (identifier) @type.builtin
  (#match? @type.builtin "^(void|string|int|float|logic)$"))

; Attributes
(at_attributes
  ["@"] @attribute
  (identifier) @attribute)

(at_attributes
  ["@"] @attribute
  (macro_call
    macro: (identifier) @attribute))

(attributes
  (identifier) @attribute)

; Builtin macros
(declaration
  lhs: "("*
  lhs: (identifier) @type
  rhs: (macro_call
    macro: (identifier) @_
  (#match? @_ "^(class|enum|interface)$")))
(declaration
  rhs: (macro_call
    macro: (identifier) @_
    arguments: (argument_list
      (identifier) @type)
  (#match? @_ "^(class|enum|interface)$")))

(macro_call
  macro: (identifier) @function.macro)

(macro_call
  macro: (identifier) @keyword
  (#match? @keyword "^(class|enum|interface|profile|using|map|array|spawn|sync|race|rush|branch)$"))

(macro_call
  macro: (identifier) @keyword.conditional
  (#match? @keyword.conditional "^(if|else|case|then)$"))
(else_keyword) @keyword.conditional

(macro_call
  macro: (identifier) @keyword.repeat
  (#match? @keyword.repeat "^(for|loop)$"))

; Tokens
[
 "{"
 "}"
 "("
 ")"
 "["
 "]"
 ":)"
] @punctuation.bracket

[
 ";"
 ","
 "."
 ". "
] @punctuation.delimiter

[
  "*"
  "/"
  "+"
  "-"
  "="
  "<>"
  "<"
  ">"
  "<="
  ">="
  "?"
  ":"
  "macro:"
  ":="
  "=>"
] @operator

[
  "set"
  "return"
  (continue_expression)
  (break_expression)
] @keyword

[
  "and"
  "or"
  "not"
] @keyword.operator

(attributes
  ["<" ">"] @attribute)

