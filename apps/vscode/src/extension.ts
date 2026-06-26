import { basename, join } from "node:path";
import { evaluate } from "@xjson/core";
import { NodeHost } from "@xjson/core/node";
import {
  EventEmitter,
  type ExtensionContext,
  Uri,
  ViewColumn,
  commands,
  window,
  workspace,
} from "vscode";
import {
  DidChangeConfigurationNotification,
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

const PREVIEW_SCHEME = "xjson-eval";

let client: LanguageClient | undefined;
const host = new NodeHost();
const previewEmitter = new EventEmitter<Uri>();
let previewSource: Uri | undefined;
let previewDoc: Uri | undefined;

export function activate(context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(join("dist", "server.js"));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "xjson" }],
  };
  client = new LanguageClient("xjson", "XJSON Language Server", serverOptions, clientOptions);
  client
    .start()
    .then(() => pushConfiguration())
    .catch((error: unknown) => window.showErrorMessage(`XJSON server failed: ${String(error)}`));

  context.subscriptions.push(
    // The evaluated preview is a read-only virtual JSON document, so it gets
    // native JSON highlighting and updates live as the source changes.
    workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, {
      onDidChange: previewEmitter.event,
      provideTextDocumentContent: (uri) => renderPreview(uri),
    }),
    commands.registerCommand("xjson.preview", (uriArg?: string) => {
      const uri = uriArg ? Uri.parse(uriArg) : window.activeTextEditor?.document.uri;
      if (uri) void openPreview(uri);
    }),
    commands.registerCommand("xjson.openExtends", (target?: string) => {
      if (target) void commands.executeCommand("vscode.open", Uri.parse(target));
    }),
    commands.registerCommand("xjson.restartServer", async () => {
      await client?.restart();
      void window.showInformationMessage("XJSON language server restarted.");
    }),
    workspace.onDidChangeTextDocument((event) => {
      if (previewDoc && previewSource && sameUri(event.document.uri, previewSource)) {
        previewEmitter.fire(previewDoc);
      }
    }),
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("xjson")) pushConfiguration();
    }),
  );
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}

function pushConfiguration(): void {
  const cfg = workspace.getConfiguration("xjson");
  void client?.sendNotification(DidChangeConfigurationNotification.type, {
    settings: {
      xjson: {
        diagnostics: cfg.get("diagnostics", {}),
        inlayHints: { enable: cfg.get("inlayHints.enable", false) },
        codeLens: { enable: cfg.get("codeLens.enable", true) },
        schemas: cfg.get("schemas", []),
      },
    },
  });
}

async function openPreview(source: Uri): Promise<void> {
  previewSource = source;
  previewDoc = Uri.parse(
    `${PREVIEW_SCHEME}:${basename(source.fsPath, ".xjson")}.evaluated.json`,
  ).with({ query: source.toString() });
  const doc = await workspace.openTextDocument(previewDoc);
  previewEmitter.fire(previewDoc);
  await window.showTextDocument(doc, {
    viewColumn: ViewColumn.Beside,
    preview: true,
    preserveFocus: true,
  });
}

function renderPreview(uri: Uri): string {
  const source = Uri.parse(uri.query);
  const doc = workspace.textDocuments.find((d) => sameUri(d.uri, source));
  const text = doc?.getText() ?? "";
  try {
    return JSON.stringify(evaluate(text, { uri: source.fsPath, host }).value, null, 2);
  } catch (error) {
    return JSON.stringify({ error: String(error) }, null, 2);
  }
}

function sameUri(a: Uri, b: Uri | undefined): boolean {
  return b !== undefined && a.toString() === b.toString();
}
