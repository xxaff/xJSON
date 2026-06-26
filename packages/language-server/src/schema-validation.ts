import type { Document, JsonValue, KeyNode, ObjectOp, ValueNode } from "@xjson/core";
import { compileSchema } from "@xjson/schema";
import {
  type Diagnostic,
  DiagnosticSeverity,
  type DocumentLink,
  type Range,
} from "vscode-languageserver-types";
import { type AnalyzeOptions, parseDocument, resolvedValue, toLspRange } from "./shared";

interface SchemaRef {
  value: string;
  range: Range;
}

interface EffectiveSchema {
  schemaUri: string;
  /** Range to attach root-level diagnostics to. */
  range: Range;
}

function findSchemaRef(doc: Document): SchemaRef | undefined {
  if (doc.kind === "data-document") {
    if (doc.value.kind !== "object") return undefined;
    const member = doc.value.members.find((m) => m.key.name === "$schema");
    return member && member.value.kind === "string"
      ? { value: member.value.value, range: toLspRange(member.value.range) }
      : undefined;
  }
  for (const op of doc.ops) {
    if (
      (op.kind === "set" || op.kind === "add") &&
      op.key.name === "$schema" &&
      op.value.kind === "string"
    ) {
      return { value: op.value.value, range: toLspRange(op.value.range) };
    }
  }
  return undefined;
}

/** Only treat an in-file `$schema` as an instance schema when it points to a local file. */
function isLocalSchema(ref: string): boolean {
  return ref.startsWith("./") || ref.startsWith("../") || ref.endsWith(".xjson");
}

function docStart(doc: Document): Range {
  const start = toLspRange(doc.range).start;
  return { start, end: start };
}

/** The schema to validate against: the in-file `$schema`, else a configured association. */
function effectiveSchema(doc: Document, options: AnalyzeOptions): EffectiveSchema | undefined {
  const ref = findSchemaRef(doc);
  if (ref && isLocalSchema(ref.value) && options.host && options.uri) {
    try {
      return { schemaUri: options.host.resolve(ref.value, options.uri), range: ref.range };
    } catch {
      return undefined;
    }
  }
  if (options.schemaUri) return { schemaUri: options.schemaUri, range: docStart(doc) };
  return undefined;
}

/** Validate an XJSON instance against its `$schema` or a configured schema association. */
export function schemaDiagnostics(source: string, options: AnalyzeOptions = {}): Diagnostic[] {
  if (!options.host) return [];
  const doc = parseDocument(source, options);
  const effective = effectiveSchema(doc, options);
  if (!effective) return [];

  let schemaSource: string;
  try {
    schemaSource = options.host.readFile(effective.schemaUri);
  } catch {
    return [error(effective.range, "Cannot read the associated schema.")];
  }

  let validate: ReturnType<typeof compileSchema>["validate"];
  try {
    validate = compileSchema(schemaSource, {
      uri: effective.schemaUri,
      host: options.host,
    }).validate;
  } catch (err) {
    return [
      error(
        effective.range,
        `Invalid schema: ${err instanceof Error ? err.message : String(err)}.`,
      ),
    ];
  }

  const instance = stripSchemaKey(resolvedValue(source, options));
  if (validate(instance)) return [];

  return (validate.errors ?? []).map((issue) => {
    const path = pointerToPath(issue.instancePath);
    const node = path.length > 0 ? findKeyNodeAtPath(doc, path) : undefined;
    const range = node ? toLspRange(node.range) : effective.range;
    return error(
      range,
      `${issue.instancePath || "/"} ${issue.message ?? "is invalid"}`,
      "schema-validation",
    );
  });
}

export interface SchemaProperty {
  name: string;
  required: boolean;
}

/** The property names declared by the effective schema (for completion). */
export function schemaInfo(source: string, options: AnalyzeOptions = {}): SchemaProperty[] {
  if (!options.host) return [];
  const doc = parseDocument(source, options);
  const effective = effectiveSchema(doc, options);
  if (!effective) return [];

  let schema: JsonValue;
  try {
    const schemaSource = options.host.readFile(effective.schemaUri);
    schema = compileSchema(schemaSource, { uri: effective.schemaUri, host: options.host }).schema;
  } catch {
    return [];
  }

  if (!isPlainObject(schema) || !isPlainObject(schema.properties)) return [];
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === "string")
    : [];
  return Object.keys(schema.properties).map((name) => ({
    name,
    required: required.includes(name),
  }));
}

/** A document link for an in-file `$schema` reference, so it is Ctrl+Click navigable. */
export function schemaLinks(source: string, options: AnalyzeOptions = {}): DocumentLink[] {
  if (!options.host || !options.uri) return [];
  const ref = findSchemaRef(parseDocument(source, options));
  if (!ref || !isLocalSchema(ref.value)) return [];
  try {
    return [{ range: ref.range, target: options.host.resolve(ref.value, options.uri) }];
  } catch {
    return [];
  }
}

function isPlainObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return (
    value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)
  );
}

function stripSchemaKey(value: JsonValue): JsonValue {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, JsonValue>)) {
      if (key !== "$schema") result[key] = entry;
    }
    return result;
  }
  return value;
}

function error(range: Range, message: string, code = "schema-error"): Diagnostic {
  return { range, message, severity: DiagnosticSeverity.Error, code, source: "xjson" };
}

function pointerToPath(pointer: string): string[] {
  if (!pointer) return [];
  return pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function findKeyNodeAtPath(doc: Document, path: string[]): KeyNode | undefined {
  if (path.length === 0) return undefined;
  return doc.kind === "data-document" ? findInValue(doc.value, path) : findInOps(doc.ops, path);
}

function findInValue(node: ValueNode, path: string[]): KeyNode | undefined {
  if (node.kind !== "object" || path.length === 0) return undefined;
  const [head, ...rest] = path;
  const member = node.members.find((m) => m.key.name === head);
  if (!member) return undefined;
  return rest.length === 0 ? member.key : findInValue(member.value, rest);
}

function findInOps(ops: ObjectOp[], path: string[]): KeyNode | undefined {
  if (path.length === 0) return undefined;
  const [head, ...rest] = path;
  for (const op of ops) {
    if (op.kind === "clear" || op.kind === "inherit" || op.kind === "delete") continue;
    if (op.key.name !== head) continue;
    if (rest.length === 0) return op.key;
    if (op.kind === "override-merge" && op.value.kind === "object-ops")
      return findInOps(op.value.ops, rest);
    if (op.kind === "set" || op.kind === "add") return findInValue(op.value, rest);
    return undefined;
  }
  return undefined;
}
