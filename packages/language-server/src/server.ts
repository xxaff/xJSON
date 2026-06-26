import { readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { type SeverityConfig, type XJSONHost, evaluate } from "@x-json/core";
import { NodeHost } from "@x-json/core/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { SymbolInformation } from "vscode-languageserver-types";
import {
  type InitializeParams,
  type InitializeResult,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
  createConnection,
} from "vscode-languageserver/node";
import { URI } from "vscode-uri";
import {
  type AnalyzeOptions,
  SEMANTIC_TOKEN_TYPES,
  type SemanticTokenAbsolute,
  analyzeDiagnostics,
  codeActions,
  codeLenses,
  completionsAt,
  definitionAt,
  documentHighlights,
  documentLinks,
  documentSymbols,
  foldingRanges,
  format,
  hoverAt,
  inlayHints,
  matchesGlob,
  references,
  renameEdits,
  schemaDiagnostics,
  schemaLinks,
  selectionRanges,
  semanticTokens,
} from "./index";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const nodeHost = new NodeHost();

/** A host that speaks file URIs (the currency the editor uses). */
const host: XJSONHost = {
  readFile: (uri) => nodeHost.readFile(URI.parse(uri).fsPath),
  resolve: (specifier, fromUri) =>
    URI.file(nodeHost.resolve(specifier, URI.parse(fromUri).fsPath)).toString(),
};

interface SchemaAssociation {
  fileMatch: string[];
  url: string;
}

interface Settings {
  severity: SeverityConfig;
  inlayHints: boolean;
  codeLens: boolean;
  schemas: SchemaAssociation[];
}
let settings: Settings = { severity: {}, inlayHints: false, codeLens: true, schemas: [] };
let workspaceRoots: string[] = [];

function optionsFor(uri: string): AnalyzeOptions {
  return { uri, host, severity: settings.severity, schemaUri: associatedSchema(uri) };
}

/** Find a configured schema (xjson.schemas) whose fileMatch matches the document. */
function associatedSchema(uri: string): string | undefined {
  const fsPath = URI.parse(uri).fsPath;
  for (const association of settings.schemas) {
    if (
      Array.isArray(association.fileMatch) &&
      association.fileMatch.some((glob) => matchesGlob(glob, fsPath))
    ) {
      return resolveSchemaUrl(association.url);
    }
  }
  return undefined;
}

function resolveSchemaUrl(url: string): string | undefined {
  if (url.startsWith("file://")) return url;
  const root = workspaceRoots[0];
  const absolute = isAbsolute(url) ? url : root ? resolvePath(root, url) : undefined;
  return absolute ? URI.file(absolute).toString() : undefined;
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceRoots = (params.workspaceFolders ?? []).map((folder) => URI.parse(folder.uri).fsPath);
  if (workspaceRoots.length === 0 && params.rootUri) {
    workspaceRoots = [URI.parse(params.rootUri).fsPath];
  }
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      hoverProvider: true,
      definitionProvider: true,
      completionProvider: { resolveProvider: false },
      documentSymbolProvider: true,
      foldingRangeProvider: true,
      documentHighlightProvider: true,
      referencesProvider: true,
      renameProvider: true,
      documentLinkProvider: { resolveProvider: false },
      codeActionProvider: true,
      codeLensProvider: { resolveProvider: false },
      inlayHintProvider: true,
      selectionRangeProvider: true,
      documentFormattingProvider: true,
      workspaceSymbolProvider: true,
      semanticTokensProvider: {
        legend: { tokenTypes: [...SEMANTIC_TOKEN_TYPES], tokenModifiers: [] },
        full: true,
      },
      executeCommandProvider: { commands: ["xjson.evaluate"] },
    },
  };
});

// --- Diagnostics ------------------------------------------------------------

function validate(doc: TextDocument): void {
  const options = optionsFor(doc.uri);
  const diagnostics = [
    ...analyzeDiagnostics(doc.getText(), options),
    ...schemaDiagnostics(doc.getText(), options),
  ];
  void connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}

documents.onDidChangeContent((event) => validate(event.document));
documents.onDidClose((event) =>
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] }),
);

connection.onDidChangeConfiguration((change) => {
  const cfg = ((change.settings as { xjson?: unknown } | undefined)?.xjson ?? {}) as {
    diagnostics?: SeverityConfig;
    inlayHints?: { enable?: boolean };
    codeLens?: { enable?: boolean };
    schemas?: SchemaAssociation[];
  };
  settings = {
    severity: cfg.diagnostics ?? {},
    inlayHints: cfg.inlayHints?.enable ?? false,
    codeLens: cfg.codeLens?.enable ?? true,
    schemas: Array.isArray(cfg.schemas) ? cfg.schemas : [],
  };
  for (const doc of documents.all()) validate(doc);
});

// --- Language features ------------------------------------------------------

