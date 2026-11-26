import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readModelCatalog } from "../dist/index.js";
import { settingsForSave } from "../dist/policy.js";

const catalog = (overrides) => ({
  listProviders: () => [{ id: "magpie", name: "Magpie" }, { id: "deepseek", name: "DeepSeek" }],
  listModels: async (provider) => {
    if (provider === "magpie") return [
      { provider, id: "flash", name: "Flash" },
      { provider, id: "pro", name: "Pro", description: "slower" },
    ];
    if (provider === "deepseek") return [{ provider, id: "chat", name: "Chat" }];
    throw new Error(`unknown provider ${provider}`);
  },
  resolveModelInfo: async (provider, model) => ({
    provider,
    id: model,
    name: model,
    ...(model === "pro"
      ? { reasoning: { efforts: [{ id: "max", name: "Max" }, { id: "low", name: "Low", description: "fast" }] } }
      : {}),
  }),
  ...overrides,
});

describe("readModelCatalog", () => {
  it("groups models per provider and carries each model's efforts", async () => {
    const view = await readModelCatalog(catalog());
    assert.deepEqual(view, {
      groups: [
        {
          id: "magpie",
          name: "Magpie",
          models: [
            { id: "flash", name: "Flash" },
            { id: "pro", name: "Pro", description: "slower", reasoning: { efforts: [{ id: "max", name: "Max" }, { id: "low", name: "Low", description: "fast" }] } },
          ],
        },
        { id: "deepseek", name: "DeepSeek", models: [{ id: "chat", name: "Chat" }] },
      ],
      failures: [],
    });
  });

  it("reports a provider whose catalog cannot be read instead of dropping it", async () => {
    const view = await readModelCatalog(catalog({
      listModels: async (provider) => {
        if (provider === "magpie") throw new Error("provider unreachable");
        return [{ provider, id: "chat", name: "Chat" }];
      },
    }));
    assert.deepEqual(view.groups.map((group) => group.id), ["deepseek"]);
    assert.deepEqual(view.failures, [{ id: "magpie", name: "Magpie", message: "provider unreachable" }]);
  });

  it("keeps a model listed when its exact metadata cannot be resolved", async () => {
    const view = await readModelCatalog(catalog({
      resolveModelInfo: async () => { throw new Error("metadata unavailable"); },
    }));
    assert.deepEqual(view.groups[0].models, [
      { id: "flash", name: "Flash" },
      { id: "pro", name: "Pro", description: "slower" },
    ]);
  });

  it("omits providers with no models and tolerates a Host without a catalog API", async () => {
    const empty = await readModelCatalog(catalog({ listModels: async () => [] }));
    assert.deepEqual(empty, { groups: [], failures: [] });
    assert.deepEqual(await readModelCatalog({ stream: async function* () {} }), { groups: [], failures: [] });
  });

  it("ignores invalid reasoning metadata instead of offering unusable efforts", async () => {
    const view = await readModelCatalog(catalog({
      resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model, reasoning: { efforts: [] } }),
    }));
    assert.equal(view.groups[0].models[0].reasoning, undefined);
  });
});

describe("settingsForSave", () => {
  const stored = { presets: { standard: { disabled: ["read"], groups: [] } }, generation: { provider: "magpie", model: "flash" } };

  it("keeps the stored generation model when an older page omits the key", () => {
    assert.deepEqual(settingsForSave({ presets: { standard: { disabled: [], groups: [] } } }, stored), {
      presets: { standard: { disabled: [], groups: [] } },
      generation: { provider: "magpie", model: "flash" },
    });
    // Only the generation choice survives an absent payload; presets always come
    // from the request, exactly as before this setting existed.
    assert.deepEqual(settingsForSave(undefined, stored), {
      presets: {},
      generation: { provider: "magpie", model: "flash" },
    });
  });

  it("clears the generation model on an explicit null", () => {
    assert.deepEqual(settingsForSave({ presets: {}, generation: null }, stored), { presets: {} });
  });

  it("replaces the generation model with the submitted one", () => {
    assert.deepEqual(settingsForSave({ presets: {}, generation: { provider: "deepseek", model: "chat", reasoningEffort: "low" } }, stored), {
      presets: {},
      generation: { provider: "deepseek", model: "chat", reasoningEffort: "low" },
    });
  });

  it("does not invent a generation model when none was stored", () => {
    assert.deepEqual(settingsForSave({ presets: {} }, { presets: {} }), { presets: {} });
  });
});
