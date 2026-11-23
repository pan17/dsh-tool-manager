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

describe("saveBlockReason", () => {
  it("returns null when the save can proceed", () => {
    assert.equal(
      client.saveBlockReason({ busy: false, autoGrouping: false, writable: true, dirty: true }),
      null,
    );
  });

  it("names the read-only config as the reason", () => {
    const reason = client.saveBlockReason({ busy: false, autoGrouping: false, writable: false, dirty: true });
    assert.match(reason, /不可写/);
  });

  it("names the missing edits as the reason", () => {
    const reason = client.saveBlockReason({ busy: false, autoGrouping: false, writable: true, dirty: false });
    assert.match(reason, /没有需要保存的修改/);
  });

  it("names the in-flight operation as the reason", () => {
    assert.match(
      client.saveBlockReason({ busy: true, autoGrouping: false, writable: true, dirty: true }),
      /正在处理/,
    );
    assert.match(
      client.saveBlockReason({ busy: false, autoGrouping: true, writable: true, dirty: true }),
      /自动分组/,
    );
  });

  it("reports the read-only config before the in-flight operation", () => {
    // The reader must be told the thing they cannot fix by waiting.
    const reason = client.saveBlockReason({ busy: true, autoGrouping: true, writable: false, dirty: true });
    assert.match(reason, /不可写/);
  });
});

describe("errorPresetId", () => {
  const ids = ["standard", "ptc", "cordis"];

  it("extracts the preset named by a client-side validation error", () => {
    assert.equal(
      client.errorPresetId("Preset \u201ccordis\u201d中的已关闭工具\u201cglob\u201d不能加入分组\u201c浏览器\u201d。", ids),
      "cordis",
    );
  });

  it("extracts the preset named by a server-side validation error", () => {
    assert.equal(
      client.errorPresetId('Preset "standard" has empty tool groups: "\u7ec4". Each group must contain at least one available tool.', ids),
      "standard",
    );
  });

  it("ignores a quoted group or tool name that is not a preset id", () => {
    assert.equal(
      client.errorPresetId("Preset \u201cmissing\u201d has empty tool groups: \u201c\u7ec4\u201d.", ids),
      null,
    );
  });

  it("returns null when the message names no preset at all", () => {
    assert.equal(client.errorPresetId("tool-manager config changed (expected revision 3, current 4); refresh and retry", ids), null);
  });
});
