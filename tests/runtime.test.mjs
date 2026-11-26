import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolPolicyRuntime } from "../dist/runtime.js";
import { PromptToolAffinity, resetPromptAffinity } from "../dist/prompt-affinity.js";
import { TOOL_MANAGER_PROBE_SESSION_ID } from "../dist/types.js";

function resumedSession() {
  const events = [
    { type: "tool/call", data: { callId: "open-1", name: "tool_list", arguments: JSON.stringify({ group: "GitHub" }) } },
    {
      type: "tool/result",
      data: { message: { role: "tool", source: { kind: "tool", callId: "open-1" }, toolCallId: "open-1", content: [{ type: "text", text: "{}" }], isError: false } },
    },
    { type: "tool/call", data: { callId: "old-1", name: "tool_list", arguments: JSON.stringify({ group: "Removed" }) } },
    {
      type: "tool/result",
      data: { message: { role: "tool", source: { kind: "tool", callId: "old-1" }, toolCallId: "old-1", content: [{ type: "text", text: "{}" }], isError: false } },
    },
  ];
  return {
    seq: events.length,
    inheritedEventCount: 0,
    eventAt(seq) {
      const event = events[seq];
      return event === undefined ? undefined : { seq, ...event };
    },
    surface: { nodes: [] },
  };
}

