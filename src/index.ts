import type {
  AgentDefaultModelLike,
  AgentLike,
  AgentPresetsLike,
  ContextLike,
  LlmRuntimeLike,
  ToolRuntimeLike,
  ToolSchemaLike,
} from "./dsh.js";
import { asRecord } from "./dsh.js";
import { ToolManagerConfigStore } from "./config.js";
import { groupPolicyIssues, normalizeSettings, policyFor } from "./policy.js";
import { ToolPolicyRuntime } from "./runtime.js";
import { buildSnapshot, mergeSchemas } from "./snapshot.js";
import { DISCOVERY_TOOL_NAME, PTC_TRANSPORT_NAME } from "./types.js";
import {
  generateAutoGroups,
  generateGroupSuggestion,
  normalizeCustomPrompt,
  normalizeGroupNames,
  validateGenerationTimeout,
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

interface AgentHandleLike {
  agent: AgentLike;
  dispose(): Promise<void>;
}

interface AgentCreateOptionsLike {
  sessionId: string;
  meta?: { agentPreset?: string; origin?: "subagent" };
  setup?: (agentCtx: ContextLike, agent: AgentLike) => Promise<void> | void;
}

interface AgentResumeOptionsLike {
  resumeSessionId: string;
  setup?: (agentCtx: ContextLike, agent: AgentLike) => Promise<void> | void;
}

interface AgentRegistryLike {
  list(): AgentLike[];
  create(options: AgentCreateOptionsLike): Promise<AgentHandleLike>;
  resume(options: AgentResumeOptionsLike): Promise<AgentHandleLike>;
}

interface SessionPersistenceLike {
  stat(sessionId: string): Promise<unknown | undefined>;
}

/** One durable internal Session, shared by every cold-Preset schema probe. */
export const TOOL_MANAGER_PROBE_SESSION_ID = "tool-manager-probe-internal-v1";

/**
 * A single live probe prevents one persistent Session per request or Preset.
 * Preset switches are serialized because `recompose()` mutates this Agent's
 * scope parent before its scoped tool catalog is read.
 */
export class PresetSchemaProbe {
  private handle?: AgentHandleLike;
  private initialization?: Promise<AgentHandleLike | undefined>;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly context: ContextLike,
    private readonly presets: AgentPresetsLike,
  ) {}

  inspect(presetId: string): Promise<ToolSchemaLike[]> {
    const operation = this.queue.then(
      () => this.inspectSerial(presetId),
      () => this.inspectSerial(presetId),
    );
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async inspectSerial(presetId: string): Promise<ToolSchemaLike[]> {
    if (this.disposed) return [];
    const handle = await this.ensure(presetId);
    if (!handle) return [];
    if (this.presets.composedPreset(handle.agent.ctx) !== presetId) {
      await this.presets.recompose(handle.agent.ctx, presetId);
    }
    return handle.agent.ctx.get<ToolRuntimeLike>("tools")?.schemas(handle.agent) ?? [];
  }

  private async ensure(initialPresetId: string): Promise<AgentHandleLike | undefined> {
    if (this.handle) return this.handle;
    if (!this.initialization) {
      this.initialization = this.initialize(initialPresetId).then(async (handle) => {
        if (!handle) return undefined;
        if (this.disposed) {
          await handle.dispose().catch(() => undefined);
          return undefined;
        }
        this.handle = handle;
        return handle;
      }).finally(() => {
        this.initialization = undefined;
      });
    }
    return this.initialization;
  }

  private async initialize(initialPresetId: string): Promise<AgentHandleLike | undefined> {
    const agents = this.context.get<AgentRegistryLike>("agents");
    const persistence = this.context.get<SessionPersistenceLike>("sessionPersistence");
    if (!agents || !persistence) return undefined;

    const setup = async (agentCtx: ContextLike) => {
      await this.presets.mount(agentCtx, initialPresetId);
    };
    const existing = await persistence.stat(TOOL_MANAGER_PROBE_SESSION_ID);
    if (existing) {
      // A broken fixed probe is intentionally not replaced with a random id:
      // falling back to standing schemas is safer than growing Session storage.
      return agents.resume({
        resumeSessionId: TOOL_MANAGER_PROBE_SESSION_ID,
        setup,
      });
    }
    return agents.create({
      sessionId: TOOL_MANAGER_PROBE_SESSION_ID,
      meta: { agentPreset: initialPresetId, origin: "subagent" },
      setup,
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.queue.catch(() => undefined);
    const pending = this.initialization;
    const initialized = pending ? await pending.catch(() => undefined) : undefined;
    const handle = this.handle ?? initialized;
    this.handle = undefined;
    if (handle) await handle.dispose().catch(() => undefined);
  }
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
  const observedSchemas = (presetId: string) => runtime.observedSchemasFor(presetId);
  const probe = new PresetSchemaProbe(context, presets);
  const pendingCatalogs = new Map<string, Promise<ToolSchemaLike[]>>();
  const catalogSchemas = async (presetId: string): Promise<ToolSchemaLike[]> => {
    const live = livePresetSchemas(context, presets, presetId);
    if (live) {
      runtime.observeSchemas(presetId, live);
      return live;
    }
    let pending = pendingCatalogs.get(presetId);
    if (!pending) {
      pending = probe.inspect(presetId).then((schemas) => {
        runtime.observeSchemas(presetId, schemas);
        return schemas;
      }).finally(() => pendingCatalogs.delete(presetId));
      pendingCatalogs.set(presetId, pending);
    }
    return pending;
  };
  const ensureAllPresetSchemas = async (): Promise<void> => {
    const inventory = await presets.compositionInventory();
    await Promise.all(inventory.filter((item) => !item.broken).map((item) => catalogSchemas(item.id)));
  };

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
        void ensureAllPresetSchemas().then(
          () => buildSnapshot(presets, tools, config.get(), config.revision, config.path, observedSchemas),
        ).then(
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
          const schemas = mergeSchemas(tools.schemas(key), await catalogSchemas(presetId))
            .filter((schema) => schema.name !== DISCOVERY_TOOL_NAME && schema.name !== PTC_TRANSPORT_NAME);
          const selected = selectSuggestionTools(schemas, body?.toolNames);
          const otherGroupNames = normalizeGroupNames(body?.otherGroupNames);
          const timeoutMs = body?.timeoutMs === undefined
            ? undefined
            : validateGenerationTimeout(body.timeoutMs);
          const prompt = normalizeCustomPrompt(body?.prompt);
          if (body?.prompt !== undefined && prompt === undefined) throw new Error("提示词不能为空");
          return generateGroupSuggestion(llm, defaultModel, { tools: selected, otherGroupNames, prompt }, timeoutMs);
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
          const schemas = mergeSchemas(tools.schemas(key), await catalogSchemas(presetId))
            .filter((schema) => schema.name !== DISCOVERY_TOOL_NAME && schema.name !== PTC_TRANSPORT_NAME);
          const selected = selectSuggestionTools(schemas, body?.toolNames);
          const otherGroupNames = normalizeGroupNames(body?.otherGroupNames);
          const timeoutMs = body?.timeoutMs === undefined
            ? undefined
            : validateGenerationTimeout(body.timeoutMs);
          const prompt = normalizeCustomPrompt(body?.prompt);
          if (body?.prompt !== undefined && prompt === undefined) throw new Error("提示词不能为空");
          return generateAutoGroups(llm, defaultModel, { tools: selected, otherGroupNames, prompt }, timeoutMs);
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
          await assertNoEmptyGroups(presets, tools, next);
          await config.replace(next, expectedRevision);
          runtime.update(config.get());
          return buildSnapshot(presets, tools, config.get(), config.revision, config.path, observedSchemas);
        })().then(
          (snapshot) => sendJson(res, 200, snapshot),
          (error) => sendJson(res, 400, { ok: false, message: errorMessage(error) }),
        );
      },
    });
  });

  context.effect?.(() => async () => {
    await probe.dispose();
    await runtime.dispose();
  }, "dsh-tool-manager runtime");
}

