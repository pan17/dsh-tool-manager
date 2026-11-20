/**
 * Which tools a `tool:*` prompt section introduces, learned from registration.
 *
 * DSH's prompt sections carry no "this section describes these tools"
 * metadata (`PromptSection` is name/order/text/interpolate/complete), and
 * `ToolDefinition` has no owner or source field. The structural signal is
 * registration identity: a Cordis service method runs with `this.ctx` bound to
 * the *calling* context, so `systemPrompt.section()` and `tools.register()` can
 * both name the plugin fiber that made the call.
 *
 * Most registrations happen after this plugin starts on a profile, and are
 * recorded directly by the method wrappers below. The built-in
 * `preset-standard` definition, however, lives in the web-app bundle and may
 * be mounted before the profile bundle that contains this plugin, or may be
 * composed by DSH after the profile plugin starts. Sections that already exist
 * when the observer is installed are recovered immediately; when the Preset's
 * scoped layers appear later, the first prompt assembly re-runs the recovery.
 * For both paths this module reads the live Cordis fiber registry: each fiber
 * retains the plugin callback whose source declares its section names and tool
 * definitions, and the fiber's effect sequence records the exact order in
 * which it called `systemPrompt.section()` and `tools.register()`. Matching
 * those two ordered lists recovers exact ownership without inspecting prompt
 * text or guessing a package-to-tool table.
 *
 * The store lives on `globalThis` because DSH reloads a plugin node by
 * re-applying it on the same Fiber: a fresh module instance must keep the
 * registrations learned before the reload. Prototype wrappers are installed
 * once per prototype and only observe; they delegate every call unchanged.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/** One plugin fiber, as much as this module needs to know about it. */
interface FiberLike {
  readonly entry?: EntryLike;
  readonly runtime?: { readonly callback?: unknown };
  getEffects?(): readonly EffectLike[];
}

interface EntryLike {
  readonly options?: { readonly name?: unknown };
  readonly parent?: {
    readonly tree?: { readonly ctx?: { readonly baseUrl?: unknown } };
  };
}

interface EffectLike {
  readonly label?: unknown;
}

/** One declaration found in a plugin's callback or module source. */
interface RegistrationEvent {
  readonly kind: "section" | "tool";
  readonly name: string;
  readonly index: number;
}

/** The section registration surface this module observes. */
interface SectionServiceLike {
  section(section: { name: string; [key: string]: unknown }): unknown;
  readonly layers?: {
    readonly global?: { readonly sections?: NamedEntriesLike };
    readonly scoped?: Map<object, { readonly sections?: NamedEntriesLike }>;
  };
}

/** The tool registration surface this module observes. */
interface ToolServiceLike {
  register(definition: { name: string; [key: string]: unknown }, ...rest: unknown[]): unknown;
  readonly layers?: {
    readonly global?: { readonly tools?: NamedEntriesLike };
    readonly scoped?: Map<object, { readonly tools?: NamedEntriesLike }>;
  };
}

interface NamedEntriesLike {
  keys(): Iterable<string>;
}

/** Process-wide registration observations. */
interface PromptAffinityStore {
  /** Tool names each plugin fiber registered. */
  readonly toolsByFiber: WeakMap<FiberLike, Set<string>>;
  /** Fibers that registered each prompt-section name; WeakRefs keep unloaded plugins collectable. */
  readonly sectionFibers: Map<string, WeakRef<FiberLike>[]>;
  /** Exact section -> tool names recovered from pre-mounted plugin callbacks. */
  learnedSectionTools: Map<string, Set<string>>;
  /** Prototypes already wrapped, so a reload never stacks wrappers. */
  readonly patched: WeakSet<object>;
  /** Entry module source, keyed by baseUrl + package specifier. */
  moduleSources: Map<string, string | undefined>;
  /** The live services, kept for lazy recovery after a Preset mounts later. */
  live?: { systemPrompt: unknown; tools: unknown; registry: unknown };
  /** Layer identities represented by the last successful recovery. */
  learnedSectionSignature?: string;
  learnedToolSignature?: string;
}

