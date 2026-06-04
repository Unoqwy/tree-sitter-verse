; Comments
(line_comment) @comment @spell
(block_comment) @comment @spell

; Literals
(integer_literal) @number
(float_literal) @number.float
(boolean_literal) @boolean
(char_literal) @character
(path_literal) @string.special

; Strings
(string) @string
(escape_sequence) @string.escape
(interpolation ["{" "}"] @punctuation.special)

; Keywords: control flow
(if_expression "if" @keyword)
(if_expression "else" @keyword)
(if_expression "then" @keyword)
(for_expression "for" @keyword)
(for_expression "do" @keyword)
(loop_expression "loop" @keyword)
(case_expression "case" @keyword)
(block_expression "block" @keyword)
(return_expression "return" @keyword)
(break_expression) @keyword
(continue_expression) @keyword
(yield_expression "yield" @keyword)
(spawn_expression "spawn" @keyword)
(sync_expression "sync" @keyword)
(branch_expression "branch" @keyword)
(defer_expression "defer" @keyword)

; Keywords: definitions
(set_expression "set" @keyword)
(var_definition "var" @keyword)
(ref_expression "ref" @keyword)
"live" @keyword

; Macro / labeled block head
(macro_block head: (identifier) @function.macro)

; Keywords: type definitions
(class_expression "class" @keyword.type)
(struct_expression "struct" @keyword.type)
(interface_expression "interface" @keyword.type)
(enum_expression "enum" @keyword.type)
(module_expression "module" @keyword.type)

; Keywords: operators
(binary_expression
  ["and" "or" "where" "when" "while" "over" "of" "is" "in" "to"] @keyword.operator)
(unary_expression "not" @keyword.operator)

; Keywords: collection constructors
(array_literal "array" @keyword)
(option_literal "option" @keyword)
(map_literal "map" @keyword)
(tuple_expression "tuple" @keyword)
(using_statement "using" @keyword)

; Functions
(call_expression
  function: (identifier) @function.call)

(call_expression
  function: (member_expression
    member: (identifier) @function.method.call))

; Definition name. Handles F(), F<spec>(), F()<effect>, F<spec>()<effect>
(function_definition
  signature: [
    (call_expression
      function: [
        (identifier) @function
        (decorated_expression operand: (identifier) @function)
      ])
    (decorated_expression
      operand: (call_expression
        function: [
          (identifier) @function
          (decorated_expression operand: (identifier) @function)
        ]))
  ])

; `:=` constructor with archetype body: MakeFoo(X:int) := foo{ ... }
(assignment_expression
  left: [
    (call_expression
      function: [
        (identifier) @function
        (decorated_expression operand: (identifier) @function)
      ])
    (decorated_expression
      operand: (call_expression
        function: [
          (identifier) @function
          (decorated_expression operand: (identifier) @function)
        ]))
  ])

; Abstract declaration (no body)
(type_annotation
  value: [
    (call_expression
      function: [
        (identifier) @function
        (decorated_expression operand: (identifier) @function)
      ])
    (decorated_expression
      operand: (call_expression
        function: [
          (identifier) @function
          (decorated_expression operand: (identifier) @function)
        ]))
  ])

; Types
; Type annotation: X:Type
(type_annotation
  type: (identifier) @type)

; Var definition type
(var_definition
  type: (identifier) @type)

; Function return type
(function_definition
  return_type: (identifier) @type)

; Array/map/optional type constructors
(array_type "]" @type)
(map_type "]" @type)
(optional_type "?" @type)

; Builtin types
((identifier) @type.builtin
  (#match? @type.builtin "^(void|string|int|float|logic|char|char32|rational|any|comparable|type|task|event|weak_map)$"))

; Class/struct/interface/enum supertypes
(supertype_clause
  (identifier) @type)

; Variables
; Variable binding: X := value
(assignment_expression
  left: (identifier) @variable)

; Var definition name
(var_definition
  name: (identifier) @variable)

; Set target
(set_expression
  target: (identifier) @variable)

; Member access
(member_expression
  member: (identifier) @property)

; Specifiers / attributes
(specifier
  ["<" ">"] @attribute)
(specifier
  name: (identifier) @attribute)

(annotation
  name: (identifier) @attribute)

(decorated_expression
  specifiers: (specifier_list
    (specifier
      name: (identifier) @attribute)))

; Operators
[
  ":="
  "+="
  "-="
  "*="
  "/="
  "="
  "<>"
  "<"
  "<="
  ">"
  ">="
  "+"
  "-"
  "*"
  "/"
  "&"
  "|"
  ".."
  "->"
  "=>"
  "?"
  "^"
  "@"
] @operator

; Punctuation
["(" ")" "[" "]" "{" "}"] @punctuation.bracket
["," ";" "." ":"] @punctuation.delimiter