connection.onHover((params) => {
  const doc = documents.get(params.textDocument.uri);
  return doc ? hoverAt(doc.getText(), params.position, optionsFor(doc.uri)) : null;
});

connection.onDefinition((params) => {
  const doc = documents.get(params.textDocument.uri);
  return doc ? definitionAt(doc.getText(), params.position, optionsFor(doc.uri)) : null;
});

connection.onCompletion((params) => {
  const doc = documents.get(params.textDocument.uri);
  return doc ? completionsAt(doc.getText(), params.position, optionsFor(doc.uri)) : [];
});

connection.onDocumentSymbol((params) => {
  const doc = documents.get(params.textDocument.uri);
  return doc ? documentSymbols(doc.getText(), optionsFor(doc.uri)) : [];
});

connection.onFoldingRanges((params) => {
  const doc = documents.get(params.textDocument.uri);
  return doc ? foldingRanges(doc.getText(), optionsFor(doc.uri)) : [];
});

connection.onDocumentHighlight((params) => {
  const doc = documents.get(params.textDocument.uri);
  return doc ? documentHighlights(doc.getText(), params.position, optionsFor(doc.uri)) : [];
});

connection.onReferences((params) => {
  const doc = documents.get(params.textDocument.uri);
  return doc ? references(doc.getText(), params.position, optionsFor(doc.uri)) : [];
});

connection.onRenameRequest((params) => {
  const doc = documents.get(params.textDocument.uri);
  return doc
    ? renameEdits(doc.getText(), params.position, params.newName, optionsFor(doc.uri))
    : null;
});

connection.onDocumentLinks((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const options = optionsFor(doc.uri);
  return [...documentLinks(doc.getText(), options), ...schemaLinks(doc.getText(), options)];
});

connection.onCodeAction((params) => {
  const doc = documents.get(params.textDocument.uri);
  return doc ? codeActions(doc.getText(), params.context.diagnostics, optionsFor(doc.uri)) : [];
});

connection.onCodeLens((params) => {
  const doc = documents.get(params.textDocument.uri);
  return doc && settings.codeLens ? codeLenses(doc.getText(), optionsFor(doc.uri)) : [];
});

connection.onSelectionRanges((params) => {
  const doc = documents.get(params.textDocument.uri);
  return doc ? selectionRanges(doc.getText(), params.positions, optionsFor(doc.uri)) : [];
});

connection.onDocumentFormatting((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const text = doc.getText();
  return [
    {
      range: { start: { line: 0, character: 0 }, end: doc.positionAt(text.length) },
      newText: format(text),
    },
  ];
});

connection.languages.inlayHint.on((params) => {
  const doc = documents.get(params.textDocument.uri);
  return doc && settings.inlayHints ? inlayHints(doc.getText(), optionsFor(doc.uri)) : [];
});

connection.languages.semanticTokens.on((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return { data: [] };
  return { data: encodeSemanticTokens(semanticTokens(doc.getText(), optionsFor(doc.uri))) };
});

connection.onWorkspaceSymbol((params) => workspaceSymbols(params.query));

connection.onExecuteCommand((params) => {
  if (params.command === "xjson.evaluate") {
    const uri = params.arguments?.[0] as string | undefined;
    const doc = uri ? documents.get(uri) : undefined;
    if (!doc) return null;
    return JSON.stringify(evaluate(doc.getText(), { uri: doc.uri, host }).value, null, 2);
  }
  return null;
});

// --- Workspace symbols ------------------------------------------------------

function workspaceSymbols(query: string): SymbolInformation[] {
  const lowered = query.toLowerCase();
  const result: SymbolInformation[] = [];
  for (const root of workspaceRoots) {
    for (const file of findXjsonFiles(root, 0)) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const uri = URI.file(file).toString();
      for (const symbol of documentSymbols(text, { uri, host })) {
        if (!lowered || symbol.name.toLowerCase().includes(lowered)) {
          result.push({
            name: symbol.name,
            kind: symbol.kind,
            location: { uri, range: symbol.selectionRange },
          });
        }
      }
      if (result.length > 200) return result;
    }
  }
  return result;
}

function findXjsonFiles(dir: string, depth: number): string[] {
  if (depth > 6) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const name of names) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = `${dir}/${name}`;
    try {
      if (statSync(full).isDirectory()) files.push(...findXjsonFiles(full, depth + 1));
      else if (name.endsWith(".xjson")) files.push(full);
    } catch {
      // ignore unreadable entries
    }
  }
  return files;
}

function encodeSemanticTokens(tokens: SemanticTokenAbsolute[]): number[] {
  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;
  for (const token of tokens) {
    const deltaLine = token.line - prevLine;
    const deltaChar = deltaLine === 0 ? token.char - prevChar : token.char;
    data.push(deltaLine, deltaChar, token.length, token.tokenType, 0);
    prevLine = token.line;
    prevChar = token.char;
  }
  return data;
}

documents.listen(connection);
connection.listen();
