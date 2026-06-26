import type {
  ArrayOp,
  Document,
  MergeValue,
  ObjectOp,
  RelativePosition,
  StringNode,
  ValueNode,
} from "./ast";
import { type DiagnosticBag, DiagnosticCode } from "./diagnostics";
import type { XJSONHost } from "./host";
import { tokenize } from "./lexer";
import { parseTokens } from "./parser";
import type { Range } from "./position";
import { type JsonObject, type JsonValue, isJsonArray, isJsonObject } from "./value";

interface PendingMove {
  key: string;
  placement: "before" | "after";
  target: string;
  range: Range;
}

export class Evaluator {
  private readonly stack: string[] = [];
  private readonly cache = new Map<string, JsonValue>();

  constructor(
    private readonly bag: DiagnosticBag,
    private readonly host?: XJSONHost,
  ) {}

  evaluateRoot(doc: Document, src: string, injectedBase?: JsonValue): JsonValue {
    this.stack.push(src);
    try {
      return this.evaluateDocument(doc, src, injectedBase);
    } finally {
      this.stack.pop();
    }
  }

  private evaluateDocument(doc: Document, src: string, injectedBase?: JsonValue): JsonValue {
    if (doc.kind === "data-document") {
      return this.evalValue(doc.value);
    }

    let base: JsonValue;
    if (doc.specifier) {
      base = this.resolveExtends(doc.specifier, src);
    } else if (injectedBase !== undefined) {
      base = injectedBase;
    } else {
      this.emit(
        DiagnosticCode.NoBaseForOverride,
        doc.range,
        "This override block has no base (no 'extends' and no injected base); using an empty object.",
        src,
      );
      base = {};
    }

    let baseObject: JsonObject;
    if (isJsonObject(base)) {
      baseObject = base;
    } else {
      this.emit(
        DiagnosticCode.TypeMismatchOverride,
        doc.range,
        "The base of a top-level override must be an object; using an empty object.",
        src,
      );
      baseObject = {};
    }
    return this.applyObjectOps(baseObject, doc.ops, src);
  }

  // --- extends resolution + cycle detection ------------------------------

  private resolveExtends(specifier: StringNode, fromFile: string): JsonValue {
    if (!this.host) {
      this.emit(
        DiagnosticCode.ExtendsWithoutHost,
        specifier.range,
        "Cannot resolve 'extends': no host was provided.",
        fromFile,
      );
      return {};
    }

    let absPath: string;
    try {
      absPath = this.host.resolve(specifier.value, fromFile);
    } catch (error) {
      this.emit(
        DiagnosticCode.ExtendsResolveFailed,
        specifier.range,
        `Could not resolve '${specifier.value}': ${errorMessage(error)}.`,
        fromFile,
      );
      return {};
    }

    if (this.stack.includes(absPath)) {
      const cycle = [...this.stack, absPath].join(" -> ");
      this.emit(
        DiagnosticCode.ExtendsCycle,
        specifier.range,
        `Cyclic 'extends' dependency detected: ${cycle}.`,
        fromFile,
      );
      return {};
    }

    const cached = this.cache.get(absPath);
    if (cached !== undefined) return cached;

    let content: string;
    try {
      content = this.host.readFile(absPath);
    } catch (error) {
      this.emit(
        DiagnosticCode.ExtendsReadFailed,
        specifier.range,
        `Could not read '${absPath}': ${errorMessage(error)}.`,
        fromFile,
      );
      return {};
    }

    const { tokens } = tokenize(content, this.bag, absPath);
    const nestedDoc = parseTokens(tokens, this.bag, absPath);

    this.stack.push(absPath);
    let value: JsonValue;
    try {
      value = this.evaluateDocument(nestedDoc, absPath);
    } finally {
      this.stack.pop();
    }
    this.cache.set(absPath, value);
    return value;
  }

  // --- object operations -------------------------------------------------

