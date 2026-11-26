import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadClient() {
  let definition;
  const context = {
    window: {
      __ModuleLoader__: {
        load(value) { definition = value; },
      },
    },
    console,
  };
  vm.runInNewContext(readFileSync(new URL("../dist/client.js", import.meta.url), "utf8"), context);
  return definition.factory(() => ({}));
}

const client = loadClient();
const plain = (value) => JSON.parse(JSON.stringify(value));

/** One page state: a Preset policy plus the global generation choice. */
function page(generation) {
  return {
    presets: [{ id: "standard", policy: { disabled: ["read"], groups: [] } }],
    ...(generation ? { generation } : {}),
  };
}

const deploymentDefault = {
  provider: "magpie",
  model: "opencode-go/deepseek-v4.1-flash",
  reasoningEffort: "max",
};

describe("generation model payload", () => {
  it("sends an explicit null when no model or effort was chosen", () => {
    // A missing key means "an older page, leave the stored choice alone" to the
    // Host, so an empty choice has to be said out loud.
    assert.deepEqual(plain(client.settingsPayload(page(undefined))), {
      presets: { standard: { disabled: ["read"], groups: [] } },
      generation: null,
    });
  });

  it("round-trips a chosen model and its effort", () => {
    assert.deepEqual(plain(client.settingsPayload(page({
      provider: "magpie",
      model: "opencode-go/deepseek-v4.1-flash",
      reasoningEffort: "low",
    }))), {
      presets: { standard: { disabled: ["read"], groups: [] } },
      generation: { provider: "magpie", model: "opencode-go/deepseek-v4.1-flash", reasoningEffort: "low" },
    });
  });

  it("keeps an effort chosen while no model is pinned", () => {
    // The plugin keeps running the deployment default model and only overrides
    // how hard it thinks, which is what the page's effort picker stores.
    assert.deepEqual(plain(client.generationPayload({ generation: { reasoningEffort: " low " } })), {
      reasoningEffort: "low",
    });
    assert.deepEqual(plain(client.settingsPayload(page({ reasoningEffort: "low" })).generation), {
      reasoningEffort: "low",
    });
  });

  it("drops an incomplete route instead of persisting it", () => {
    assert.equal(client.generationPayload({ generation: { provider: "magpie" } }), null);
    assert.equal(client.generationPayload({ generation: { provider: "", model: "flash" } }), null);
    assert.equal(client.generationPayload({ generation: "magpie/flash" }), null);
    assert.equal(client.generationPayload({ generation: { reasoningEffort: "" } }), null);
    assert.equal(client.generationPayload({}), null);
    assert.equal(client.generationPayload(null), null);
  });

  it("trims and omits a blank effort", () => {
    assert.deepEqual(plain(client.generationPayload({
      generation: { provider: " magpie ", model: " flash ", reasoningEffort: "   " },
    })), { provider: "magpie", model: "flash" });
  });

  it("changes the save signature, so picking a model or a level marks the page dirty", () => {
    const before = JSON.stringify(client.settingsPayload(page(undefined)));
    assert.notEqual(before, JSON.stringify(client.settingsPayload(page({ provider: "magpie", model: "flash" }))));
    assert.notEqual(before, JSON.stringify(client.settingsPayload(page({ reasoningEffort: "low" }))));
  });
});

describe("effective generation model", () => {
  it("uses the deployment default when nothing is stored", () => {
    assert.deepEqual(plain(client.effectiveGenerationModel(null, deploymentDefault)), plain(deploymentDefault));
  });

  it("keeps the default route but overrides its level when only an effort is stored", () => {
    assert.deepEqual(plain(client.effectiveGenerationModel({ reasoningEffort: "low" }, deploymentDefault)), {
      provider: "magpie",
      model: "opencode-go/deepseek-v4.1-flash",
      reasoningEffort: "low",
    });
    // Nothing stored for the level: the deployment default's own one is shown,
    // so the picker names what the request will actually send.
    assert.deepEqual(
      plain(client.effectiveGenerationModel({ provider: "magpie", model: "flash" }, { ...deploymentDefault, reasoningEffort: "low" })),
      { provider: "magpie", model: "flash" },
    );
  });

  it("pins a stored route and drops the deployment default's level", () => {
    assert.deepEqual(plain(client.effectiveGenerationModel({ provider: "deepseek", model: "chat" }, deploymentDefault)), {
      provider: "deepseek",
      model: "chat",
    });
  });

  it("answers null when neither a stored route nor a default model exists", () => {
    assert.equal(client.effectiveGenerationModel(null, null), null);
    assert.equal(client.effectiveGenerationModel({ reasoningEffort: "low" }, null), null);
  });

  it("recognises the deployment default route", () => {
    assert.equal(client.isDefaultSelection({ provider: "magpie", model: "opencode-go/deepseek-v4.1-flash" }, deploymentDefault), true);
    assert.equal(client.isDefaultSelection({ provider: "magpie", model: "flash" }, deploymentDefault), false);
    assert.equal(client.isDefaultSelection(null, deploymentDefault), false);
    assert.equal(client.isDefaultSelection({ provider: "magpie", model: "x" }, null), false);
  });
});

