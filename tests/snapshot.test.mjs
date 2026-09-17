import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeSchemas } from "../dist/snapshot.js";

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
});