  private applyObjectOps(base: JsonObject, ops: ObjectOp[], src: string): JsonObject {
    const clearedAtStart = ops[0]?.kind === "clear";

    const mentioned = new Set<string>();
    const deletedKeys = new Set<string>();
    for (const op of ops) {
      if (
        op.kind === "set" ||
        op.kind === "add" ||
        op.kind === "override-move" ||
        op.kind === "override-merge"
      ) {
        mentioned.add(op.key.name);
      } else if (op.kind === "delete") {
        deletedKeys.add(op.key.name);
      }
    }

    const baseKeys = clearedAtStart ? [] : Object.keys(base);
    const inheritedKeys = baseKeys.filter((k) => !mentioned.has(k) && !deletedKeys.has(k));

    const valueMap = new Map<string, JsonValue>();
    if (!clearedAtStart) {
      for (const k of baseKeys) valueMap.set(k, base[k] as JsonValue);
    }

    const order: string[] = [];
    const pending: PendingMove[] = [];
    let inheritPlaced = false;

    const place = (key: string, position?: RelativePosition): void => {
      const existing = order.indexOf(key);
      if (existing >= 0) order.splice(existing, 1);
      order.push(key);
      if (position) {
        pending.push({
          key,
          placement: position.placement,
          target: position.key.name,
          range: position.range,
        });
      }
    };

    for (let idx = 0; idx < ops.length; idx++) {
      const op = ops[idx] as ObjectOp;
      switch (op.kind) {
        case "clear":
          if (idx !== 0) {
            this.emit(
              DiagnosticCode.ClearNotAtStart,
              op.range,
              "'clear' is only valid at the start of a block.",
              src,
            );
          }
          break;
        case "set":
          valueMap.set(op.key.name, this.evalValue(op.value));
          place(op.key.name);
          break;
        case "add":
          valueMap.set(op.key.name, this.evalValue(op.value));
          place(op.key.name, op.position);
          break;
        case "override-move":
          if (!valueMap.has(op.key.name)) {
            this.emit(
              DiagnosticCode.OverrideUnknownKey,
              op.key.range,
              `Cannot reposition '${op.key.name}': it does not exist in the base.`,
              src,
            );
          } else {
            place(op.key.name, op.position);
          }
          break;
        case "override-merge": {
          const had = valueMap.has(op.key.name);
          if (!had) {
            this.emit(
              DiagnosticCode.OverrideUnknownKey,
              op.key.range,
              `Cannot merge into '${op.key.name}': it does not exist in the base.`,
              src,
            );
          }
          const merged = this.applyMerge(valueMap.get(op.key.name), op.value, src);
          valueMap.set(op.key.name, merged);
          place(op.key.name, op.position);
          break;
        }
        case "delete":
          if (!valueMap.has(op.key.name)) {
            this.emit(
              DiagnosticCode.DeleteUnknownKey,
              op.key.range,
              `Cannot delete '${op.key.name}': it does not exist in the base.`,
              src,
            );
          }
          valueMap.delete(op.key.name);
          {
            const i = order.indexOf(op.key.name);
            if (i >= 0) order.splice(i, 1);
          }
          break;
        case "inherit":
          if (inheritPlaced) {
            this.emit(
              DiagnosticCode.DuplicateInherit,
              op.range,
              "Duplicate 'inherit' in the same block.",
              src,
            );
          } else {
            for (const k of inheritedKeys) {
              if (valueMap.has(k) && order.indexOf(k) < 0) order.push(k);
            }
            inheritPlaced = true;
          }
          break;
      }
    }

    if (!inheritPlaced) {
      const prefix = inheritedKeys.filter((k) => valueMap.has(k) && order.indexOf(k) < 0);
      order.unshift(...prefix);
    }

    for (const move of pending) {
      const keyIndex = order.indexOf(move.key);
      if (keyIndex < 0) continue;
      if (order.indexOf(move.target) < 0) {
        this.emit(
          DiagnosticCode.UnknownKeyReference,
          move.range,
          `Reference key '${move.target}' does not exist; keeping '${move.key}' in place.`,
          src,
        );
        continue;
      }
      order.splice(keyIndex, 1);
      const targetIndex = order.indexOf(move.target);
      const insertAt = move.placement === "before" ? targetIndex : targetIndex + 1;
      order.splice(insertAt, 0, move.key);
    }

    const result: JsonObject = {};
    const seen = new Set<string>();
    for (const key of order) {
      if (valueMap.has(key) && !seen.has(key)) {
        seen.add(key);
        result[key] = valueMap.get(key) as JsonValue;
      }
    }
    for (const [key, value] of valueMap) {
      if (!seen.has(key)) {
        seen.add(key);
        result[key] = value;
      }
    }
    return result;
  }

