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
   * resident: the same roster rendered without it, subtracted from the whole.
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
  // Rendering the roster once per tool is not cheap (a 137-tool roster takes
  // roughly a second), and the panel asks for every preset on each load.
  // Reuse the last model while the definitions still say the same thing.
  const signature = sdkSignature(definitions);
  const byScope = cacheFor(runtime);
  const cached = byScope.get(scope);
  if (cached !== undefined && cached.signature === signature) return cached.model;
  try {
    const model = priceSdkText(executor, definitions);
    byScope.set(scope, { signature, model });
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
  const marginal = new Map<string, number>();
  for (const definition of definitions) {
    const without = definitions.filter((candidate) => candidate !== definition);
    marginal.set(definition.name, Math.max(0, totalTokens - (renderTokens(without) + transportTokens)));
  }

  return {
    transport: "ptc",
    totalTokens,
    marginal: (name) => marginal.get(name),
  };
}

/** One priced model per preset, kept while its definitions render the same text. */
const modelCache = new WeakMap<object, Map<unknown, { signature: string; model: TokenModel }>>();

function cacheFor(runtime: ToolRuntimeLike): Map<unknown, { signature: string; model: TokenModel }> {
  let byScope = modelCache.get(runtime as object);
  if (byScope === undefined) {
    byScope = new Map();
    modelCache.set(runtime as object, byScope);
  }
  return byScope;
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
