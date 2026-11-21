import type { ToolRuntimeLike } from "./dsh.js";
import { estimateToolTokens } from "./stats.js";

/**
 * A model-facing tool definition. The Host keeps `output` out of the request's
 * `tools` array but renders it into the PTC SDK text, so pricing that text needs
 * the raw definitions rather than the projected schemas.
 */
interface ToolDefinitionLike {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output?: { schema?: unknown };
}

/**
 * The part of a Host tool executor that renders the PTC SDK text, read by shape
 * so this plugin keeps working on a Host that has no PTC executor at all.
 */
interface SdkExecutorLike {
  renderSdk(tools: readonly unknown[]): string;
  describe?(tools: readonly unknown[]): { schemas?: readonly unknown[] } | undefined;
  sections?: readonly { text?: unknown }[];
}

/** What one preset's tools cost the model, priced in the text the model reads. */
export interface TokenModel {
  /** The text this model counts is the rendered PTC SDK, not JSON schemas. */
  transport: "ptc";
  /** Resident tokens for the whole visible roster, transport call included. */
  totalTokens: number;
  /**
   * Tokens one tool adds to a request while the rest of the roster stays
   * resident: its own member block in the rendered SDK text. Measured against
   * the leave-one-out figure it agrees to within two tokens per tool, and the
   * difference between the two sums lands in the caller's constant.
   */
  marginal(name: string): number | undefined;
}

/**
 * Price a preset's tools the way its transport puts them in front of the model.
 *
 * @param runtime - the Host tools service.
 * @param scope - a preset scope key from `acquireScope`.
 * @returns the PTC text model, or `undefined` for a native (JSON tool-calling)
 * preset or a Host that exposes neither definitions nor an SDK renderer.
 */
export function measurePresetTokens(runtime: ToolRuntimeLike, scope: unknown): TokenModel | undefined {
  const definitions = readDefinitions(runtime, scope);
  if (definitions.length === 0) return undefined;
  const executor = readExecutor(runtime, scope);
  if (executor === undefined || typeof executor.renderSdk !== "function") return undefined;
  // The priced model depends on the definitions alone, and the page asks for
  // every preset on every load. Keep it while the definitions still render the
  // same text: the scope key is a fresh object per lease, so it cannot be the
  // cache key, and re-pricing a 128-tool roster costs about 0.8s.
  const signature = sdkSignature(definitions);
  const priced = cacheFor(executor);
  const cached = priced.get(signature);
  if (cached !== undefined) {
    // Refresh the recency of a hit so the limit below drops a stale roster.
    priced.delete(signature);
    priced.set(signature, cached);
    return cached;
  }
  try {
    const model = priceSdkText(executor, definitions);
    priced.set(signature, model);
    if (priced.size > MODEL_CACHE_LIMIT) {
      const oldest = priced.keys().next();
      if (!oldest.done) priced.delete(oldest.value);
    }
    return model;
  } catch {
    // A renderer that fails must not cost the reader its whole catalog: fall back
    // to the JSON projection, which is what the Host would send without PTC.
    return undefined;
  }
}

function readDefinitions(runtime: ToolRuntimeLike, scope: unknown): ToolDefinitionLike[] {
  if (typeof runtime.definitions !== "function") return [];
  try {
    const definitions = runtime.definitions(scope);
    if (!Array.isArray(definitions)) return [];
    return definitions
      .filter((definition): definition is ToolDefinitionLike => {
        const record = definition as ToolDefinitionLike | undefined;
        // Only the name is required: a tool registered without a description
        // still renders (as an undocumented member), so dropping it here would
        // quietly shrink the roster and mix two pricing bases.
        return typeof record?.name === "string";
      })
      .map((definition) => ({
        name: definition.name,
        description: typeof definition.description === "string" ? definition.description : "",
        parameters: definition.parameters ?? {},
        // The SDK renderer reads `output.schema`; a tool registered without one
        // renders as `unknown`, which is exactly what the model would read.
        output: definition.output ?? {},
      }));
  } catch {
    return [];
  }
}

function readExecutor(runtime: ToolRuntimeLike, scope: unknown): SdkExecutorLike | undefined {
  if (typeof runtime.selectExecutor !== "function") return undefined;
  try {
    return runtime.selectExecutor(scope) as SdkExecutorLike | undefined;
  } catch {
    return undefined;
  }
}

function priceSdkText(executor: SdkExecutorLike, definitions: readonly ToolDefinitionLike[]): TokenModel {
  const cache = new Map<string, number>();
  const renderTokens = (subset: readonly ToolDefinitionLike[]): number => {
    const key = subset.map((definition) => definition.name).join("\u0000");
    let tokens = cache.get(key);
    if (tokens === undefined) {
      tokens = Math.ceil(executor.renderSdk(subset).length / 4);
      cache.set(key, tokens);
    }
    return tokens;
  };

  const transportTokens = fixedTokens(executor, definitions);
  const totalTokens = renderTokens(definitions) + transportTokens;
  // One tool's own block, not the whole roster re-rendered without it: the
  // renderer writes a 128-tool roster in 0.8s, so the leave-one-out loop was
  // what made the page slow, and the two agree to within two tokens per tool.
  const scaffold = renderTokens([]);
  const marginal = new Map<string, number>();
  for (const definition of definitions) {
    marginal.set(definition.name, Math.max(0, renderTokens([definition]) - scaffold));
  }

  return {
    transport: "ptc",
    totalTokens,
    marginal: (name) => marginal.get(name),
  };
}

/**
 * Priced models per renderer, keyed by the text its definitions render.
 *
 * The renderer is the Host's registered executor, so it outlives a request and
 * prices the same text for the same definitions; a roster that changes gets a
 * new signature and is priced again. The cap keeps a few revisions' worth of
 * rosters, which is what the page walks through while the user edits presets.
 */
const modelCache = new WeakMap<object, Map<string, TokenModel>>();
const MODEL_CACHE_LIMIT = 4;

function cacheFor(executor: SdkExecutorLike): Map<string, TokenModel> {
  let priced = modelCache.get(executor as object);
  if (priced === undefined) {
    priced = new Map();
    modelCache.set(executor as object, priced);
  }
  return priced;
}

/** Everything the renderer can read, in one string: same signature, same text. */
function sdkSignature(definitions: readonly ToolDefinitionLike[]): string {
  return definitions
    .map((definition) =>
      [definition.name, definition.description, JSON.stringify(definition.parameters), JSON.stringify(definition.output ?? null)].join("\u0001"),
    )
    .join("\u0002");
}

/**
 * Tokens a PTC request pays before any tool is declared: the `run_code`
 * schema in the request's `tools` array plus the executor's own instruction
 * sections. Both come from the Host, so this stays right when it rewords them.
 */
function fixedTokens(executor: SdkExecutorLike, definitions: readonly ToolDefinitionLike[]): number {
  let tokens = 0;
  const transport = executor.describe?.(definitions)?.schemas?.[0];
  if (transport) tokens += estimateToolTokens(transport as { name: string; description: string; parameters: Record<string, unknown> });
  for (const section of executor.sections ?? []) {
    if (typeof section?.text === "string") tokens += Math.ceil(section.text.length / 4);
  }
  return tokens;
}
