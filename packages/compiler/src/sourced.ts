import type { Range } from '@agentscript/types';

/**
 * Ephemeral carrier: pairs a value with its source range.
 *
 * Exists only between extraction (extractSourcedString etc.) and
 * ctx.track(). The track() function unwraps it to a plain primitive
 * and records the range in a side-channel. Compiler authors never
 * see Sourced<T> in output objects — values are always plain.
 */
export class Sourced<T> {
  readonly value: T;
  readonly range: Range | undefined;

  constructor(value: T, range: Range | undefined) {
    this.value = value;
    this.range = range;
  }

  toJSON(): T {
    return this.value;
  }

  toString(): string {
    return String(this.value);
  }

  valueOf(): T {
    return this.value;
  }
}

/** Create a Sourced value. */
export function sourced<T>(value: T, range: Range | undefined): Sourced<T> {
  return new Sourced(value, range);
}

/**
 * Recursively make every leaf primitive in T accept Sourced<T> | T.
 * Used by ctx.track() for type-safe construction of output objects.
 */
export type Sourceable<T> = T extends string
  ? Sourced<string> | string
  : T extends number
    ? Sourced<number> | number
    : T extends boolean
      ? Sourced<boolean> | boolean
      : T extends (infer U)[]
        ? Sourceable<U>[]
        : T extends object
          ? { [K in keyof T]: Sourceable<T[K]> }
          : T;