const STORE_KEY = Symbol.for("dsh-tool-manager.prompt-affinity");

function store(): PromptAffinityStore {
  const holder = globalThis as unknown as Record<symbol, PromptAffinityStore | undefined>;
  let current = holder[STORE_KEY];
  if (current === undefined) {
    current = {
      toolsByFiber: new WeakMap(),
      sectionFibers: new Map(),
      learnedSectionTools: new Map(),
      patched: new WeakSet(),
      moduleSources: new Map(),
    };
    holder[STORE_KEY] = current;
  }
  // A plugin reload can find a store created by an older module version.
  current.learnedSectionTools ??= new Map();
  current.moduleSources ??= new Map();
  return current;
}

/** The tool family a prompt section introduces, when its author is known. */
export interface PromptToolFamily {
  /** Whether a registering fiber was observed for this section name. */
  readonly owned: boolean;
  /** Every tool name those fibers registered, across the process. */
  readonly tools: readonly string[];
}

/**
 * Registration-identity view of prompt sections and tool families.
 *
 * One instance is enough per process; {@link PromptToolAffinity.shared}
 * returns it. Instances are stateless themselves — every observation is kept
 * in the process-wide store so a plugin reload cannot lose it.
 */
export class PromptToolAffinity {
  /** The process-wide instance shared by every plugin reload. */
  static shared(): PromptToolAffinity {
    return SHARED;
  }

  /**
   * Start observing section and tool registrations, then recover sections
   * that were already mounted before this plugin loaded.
   *
   * @param systemPrompt - the live `systemPrompt` service, or `undefined`.
   * @param tools - the live global `tools` service, or `undefined`.
   * @param registry - the live Cordis registry, or `undefined`.
   */
  install(systemPrompt: unknown, tools: unknown, registry?: unknown): void {
    const state = store();
    state.live = { systemPrompt, tools, registry };
    state.learnedSectionSignature = undefined;
    state.learnedToolSignature = undefined;
    const sectionProto = prototypeOf(systemPrompt);
    if (sectionProto !== undefined) wrapSection(sectionProto);
    const toolProto = prototypeOf(tools);
    if (toolProto !== undefined) wrapRegister(toolProto);
    if (registry !== undefined) this.learnExisting(registry, systemPrompt, tools);
  }

  /**
   * Recover ownership for sections that were registered before `install()`.
   *
   * This is intentionally structural: it uses the live fiber's callback source
   * and effect order, not the prompt section's prose. A section is learned only
   * when both its declaration and its tool definitions are found in the same
   * plugin callback (or in the same entry's module when a helper is involved).
   */
  learnExisting(registry: unknown, systemPrompt: unknown, tools: unknown): void {
    const sectionNames = collectSectionNames(systemPrompt);
    const toolNames = collectToolNames(tools);
    const state = store();
    state.learnedSectionSignature = signatureOf(sectionNames);
    state.learnedToolSignature = signatureOf(toolNames);
    if (sectionNames.length === 0 || toolNames.length === 0) return;

    const groups = groupFibers(registry);
    for (const fibers of groups) {
      const declaredSections = new Set<string>();
      const declaredTools = new Set<string>();
      let paired = false;

      for (const fiber of fibers) {
        const source = callbackSource(fiber);
        if (source.length === 0) continue;
        const events = registrationEvents(source, sectionNames, toolNames);
        for (const event of events) {
          if (event.kind === "section") declaredSections.add(event.name);
          else declaredTools.add(event.name);
        }
        const kinds = effectKinds(fiber);
        const pairs = pairEvents(events, kinds);
        if (pairs === undefined) continue;
        paired = true;
        for (const [section, members] of pairs) rememberLearned(section, members);
      }

      // `tool-terminal-panel` registers its section in apply() but its tools in
      // a module-level helper called directly from apply(), so the callback
      // source has no tool declarations. Read the entry's module source in that
      // case; only a single-section module is safe to attribute wholesale.
      const entry = fibers.map((fiber) => fiber.entry).find((value) => value !== undefined);
      const moduleSource = entry === undefined ? undefined : moduleSourceOf(entry);
      if (moduleSource !== undefined) {
        for (const event of registrationEvents(moduleSource, sectionNames, toolNames)) {
          if (event.kind === "section") declaredSections.add(event.name);
          else declaredTools.add(event.name);
        }
        for (const [section, members] of modulePairs(moduleSource, sectionNames, toolNames)) {
          rememberLearned(section, members);
          paired = true;
        }
      }
      if (!paired && declaredSections.size === 1 && declaredTools.size > 0) {
        rememberLearned([...declaredSections][0]!, [...declaredTools]);
      }
    }
  }

