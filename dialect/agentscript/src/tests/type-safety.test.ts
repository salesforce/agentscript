/**
 * Compile-time type safety tests for FieldType inference.
 *
 * Ensures InferFieldType<T> correctly extracts the value type V from
 * each FieldType<V> declaration. A mismatch between the FieldType generic
 * parameter and the actual parse return type won't be caught at compile
 * time by TypeScript alone — these assertions guard against that drift.
 */

import { describe, test, expectTypeOf } from 'vitest';
import type {
  InferFieldType,
  Expression,
  StringValue,
  NumberValue,
  BooleanValue,
  ProcedureValue,
  ReferenceValue,
} from '@agentscript/language';
import {
  StringValue as StringValueConst,
  NumberValue as NumberValueConst,
  BooleanValue as BooleanValueConst,
  ProcedureValue as ProcedureValueConst,
  ExpressionValue,
  ReferenceValue as ReferenceValueConst,
} from '@agentscript/language';

describe('InferFieldType', () => {
  test('StringValue infers StringLiteral | TemplateExpression', () => {
    expectTypeOf<
      InferFieldType<typeof StringValueConst>
    >().toEqualTypeOf<StringValue>();
  });

  test('NumberValue infers NumberValueNode', () => {
    expectTypeOf<
      InferFieldType<typeof NumberValueConst>
    >().toEqualTypeOf<NumberValue>();
  });

  test('BooleanValue infers BooleanValueNode', () => {
    expectTypeOf<
      InferFieldType<typeof BooleanValueConst>
    >().toEqualTypeOf<BooleanValue>();
  });

  test('ProcedureValue infers ProcedureValueNode', () => {
    expectTypeOf<
      InferFieldType<typeof ProcedureValueConst>
    >().toEqualTypeOf<ProcedureValue>();
  });

  test('ExpressionValue infers Expression', () => {
    expectTypeOf<
      InferFieldType<typeof ExpressionValue>
    >().toEqualTypeOf<Expression>();
  });

  test('ReferenceValue infers MemberExpression', () => {
    expectTypeOf<
      InferFieldType<typeof ReferenceValueConst>
    >().toEqualTypeOf<ReferenceValue>();
  });
});