  // --- array operations --------------------------------------------------

  private applyArrayOps(base: JsonValue[], ops: ArrayOp[], src: string): JsonValue[] {
    const clearedAtStart = ops[0]?.kind === "array-clear";
    const arr: JsonValue[] = clearedAtStart ? [] : [...base];

    for (let idx = 0; idx < ops.length; idx++) {
      const op = ops[idx] as ArrayOp;
      switch (op.kind) {
        case "array-clear":
          if (idx !== 0) {
            this.emit(
              DiagnosticCode.ClearNotAtStart,
              op.range,
              "'clear' is only valid at the start of a block.",
              src,
            );
          }
          break;
        case "array-add": {
          const value = this.evalValue(op.value);
          if (op.index === undefined) {
            arr.push(value);
          } else {
            let i = op.index;
            if (i < 0 || i > arr.length) {
              this.emit(
                DiagnosticCode.AddIndexOutOfRange,
                op.range,
                `Index ${op.index} is out of range (0..${arr.length}); clamping.`,
                src,
              );
              i = Math.max(0, Math.min(i, arr.length));
            }
            arr.splice(i, 0, value);
          }
          break;
        }
        case "array-delete":
          if (op.index < 0 || op.index >= arr.length) {
            this.emit(
              DiagnosticCode.DeleteIndexOutOfRange,
              op.range,
              `Index ${op.index} is out of range (0..${arr.length - 1}); ignoring.`,
              src,
            );
          } else {
            arr.splice(op.index, 1);
          }
          break;
      }
    }
    return arr;
  }

  // --- merge + value evaluation -----------------------------------------

  private applyMerge(
    current: JsonValue | undefined,
    mergeValue: MergeValue,
    src: string,
  ): JsonValue {
    if (mergeValue.kind === "object-ops") {
      if (isJsonObject(current)) return this.applyObjectOps(current, mergeValue.ops, src);
      if (current !== undefined) {
        this.emit(
          DiagnosticCode.TypeMismatchOverride,
          mergeValue.range,
          "Cannot merge object operations into a non-object value; substituting.",
          src,
        );
      }
      return this.applyObjectOps({}, mergeValue.ops, src);
    }
    if (mergeValue.kind === "array-ops") {
      if (isJsonArray(current)) return this.applyArrayOps(current, mergeValue.ops, src);
      if (current !== undefined) {
        this.emit(
          DiagnosticCode.TypeMismatchOverride,
          mergeValue.range,
          "Cannot merge array operations into a non-array value; substituting.",
          src,
        );
      }
      return this.applyArrayOps([], mergeValue.ops, src);
    }
    if (current !== undefined) {
      this.emit(
        DiagnosticCode.TypeMismatchOverride,
        mergeValue.range,
        "Cannot merge a non-combinable value; substituting.",
        src,
      );
    }
    return this.evalValue(mergeValue);
  }

  private evalValue(node: ValueNode): JsonValue {
    switch (node.kind) {
      case "object": {
        const obj: JsonObject = {};
        for (const member of node.members) obj[member.key.name] = this.evalValue(member.value);
        return obj;
      }
      case "array":
        return node.elements.map((element) => this.evalValue(element));
      case "string":
        return node.value;
      case "number":
        return node.value;
      case "boolean":
        return node.value;
      case "null":
        return null;
    }
  }

  private emit(code: DiagnosticCode, range: Range, message: string, src: string): void {
    this.bag.emit(code, range, message, src);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