  /**
   * Recover sections that were mounted after the initial {@link install}, as
   * happens when DSH composes the default Preset after this profile plugin
   * starts. A lookup runs during prompt assembly, at which point the Preset's
   * scoped layers exist; only rerun the scan when the layer names changed.
   */
  private ensureLearnedForCurrentLayers(): void {
    const state = store();
    const live = state.live;
    if (live === undefined) return;
    const sections = collectSectionNames(live.systemPrompt);
    const tools = collectToolNames(live.tools);
    if (signatureOf(sections) === state.learnedSectionSignature && signatureOf(tools) === state.learnedToolSignature) return;
    this.learnExisting(live.registry, live.systemPrompt, live.tools);
  }

  /**
   * The tools registered by the fibers that registered `sectionName`, plus any
   * exact tool family recovered from that section's pre-mounted plugin.
   *
   * @param sectionName - full prompt-section name, e.g. `tool:jobs`.
   * @returns `owned: false` when no registering fiber or tool declaration was
   *   observed, which the caller must treat as "not a tool family" rather than
   *   "empty family".
   */
  lookup(sectionName: string): PromptToolFamily {
    this.ensureLearnedForCurrentLayers();
    const names = new Set(store().learnedSectionTools.get(sectionName) ?? []);
    const refs = store().sectionFibers.get(sectionName);
    let sawLive = false;
    if (refs !== undefined) {
      const live: WeakRef<FiberLike>[] = [];
      for (const ref of refs) {
        const fiber = ref.deref();
        if (fiber === undefined) continue;
        sawLive = true;
        live.push(ref);
        for (const name of store().toolsByFiber.get(fiber) ?? []) names.add(name);
      }
      if (!sawLive) store().sectionFibers.delete(sectionName);
      else if (live.length !== refs.length) store().sectionFibers.set(sectionName, live);
    }
    if (names.size === 0 && !sawLive) return { owned: false, tools: [] };
    return { owned: true, tools: [...names] };
  }
}

const SHARED = new PromptToolAffinity();

/** The object that owns a service instance's methods. */
function prototypeOf(value: unknown): object | undefined {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return undefined;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto !== null && typeof proto === "object" ? proto : undefined;
}

/** The plugin fiber a service call is made from, if the context still carries one. */
function fiberOf(serviceInstance: unknown): FiberLike | undefined {
  if (serviceInstance === null || typeof serviceInstance !== "object") return undefined;
  const ctx = (serviceInstance as { ctx?: unknown }).ctx;
  if (ctx === null || typeof ctx !== "object") return undefined;
  const fiber = (ctx as { fiber?: unknown }).fiber;
  return fiber !== null && typeof fiber === "object" ? fiber as FiberLike : undefined;
}

