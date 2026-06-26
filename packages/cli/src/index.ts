import { type Diagnostic, type XJSONHost, evaluate } from "@xjson/core";
import { validateValue } from "@xjson/schema";

export interface CliEnv {
  /** Host used to resolve and read `extends` targets. */
  host: XJSONHost;
  /** Read a file by absolute path. */
  readFile(absolutePath: string): string;
  /** Turn a (possibly relative) path into an absolute one. */
  resolve(path: string): string;
  /** Write to standard output. */
  out(text: string): void;
  /** Write to standard error. */
  err(text: string): void;
}

const USAGE = `xjson — XJSON command-line tool

Usage:
  xjson eval <file> [--compact]      Evaluate a document and print the JSON result
  xjson validate <file>              Report diagnostics; exit non-zero on errors
  xjson check <file> --schema <s>    Validate an instance against an XJSON schema
  xjson help                         Show this help
`;

export function run(argv: string[], env: CliEnv): number {
  const [command, ...rest] = argv;
  switch (command) {
    case "eval":
      return cmdEval(rest, env);
    case "validate":
      return cmdValidate(rest, env);
    case "check":
      return cmdCheck(rest, env);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      env.out(USAGE);
      return 0;
    default:
      env.err(`Unknown command: ${command}\n`);
      env.out(USAGE);
      return 2;
  }
}

function cmdEval(args: string[], env: CliEnv): number {
  const file = positionals(args)[0];
  if (!file) {
    env.err("eval: missing <file>\n");
    return 2;
  }
  const compact = args.includes("--compact");
  const source = tryRead(file, env);
  if (source === undefined) return 2;
  const absolute = env.resolve(file);
  const { value, diagnostics } = evaluate(source, { uri: absolute, host: env.host });
  env.out(`${JSON.stringify(value, null, compact ? 0 : 2)}\n`);
  printDiagnostics(diagnostics, env);
  return hasErrors(diagnostics) ? 1 : 0;
}

function cmdValidate(args: string[], env: CliEnv): number {
  const file = positionals(args)[0];
  if (!file) {
    env.err("validate: missing <file>\n");
    return 2;
  }
  const source = tryRead(file, env);
  if (source === undefined) return 2;
  const absolute = env.resolve(file);
  const { diagnostics } = evaluate(source, { uri: absolute, host: env.host });
  printDiagnostics(diagnostics, env);
  if (diagnostics.length === 0) env.out("OK: no problems found\n");
  return hasErrors(diagnostics) ? 1 : 0;
}

function cmdCheck(args: string[], env: CliEnv): number {
  const file = positionals(args)[0];
  const schemaPath = flagValue(args, "--schema");
  if (!file || !schemaPath) {
    env.err("check: usage is `xjson check <file> --schema <schema>`\n");
    return 2;
  }
  const instanceSource = tryRead(file, env);
  const schemaSource = tryRead(schemaPath, env);
  if (instanceSource === undefined || schemaSource === undefined) return 2;

  const instance = evaluate(instanceSource, { uri: env.resolve(file), host: env.host });
  const result = validateValue(schemaSource, instance.value, {
    uri: env.resolve(schemaPath),
    host: env.host,
  });

  printDiagnostics([...instance.diagnostics, ...result.diagnostics], env);
  for (const issue of result.issues) {
    env.err(`${issue.path} ${issue.message}\n`);
  }
  env.out(result.valid ? "valid\n" : "invalid\n");

  const failed = !result.valid || hasErrors(instance.diagnostics) || hasErrors(result.diagnostics);
  return failed ? 1 : 0;
}

function tryRead(path: string, env: CliEnv): string | undefined {
  try {
    return env.readFile(env.resolve(path));
  } catch (error) {
    env.err(`Cannot read '${path}': ${error instanceof Error ? error.message : String(error)}\n`);
    return undefined;
  }
}

function positionals(args: string[]): string[] {
  return args.filter((arg) => !arg.startsWith("--"));
}

function flagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function printDiagnostics(diagnostics: Diagnostic[], env: CliEnv): void {
  for (const d of diagnostics) {
    const location = `${d.source ?? "<input>"}:${d.range.start.line}:${d.range.start.column}`;
    env.err(`${location} ${d.severity} [${d.code}] ${d.message}\n`);
  }
}

function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
