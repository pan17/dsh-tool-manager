import type {
  AgentPresetsLike,
  ContextLike,
  SettingsProviderLike,
  ToolRuntimeLike,
} from "./dsh.js";
import { asRecord } from "./dsh.js";
import { normalizeSettings } from "./policy.js";
import { ToolPolicyRuntime } from "./runtime.js";
import { toolManagerSettingsSchema } from "./schema.js";
import { buildSnapshot } from "./snapshot.js";
import { SETTINGS_NAMESPACE, type ToolManagerSettings } from "./types.js";

export const name = "dsh-tool-manager";
export const inject = ["agentPresets", "agents", "tools", "settings"];

interface HttpRequest extends NodeJS.ReadableStream {
  method?: string;
}

interface HttpResponse {
  statusCode?: number;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

interface WebServer {
  register(route: {
    kind: "exact" | "prefix";
    path: string;
    handler(req: HttpRequest, res: HttpResponse): void;
  }): unknown;
}

export function apply(ctx: unknown): void {
  const context = ctx as ContextLike;
  const presets = context.get<AgentPresetsLike>("agentPresets");
  const tools = context.get<ToolRuntimeLike>("tools");
  const settingsProvider = context.get<SettingsProviderLike>("settings");
  if (!presets || !tools || !settingsProvider) {
    throw new Error("dsh-tool-manager requires agentPresets, agents, tools, and settings");
  }

  const settingsScope = settingsProvider.register(
    SETTINGS_NAMESPACE,
    toolManagerSettingsSchema(),
    { base: { presets: {} }, applies: "live" },
  );
  const current = (): ToolManagerSettings => normalizeSettings(settingsScope.get());
  const runtime = new ToolPolicyRuntime(context, presets, current());
  runtime.start();
  settingsScope.watch(() => runtime.update(current()));

  context.inject?.(["webServer"], (webCtx) => {
    const webServer = webCtx.get<WebServer>("webServer");
    if (!webServer) return;

    webServer.register({
      kind: "exact",
      path: "/tool-manager/api/snapshot",
      handler: (req, res) => {
        if (String(req.method ?? "GET").toUpperCase() !== "GET") {
          sendJson(res, 405, { ok: false, message: "method not allowed" });
          return;
        }
        void buildSnapshot(presets, tools, settingsProvider, current()).then(
          (snapshot) => sendJson(res, 200, snapshot),
          (error) => sendJson(res, 500, { ok: false, message: errorMessage(error) }),
        );
      },
    });

    webServer.register({
      kind: "exact",
      path: "/tool-manager/api/save",
      handler: (req, res) => {
        if (String(req.method ?? "POST").toUpperCase() !== "POST") {
          sendJson(res, 405, { ok: false, message: "method not allowed" });
          return;
        }
        void (async () => {
          const body = asRecord(await readJsonBody(req));
          const expectedRevision = body && typeof body.expectedRevision === "number"
            ? body.expectedRevision
            : undefined;
          const next = normalizeSettings(body?.settings);
          await settingsProvider.replace(SETTINGS_NAMESPACE, next, expectedRevision);
          return buildSnapshot(presets, tools, settingsProvider, current());
        })().then(
          (snapshot) => sendJson(res, 200, snapshot),
          (error) => sendJson(res, 400, { ok: false, message: errorMessage(error) }),
        );
      },
    });
  });

  context.effect?.(() => () => runtime.dispose(), "dsh-tool-manager runtime");
}

async function readJsonBody(req: HttpRequest): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array);
    bytes += buffer.byteLength;
    if (bytes > 1_048_576) throw new Error("request body exceeds 1 MiB");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}

function sendJson(res: HttpResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type * from "./types.js";
