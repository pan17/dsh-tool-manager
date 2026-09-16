# dsh-tool-manager

一个面向 DeepSeek Harness（DSH）的工具策略插件：

- 在 WebUI 的「设置 → 工具管理」中按 Agent Preset 查看和开关工具；
- 将一组低频工具折叠为按需组，模型默认只看到一个 `tool_list`；
- 模型调用 `tool_list({ group: "..." })` 后，该组工具在当前会话里一直可用；
- 设置页用筛选 + 勾选把工具放进组；旧配置里的 `*` 通配符仍然有效。

策略层只裁剪 **模型上下文中的 schema** 和 Agent 调用权限。MCP 进程是否常驻仍由 Cordis composition 决定。设计背景见 [DESIGN.md](./DESIGN.md)。

## 为什么可行

DSH 的 `ToolRuntime` 已提供统一能力：

- `tools.schemas(scope)`：读取某个 Agent/Preset 可见的工具 schema；
- `agent.ctx.tools.restrict({ deny })`：在 Agent scope 中同时隐藏 schema、lookup 和 dispatch；
- scope-local `tools.register()`：为每个 Agent 注册 `tool_list`，不污染其他 Agent；
- `tools/change` 与逐 step 的 prompt assembly：限制变化会在下一个模型步骤生效；
- MCP 客户端最终也注册到同一个 `ctx.tools`，公开名为 `mcp__<server>__<tool>`。

所以不需要给每一种插件/MCP 写单独开关器。工具进入统一 registry 后即可治理。

## 安装

当前包还没发到 npm。本地安装要用 **正斜杠 `link:`**，和本机已装的 `dsh-wechat` 一样：

```bash
dsh plugin --profile web add link:F:/project_pan/dsh-pan-plugin-collection/dsh-tool-manager
```

不要写成 `F:\project_pan\...\dsh-tool-manager`：Windows 的 `\t` 会被当成 Tab，pnpm 就会去网上解析一个错包名，卡在 `Progress: resolved 6`。

另外，`dsh plugin add` 会在整个 profile 上跑 `pnpm add`。如果 profile 里已经有 `github:` 皮肤包，pnpm 会重新去 GitHub 拉 tarball，看起来也像卡住。这时不要等，Ctrl+C，然后手工写入（本机 web profile 已按这个方式装好）：

1. `profiles/web/package.json` 的 `dependencies` 加  
   `"dsh-tool-manager": "link:F:/project_pan/dsh-pan-plugin-collection/dsh-tool-manager"`
2. 同一文件的 `dsh.profile.bundles` 加上 `"dsh-tool-manager"`
3. `node_modules/dsh-tool-manager` 做成指向源码目录的 junction
4. **重启 DSH**

这个包和 `dsh-wechat` 一样是 **零运行时 `@deepseek-ai` 依赖**：DSH 服务全部通过 `ctx.get` / `ctx.inject` 读取。不要把 `@deepseek-ai/*` 写进本包 `dependencies`。

装上之后：

1. `cordis.patch.yml` 把 Host 插件挂进组合；
2. `dsh.client` 把 `dist/client.js` 注入 WebUI。

如果 pnpm 拒绝跑 `prepare`/`build`（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`），在该 profile 的 `pnpm-workspace.yaml` 加上后再重跑同一条命令：

```yaml
allowBuilds:
  dsh-tool-manager: true
```

装完后 **重启对应 Profile**。然后打开 WebUI（默认 `http://127.0.0.1:3080`）→ **设置 → 工具管理**。

升级 / 卸载：

```bash
dsh plugin --profile web update dsh-tool-manager
dsh plugin --profile web remove dsh-tool-manager
```

开发时自己构建：

```bash
npm install
npm run build
npm test
```

## 使用

