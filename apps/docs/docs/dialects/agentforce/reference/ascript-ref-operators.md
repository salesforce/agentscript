---
sidebar_label: "Supported Operators"
---

# Agent Script Reference: Supported Operators

In Agent Script, you can use these operators.

| Category   | Operator | Description            | Example                         |
| :--------- | :------- | :--------------------- | :------------------------------ |
| Comparison | `==`     | Equal to               | `@variables.count == 10`        |
|            | `!=`     | Not equal to           | `@variables.status != "done"`   |
|            | `<`      | Less than              | `@variables.age < 18`           |
|            | `<=`     | Less than or equal     | `@variables.score <= 100`       |
|            | `>`      | Greater than           | `@variables.count > 0`          |
|            | `>=`     | Greater than or equal  | `@variables.total >= 50`        |
|            | `is`     | Identity check         | `@variables.value is None`      |
|            | `is not` | Negated identity check | `@variables.data is not None`   |
| Logical    | `and`    | Logical AND            | `@variables.a and @variables.b` |
|            | `or`     | Logical OR             | `@variables.x or @variables.y`  |
|            | `not`    | Logical NOT            | `not @variables.flag`           |
| Arithmetic | `+`      | Addition               | `@variables.count + 1`          |
|            | `-`      | Subtraction            | `@variables.total - 5`          |

**Related Topics**

- [Reasoning Instructions](ascript-ref-instructions.md)
- [Conditional Expressions](ascript-ref-expressions.md)