function livePresetSchemas(
  context: ContextLike,
  presets: AgentPresetsLike,
  presetId: string,
): ToolSchemaLike[] | undefined {
  const agents = context.get<AgentRegistryLike>("agents");
  const existing = agents?.list().find((agent) => presets.composedPreset(agent.ctx) === presetId);
  if (!existing) return undefined;
  return existing.ctx.get<ToolRuntimeLike>("tools")?.schemas(existing) ?? [];
}

export async function assertNoEmptyGroups(
  presets: AgentPresetsLike,
  tools: ToolRuntimeLike,
  settings: ReturnType<typeof normalizeSettings>,
): Promise<void> {
  const inventory = await presets.compositionInventory();
  const inspectable = new Map(inventory.map((item) => [item.id, item]));
  for (const [presetId, policy] of Object.entries(settings.presets)) {
    if (policy.groups.length === 0) continue;
    const composition = inspectable.get(presetId);
    if (!composition || composition.broken) continue;
    let names: string[];
    try {
      const key = await presets.standingKeyFor(presetId);
      names = tools.schemas(key).map((schema) => schema.name);
    } catch {
      continue;
    }
    const issues = groupPolicyIssues(policyFor(settings, presetId), names);
    if (issues.disabledMembers.length > 0) {
      const issue = issues.disabledMembers[0]!;
      throw new Error(
        `Preset ${JSON.stringify(presetId)} has disabled tool ${JSON.stringify(issue.tool)} in group ${JSON.stringify(issue.groups[0])}. Disabled tools cannot belong to on-demand groups.`,
      );
    }
    if (issues.duplicateMembers.length > 0) {
      const issue = issues.duplicateMembers[0]!;
      throw new Error(
        `Preset ${JSON.stringify(presetId)} assigns tool ${JSON.stringify(issue.tool)} to multiple groups: ${issue.groups.map((name) => JSON.stringify(name)).join(", ")}. Each tool may belong to only one group.`,
      );
    }
    if (issues.emptyGroups.length > 0) {
      throw new Error(
        `Preset ${JSON.stringify(presetId)} has empty tool groups: ${issues.emptyGroups.map((name) => JSON.stringify(name)).join(", ")}. Each group must contain at least one available tool.`,
      );
    }
  }
}

async function readJsonBody(req: HttpRequest): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array);
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