/** The section name of a `section()` argument. */
function sectionNameOf(section: unknown): string | undefined {
  if (section === null || typeof section !== "object") return undefined;
  const name = (section as { name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

/** The tool name of a `register()` argument. */
function toolNameOf(definition: unknown): string | undefined {
  if (definition === null || typeof definition !== "object") return undefined;
  const name = (definition as { name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

/** Replace `proto.section` with an observing wrapper, once. */
function wrapSection(proto: object): void {
  const state = store();
  if (state.patched.has(proto)) return;
  const target = proto as Partial<SectionServiceLike>;
  const original = target.section;
  if (typeof original !== "function") return;
  state.patched.add(proto);
  target.section = function observedSection(this: unknown, section: unknown): unknown {
    const fiber = fiberOf(this);
    const name = sectionNameOf(section);
    const disposer = Reflect.apply(original, this, [section]);
    if (fiber === undefined || name === undefined) return disposer;
    rememberSection(name, fiber);
    return observeDisposal(disposer, () => forgetSection(name, fiber));
  };
}

/** Replace `proto.register` with an observing wrapper, once. */
function wrapRegister(proto: object): void {
  const state = store();
  if (state.patched.has(proto)) return;
  const target = proto as Partial<ToolServiceLike>;
  const original = target.register;
  if (typeof original !== "function") return;
  state.patched.add(proto);
  target.register = function observedRegister(this: unknown, definition: unknown, ...rest: unknown[]): unknown {
    const fiber = fiberOf(this);
    const name = toolNameOf(definition);
    const disposer = Reflect.apply(original, this, [definition, ...rest]);
    if (fiber === undefined || name === undefined) return disposer;
    rememberTool(name, fiber);
    return observeDisposal(disposer, () => forgetTool(name, fiber));
  };
}

/** Recover all live fibers from Cordis's registry service. */
function groupFibers(registry: unknown): FiberLike[][] {
  const groups = new Map<object, FiberLike[]>();
  const values = (registry as { values?: () => Iterable<unknown> } | undefined)?.values;
  if (typeof values !== "function") return [];
  for (const runtime of values.call(registry)) {
    const fibers = (runtime as { fibers?: Iterable<FiberLike> } | undefined)?.fibers;
    if (fibers === undefined) continue;
    for (const fiber of fibers) {
      if (fiber === null || typeof fiber !== "object") continue;
      const key = fiber.entry ?? fiber;
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [fiber]);
      else group.push(fiber);
    }
  }
  return [...groups.values()];
}

/** Names of every prompt section in the global and scoped prompt layers. */
function collectSectionNames(systemPrompt: unknown): string[] {
  const layers = (systemPrompt as SectionServiceLike | undefined)?.layers;
  const names = new Set<string>();
  addNames(names, layers?.global?.sections);
  if (layers?.scoped !== undefined) {
    for (const layer of layers.scoped.values()) addNames(names, layer.sections);
  }
  return [...names];
}

/** A stable identity for the exact set of names currently in a layer. */
function signatureOf(names: readonly string[]): string {
  return [...names].sort().join("\0");
}

/** Names of every tool in the global and scoped tool layers. */
function collectToolNames(tools: unknown): string[] {
  const layers = (tools as ToolServiceLike | undefined)?.layers;
  const names = new Set<string>();
  addNames(names, layers?.global?.tools);
  if (layers?.scoped !== undefined) {
    for (const layer of layers.scoped.values()) addNames(names, layer.tools);
  }
  return [...names];
}

function addNames(target: Set<string>, entries: NamedEntriesLike | undefined): void {
  if (entries === undefined) return;
  for (const name of entries.keys()) target.add(name);
}

/** `Function.prototype.toString` of the fiber's plugin callback. */
function callbackSource(fiber: FiberLike): string {
  const callback = fiber.runtime?.callback;
  if (typeof callback !== "function") return "";
  try {
    return Function.prototype.toString.call(callback);
  } catch {
    return "";
  }
}

/** Section/tool effects in the order the fiber created them. */
function effectKinds(fiber: FiberLike): Array<"section" | "tool"> | undefined {
  if (typeof fiber.getEffects !== "function") return undefined;
  let effects: readonly EffectLike[];
  try {
    effects = fiber.getEffects();
  } catch {
    return undefined;
  }
  const kinds: Array<"section" | "tool"> = [];
  for (const effect of effects) {
    if (effect.label === "systemPrompt.section()") kinds.push("section");
    else if (effect.label === "tools.register()") kinds.push("tool");
  }
  return kinds;
}

/** Declarations of known sections and tools in a source string, in source order. */
function registrationEvents(source: string, sectionNames: readonly string[], toolNames: readonly string[]): RegistrationEvent[] {
  const events: RegistrationEvent[] = [];
  for (const name of sectionNames) {
    const pattern = new RegExp(
      `\\.systemPrompt\\.section\\(\\s*\\{[^{}]{0,400}?\\bname\\s*:\\s*["'\`]${escapeRegExp(name)}["'\`]`,
      "g",
    );
    for (const match of source.matchAll(pattern)) {
      if (match.index !== undefined) events.push({ kind: "section", name, index: match.index });
    }
  }
  for (const name of toolNames) {
    const pattern = new RegExp(
      `defineTool\\(\\s*\\{[^{}]{0,400}?\\bname\\s*:\\s*["'\`]${escapeRegExp(name)}["'\`]`,
      "g",
    );
    for (const match of source.matchAll(pattern)) {
      if (match.index !== undefined) events.push({ kind: "tool", name, index: match.index });
    }
  }
  return events.sort((left, right) => left.index - right.index);
}

/** Match one source event to each section/tool effect of a fiber. */
function pairEvents(
  events: readonly RegistrationEvent[],
  kinds: readonly ("section" | "tool")[] | undefined,
): Map<string, Set<string>> | undefined {
  if (kinds === undefined || kinds.length === 0 || events.length !== kinds.length) return undefined;
  const pairs = new Map<string, Set<string>>();
  let current: string | undefined;
  for (let index = 0; index < kinds.length; index += 1) {
    const event = events[index]!;
    if (event.kind !== kinds[index]) return undefined;
    if (event.kind === "section") {
      current = event.name;
      if (!pairs.has(current)) pairs.set(current, new Set());
    } else {
      if (current === undefined) return undefined;
      pairs.get(current)!.add(event.name);
    }
  }
  return pairs;
}

/**
 * Pair sections and tools inside a module's function declarations.
 *
 * A plugin can delegate `apply()` to module-level helpers
 * (`applyReadTool`, `registerUserTerminalTools`, ...); those helpers are not
 * Cordis fibers of their own, so their registration order is not available
 * from `getEffects()`. Function-local declaration order is the exact authoring
 * order in that case. A helper with one section and several tools owns all of
 * them; a module with only one section and several tool helpers (the terminal
 * panel shape) owns all module tools.
 */
function modulePairs(
  source: string,
  sectionNames: readonly string[],
  toolNames: readonly string[],
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const moduleSections = new Set<string>();
  const moduleTools = new Set<string>();
  for (const block of functionBodies(source)) {
    const events = registrationEvents(block, sectionNames, toolNames);
    const sections = events.filter((event) => event.kind === "section");
    const tools = events.filter((event) => event.kind === "tool");
    for (const event of sections) moduleSections.add(event.name);
    for (const event of tools) moduleTools.add(event.name);
    if (sections.length === 0 || tools.length === 0) continue;
    if (sections.length === 1) {
      let members = result.get(sections[0]!.name);
      if (members === undefined) {
        members = new Set();
        result.set(sections[0]!.name, members);
      }
      for (const event of tools) members.add(event.name);
      continue;
    }
    // Multiple section/tool declarations in one function: use their source order.
    const pairs = pairEvents(events, events.map((event) => event.kind));
    if (pairs !== undefined) {
      for (const [section, members] of pairs) {
        let existing = result.get(section);
        if (existing === undefined) {
          existing = new Set();
          result.set(section, existing);
        }
        for (const tool of members) existing.add(tool);
      }
    }
  }
  if (result.size === 0 && moduleSections.size === 1 && moduleTools.size > 0) {
    result.set([...moduleSections][0]!, new Set(moduleTools));
  }
  return result;
}

/** Function bodies in a module, with nested braces tracked outside strings. */
function functionBodies(source: string): string[] {
  const bodies: string[] = [];
  const pattern = /function\s+[A-Za-z0-9_$]+\s*\([^)]*\)\s*\{/g;
  for (const match of source.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const start = match.index + match[0].length;
    const end = matchingBrace(source, start);
    if (end !== undefined) bodies.push(source.slice(start, end));
  }
  return bodies;
}

/** Index of the brace closing a block that starts just after `{`. */
function matchingBrace(source: string, start: number): number | undefined {
  let depth = 1;
  let quote: "'" | '"' | "`" | undefined;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote !== undefined) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

/** Read the entry's module source when the callback delegates to a module helper. */
function moduleSourceOf(entry: EntryLike): string | undefined {
  const name = entry.options?.name;
  const baseUrl = entry.parent?.tree?.ctx?.baseUrl;
  if (typeof name !== "string" || name.startsWith("cordis:") || baseUrl === undefined) return undefined;
  const key = `${String(baseUrl)}\0${name}`;
  const state = store();
  if (state.moduleSources.has(key)) return state.moduleSources.get(key);
  let source: string | undefined;
  try {
    const base = typeof baseUrl === "string" || baseUrl instanceof URL
      ? String(baseUrl)
      : undefined;
    if (base !== undefined) {
      const requireFrom = createRequire(requesterPath(base));
      const file = requireFrom.resolve(name);
      source = readFileSync(file, "utf8");
    }
  } catch {
    source = undefined;
  }
  state.moduleSources.set(key, source);
  return source;
}

/** A file-like anchor for `createRequire`, including directory base URLs. */
function requesterPath(base: string): string {
  if (/^file:/i.test(base)) {
    try {
      return new URL("__dsh_tool_manager__.js", base).href;
    } catch {
      return base;
    }
  }
  if (/[\\/]$/.test(base)) return `${base}__dsh_tool_manager__.js`;
  return base;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Record an exact set of members recovered from a pre-mounted plugin. */
function rememberLearned(sectionName: string, tools: Iterable<string>): void {
  if (!sectionName.startsWith("tool:")) return;
  const state = store();
  let members = state.learnedSectionTools.get(sectionName);
  if (members === undefined) {
    members = new Set();
    state.learnedSectionTools.set(sectionName, members);
  }
  for (const tool of tools) if (tool.length > 0) members.add(tool);
}

/** Keep a section's registering fiber without holding a dead plugin alive. */
function rememberSection(name: string, fiber: FiberLike): void {
  const refs = store().sectionFibers.get(name) ?? [];
  const kept = refs.filter((ref) => {
    const current = ref.deref();
    return current !== undefined && current !== fiber;
  });
  kept.push(new WeakRef(fiber));
  store().sectionFibers.set(name, kept);
}

/** Drop one fiber from a section's owners, leaving any other scope's mount. */
function forgetSection(name: string, fiber: FiberLike): void {
  const refs = store().sectionFibers.get(name);
  if (refs === undefined) return;
  const kept = refs.filter((ref) => {
    const current = ref.deref();
    return current !== undefined && current !== fiber;
  });
  if (kept.length === 0) store().sectionFibers.delete(name);
  else store().sectionFibers.set(name, kept);
}

/** Record one tool under its registering fiber. */
function rememberTool(name: string, fiber: FiberLike): void {
  const state = store();
  let names = state.toolsByFiber.get(fiber);
  if (names === undefined) {
    names = new Set();
    state.toolsByFiber.set(fiber, names);
  }
  names.add(name);
}

/** Drop one tool from its registering fiber. */
function forgetTool(name: string, fiber: FiberLike): void {
  const names = store().toolsByFiber.get(fiber);
  if (names === undefined) return;
  names.delete(name);
  if (names.size === 0) store().toolsByFiber.delete(fiber);
}

/** Run `callback` when a disposer is called, preserving the disposer's return. */
function observeDisposal(disposer: unknown, callback: () => void): unknown {
  if (typeof disposer !== "function") return disposer;
  return function observedDisposal(this: unknown, ...args: unknown[]): unknown {
    const result = Reflect.apply(disposer, this, args);
    callback();
    return result;
  };
}

/**
 * Clear the process-wide store. Intended for tests that need a clean process.
 */
export function resetPromptAffinity(): void {
  const holder = globalThis as unknown as Record<symbol, unknown>;
  delete holder[STORE_KEY];
}