describe("ToolPolicyRuntime restart recovery", () => {
  it("records tools that only exist in a live Agent scope", async () => {
    const scopedSchemas = ["read", "subagent"].map((name) => ({ name, description: name, parameters: {} }));
    const standingSchemas = [{ name: "read", description: "read", parameters: {} }];
    const scopedTools = {
      schemas() { return scopedSchemas; },
      register() { throw new Error("scope register should not be used"); },
      restrict() { return () => {}; },
    };
    const agent = {
      ctx: { get(name) { return name === "tools" ? scopedTools : undefined; }, on() {} },
      session: resumedSession(),
    };
    const context = {
      get(name) {
        if (name === "tools") return {
          schemas() { return standingSchemas; },
          register() { return () => {}; },
          restrict() { throw new Error("host restrict should not be used"); },
        };
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on() {},
    };
    const presets = { composedPreset: () => "standard" };

    const runtime = new ToolPolicyRuntime(context, presets, { presets: {} });
    runtime.start();

    assert.deepEqual(runtime.observedSchemasFor("standard").map((item) => item.name), ["read", "subagent"]);
    await runtime.dispose();
  });

  it("does not cache transient schemas observed on the shared probe Agent", async () => {
    const scopedSchemas = ["pwsh", "subagent", "list_subagent_models"].map((name) => ({
      name,
      description: name,
      parameters: {},
    }));
    const probeAgent = {
      id: TOOL_MANAGER_PROBE_SESSION_ID,
      ctx: {
        get(name) {
          return name === "tools" ? {
            schemas() { return scopedSchemas; },
            register() { throw new Error("scope register should not be used"); },
            restrict() { return () => {}; },
          } : undefined;
        },
        on() {},
      },
      session: resumedSession(),
    };
    const context = {
      get(name) {
        if (name === "tools") return { schemas() { return []; }, register() { return () => {}; } };
        if (name === "agents") return { list: () => [probeAgent] };
        return undefined;
      },
      on() {},
    };
    const presets = { composedPreset: () => "minimal" };
    const runtime = new ToolPolicyRuntime(context, presets, { presets: {} });

    runtime.start();

    assert.deepEqual(runtime.observedSchemasFor("minimal"), []);
    await runtime.dispose();
  });

  it("filters and guards tools registered in the Agent's own scope", async () => {
    const schemas = ["read", "subagent"].map((name) => ({ name, description: name, parameters: {} }));
    let guard;
    let assemble;
    const scopedTools = {
      schemas() { return schemas; },
      register() { throw new Error("scope register should not be used"); },
      restrict() { throw new Error('tool "subagent" is scoped, not globally restrictable; known global tools: read'); },
      guard(callback) { guard = callback; return () => {}; },
    };
    const agent = {
      ctx: {
        get(name) { return name === "tools" ? scopedTools : undefined; },
        on(name, handler) { if (name === "system-prompt/assemble") assemble = handler; return () => {}; },
      },
      session: resumedSession(),
    };
    const context = {
      get(name) {
        if (name === "tools") return { schemas() { return schemas; }, register() { return () => {}; } };
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on() {},
    };
    const presets = { composedPreset: () => "standard" };
    const runtime = new ToolPolicyRuntime(context, presets, {
      presets: { standard: { disabled: ["subagent"], groups: [] } },
    });
    runtime.start();

    const filtered = await assemble({}, {}, async () => ({
      tools: schemas,
      sections: [{ name: "tool:read" }, { name: "tool:subagent" }, { name: "identity" }],
      contexts: [],
      variables: {},
    }));
    assert.deepEqual(filtered.tools.map((item) => item.name), ["read"]);
    assert.deepEqual(filtered.sections.map((item) => item.name), ["tool:read", "identity"]);
    assert.match(guard({ name: "subagent" }), /disabled by the tool-manager policy/);
    assert.equal(guard({ name: "read" }), undefined);
    await runtime.dispose();
  });

  it("filters section text when DSH assembles without tool declarations (0.2.2 fallback)", async () => {
    const schemas = ["read", "subagent"].map((name) => ({ name, description: name, parameters: {} }));
    let guard;
    let assemble;
    const warnings = [];
    const scopedTools = {
      schemas() { return schemas; },
      register() { throw new Error("scope register should not be used"); },
      restrict() { throw new Error('tool "subagent" is scoped, not globally restrictable; known global tools: read'); },
      guard(callback) { guard = callback; return () => {}; },
    };
    const agent = {
      ctx: {
        get(name) { return name === "tools" ? scopedTools : undefined; },
        on(name, handler) { if (name === "system-prompt/assemble") assemble = handler; return () => {}; },
      },
      session: resumedSession(),
    };
    const context = {
      get(name) {
        if (name === "tools") return { schemas() { return schemas; }, register() { return () => {}; } };
        if (name === "agents") return { list: () => [agent] };
        if (name === "logger") return { warn: (message) => warnings.push(message) };
        return undefined;
      },
      on() {},
    };
    const presets = { composedPreset: () => "standard" };
    const runtime = new ToolPolicyRuntime(context, presets, {
      presets: { standard: { disabled: ["subagent"], groups: [] } },
    });
    runtime.start();

    // DSH >= 0.2.2 hands over a PromptPresentation: sections/contexts/variables
    // only, and re-attaches the registry's tool declarations after the
    // waterfall.
    const presentation = () => ({
      sections: [{ name: "tool:read" }, { name: "tool:subagent" }, { name: "identity" }],
      contexts: [],
      variables: {},
    });

    const filtered = await assemble({}, {}, async () => presentation());
    assert.deepEqual(filtered.sections.map((item) => item.name), ["tool:read", "identity"]);
    assert.equal("tools" in filtered, false);
    assert.match(guard({ name: "subagent" }), /disabled by the tool-manager policy/);

    // The Agent-scoped tool cannot be hidden from the prompt any more, so the
    // runtime must say so once instead of failing silently.
    const limitation = warnings.filter((message) => /Agent-scoped tool/.test(message));
    assert.equal(limitation.length, 1);
    assert.match(limitation[0], /subagent/);

    await assemble({}, {}, async () => presentation());
    assert.equal(warnings.filter((message) => /Agent-scoped tool/.test(message)).length, 1);
    await runtime.dispose();
  });

  it("drops prompt sections that only introduce a fully hidden tool family", async () => {
    const schemas = [
      "tool_list",
      "read",
      "list_mcp_resources",
      "list_mcp_resource_templates",
      "read_mcp_resource",
      "mcp__playwright__browser_navigate",
      "mcp__playwright__browser_close",
    ].map((name) => ({ name, description: name, parameters: {} }));
    let assemble;
    let discovery;
    const scopedTools = {
      schemas() { return schemas; },
      register() { throw new Error("scope register should not be used"); },
      restrict() { return () => {}; },
      guard() { return () => {}; },
    };
    const agent = {
      ctx: {
        get(name) { return name === "tools" ? scopedTools : undefined; },
        on(name, handler) { if (name === "system-prompt/assemble") assemble = handler; return () => {}; },
      },
      session: resumedSession(),
    };
    const context = {
      get(name) {
        if (name === "tools") return {
          schemas() { return schemas; },
          register(definition) { discovery = definition; return () => {}; },
        };
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on() {},
    };
    const runtime = new ToolPolicyRuntime(context, { composedPreset: () => "standard" }, {
      presets: {
        standard: {
          disabled: [],
          groups: [
            {
              name: "MCP资源浏览",
              patterns: ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"],
            },
            {
              name: "浏览器自动化",
              patterns: ["mcp__playwright__browser_navigate", "mcp__playwright__browser_close"],
            },
          ],
        },
      },
    });
    runtime.start();

    const presentation = () => ({
      sections: [
        { name: "tool:read" },
        { name: "tool:list_mcp_resources" },
        { name: "mcp-resource-servers" },
        { name: "mcp:playwright" },
        { name: "mcp:nonexistent" },
        { name: "identity" },
      ],
      contexts: [],
      variables: {},
    });
    const kept = async () => (await assemble({}, {}, async () => presentation()))
      .sections.map((section) => section.name);

    // Both groups are closed, so every advertised tool is hidden and the
    // sections that exist only for them go too. A section whose family
    // registered no tools stays: nothing is hidden, nothing is stale.
    assert.deepEqual(await kept(), ["tool:read", "mcp:nonexistent", "identity"]);

    // One visible tool is enough to keep its family's section.
    await discovery.execute({ group: "MCP资源浏览" }, { agent });
    assert.deepEqual(await kept(), [
      "tool:read",
      "tool:list_mcp_resources",
      "mcp-resource-servers",
      "mcp:nonexistent",
      "identity",
    ]);

    // Same for an MCP server's own instruction section: opening its group
    // restores it, closing it removes it again.
    await discovery.execute({ group: "浏览器自动化" }, { agent });
    assert.deepEqual(await kept(), [
      "tool:read",
      "tool:list_mcp_resources",
      "mcp-resource-servers",
      "mcp:playwright",
      "mcp:nonexistent",
      "identity",
    ]);

    // A partially hidden family keeps its section while a sibling is callable.
    runtime.update({
      presets: {
        standard: {
          disabled: [
            "mcp__playwright__browser_navigate",
            "list_mcp_resources",
            "list_mcp_resource_templates",
            "read_mcp_resource",
          ],
          groups: [],
        },
      },
    });
    assert.deepEqual(await kept(), ["tool:read", "mcp:playwright", "mcp:nonexistent", "identity"]);

    // Hiding the last member removes the server instructions with it.
    runtime.update({
      presets: {
        standard: {
          disabled: [
            "mcp__playwright__browser_navigate",
            "mcp__playwright__browser_close",
            "list_mcp_resources",
            "list_mcp_resource_templates",
            "read_mcp_resource",
          ],
          groups: [],
        },
      },
    });
    assert.deepEqual(await kept(), ["tool:read", "mcp:nonexistent", "identity"]);
    await runtime.dispose();
  });

  it("folds sections by preset policy when an upstream restrict already shrank the baseline", async () => {
    // Issue #3: a delegated child Agent joins the parent's preset, but its tool
    // surface was narrowed by `childCtx.tools.restrict(toolFilter)` before this
    // plugin installed. The folded tools are therefore absent from the
    // baseline, `denyNames()` returns nothing, and only the policy itself still
    // proves the section is stale.
    const schemas = ["tool_list", "read"].map((name) => ({ name, description: name, parameters: {} }));
    let assemble;
    const warnings = [];
    const scopedTools = {
      schemas() { return schemas; },
      register() { throw new Error("scope register should not be used"); },
      restrict() { return () => {}; },
      guard() { return () => {}; },
    };
    const agent = {
      ctx: {
        get(name) { return name === "tools" ? scopedTools : undefined; },
        on(name, handler) { if (name === "system-prompt/assemble") assemble = handler; return () => {}; },
      },
      session: resumedSession(),
    };
    const context = {
      get(name) {
        if (name === "tools") return { schemas() { return schemas; }, register() { return () => {}; } };
        if (name === "agents") return { list: () => [agent] };
        if (name === "logger") return { warn: (message) => warnings.push(message) };
        return undefined;
      },
      on() {},
    };
    const runtime = new ToolPolicyRuntime(context, { composedPreset: () => "standard" }, {
      presets: {
        standard: {
          disabled: ["orphan_tool"],
          groups: [
            { name: "bilibili", patterns: ["bilibili_extract", "bilibili_login", "bilibili_doctor"] },
            { name: "MCP资源浏览", patterns: ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"] },
            { name: "浏览器自动化", patterns: ["mcp__playwright__*"] },
          ],
        },
      },
    });
    runtime.start();

    const kept = async () => (await assemble({}, {}, async () => ({
      sections: [
        { name: "tool:read" },
        { name: "tool:bilibili_extract" },
        { name: "tool:orphan_tool" },
        { name: "mcp-resource-servers" },
        { name: "mcp:playwright" },
        { name: "identity" },
      ],
      contexts: [],
      variables: {},
    }))).sections.map((section) => section.name);

    // Nothing here is in the baseline, yet every folded or disabled family is
    // gone: the section follows the preset declaration, not this Agent's
    // inherited surface. `tool:read` and the unowned `identity` stay.
    assert.deepEqual(await kept(), ["tool:read", "identity"]);
    // Folding is silent: the fallback warning is about declarations, not here.
    assert.deepEqual(warnings.filter((message) => /Agent-scoped tool/.test(message)), []);
    await runtime.dispose();
  });

  it("keeps every section when the preset has no policy at all", async () => {
    const schemas = ["read"].map((name) => ({ name, description: name, parameters: {} }));
    let assemble;
    const scopedTools = {
      schemas() { return schemas; },
      register() { throw new Error("scope register should not be used"); },
      restrict() { return () => {}; },
      guard() { return () => {}; },
    };
    const agent = {
      ctx: {
        get(name) { return name === "tools" ? scopedTools : undefined; },
        on(name, handler) { if (name === "system-prompt/assemble") assemble = handler; return () => {}; },
      },
      session: resumedSession(),
    };
    const context = {
      get(name) {
        if (name === "tools") return { schemas() { return schemas; }, register() { return () => {}; } };
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on() {},
    };
    const runtime = new ToolPolicyRuntime(context, { composedPreset: () => "minimal" }, { presets: {} });
    runtime.start();

    const sections = [
      { name: "tool:read" },
      { name: "tool:bilibili_extract" },
      { name: "mcp-resource-servers" },
      { name: "identity" },
    ];
    const filtered = await assemble({}, {}, async () => ({ sections, contexts: [], variables: {} }));
    assert.deepEqual(filtered.sections.map((section) => section.name), sections.map((section) => section.name));
    await runtime.dispose();
  });

  it("hides Agent-scoped tools from the per-step tool set (0.2.2)", async () => {
    const globals = ["read"];
    const own = ["subagent"];
    const byName = new Map([...globals, ...own].map((name) => [name, { name, description: name, parameters: {} }]));
    class ScopedTools {
      denied = new Set();
      schemas() { return [...byName.values()]; }
      register() { return () => {}; }
      restrict({ deny }) {
        const unknown = deny.filter((name) => !globals.includes(name));
        if (unknown.length > 0) {
          throw new Error(`tools.restrict() names unknown global tools ${unknown.map((name) => `"${name}"`).join(", ")}; known global tools: ${globals.join(", ")}`);
        }
        this.denied = new Set(deny);
        return () => { this.denied = new Set(); };
      }
      guard() { return () => {}; }
      async resolve() {
        const owner = this;
        return {
          dispose() {},
          view() {
            const admitted = new Map();
            for (const name of [...globals.filter((item) => !owner.denied.has(item)), ...own]) {
              admitted.set(name, byName.get(name));
            }
            return admitted;
          },
        };
      }
    }

    const tools = new ScopedTools();
    let assemble;
    const warnings = [];
    const agent = {
      ctx: {
        get(name) { return name === "tools" ? tools : undefined; },
        on(name, handler) { if (name === "system-prompt/assemble") assemble = handler; return () => {}; },
      },
      session: resumedSession(),
    };
    const context = {
      get(name) {
        if (name === "tools") return tools;
        if (name === "agents") return { list: () => [agent] };
        if (name === "logger") return { warn: (message) => warnings.push(message) };
        return undefined;
      },
      on() {},
    };
    const presets = { composedPreset: () => "standard" };
    const runtime = new ToolPolicyRuntime(context, presets, {
      presets: { standard: { disabled: ["subagent"], groups: [] } },
    });
    runtime.start();

    const signal = new AbortController().signal;
    const set = await tools.resolve({ agent, modelSelection: { provider: "p", model: "m" }, signal });
    assert.deepEqual([...set.view(agent).keys()], ["read"]);
    set.dispose();

    // The declarations are already filtered, so the fallback warning must stay silent.
    await assemble({}, {}, async () => ({
      sections: [{ name: "tool:read" }, { name: "tool:subagent" }],
      contexts: [],
      variables: {},
    }));
    assert.deepEqual(warnings.filter((message) => /Agent-scoped tool/.test(message)), []);

    // Unloading restores the Host's own resolve().
    await runtime.dispose();
    const restored = await tools.resolve({ agent, modelSelection: { provider: "p", model: "m" }, signal });
    assert.deepEqual([...restored.view(agent).keys()].sort(), ["read", "subagent"]);
  });

  it("explains when a tool's on-demand group must be opened first", async () => {
    const schemas = ["tool_list", "plugin_manager", "subagent"].map((name) => ({
      name,
      description: name,
      parameters: {},
    }));
    let guard;
    let discovery;
    const scopedTools = {
      schemas() { return schemas; },
      register() { throw new Error("scope register should not be used"); },
      restrict() { return () => {}; },
      guard(callback) { guard = callback; return () => {}; },
    };
    const agent = {
      ctx: {
        get(name) { return name === "tools" ? scopedTools : undefined; },
        on() { return () => {}; },
      },
      session: resumedSession(),
    };
    const context = {
      get(name) {
        if (name === "tools") return {
          schemas() { return schemas; },
          register(definition) { discovery = definition; return () => {}; },
        };
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on() {},
    };
    const presets = { composedPreset: () => "cordis" };
    const runtime = new ToolPolicyRuntime(context, presets, {
      presets: {
        cordis: {
          disabled: ["subagent"],
          groups: [{
            name: "Cordis插件管理",
            patterns: ["plugin_manager", "subagent"],
          }],
        },
      },
    });
    runtime.start();

    assert.equal(
      guard({ name: "plugin_manager" }),
      'tool "plugin_manager" belongs to on-demand group "Cordis插件管理" which is not open; call tool_list with {"group":"Cordis插件管理"} first',
    );
    assert.match(guard({ name: "subagent" }), /disabled by the tool-manager policy/);

    await discovery.execute({ group: "Cordis插件管理" }, { agent });

    assert.equal(guard({ name: "plugin_manager" }), undefined);
    assert.match(guard({ name: "subagent" }), /disabled by the tool-manager policy/);
    await runtime.dispose();
  });

  it("keeps standard delegation policy isolated from creator sessions and restores it", async () => {
    const schemas = ["tool_list", "read", "list_subagent_models", "subagent"].map((name) => ({
      name,
      description: name,
      parameters: {},
    }));
    const handlers = new Map();
    const agents = [];
    function makeAgent(id, presetId) {
      let guard;
      let assemble;
      let restricted = new Set();
      const scopedTools = {
        schemas() { return schemas.filter((item) => !restricted.has(item.name)); },
        register() { throw new Error("scope register should not be used"); },
        restrict({ deny }) {
          const local = deny.filter((name) => name === "list_subagent_models" || name === "subagent");
          if (local.length) {
            throw new Error(`tool ${JSON.stringify(local[0])} is scoped, not globally restrictable; known global tools: tool_list, read`);
          }
          restricted = new Set(deny);
          handlers.get("tools/change")?.();
          return () => {
            restricted = new Set();
            handlers.get("tools/change")?.();
          };
        },
        guard(callback) { guard = callback; return () => {}; },
      };
      const agent = {
        id,
        presetId,
        ctx: {
          get(name) { return name === "tools" ? scopedTools : undefined; },
          on(name, handler) {
            if (name === "system-prompt/assemble") assemble = handler;
            return () => {};
          },
        },
        session: resumedSession(),
        get guard() { return guard; },
        get assemble() { return assemble; },
      };
      agents.push(agent);
      return agent;
    }
    const standard = makeAgent("standard-agent", "standard");
    const creator = makeAgent("creator-agent", "cordis");
    const hostTools = {
      schemas() { return schemas; },
      register() { return () => {}; },
      restrict() { throw new Error("host restrict should not be used"); },
    };
    const context = {
      get(name) {
        if (name === "tools") return hostTools;
        if (name === "agents") return { list: () => agents };
        return undefined;
      },
      on(name, handler) { handlers.set(name, handler); },
    };
    const presets = { composedPreset: (ctx) => agents.find((agent) => agent.ctx === ctx)?.presetId };
    const disabledStandard = {
      presets: {
        standard: { disabled: ["list_subagent_models", "subagent"], groups: [] },
        cordis: { disabled: [], groups: [] },
      },
    };
    const enabledAgain = {
      presets: {
        standard: { disabled: [], groups: [] },
        cordis: { disabled: [], groups: [] },
      },
    };
    const assembly = () => ({
      tools: schemas,
      sections: schemas.map((item) => ({ name: `tool:${item.name}` })),
      contexts: [],
      variables: {},
    });

    const runtime = new ToolPolicyRuntime(context, presets, disabledStandard);
    runtime.start();

    const standardDisabled = await standard.assemble({}, {}, async () => assembly());
    const creatorUnaffected = await creator.assemble({}, {}, async () => assembly());
    const enabledWithoutDiscovery = schemas.filter((item) => item.name !== "tool_list").map((item) => item.name);
    assert.deepEqual(standardDisabled.tools.map((item) => item.name), ["read"]);
    assert.deepEqual(creatorUnaffected.tools.map((item) => item.name), enabledWithoutDiscovery);
    assert.match(standard.guard({ name: "subagent" }), /disabled by the tool-manager policy/);
    assert.equal(creator.guard({ name: "subagent" }), undefined);

    runtime.update(enabledAgain);

    const standardRestored = await standard.assemble({}, {}, async () => assembly());
    const creatorStillUnaffected = await creator.assemble({}, {}, async () => assembly());
    assert.deepEqual(standardRestored.tools.map((item) => item.name), enabledWithoutDiscovery);
    assert.deepEqual(creatorStillUnaffected.tools.map((item) => item.name), enabledWithoutDiscovery);
    assert.equal(standard.guard({ name: "subagent" }), undefined);
    assert.equal(creator.guard({ name: "subagent" }), undefined);
    await runtime.dispose();
  });

  it("does not snapshot a transient missing scoped tool during a Preset switch", async () => {
    const schema = (name) => ({ name, description: name, parameters: {} });
    let presetId = "standard";
    let dynamicSubagent = true;
    let guard;
    const handlers = new Map([["tools/change", []]]);
    const emit = (name) => {
      for (const handler of handlers.get(name) || []) handler();
    };
    // Registered before ToolPolicyRuntime, like a standing Preset listener.
    // Recomposition can temporarily remove one Agent-scoped registration while
    // its replacement settles asynchronously without another registry edge.
    handlers.get("tools/change").push(() => {
      dynamicSubagent = false;
      setImmediate(() => { dynamicSubagent = true; });
    });
    const scopedTools = {
      schemas() {
        return [schema("read"), ...(dynamicSubagent ? [schema("subagent")] : [])];
      },
      register() { throw new Error("scope register should not be used"); },
      restrict({ deny }) {
        if (deny.includes("subagent")) {
          throw new Error('tool "subagent" is scoped, not globally restrictable; known global tools: read');
        }
        return () => {};
      },
      guard(callback) { guard = callback; return () => {}; },
    };
    const agent = {
      id: "switching-agent",
      ctx: { get(name) { return name === "tools" ? scopedTools : undefined; }, on() { return () => {}; } },
      session: resumedSession(),
    };
    const context = {
      get(name) {
        if (name === "tools") return { schemas() { return []; }, register() { return () => {}; } };
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on(name, handler) {
        const list = handlers.get(name) || [];
        list.push(handler);
        handlers.set(name, list);
      },
    };
    const presets = { composedPreset: () => presetId };
    const runtime = new ToolPolicyRuntime(context, presets, { presets: {} });
    runtime.start();

    presetId = "cordis";
    emit("tools/change");
    await new Promise((resolve) => setImmediate(resolve));
    runtime.update({ presets: { cordis: { disabled: ["subagent"], groups: [] } } });

    assert.equal(dynamicSubagent, true);
    assert.match(guard({ name: "subagent" }), /disabled by the tool-manager policy/);
    await runtime.dispose();
  });

  it("keeps restored groups open while enforcing other hidden and disabled tools", async () => {
    const applied = [];
    const schemas = ["tool_list", "mcp__github__issue", "web_search", "write"].map((name) => ({
      name,
      description: name,
      parameters: {},
    }));
    const scopedTools = {
      schemas() { return schemas; },
      register() { throw new Error("scope register should not be used"); },
      restrict({ deny }) {
        applied.push([...deny]);
        return () => {};
      },
    };
    const agent = {
      ctx: { get(name) { return name === "tools" ? scopedTools : undefined; }, on() {} },
      session: resumedSession(),
    };
    const handlers = new Map();
    const hostTools = {
      schemas() { return schemas; },
      register() { return () => {}; },
      restrict() { throw new Error("host restrict should not be used"); },
    };
    const context = {
      get(name) {
        if (name === "tools") return hostTools;
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on(name, handler) { handlers.set(name, handler); },
    };
    const presets = { composedPreset: () => "standard" };
    const settings = {
      presets: {
        standard: {
          disabled: ["write"],
          groups: [
            { name: "GitHub", patterns: ["mcp__github__issue"] },
            { name: "Web", patterns: ["web_search"] },
          ],
        },
      },
    };

    const runtime = new ToolPolicyRuntime(context, presets, settings);
    runtime.start();

    assert.deepEqual(applied.at(-1), ["web_search", "write"]);
    await runtime.dispose();
  });

  it("keeps a fork's inherited group open and still hides the groups it never opened", async () => {
    const applied = [];
    const schemas = ["tool_list", "mcp__github__issue", "web_search", "write"].map((name) => ({
      name,
      description: name,
      parameters: {},
    }));
    const scopedTools = {
      schemas() { return schemas; },
      register() { throw new Error("scope register should not be used"); },
      restrict({ deny }) {
        applied.push([...deny]);
        return () => {};
      },
    };
    // The parent opened "Web" before the fork; the child continues that replayed log.
    const inherited = [
      { type: "tool/call", data: { callId: "parent-open", name: "tool_list", arguments: JSON.stringify({ group: "Web" }) } },
      {
        type: "tool/result",
        data: { message: { role: "tool", source: { kind: "tool", callId: "parent-open" }, toolCallId: "parent-open", content: [{ type: "text", text: "{}" }], isError: false } },
      },
    ];
    const forkLog = [...inherited, { type: "session/end-seed", data: { inherited: true } }];
    const agent = {
      ctx: { get(name) { return name === "tools" ? scopedTools : undefined; }, on() {} },
      session: {
        seq: forkLog.length,
        inheritedEventCount: inherited.length,
        eventAt(seq) {
          const event = forkLog[seq];
          return event === undefined ? undefined : { seq, ...event };
        },
        surface: { nodes: [] },
      },
    };
    const context = {
      get(name) {
        if (name === "tools") return { schemas() { return schemas; }, register() { return () => {}; }, restrict() { return () => {}; } };
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on() {},
    };
    const presets = { composedPreset: () => "standard" };
    const settings = {
      presets: {
        standard: {
          disabled: ["write"],
          groups: [
            { name: "GitHub", patterns: ["mcp__github__issue"] },
            { name: "Web", patterns: ["web_search"] },
          ],
        },
      },
    };

    const runtime = new ToolPolicyRuntime(context, presets, settings);
    runtime.start();

    assert.deepEqual(applied.at(-1), ["mcp__github__issue", "write"]);
    await runtime.dispose();
  });
});

describe("ToolPolicyRuntime registry reload", () => {
  it("follows the live registry, forgets its observations, and keeps the policy", async () => {
    const denies = [];
    const scopedSchemas = ["read", "subagent"].map((name) => ({ name, description: name, parameters: {} }));
    const scopedTools = {
      schemas() { return scopedSchemas; },
      register() { return () => {}; },
      restrict(filter) { denies.push(filter.deny); return () => {}; },
    };
    const agent = {
      ctx: { get(name) { return name === "tools" ? scopedTools : undefined; }, on() { return () => {}; } },
      session: resumedSession(),
    };
    const context = {
      get(name) {
        if (name === "tools") return { schemas: () => [], register: () => () => {}, restrict: () => () => {} };
        if (name === "agents") return { list: () => [agent] };
        if (name === "logger") return { warn() {} };
        return undefined;
      },
      on() {},
    };
    const seen = [];
    let instance = { composedPreset() { seen.push("first"); return "standard"; } };

    const runtime = new ToolPolicyRuntime(context, () => instance, {
      presets: { standard: { disabled: ["subagent"], groups: [] } },
    });
    runtime.start();
    assert.deepEqual(runtime.observedSchemasFor("standard").map((item) => item.name), ["read", "subagent"]);
    assert.deepEqual(denies.at(-1), ["subagent"]);

    // DSH republished the registry: the new instance has no bindings yet, and
    // preset ids from the retired one no longer name a composition it owns.
    instance = { composedPreset() { seen.push("second"); return undefined; } };
    runtime.update({ presets: { standard: { disabled: ["subagent"], groups: [] } } });

    assert.equal(seen.at(-1), "second");
    assert.deepEqual(runtime.observedSchemasFor("standard"), []);
    // A Session DSH can no longer report a preset for keeps the policy it was
    // running under: silently re-enabling every disabled tool is worse.
    assert.deepEqual(denies.at(-1), ["subagent"]);
    await runtime.dispose();
  });
});

describe("a tool registered after the baseline snapshot", () => {
  function host() {
    const schema = (name) => ({ name, description: name, parameters: {} });
    let names = ["read"];
    let restricted = new Set();
    let guard;
    let stepSet;
    const listeners = new Map();
    /** The Agent-scoped service: `restrict()` removes names from what it shows. */
    const visible = () => names.filter((name) => !restricted.has(name)).map(schema);
    const scopedTools = {
      schemas: visible,
      register: () => () => {},
      restrict({ deny }) {
        restricted = new Set(deny);
        return () => {
          restricted = new Set();
        };
      },
      guard(callback) {
        guard = callback;
        return () => {};
      },
    };
    const agent = {
      id: "session-1",
      ctx: {
        get: (name) => (name === "tools" ? scopedTools : undefined),
        on: () => () => {},
      },
      session: { seq: 0, eventAt: () => undefined, surface: { nodes: [] } },
    };
    const hostTools = {
      schemas: visible,
      register: () => () => {},
      restrict: () => () => {},
      // The real host service owns `resolve`; the plugin patches it in place.
      async resolve() {
        stepSet = {
          dispose() {},
          view: () => new Map(visible().map((item) => [item.name, item])),
        };
        return stepSet;
      },
    };
    const context = {
      get(name) {
        if (name === "tools") return hostTools;
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on(event, listener) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return () => {};
      },
    };
    const settings = {
      presets: {
        standard: {
          disabled: [],
          groups: [{ name: "GitHub", description: "github", patterns: ["github_*"] }],
        },
      },
    };
    return {
      agent,
      context,
      hostTools,
      listeners,
      settings,
      get guard() {
        return guard;
      },
      get stepSet() {
        return stepSet;
      },
      get restricted() {
        return [...restricted];
      },
      visibleNames() {
        return visible().map((item) => item.name);
      },
      addLateTool() {
        names = ["read", "github_search"];
      },
      setTools(next) {
        names = [...next];
      },
    };
  }

  const presets = { composedPreset: () => "standard" };

  it("joins its on-demand group on the next step without a restart", async () => {
    const h = host();
    const runtime = new ToolPolicyRuntime(h.context, presets, h.settings);
    runtime.start();
    const preStep = h.listeners.get("agent/pre-step")[0];

    // A plugin installed after this Agent's snapshot registered its tool into
    // the live surface, but no `tools/change` edge reached the runtime.
    h.addLateTool();

    const decision = await preStep({ agent: h.agent }, () => ({ kind: "enter", messages: [] }));

    assert.equal(decision.messages.length, 1, "the catalog now names the group");
    assert.equal(decision.messages[0].source.kind, "tool-manager-catalog");
    assert.deepEqual(decision.messages[0].source.entries.map((entry) => entry.name), ["GitHub"]);
    assert.deepEqual(decision.messages[0].source.entries[0].tools, ["github_search"]);
    assert.match(h.guard({ name: "github_search" }), /belongs to on-demand group "GitHub"/);
    await runtime.dispose();
  });

  it("hides the late tool from the step set the host is about to resolve", async () => {
    const h = host();
    const runtime = new ToolPolicyRuntime(h.context, presets, h.settings);
    runtime.start();

    h.addLateTool();
    const set = await h.hostTools.resolve({ agent: h.agent });

    assert.deepEqual([...set.view().keys()], ["read"]);
    await runtime.dispose();
  });

  it("keeps the snapshot when the surface merely shrinks", async () => {
    const h = host();
    h.addLateTool();
    const runtime = new ToolPolicyRuntime(h.context, presets, h.settings);
    runtime.start();
    const preStep = h.listeners.get("agent/pre-step")[0];

    // A composition swap can drop a standing layer for one turn; adopting that
    // gap would un-hide the group's tools, so only growth refreshes the snapshot.
    h.setTools(["read"]);
    const decision = await preStep({ agent: h.agent }, () => ({ kind: "enter", messages: [] }));

    assert.deepEqual(decision.messages[0].source.entries.map((entry) => entry.name), ["GitHub"]);
    assert.deepEqual(decision.messages[0].source.entries[0].tools, ["github_search"]);
    await runtime.dispose();
  });

  it("keeps grouped tools in the snapshot while their group is closed", async () => {
    const h = host();
    h.setTools(["read", "github_search"]);
    const runtime = new ToolPolicyRuntime(h.context, presets, h.settings);
    runtime.start();
    const preStep = h.listeners.get("agent/pre-step")[0];
    assert.deepEqual(h.restricted, ["github_search"], "the closed group is denied");

    // A second plugin registers another tool while the group is still closed.
    // The visible surface hides `github_search`, so a naive re-read would drop
    // it from the snapshot and lift the group's restriction.
    h.setTools(["read", "github_search", "gitlab_search"]);
    const decision = await preStep({ agent: h.agent }, () => ({ kind: "enter", messages: [] }));

    assert.deepEqual(h.restricted, ["github_search"], "the closed group stays denied");
    assert.deepEqual(h.visibleNames(), ["read", "gitlab_search"]);
    assert.deepEqual(decision.messages[0].source.entries[0].tools, ["github_search"]);
    await runtime.dispose();
  });
});

describe("family-named prompt sections", () => {
  class FakeSystemPrompt {
    constructor() { this.sections = []; }
    section(section) { this.sections.push(section.name); return () => {}; }
  }

  class FakeTools {
    constructor() { this.definitions = []; this.discovery = undefined; }
    schemas() { return []; }
    register(definition) {
      this.definitions.push(definition.name);
      if (definition.name === "tool_list") this.discovery = definition;
      return () => {};
    }
    restrict() { return () => {}; }
  }

  /** A service shadow whose `this.ctx` is the plugin context that owns the call. */
  function asPlugin(service, fiber) {
    const shadow = Object.create(service);
    shadow.ctx = { fiber };
    return shadow;
  }

  function makeHost(names) {
    const schema = (name) => ({ name, description: name, parameters: {} });
    const systemPrompt = new FakeSystemPrompt();
    const hostTools = new FakeTools();
    const listeners = new Map();
    const agents = [];
    let assemble;
    const scopedTools = {
      schemas() { return names.map(schema); },
      register() { throw new Error("scope register should not be used"); },
      restrict() { return () => {}; },
      guard() { return () => {}; },
    };
    const agent = {
      id: "session-1",
      ctx: {
        get(name) { return name === "tools" ? scopedTools : undefined; },
        on(name, handler) {
          if (name === "system-prompt/assemble") assemble = handler;
          return () => {};
        },
      },
      session: resumedSession(),
    };
    const context = {
      get(name) {
        if (name === "tools") return hostTools;
        if (name === "systemPrompt") return systemPrompt;
        if (name === "agents") return { list: () => agents };
        if (name === "logger") return { warn() {} };
        return undefined;
      },
      on(event, listener) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return () => {};
      },
    };
    return {
      systemPrompt,
      hostTools,
      context,
      agent,
      agents,
      names,
      emit(event, payload) { for (const listener of listeners.get(event) ?? []) listener(payload); },
      filter() { return assemble; },
    };
  }

  const settings = {
    presets: {
      standard: {
        disabled: [],
        groups: [{ name: "Jobs", patterns: ["job_list", "job_output", "job_kill"] }],
      },
    },
  };

  it("drops a family-named section registered before the manager started", async () => {
    // DSH's preset-standard row mounts before the profile's tool-manager
    // bundle applies, so this section exists before affinity.install() runs.
    resetPromptAffinity();
    const h = makeHost(["tool_list", "read", "job_list", "job_output", "job_kill"]);
    asPlugin(h.systemPrompt, { name: "dsh-tool-jobs" }).section({
      name: "tool:jobs",
      text: "Track every background job id you start. Use job_output or job_kill when done.",
    });
    h.systemPrompt.layers = {
      global: { sections: new Map([["tool:jobs", {}], ["tool:read", {}]]) },
      scoped: new Map(),
    };
    h.hostTools.layers = {
      global: { tools: new Map(["tool_list", "read", "job_list", "job_output", "job_kill"].map((name) => [name, {}])) },
      scoped: new Map(),
    };
    const jobsFiber = {
      runtime: {
        callback: new Function("ctx", `
          ctx.systemPrompt.section({ name: "tool:jobs", text: "" });
          const list = defineTool({ name: "job_list" });
          const output = defineTool({ name: "job_output" });
          const kill = defineTool({ name: "job_kill" });
        `),
      },
      getEffects: () => [
        { label: "systemPrompt.section()" },
        { label: "tools.register()" },
        { label: "tools.register()" },
        { label: "tools.register()" },
      ],
    };
    h.context.registry = new Map([["runtime", { fibers: [jobsFiber] }]]);

    const runtime = new ToolPolicyRuntime(
      h.context,
      { composedPreset: () => "standard" },
      settings,
      undefined,
      undefined,
      new PromptToolAffinity(),
    );
    runtime.start();
    h.agents.push(h.agent);
    h.emit("agent/created", { agent: h.agent });

    const sections = (await h.filter()({}, {}, async () => ({
      sections: [
        { name: "tool:jobs", text: "Track every background job id you start. Use job_output or job_kill when done." },
        { name: "tool:read", text: "Read a file." },
        { name: "identity", text: "You are an AI agent." },
      ],
      contexts: [],
      variables: {},
    }))).sections.map((section) => section.name);

    assert.deepEqual(sections, ["tool:read", "identity"]);
    await runtime.dispose();
  });

  it("drops a family-named section when the registering plugin's whole family is folded", async () => {
    resetPromptAffinity();
    const h = makeHost(["tool_list", "read"]);
    const runtime = new ToolPolicyRuntime(
      h.context,
      { composedPreset: () => "standard" },
      settings,
      undefined,
      undefined,
      new PromptToolAffinity(),
    );
    runtime.start();

    // The preset mounts after the manager starts: `dsh-tool-jobs` registers its
    // section and its three tools in the same plugin fiber, as the real package does.
    const jobsFiber = { name: "dsh-tool-jobs" };
    asPlugin(h.systemPrompt, jobsFiber).section({
      name: "tool:jobs",
      text: "Track every background job id you start. Use job_output or job_kill when done.",
    });
    for (const name of ["job_list", "job_output", "job_kill"]) {
      asPlugin(h.hostTools, jobsFiber).register({ name });
    }
    h.names.push("job_list", "job_output", "job_kill");

    h.agents.push(h.agent);
    h.emit("agent/created", { agent: h.agent });

    const kept = async () => (await h.filter()({}, {}, async () => ({
      sections: [
        { name: "tool:jobs", text: "Track every background job id you start. Use job_output or job_kill when done." },
        { name: "tool:read", text: "Read a file." },
        { name: "identity", text: "You are an AI agent." },
      ],
      contexts: [],
      variables: {},
    }))).sections.map((section) => section.name);

    assert.deepEqual(await kept(), ["tool:read", "identity"]);

    // Opening the group makes the family callable again, so the section returns.
    await h.hostTools.discovery.execute({ group: "Jobs" }, { agent: h.agent });
    assert.deepEqual(await kept(), ["tool:jobs", "tool:read", "identity"]);
    await runtime.dispose();
  });

  it("drops a family section even when its prose mentions another plugin's tool", async () => {
    resetPromptAffinity();
    const h = makeHost(["tool_list", "read", "terminal_open", "terminal_close"]);
    const runtime = new ToolPolicyRuntime(
      h.context,
      { composedPreset: () => "standard" },
      {
        presets: {
          standard: {
            disabled: [],
            groups: [{ name: "User terminals", patterns: ["user_terminal_list", "user_terminal_read"] }],
          },
        },
      },
      undefined,
      undefined,
      new PromptToolAffinity(),
    );
    runtime.start();

    const panelFiber = { name: "dsh-terminal-panel" };
    asPlugin(h.systemPrompt, panelFiber).section({
      name: "tool:pty-panel",
      text: "Terminals you open with terminal_open appear in the side panel; terminal_close only removes one.",
    });
    for (const name of ["user_terminal_list", "user_terminal_read"]) {
      asPlugin(h.hostTools, panelFiber).register({ name });
    }
    h.names.push("user_terminal_list", "user_terminal_read");

    h.agents.push(h.agent);
    h.emit("agent/created", { agent: h.agent });

    const sections = (await h.filter()({}, {}, async () => ({
      sections: [
        {
          name: "tool:pty-panel",
          text: "Terminals you open with terminal_open appear in the side panel; terminal_close only removes one.",
        },
        { name: "tool:read", text: "Read a file." },
      ],
      contexts: [],
      variables: {},
    }))).sections.map((section) => section.name);

    // Ownership is the panel entry's own user_terminal_* tools; mentions of
    // terminal_open/terminal_close in prose do not make them members.
    assert.deepEqual(sections, ["tool:read"]);
    await runtime.dispose();
  });

  it("drops a family section that only mentions generic tool words", async () => {
    resetPromptAffinity();
    const h = makeHost(["tool_list", "read", "terminal_open", "terminal_send", "terminal_close"]);
    const runtime = new ToolPolicyRuntime(
      h.context,
      { composedPreset: () => "standard" },
      {
        presets: {
          standard: {
            disabled: [],
            groups: [{ name: "Terminals", patterns: ["terminal_*"] }],
          },
        },
      },
      undefined,
      undefined,
      new PromptToolAffinity(),
    );
    runtime.start();

    const terminalFiber = { name: "dsh-tool-terminal" };
    asPlugin(h.systemPrompt, terminalFiber).section({
      name: "tool:pty",
      text: "Use a terminal session only when work needs persistent terminal state or interactive stdin; prefer shell/read/write/edit for bounded one-shot operations.",
    });
    for (const name of ["terminal_open", "terminal_send", "terminal_close"]) {
      asPlugin(h.hostTools, terminalFiber).register({ name });
    }

    h.agents.push(h.agent);
    h.emit("agent/created", { agent: h.agent });

    const sections = (await h.filter()({}, {}, async () => ({
      sections: [
        {
          name: "tool:pty",
          text: "Use a terminal session only when work needs persistent terminal state or interactive stdin; prefer shell/read/write/edit for bounded one-shot operations.",
        },
        { name: "tool:read", text: "Read a file." },
      ],
      contexts: [],
      variables: {},
    }))).sections.map((section) => section.name);

    // The text says `shell/read/write/edit`, but those single-word tools are not
    // separator-bearing names: only the registration-identity family can prove
    // this section stale.
    assert.deepEqual(sections, ["tool:read"]);
    await runtime.dispose();
  });

  it("folds a family section from the preset policy when the baseline is narrowed", async () => {
    // Issue #3 path: a delegated child Agent starts without the plugin's tools
    // in its baseline, but the preset still declares the folded group.
    resetPromptAffinity();
    const h = makeHost(["tool_list", "read"]);
    const runtime = new ToolPolicyRuntime(
      h.context,
      { composedPreset: () => "standard" },
      {
        presets: {
          standard: {
            disabled: [],
            groups: [{ name: "Jobs", patterns: ["job_*"] }],
          },
        },
      },
      undefined,
      undefined,
      new PromptToolAffinity(),
    );
    runtime.start();

    const jobsFiber = { name: "dsh-tool-jobs" };
    asPlugin(h.systemPrompt, jobsFiber).section({
      name: "tool:jobs",
      text: "Track every background job id you start.",
    });
    for (const name of ["job_list", "job_output", "job_kill"]) {
      asPlugin(h.hostTools, jobsFiber).register({ name });
    }

    h.agents.push(h.agent);
    h.emit("agent/created", { agent: h.agent });

    const sections = (await h.filter()({}, {}, async () => ({
      sections: [
        { name: "tool:jobs", text: "Track every background job id you start." },
        { name: "tool:read", text: "Read a file." },
      ],
      contexts: [],
      variables: {},
    }))).sections.map((section) => section.name);

    assert.deepEqual(sections, ["tool:read"]);
    await runtime.dispose();
  });
});

describe("a compaction keep limit", () => {
  function compaction(error) {
    return { type: "compaction/end", data: error === undefined ? { turn: 1 } : { turn: 1, error } };
  }

  function open(callId, groupName) {
    return [
      { type: "tool/call", data: { callId, name: "tool_list", arguments: JSON.stringify({ group: groupName }) } },
      {
        type: "tool/result",
        data: {
          message: {
            role: "tool",
            source: { kind: "tool", callId },
            toolCallId: callId,
            content: [{ type: "text", text: "{}" }],
            isError: false,
          },
        },
      },
    ];
  }

  function memberUse(callId, name) {
    return [
      { type: "tool/call", data: { callId, name, arguments: "{}" } },
      {
        type: "tool/result",
        data: {
          message: {
            role: "tool",
            source: { kind: "tool", callId },
            toolCallId: callId,
            content: [{ type: "text", text: "{}" }],
            isError: false,
          },
        },
      },
    ];
  }

  function host(events, policy) {
    const schema = (name) => ({ name, description: name, parameters: {} });
    const names = ["read", "github_issue", "web_search"];
    let restricted = new Set();
    let guard;
    const listeners = new Map();
    const log = [...events];
    const surface = { nodes: [] };
    const visible = () => names.filter((name) => !restricted.has(name)).map(schema);
    const scopedTools = {
      schemas: visible,
      register: () => () => {},
      restrict({ deny }) {
        restricted = new Set(deny);
        return () => { restricted = new Set(); };
      },
      guard(callback) {
        guard = callback;
        return () => {};
      },
    };
    const agent = {
      id: "session-compact",
      ctx: {
        get: (name) => (name === "tools" ? scopedTools : undefined),
        on: () => () => {},
      },
      session: {
        get seq() { return log.length; },
        eventAt: (seq) => (log[seq] === undefined ? undefined : { seq, ...log[seq] }),
        surface,
      },
    };
    const hostTools = {
      schemas: visible,
      register: () => () => {},
      restrict: () => () => {},
      async resolve() {
        return { dispose() {}, view: () => new Map(visible().map((item) => [item.name, item])) };
      },
    };
    const context = {
      get(name) {
        if (name === "tools") return hostTools;
        if (name === "agents") return { list: () => [agent] };
        return undefined;
      },
      on(event, listener) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return () => {};
      },
    };
    return {
      agent,
      context,
      hostTools,
      settings: { presets: { standard: policy } },
      get guard() {
        return guard;
      },
      get restricted() {
        return [...restricted];
      },
      preStep() {
        return listeners.get("agent/pre-step")[0];
      },
      sessionEvent() {
        return listeners.get("session/event")[0];
      },
      append(next, visibleSurface = false) {
        const start = log.length;
        log.push(...next);
        if (visibleSurface) {
          for (let seq = start; seq < log.length; seq += 1) surface.nodes.push(seq);
        }
      },
    };
  }

  const presets = { composedPreset: () => "standard" };
  const groups = [
    { name: "GitHub", patterns: ["github_*"] },
    { name: "Search", patterns: ["web_*"] },
  ];

  it("declares always-group members and never opens them", async () => {
    const h = host([], {
      disabled: [],
      groups: [{ name: "GitHub", patterns: ["github_*"], loading: "always" }],
    });
    const runtime = new ToolPolicyRuntime(h.context, presets, h.settings);
    runtime.start();

    assert.deepEqual(h.restricted, []);
    assert.equal(h.guard({ name: "github_issue" }), undefined);
    const set = await h.hostTools.resolve({ agent: h.agent });
    assert.deepEqual([...set.view().keys()], ["read", "github_issue", "web_search"]);
    await runtime.dispose();
  });

  it("hides off-group members and enforces group-level disables", async () => {
    const h = host([], {
      disabled: [],
      groups: [
        { name: "Search", patterns: ["web_*"], loading: "off" },
        { name: "GitHub", patterns: ["github_*"], loading: "always", disabled: ["github_issue"] },
      ],
    });
    const runtime = new ToolPolicyRuntime(h.context, presets, h.settings);
    runtime.start();

    assert.deepEqual(h.restricted, ["github_issue", "web_search"]);
    assert.match(h.guard({ name: "web_search" }), /group "Search" which is off/);
    assert.match(h.guard({ name: "github_issue" }), /disabled inside group "GitHub"/);
    const set = await h.hostTools.resolve({ agent: h.agent });
    assert.deepEqual([...set.view().keys()], ["read"]);
    await runtime.dispose();
  });

  it("restores only the recently used group after a recorded compaction", async () => {
    const h = host(
      [...open("a", "GitHub"), ...open("b", "Search"), ...memberUse("use", "web_search"), compaction()],
      { disabled: [], groups, keepAfterCompaction: 1 },
    );
    const runtime = new ToolPolicyRuntime(h.context, presets, h.settings);
    runtime.start();

    assert.deepEqual(h.restricted, ["github_issue"], "only the most recently used group stays open");
    assert.equal(h.guard({ name: "web_search" }), undefined);
    assert.match(h.guard({ name: "github_issue" }), /belongs to on-demand group "GitHub"/);
    await runtime.dispose();
  });

  it("narrows the live set when a compaction lands between steps", async () => {
    const h = host([...open("a", "GitHub"), ...open("b", "Search")], {
      disabled: [],
      groups,
      keepAfterCompaction: 1,
    });
    const runtime = new ToolPolicyRuntime(h.context, presets, h.settings);
    runtime.start();
    assert.deepEqual(h.restricted, [], "both groups are open before the compaction");

    const first = await h.preStep()({ agent: h.agent }, () => ({ kind: "enter", messages: [] }));
    assert.deepEqual(h.restricted, []);
    const firstCatalog = first.messages.find((message) => message.source?.kind === "tool-manager-catalog");
    assert.ok(firstCatalog, "the step sees the group catalog");
    // The step's messages reach the Session log; the surface makes the catalog
    // visible, so nothing would republish it without the reset.
    h.append([{ type: "user/message", data: firstCatalog }], true);

    h.append([compaction()]);
    const second = await h.preStep()({ agent: h.agent }, () => ({ kind: "enter", messages: [] }));

    assert.deepEqual(h.restricted, ["github_issue"], "the older group is closed again");
    assert.equal(h.guard({ name: "web_search" }), undefined);
    assert.match(h.guard({ name: "github_issue" }), /call tool_list with \{"group":"GitHub"\}/);
    const resetCatalog = second.messages.find((message) => message.source?.kind === "tool-manager-catalog");
    assert.ok(resetCatalog, "the catalog is republished even though its entries did not change");
    assert.match(resetCatalog.content[0].text, /The session was compacted, so some groups opened earlier were reset/);
    h.append([{ type: "user/message", data: resetCatalog }], true);

    // The explanation is one shot: the following step has nothing new to say.
    const third = await h.preStep()({ agent: h.agent }, () => ({ kind: "enter", messages: [] }));
    assert.equal(
      third.messages.some((message) => message.source?.kind === "tool-manager-catalog"),
      false,
    );
    await runtime.dispose();
  });

  it("narrows the step set resolved before pre-step, which is the real loop order", async () => {
    // `agent/pre-step` runs AFTER `tools.resolve()`: the request that follows a
    // `/compact` must already see the narrowed set, or the model keeps both
    // groups for one more step.
    const h = host([...open("a", "GitHub"), ...open("b", "Search")], {
      disabled: [],
      groups,
      keepAfterCompaction: 1,
    });
    const runtime = new ToolPolicyRuntime(h.context, presets, h.settings);
    runtime.start();

    h.append([compaction()]);
    const set = await h.hostTools.resolve({ agent: h.agent });
    assert.deepEqual([...set.view().keys()], ["read", "web_search"], "the older group is gone from the resolved set");
    await runtime.dispose();
  });

  it("narrows from the compaction event before any step resolves", async () => {
    const h = host([...open("a", "GitHub"), ...open("b", "Search")], {
      disabled: [],
      groups,
      keepAfterCompaction: 1,
    });
    const runtime = new ToolPolicyRuntime(h.context, presets, h.settings);
    runtime.start();
    assert.deepEqual(h.restricted, [], "both groups are open before the compaction");

    h.append([compaction()]);
    h.sessionEvent()(h.agent.session, { type: "compaction/end", seq: 4, data: {} });

    assert.deepEqual(h.restricted, ["github_issue"], "the event itself closes the older group");
    assert.equal(h.guard({ name: "web_search" }), undefined);
    await runtime.dispose();
  });

  it("closes a kept group when the next interval passes without touching it", async () => {
    const h = host([...open("a", "GitHub"), ...open("b", "Search")], {
      disabled: [],
      groups,
      keepAfterCompaction: 1,
    });
    const runtime = new ToolPolicyRuntime(h.context, presets, h.settings);
    runtime.start();

    h.append([compaction()]);
    const first = await h.hostTools.resolve({ agent: h.agent });
    assert.deepEqual([...first.view().keys()], ["read", "web_search"], "the first cut keeps the most recent group");

    h.append([compaction()]);
    const second = await h.hostTools.resolve({ agent: h.agent });
    assert.deepEqual([...second.view().keys()], ["read"], "the next interval retires the untouched group");
    assert.deepEqual(h.restricted, ["github_issue", "web_search"]);
    await runtime.dispose();
  });

  it("ignores the limit in mcp mode, which has no open state", async () => {
    const h = host([...open("a", "GitHub"), compaction()], {
      disabled: [],
      groups,
      mode: "mcp",
      keepAfterCompaction: 0,
    });
    const runtime = new ToolPolicyRuntime(h.context, presets, h.settings);
    runtime.start();
    await h.preStep()({ agent: h.agent }, () => ({ kind: "enter", messages: [] }));

    assert.deepEqual(h.restricted, []);
    assert.equal(h.guard({ name: "github_issue" }), undefined);
    await runtime.dispose();
  });
});
