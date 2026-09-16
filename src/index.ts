import type {
  AgentDefaultModelLike,
  AgentPresetsLike,
  ContextLike,
  LlmRuntimeLike,
  ToolRuntimeLike,
} from "./dsh.js";
import { asRecord } from "./dsh.js";
import { ToolManagerConfigStore } from "./config.js";
import { normalizeSettings } from "./policy.js";
import { ToolPolicyRuntime } from "./runtime.js";
import { buildSnapshot } from "./snapshot.js";
import { DISCOVERY_TOOL_NAME, PTC_TRANSPORT_NAME } from "./types.js";
import {
  generateAutoGroups,
  generateGroupSuggestion,
  MAX_AUTO_GROUP_TOOLS,
  normalizeGroupNames,
  selectSuggestionTools,
} from "./suggest.js";

export const name = "dsh-tool-manager";
export const inject = ["agentPresets", "agents", "tools"];

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
  if (!presets || !tools) {
    throw new Error("dsh-tool-manager requires agentPresets, agents, and tools");
  }

  const config = new ToolManagerConfigStore();
  const runtime = new ToolPolicyRuntime(context, presets, config.get());
  runtime.start();

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
        void buildSnapshot(presets, tools, config.get(), config.revision, config.path).then(
          (snapshot) => sendJson(res, 200, snapshot),
          (error) => sendJson(res, 500, { ok: false, message: errorMessage(error) }),
        );
      },
    });

    webServer.register({
      kind: "exact",
      path: "/tool-manager/api/suggest-group",
      handler: (req, res) => {
        if (String(req.method ?? "POST").toUpperCase() !== "POST") {
          sendJson(res, 405, { ok: false, message: "method not allowed" });
          return;
        }
        void (async () => {
          const llm = context.get<LlmRuntimeLike>("llm");
          const defaultModel = context.get<AgentDefaultModelLike>("agentDefaultModel");
          if (!llm || !defaultModel) {
            throw new Error("当前 DSH 没有可用的默认模型服务，无法自动生成");
          }
          const body = asRecord(await readJsonBody(req));
          const presetId = typeof body?.presetId === "string" ? body.presetId.trim() : "";
          if (!presetId) throw new Error("presetId is required");
          const inventory = await presets.compositionInventory();
          if (!inventory.some((item) => item.id === presetId)) throw new Error(`unknown preset ${JSON.stringify(presetId)}`);
          const key = await presets.standingKeyFor(presetId);
          const schemas = tools.schemas(key)
            .filter((schema) => schema.name !== DISCOVERY_TOOL_NAME && schema.name !== PTC_TRANSPORT_NAME);
          const selected = selectSuggestionTools(schemas, body?.toolNames);
          const otherGroupNames = normalizeGroupNames(body?.otherGroupNames);
          return generateGroupSuggestion(llm, defaultModel, { tools: selected, otherGroupNames });
        })().then(
          (suggestion) => sendJson(res, 200, suggestion),
          (error) => sendJson(res, 400, { ok: false, message: errorMessage(error) }),
        );
      },
    });

    webServer.register({
      kind: "exact",
      path: "/tool-manager/api/auto-group",
      handler: (req, res) => {
        if (String(req.method ?? "POST").toUpperCase() !== "POST") {
          sendJson(res, 405, { ok: false, message: "method not allowed" });
          return;
        }
        void (async () => {
          const llm = context.get<LlmRuntimeLike>("llm");
          const defaultModel = context.get<AgentDefaultModelLike>("agentDefaultModel");
          if (!llm || !defaultModel) {
            throw new Error("当前 DSH 没有可用的默认模型服务，无法自动分组");
          }
          const body = asRecord(await readJsonBody(req));
          const presetId = typeof body?.presetId === "string" ? body.presetId.trim() : "";
          if (!presetId) throw new Error("presetId is required");
          const inventory = await presets.compositionInventory();
          if (!inventory.some((item) => item.id === presetId)) throw new Error(`unknown preset ${JSON.stringify(presetId)}`);
          const key = await presets.standingKeyFor(presetId);
          const schemas = tools.schemas(key)
            .filter((schema) => schema.name !== DISCOVERY_TOOL_NAME && schema.name !== PTC_TRANSPORT_NAME);
          const selected = selectSuggestionTools(schemas, body?.toolNames, MAX_AUTO_GROUP_TOOLS);
          const otherGroupNames = normalizeGroupNames(body?.otherGroupNames);
          return generateAutoGroups(llm, defaultModel, { tools: selected, otherGroupNames });
        })().then(
          (result) => sendJson(res, 200, result),
          (error) => sendJson(res, 400, { ok: false, message: errorMessage(error) }),
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
          await config.replace(next, expectedRevision);
          runtime.update(config.get());
          return buildSnapshot(presets, tools, config.get(), config.revision, config.path);
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
    if (bytes > 262_144) throw new Error("request body exceeds 256 KiB");
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
