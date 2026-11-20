import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { PromptToolAffinity, resetPromptAffinity } from "../dist/prompt-affinity.js";

class FakeSystemPrompt {
  sections = [];
  section(section) {
    this.sections.push(section.name);
    return () => {};
  }
}

class FakeTools {
  registered = [];
  register(definition) {
    this.registered.push(definition.name);
    return () => {};
  }
}

function services() {
  return { systemPrompt: new FakeSystemPrompt(), tools: new FakeTools() };
}

/** Minimal live-registry shape consumed by learnExisting(). */
function layeredServices(sectionNames, toolNames) {
  const { systemPrompt, tools } = services();
  systemPrompt.layers = {
    global: { sections: new Map(sectionNames.map((name) => [name, {}])) },
    scoped: new Map(),
  };
  tools.layers = {
    global: { tools: new Map(toolNames.map((name) => [name, {}])) },
    scoped: new Map(),
  };
  return { systemPrompt, tools };
}

function fakeFiber(source, effects, entry) {
  return {
    entry,
    runtime: { callback: new Function("ctx", source) },
    getEffects: () => effects.map((label) => ({ label })),
  };
}

function registry(...fibers) {
  return new Map([["runtime", { fibers }]]);
}

/** A service shadow whose `this.ctx` is the plugin context that owns the call. */
function asPlugin(service, fiber) {
  const shadow = Object.create(service);
  shadow.ctx = { fiber };
  return shadow;
}

describe("prompt affinity from registration identity", () => {
  beforeEach(() => {
    resetPromptAffinity();
  });

  it("attributes a family-named section to the tools its registering fiber adds", () => {
    const { systemPrompt, tools } = services();
    const affinity = PromptToolAffinity.shared();
    affinity.install(systemPrompt, tools);

    const jobs = {};
    asPlugin(systemPrompt, jobs).section({ name: "tool:jobs", text: "Track jobs." });
    for (const name of ["job_list", "job_output", "job_kill"]) {
      asPlugin(tools, jobs).register({ name });
    }

    assert.deepEqual(affinity.lookup("tool:jobs"), {
      owned: true,
      tools: ["job_list", "job_output", "job_kill"],
    });
    // Another section never registered has no owner, even when a tool stem matches.
    assert.deepEqual(affinity.lookup("tool:goal"), { owned: false, tools: [] });
  });

  it("keeps ownership when tools register after the section", () => {
    const { systemPrompt, tools } = services();
    const affinity = PromptToolAffinity.shared();
    affinity.install(systemPrompt, tools);

    const fiber = {};
    asPlugin(systemPrompt, fiber).section({ name: "tool:goal", text: "Use goals." });
    assert.deepEqual(affinity.lookup("tool:goal"), { owned: true, tools: [] });
    asPlugin(tools, fiber).register({ name: "get_goal" });
    asPlugin(tools, fiber).register({ name: "create_goal" });

    assert.deepEqual(affinity.lookup("tool:goal"), { owned: true, tools: ["get_goal", "create_goal"] });
  });

  it("does not attribute another plugin's tools to the section", () => {
    const { systemPrompt, tools } = services();
    const affinity = PromptToolAffinity.shared();
    affinity.install(systemPrompt, tools);

    const sectionFiber = {};
    const toolFiber = {};
    asPlugin(systemPrompt, sectionFiber).section({ name: "tool:pty", text: "Use a terminal." });
    asPlugin(tools, toolFiber).register({ name: "terminal_open" });
    asPlugin(tools, toolFiber).register({ name: "unrelated_tool" });

    // The section is owned, but by a fiber that registered no tools; the other
    // fiber's tools must not leak into it.
    assert.deepEqual(affinity.lookup("tool:pty"), { owned: true, tools: [] });
  });

  it("forgets a section or tool when its registration is disposed", () => {
    const { systemPrompt, tools } = services();
    const affinity = PromptToolAffinity.shared();
    affinity.install(systemPrompt, tools);

    const fiber = {};
    const disposeSection = asPlugin(systemPrompt, fiber).section({ name: "tool:session-query", text: "Search." });
    const disposeTool = asPlugin(tools, fiber).register({ name: "session_search" });
    assert.deepEqual(affinity.lookup("tool:session-query"), { owned: true, tools: ["session_search"] });

    disposeTool();
    assert.deepEqual(affinity.lookup("tool:session-query"), { owned: true, tools: [] });
    disposeSection();
    assert.deepEqual(affinity.lookup("tool:session-query"), { owned: false, tools: [] });
  });

  it("is idempotent when installed repeatedly", () => {
    const { systemPrompt, tools } = services();
    const affinity = PromptToolAffinity.shared();
    affinity.install(systemPrompt, tools);
    affinity.install(systemPrompt, tools);

    const fiber = {};
    asPlugin(systemPrompt, fiber).section({ name: "tool:schedule", text: "Schedule." });
    asPlugin(tools, fiber).register({ name: "schedule_create" });

    assert.deepEqual(affinity.lookup("tool:schedule"), { owned: true, tools: ["schedule_create"] });
  });
});

