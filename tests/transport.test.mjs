import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateToolTokens } from "../dist/stats.js";
import { measurePresetTokens } from "../dist/transport.js";

const definitions = [
  { name: "read", description: "Read a file", parameters: { type: "object" }, output: { schema: { type: "string" } } },
  { name: "web_search", description: "Search the web", parameters: { type: "object" }, output: { schema: { type: "string" } } },
];

const render = (list) => "tools = {" + list.map((tool) => tool.name + ":" + JSON.stringify(tool.output.schema)).join(",") + "}";

function ptcRuntime(overrides = {}) {
  const executor = {
    renderSdk: render,
    describe: () => ({ schemas: [{ name: "run_code", description: "Run TypeScript", parameters: { type: "object" } }] }),
    sections: [{ name: "tools:ptc-only", text: "Instruction text here" }, { name: "tools:sdk", text: render }],
    ...overrides,
  };
  return {
    definitions: () => definitions,
    selectExecutor: () => executor,
    schemas: () => definitions,
  };
}

describe("tool-manager transport pricing", () => {
  it("has no model for a Host that only projects JSON schemas", () => {
    assert.equal(measurePresetTokens({ schemas: () => definitions }, "scope"), undefined);
    assert.equal(measurePresetTokens({ definitions: () => definitions }, "scope"), undefined);
  });

  it("prices the rendered SDK text plus the transport call and its instruction", () => {
    const model = measurePresetTokens(ptcRuntime(), "scope");
    const fixed = estimateToolTokens({ name: "run_code", description: "Run TypeScript", parameters: { type: "object" } })
      + Math.ceil("Instruction text here".length / 4);

    assert.equal(model.transport, "ptc");
    assert.equal(model.totalTokens, Math.ceil(render(definitions).length / 4) + fixed);
  });

  it("prices one tool by its own member block", () => {
    const model = measurePresetTokens(ptcRuntime(), "scope");
    const scaffold = Math.ceil(render([]).length / 4);

    assert.equal(model.marginal("read"), Math.ceil(render([definitions[0]]).length / 4) - scaffold);
    assert.equal(model.marginal("absent"), undefined);
  });

  it("prices the roster in one pass instead of once per tool", () => {
    let renders = 0;
    const roster = Array.from({ length: 40 }, (_, index) => ({
      name: "tool_" + index,
      description: "Tool " + index,
      parameters: { type: "object" },
      output: { schema: { type: "string" } },
    }));
    const runtime = {
      definitions: () => roster,
      selectExecutor: () => ({ renderSdk: (list) => { renders += 1; return render(list); }, sections: [] }),
    };

    const model = measurePresetTokens(runtime, "one-pass");
    // One render for the whole roster, one for the bare scaffold, one per tool:
    // the leave-one-out loop this replaced rendered the whole roster per tool.
    assert.ok(renders <= roster.length + 2, "rendered " + renders + " times for " + roster.length + " tools");
    const rows = roster.reduce((sum, tool) => sum + (model.marginal(tool.name) ?? 0), 0);
    assert.ok(rows <= model.totalTokens, "the rows must not outgrow the total");
  });

  it("falls back to no model when the renderer throws", () => {
    const runtime = ptcRuntime({ renderSdk: () => { throw new Error("no sdk"); } });
    assert.equal(measurePresetTokens(runtime, "scope"), undefined);
  });

  it("reuses the priced model across requests until the definitions change", () => {
    let renders = 0;
    let current = definitions;
    const executor = {
      renderSdk: (list) => { renders += 1; return render(list); },
      describe: () => ({ schemas: [{ name: "run_code", description: "Run TypeScript", parameters: { type: "object" } }] }),
      sections: [],
    };
    // Every request leases its own scope key and resolves the services again, so
    // reuse must not hinge on either: the Host's registered executor is the one
    // thing that outlives a request, which is what the cache is keyed by.
    const request = () => ({ definitions: () => current, selectExecutor: () => executor });

    const first = measurePresetTokens(request(), { lease: 1 });
    const afterFirst = renders;
    const second = measurePresetTokens(request(), { lease: 2 });
    assert.equal(renders, afterFirst, "an unchanged roster must not render again");
    assert.equal(second.totalTokens, first.totalTokens);

    current = [...definitions, { name: "edit", description: "Edit a file", parameters: { type: "object" }, output: { schema: { type: "string" } } }];
    measurePresetTokens(request(), { lease: 3 });
    assert.ok(renders > afterFirst, "a changed roster must be re-rendered");
  });

  it("keeps a tool that has no description in the roster", () => {
    const bare = { name: "bare", parameters: { type: "object" } };
    const runtime = {
      definitions: () => [bare, ...definitions],
      selectExecutor: () => ({ renderSdk: (list) => render(list.map((tool) => ({ ...tool, output: tool.output ?? { schema: null } }))), sections: [] }),
    };

    const model = measurePresetTokens(runtime, "scope-with-bare-tool");
    assert.ok(model.totalTokens > 0);
    assert.notEqual(model.marginal("bare"), undefined);
  });

  it("falls back to no model when there are no definitions to price", () => {
    const runtime = { definitions: () => [], selectExecutor: () => ptcRuntime().selectExecutor() };
    assert.equal(measurePresetTokens(runtime, "scope"), undefined);
  });
});
