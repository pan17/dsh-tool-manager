import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { ToolManagerConfigStore, resolveConfigPath } from "../dist/config.js";

describe("tool-manager config store", () => {
  it("resolves explicit path before DSH_HOME", () => {
    assert.equal(
      resolveConfigPath({ DSH_TOOL_MANAGER_CONFIG: "custom/tools.json", DSH_HOME: "ignored" }, "home"),
      resolve("custom/tools.json"),
    );
    assert.equal(
      resolveConfigPath({ DSH_HOME: "dsh-home" }, "ignored"),
      join(resolve("dsh-home"), "tool-manager.json"),
    );
    assert.equal(
      resolveConfigPath({}, "home"),
      join("home", ".dsh", "tool-manager.json"),
    );
  });

  it("starts empty and persists normalized policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-tool-manager-"));
    const path = join(root, "nested", "tool-manager.json");
    try {
      const store = new ToolManagerConfigStore(path);
      assert.deepEqual(store.get(), { presets: {} });
      assert.equal(store.revision, 0);
      await store.replace({
        presets: {
          standard: {
            disabled: ["read", "read"],
            groups: [{ name: "Web", patterns: ["web_*"] }],
          },
        },
      }, 0);
      assert.equal(store.revision, 1);
      assert.deepEqual(JSON.parse(await readFile(path, "utf8")), store.get());
      await store.replace({ presets: {} }, 1);
      assert.equal(store.revision, 2);
      assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { presets: {} });
      assert.deepEqual(new ToolManagerConfigStore(path).get(), store.get());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects stale writes and malformed JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-tool-manager-"));
    const path = join(root, "tool-manager.json");
    try {
      const store = new ToolManagerConfigStore(path);
      await assert.rejects(() => store.replace({ presets: {} }, 1), /expected revision 1, current 0/);
      await writeFile(path, "{broken", "utf8");
      assert.throws(() => new ToolManagerConfigStore(path), /failed to parse tool-manager config/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
