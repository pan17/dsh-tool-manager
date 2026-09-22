import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot, mergeSchemas } from "../dist/snapshot.js";

function schema(name, description = name) {
  return { name, description, parameters: {} };
}

describe("snapshot schema merging", () => {
  it("includes agent-scoped tools missing from the standing preset view", () => {
    const merged = mergeSchemas(
      [schema("read"), schema("subagent_fork")],
      [schema("subagent", "agent-scoped delegation"), schema("read", "newer scoped schema")],
    );

    assert.deepEqual(merged.map((item) => item.name), ["read", "subagent_fork", "subagent"]);
    assert.equal(merged.find((item) => item.name === "read").description, "newer scoped schema");
  });

  it("reads standing schemas through acquireScope and always releases the lease", async () => {
    const released = [];
    const presets = {
      async compositionInventory() {
        return [{ id: "standard", isDefault: true }];
      },
      async acquireScope(id) {
        assert.equal(id, "standard");
        return {
          key: "standing-standard",
          async [Symbol.asyncDispose]() {
            released.push(id);
          },
        };
      },
    };
    const tools = {
      schemas(key) {
        assert.equal(key, "standing-standard");
        return [schema("read"), schema("tool_list"), schema("run_code")];
      },
    };

    const snapshot = await buildSnapshot(presets, tools, { presets: {} }, 1, "/tmp/tool-manager.json");

    assert.deepEqual(snapshot.presets.map((item) => item.id), ["standard"]);
    assert.deepEqual(snapshot.presets[0].tools.map((item) => item.name), ["read"]);
    assert.equal(snapshot.presets[0].trust, "system");
    assert.deepEqual(released, ["standard"]);
  });

  it("still releases the standing lease when schema projection throws", async () => {
    const released = [];
    const presets = {
      async compositionInventory() {
        return [{ id: "standard", isDefault: true }];
      },
      async acquireScope() {
        return {
          key: "standing-standard",
          async [Symbol.asyncDispose]() {
            released.push("standard");
          },
        };
      },
    };
    const tools = {
      schemas() {
        throw new Error("schemas unavailable");
      },
    };

    const snapshot = await buildSnapshot(presets, tools, { presets: {} }, 1, "/tmp/tool-manager.json");

    assert.equal(snapshot.presets[0].broken, "schemas unavailable");
    assert.deepEqual(released, ["standard"]);
  });
});