1. 打开 **设置 → 工具管理**。
2. 选择一个 Preset。
3. 关闭不希望该 Preset 使用的工具。
4. 新建或编辑按需工具组，筛选并勾选要收进去的工具；也可点击“自动生成名称和描述”，让当前默认模型根据所选工具填写草稿。
5. 检查或修改生成结果后确定，再保存。
6. 模型平时只看到 `tool_list`；需要某组工具时用 **名称** 调用，该组全部工具立刻打开：

```json
{ "group": "GitHub MCP" }
```

## 策略存储

策略使用独立 JSON 文件，不写入 DSH Settings：

- 默认路径：`$DSH_HOME/tool-manager.json`；未设置 `DSH_HOME` 时为 `~/.dsh/tool-manager.json`；
- 可用环境变量 `DSH_TOOL_MANAGER_CONFIG` 指定其他路径；
- 文件会在 WebUI 第一次保存时自动创建，页面也会显示当前实际路径；
- 写入采用临时文件替换，且保存请求携带 revision，避免并发页面覆盖新配置。

```json
{
  "presets": {
    "standard": {
      "disabled": ["codex_image_generate"],
      "groups": [
        {
          "name": "GitHub MCP",
          "description": "GitHub 相关工具",
          "patterns": [
            "mcp__github__create_issue",
            "mcp__github__list_issues"
          ]
        }
      ]
    }
  }
}
```

从旧版升级时，原 Settings `tool-manager` namespace 不会被自动迁移或删除；请在升级前导出原策略，或在新页面中重新保存。`disabled` 优先级高于组打开；即使同一个工具也被某个 group 匹配，显式关闭仍不会被 `tool_list` 解锁。打开后的组在当前 Agent 会话里一直可用，不会按步数收回。

“自动生成名称和描述”适用于新建和编辑分组，会把所选工具的名称与描述发送给 DSH 当前默认模型，因此会产生一次模型调用和相应模型用量。生成内容只回填当前弹窗，不会自动确定或写入配置文件；模型未配置、调用失败或输出无效时，已选工具和手工草稿都会保留。

工具目录上的“自动分组”会将当前 Preset 中**尚未加入任何按需组且未关闭**的工具发送给默认模型，由模型按能力和使用场景聚类，并为每个新组生成名称与描述。结果会先显示预览；取消不会修改草稿，确认后也只加入页面草稿，仍需点击“保存”才写入配置。已有分组和已关闭工具不会被移动，模型未归组的工具继续保持常开。

工具目录会独立显示五项统计：工具总量、分组数量、未分组工具、按需工具和已关闭工具。分组数量包含空组；orphan 关闭项不计入已关闭工具。同一个工具即使被多个组匹配也只统计一次，且显式关闭优先，所以对当前真实工具目录始终满足 `未分组工具 + 按需工具 + 已关闭工具 = 工具总量`。“未分组工具”与自动分组的候选范围一致。

## 当前边界

- 策略按 Preset 定义，但实时应用于该 Preset 的每个 live Agent；
- 修改策略不会改写 shipped preset 文件；
- 插件 row 本身是否启动（例如 MCP 进程是否常驻）仍由 Cordis composition 决定；
- WebUI 当前通过同源 HTTP API 读写独立配置文件；设置页会为列出 schema 而 standing-mount 尚未挂载的 Preset；
- 按需组说明走 skill 同款会话目录：`agent/pre-step` 写入一条持久的 `<system-reminder>` 用户消息，不依赖系统提示段。极简模式的 `complete: true` persona 因此也能看到组名；标准模式不再往系统提示后部塞第二份名单。

## 开发状态

当前版本包含：

- Host 策略运行时，按 Agent 隔离曝光状态；
- 仅在存在按需组时注册 `tool_list`，并在下一步注入 skill 式组目录；
- 设置页用筛选 + 勾选维护组员；旧 `*` 通配符仍可匹配；
- 组被打开后在当前会话一直可用；
- `tools/change` 后刷新 inherited baseline；
- WebUI 设置页：搜索、筛选、组内勾选、orphan 清理；
- Settings 持久化与 revision 冲突保护；
- 策略纯函数测试。
