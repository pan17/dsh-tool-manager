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

  it("prices one tool by rendering the roster without it", () => {
    const model = measurePresetTokens(ptcRuntime(), "scope");
    const full = Math.ceil(render(definitions).length / 4);
    const withoutRead = Math.ceil(render(definitions.slice(1)).length / 4);

    assert.equal(model.marginal("read"), full - withoutRead);
    assert.equal(model.marginal("absent"), undefined);
  });

  it("falls back to no model when the renderer throws", () => {
    const runtime = ptcRuntime({ renderSdk: () => { throw new Error("no sdk"); } });
    assert.equal(measurePresetTokens(runtime, "scope"), undefined);
  });

  it("reuses the rendered model until the definitions change", () => {
    let renders = 0;
    let current = definitions;
    const runtime = {
      definitions: () => current,
      selectExecutor: () => ({
        renderSdk: (list) => { renders += 1; return render(list); },
        describe: () => ({ schemas: [{ name: "run_code", description: "Run TypeScript", parameters: { type: "object" } }] }),
        sections: [],
      }),
    };

    const first = measurePresetTokens(runtime, "memo-scope");
    const afterFirst = renders;
    const second = measurePresetTokens(runtime, "memo-scope");
    assert.equal(renders, afterFirst, "an unchanged roster must not render again");
    assert.equal(second.totalTokens, first.totalTokens);

    current = [...definitions, { name: "edit", description: "Edit a file", parameters: { type: "object" }, output: { schema: { type: "string" } } }];
    measurePresetTokens(runtime, "memo-scope");
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
