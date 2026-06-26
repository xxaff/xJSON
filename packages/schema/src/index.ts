import { type Diagnostic, type EvaluateOptions, type JsonValue, evaluate } from "@xjson/core";
import type { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020";

export interface SchemaCompileResult {
  /** The evaluated JSON Schema as a plain JSON value. */
  schema: JsonValue;
  /** The AJV validator compiled from the schema. */
  validate: ValidateFunction;
  /** Diagnostics produced while evaluating the XJSON schema source. */
  diagnostics: Diagnostic[];
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  diagnostics: Diagnostic[];
}

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

/** Evaluate an XJSON schema source and compile it into an AJV validator. */
export function compileSchema(source: string, options?: EvaluateOptions): SchemaCompileResult {
  const { value, diagnostics } = evaluate(source, options);
  const validate = createAjv().compile(value as object);
  return { schema: value, validate, diagnostics };
}

/** Validate a plain JSON instance against an XJSON schema source. */
export function validateValue(
  source: string,
  instance: JsonValue,
  options?: EvaluateOptions,
): ValidationResult {
  const { validate, diagnostics } = compileSchema(source, options);
  const valid = validate(instance) === true;
  const issues = (validate.errors ?? []).map((error) => ({
    path: error.instancePath === "" ? "/" : error.instancePath,
    message: error.message ?? "invalid",
  }));
  return { valid, issues, diagnostics };
}

/** Validate an XJSON instance source against an XJSON schema source. */
export function validateSource(
  schemaSource: string,
  instanceSource: string,
  schemaOptions?: EvaluateOptions,
  instanceOptions?: EvaluateOptions,
): ValidationResult {
  const instance = evaluate(instanceSource, instanceOptions);
  const result = validateValue(schemaSource, instance.value, schemaOptions);
  return { ...result, diagnostics: [...result.diagnostics, ...instance.diagnostics] };
}