describe("prompt affinity recovery for sections mounted before install", () => {
  beforeEach(() => {
    resetPromptAffinity();
  });

  it("recovers a family from the registering callback and its effect order", () => {
    const { systemPrompt, tools } = layeredServices(
      ["tool:jobs", "tool:goal"],
      ["job_list", "job_output", "job_kill", "get_goal", "create_goal", "update_goal"],
    );
    const jobs = fakeFiber(
      `
        ctx.systemPrompt.section({ name: "tool:jobs", text: "Track jobs." });
        const list = defineTool({ name: "job_list" });
        const output = defineTool({ name: "job_output" });
        const kill = defineTool({ name: "job_kill" });
      `,
      ["systemPrompt.section()", "tools.register()", "tools.register()", "tools.register()"],
    );

    const affinity = new PromptToolAffinity();
    affinity.install(systemPrompt, tools, registry(jobs));

    assert.deepEqual(affinity.lookup("tool:jobs"), {
      owned: true,
      tools: ["job_list", "job_output", "job_kill"],
    });
    assert.deepEqual(affinity.lookup("tool:goal"), { owned: false, tools: [] });
  });

  it("pairs each section with the tool declared next to it", () => {
    const { systemPrompt, tools } = layeredServices(
      ["tool:read", "tool:write"],
      ["read", "write"],
    );
    const fs = fakeFiber(
      `
        ctx.systemPrompt.section({ name: "tool:read", text: "Read files." });
        const read = defineTool({ name: "read" });
        ctx.systemPrompt.section({ name: "tool:write", text: "Write files." });
        const write = defineTool({ name: "write" });
      `,
      ["systemPrompt.section()", "tools.register()", "systemPrompt.section()", "tools.register()"],
    );

    const affinity = new PromptToolAffinity();
    affinity.install(systemPrompt, tools, registry(fs));

    assert.deepEqual(affinity.lookup("tool:read"), { owned: true, tools: ["read"] });
    assert.deepEqual(affinity.lookup("tool:write"), { owned: true, tools: ["write"] });
  });

  it("does not infer a family from prompt prose", () => {
    const { systemPrompt, tools } = layeredServices(["tool:jobs"], ["job_output"]);
    const empty = fakeFiber(
      `ctx.systemPrompt.section({ name: "tool:jobs", text: "Use job_output when done." });`,
      ["systemPrompt.section()"],
    );

    const affinity = new PromptToolAffinity();
    affinity.install(systemPrompt, tools, registry(empty));

    assert.deepEqual(affinity.lookup("tool:jobs"), { owned: false, tools: [] });
  });

  it("recovers a Preset mounted after install when lookup first sees its layers", () => {
    const { systemPrompt, tools } = layeredServices([], []);
    const jobs = fakeFiber(
      `
        ctx.systemPrompt.section({ name: "tool:jobs", text: "Track jobs." });
        const list = defineTool({ name: "job_list" });
        const output = defineTool({ name: "job_output" });
        const kill = defineTool({ name: "job_kill" });
      `,
      ["systemPrompt.section()", "tools.register()", "tools.register()", "tools.register()"],
    );
    const affinity = new PromptToolAffinity();
    affinity.install(systemPrompt, tools, registry(jobs));

    // The profile plugin starts before the default Preset mounts; its scoped
    // layer becomes visible only when the first Agent is composed.
    const scope = {};
    systemPrompt.layers.scoped.set(scope, {
      sections: new Map([["tool:jobs", {}]]),
    });
    tools.layers.scoped.set(scope, {
      tools: new Map([
        ["job_list", {}],
        ["job_output", {}],
        ["job_kill", {}],
      ]),
    });

    assert.deepEqual(affinity.lookup("tool:jobs"), {
      owned: true,
      tools: ["job_list", "job_output", "job_kill"],
    });
  });

  it("keeps callback recovery idempotent across repeated installs", () => {
    const { systemPrompt, tools } = layeredServices(["tool:schedule"], ["schedule_create"]);
    const schedule = fakeFiber(
      `
        ctx.systemPrompt.section({ name: "tool:schedule", text: "" });
        const create = defineTool({ name: "schedule_create" });
      `,
      ["systemPrompt.section()", "tools.register()"],
    );

    const affinity = new PromptToolAffinity();
    affinity.install(systemPrompt, tools, registry(schedule));
    affinity.install(systemPrompt, tools, registry(schedule));

    assert.deepEqual(affinity.lookup("tool:schedule"), { owned: true, tools: ["schedule_create"] });
  });
});