describe("carrying the level across a model switch", () => {
  const four = [{ id: "off" }, { id: "low" }, { id: "high" }, { id: "max" }];
  const three = [{ id: "low" }, { id: "high" }, { id: "max" }];

  it("keeps a level the new model declares", () => {
    assert.equal(client.carryReasoningEffort("low", three, four), "low");
    assert.equal(client.carryReasoningEffort("max", four, three), "max");
  });

  it("maps an undeclared level onto the same position of the new list", () => {
    // Off on a four-step model is the cheapest step; the three-step model's
    // cheapest is Low, not the deployment default's Max.
    assert.equal(client.carryReasoningEffort("off", four, three), "low");
    assert.equal(client.carryReasoningEffort("high", four, three), "high");
    assert.equal(client.carryReasoningEffort("low", three, four), "low");
  });

  it("prefers the new model's own default when it declares one", () => {
    assert.equal(client.carryReasoningEffort("off", four, three, "high"), "high");
    assert.equal(client.carryReasoningEffort("max", four, three, "bogus"), "max");
  });

  it("drops a level the new model cannot express at all", () => {
    assert.equal(client.carryReasoningEffort("off", four, []), "");
    assert.equal(client.carryReasoningEffort("off", four, undefined), "");
  });

  it("leaves an unset level unset", () => {
    assert.equal(client.carryReasoningEffort("", four, three), "");
    assert.equal(client.carryReasoningEffort(undefined, four, three), "");
    // A level the previous model never listed still lands on the cheapest step.
    assert.equal(client.carryReasoningEffort("turbo", four, three), "low");
  });
});

describe("generation model picker values", () => {
  it("encodes provider and model ids that contain separators", () => {
    const choice = { provider: "magpie", model: "opencode-go/deepseek-v4.1-flash" };
    const value = client.generationModelValue(choice);
    assert.equal(typeof value, "string");
    assert.deepEqual(plain(client.parseGenerationModelValue(value)), choice);
  });

  it("treats an empty or unset route as nothing to decode", () => {
    assert.equal(client.generationModelValue(null), "");
    assert.equal(client.generationModelValue({ provider: "", model: "" }), "");
    assert.equal(client.generationModelValue({ reasoningEffort: "low" }), "");
    assert.equal(client.parseGenerationModelValue(""), null);
    assert.equal(client.parseGenerationModelValue("not json"), null);
    assert.equal(client.parseGenerationModelValue('["only-provider"]'), null);
    assert.equal(client.parseGenerationModelValue('["p",""]'), null);
    assert.equal(client.parseGenerationModelValue('[1,2]'), null);
  });
});

describe("generation model labels", () => {
  const catalog = {
    groups: [
      {
        id: "magpie",
        name: "Magpie",
        models: [
          { id: "opencode-go/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash 1017 · OpenCode Go", reasoning: { efforts: [{ id: "low", name: "Low" }, { id: "max", name: "Max" }] } },
          { id: "flash", name: "Flash" },
        ],
      },
      { id: "retired", name: "Retired", models: [{ id: "ghost", name: "Ghost" }] },
    ],
  };

  it("names the model the request will run, the way the picker does", () => {
    // The sentence prints a level exactly when the picker has one selected, so
    // following the default model (which runs ITS level) reads the same in both.
    assert.equal(
      client.generationTargetLabel(null, deploymentDefault, catalog),
      "「DeepSeek V4.1 Flash 1017 · OpenCode Go · 推理 Max」",
    );
    assert.equal(
      client.generationTargetLabel({ reasoningEffort: "low" }, deploymentDefault, catalog),
      "「DeepSeek V4.1 Flash 1017 · OpenCode Go · 推理 Low」",
    );
    // A pinned route with no level chosen sends no effort, so none is named.
    assert.equal(
      client.generationTargetLabel({ provider: "magpie", model: "flash" }, deploymentDefault, catalog),
      "「Flash」",
    );
  });

  it("falls back to the route when the catalog cannot name it", () => {
    assert.equal(
      client.generationTargetLabel({ provider: "magpie", model: "flash" }, deploymentDefault),
      "「magpie/flash」",
    );
    // A level the catalog does not list is printed as the raw id.
    assert.equal(
      client.generationTargetLabel({ provider: "magpie", model: "flash", reasoningEffort: "turbo" }, deploymentDefault, catalog),
      "「Flash · 推理 turbo」",
    );
  });

  it("says so when no model can be named at all", () => {
    assert.equal(client.generationTargetLabel(undefined, undefined), "未配置的模型");
  });

  it("finds a catalog entry only for the exact route", () => {
    assert.equal(client.findModelEntry(catalog, { provider: "magpie", model: "flash" }).id, "flash");
    assert.equal(client.findModelEntry(catalog, { provider: "magpie", model: "chat" }), null);
    assert.equal(client.findModelEntry(catalog, { provider: "retired", model: "flash" }), null);
    assert.equal(client.findModelEntry(null, { provider: "magpie", model: "flash" }), null);
    assert.equal(client.findModelEntry(catalog, null), null);
  });
});
