# DSH 组合切换竞态：创造模式丢失 `subagent` / `list_subagent_models`

## 症状

在“标准模式”新建会话后切换到“创造模式”（preset `cordis`），该会话的工具列表里没有：

- `subagent`
- `list_subagent_models`

而同一个 preset 的其他工具（`subagent_fork`、`send_message`、`interrupt_agent`、`list_agents`、`cordis_inspect_list` 等）都正常。该会话之后一直缺少这两个工具，直到重新打开会话（重建 Agent）。

## 已确认的事实（来自本机会话日志）

会话持久化文件里每个 Agent 的**首次请求**都会记录 `request/header`，其中 `data.header.tools` 就是真正发给模型的工具清单。

| 会话 | 所在 Host 运行段 | 首个主请求工具数 | `subagent` | `list_subagent_models` |
| --- | --- | ---: | --- | --- |
| 10 个 cordis 会话（共 14 次请求） | 9/18 08:34–10:34 那一轮 | 33 | 缺失 | 缺失 |
| 本会话（4a0a7d3e） | 9/18 10:35 之后那一轮 | 35 | 有 | 有 |
| 标准模式会话 | 同上 | 32 | 有 | 有 |

（同一轮里每一次“标准→创造模式”的会话都是 33，且整个会话期间都是 33；本会话是那一轮里唯一一次该切换。）

关键点：

1. 缺少的永远是这两个工具，而它们正好是 preset 里 `modelSelectionSettings: true` 那一行**按 Agent 注册**的工具；`subagent_fork` 来自同一插件但走 standing 注册，所以不受影响。
2. 出问题的会话在切换后策略配置是**空的**（`tool-manager.json` 中 `standard` / `cordis` 的 `disabled` 都是 `[]`，mtime 早于这些会话的创建时间）。因此这不是本插件的开关策略、也不是 `restrict()` / `guard` / `system-prompt/assemble` 过滤造成的——工具在 registry 层面就从未注册成功。
3. 同一 preset 的**新会话**（从未切过 mode）正常；只有“先按默认 preset 创建、再切到目标 preset”的会话会丢。而 WebUI 的建会话流程正是“按默认 preset 创建，再 `select` 目标 preset”。

### 为什么可以排除“按需分组隐藏”

按需（on-demand）分组同样能让工具从请求里消失，所以要单独排除：

- 这些 33 工具的请求里**没有 `tool_list`**。插件的 `denyNames()`（[`src/policy.ts`](../src/policy.ts)）只在“当前 Preset 没有任何可用按需分组”时才隐藏 `tool_list`；
- 若存在包含 `subagent` / `list_subagent_models` 的分组，该分组就是可用分组，`tool_list` 会被保留并出现在请求里；
- 因此这些会话不存在任何隐藏这两个工具的按需分组，`disabled` 也为空 ⇒ 它们不是“被隐藏”，而是**没有注册**。

## 机制

涉及 DSH 自身的三个事实（路径为该部署的安装目录）：

1. `@deepseek-ai/dsh-agent-presets` 为**每个 preset 维护一份永久 standing composition**；`recompose()`（`lib/index.js` 1693-1707）只做一次 scope 父链重挂，然后发出**一次** `tools/change`。

2. `@deepseek-ai/dsh-tool-subagent` 在 `modelSelectionSettings: true` 时走“按 Agent 安装”分支（`lib/index.js` 606-659）：

   ```js
   const installScoped = (candidate) => {
     const existing = scopedInstalls.get(candidate);
     if (existing !== void 0) return existing;          // ← 失败也会被记住
     ...
     fiber = candidate.ctx.inject(["tools", "subagents", "systemPrompt"], (runtimeCtx) => {
       install(runtimeCtx, policy);                      // 注册 subagent / list_subagent_models
     });
     scopedInstalls.set(candidate, fiber);
   };
   ```

   注册目标是 **Agent 自己的 scope layer**（`candidate.ctx`），而不是 preset 的 standing layer。

3. `@deepseek-ai/dsh-tools` 同一 layer 内工具名唯一：重复注册会抛
   `tool "list_subagent_models" is already registered in this scope`（`lib/index.js` 2623-2635、2876-2884）。

于是 `标准模式 → 创造模式` 的切换变成一场竞速：

- 旧 composition（standard）在同一次 `tools/change` 里 `removeScoped()` → `fiber.dispose()`；
- 新 composition（cordis）在同一次 `tools/change` 里 `installScoped()` → `ctx.inject(...)` → 注册同名工具；
- Cordis 的 `_reload()`（`cordis/src/fiber.ts` 646-673）先 `await Promise.resolve()` 再执行插件体，`_unload()`（675-696）同样先 await 才拆注册——两者都是**异步**的，谁先落地由**监听器调用顺序**决定；
- `cordis/src/events.ts` 的 `dispatch()` 按注册顺序遍历监听器，而监听器注册时刻取决于该 row 最近一次激活（通常紧随 composition 的 mount）。

结论：

> **先注册监听器的 composition 在切换中占先手。** 默认 preset 先 mount 时，切换是“先拆后建”，工具保住；非默认 preset 先 mount 时，切换变成“先建后拆”，注册撞名失败。

支持这一判断的观测：

- 本机当前这次 Host（`standard` 于 10:35:57 先 mount，`cordis` 于 10:35:59 由探针 mount）：本会话与探针的 `standard → ptc` 切换都**保住了**按 Agent 注册的工具；
- 上一个 Host（9/18 08:34–10:34 那一轮）：每一次“标准→创造模式”的切换**全部丢失**（10 个会话、14 次请求，无一例外）。

需要注意的限制：监听器顺序由“该 row 的最近一次激活”决定，而 **Profile 重新组合（安装/更新/卸载插件、改 host patch）会让 row 重新激活**，监听器会重新排到队尾。因此顺序不是永久钉死的，本插件的顺序防护只能保证“启动那一刻默认 Preset 先 mount、且插件自己的 mount 不会抢在前面”。**所以顺序预测只是第一层，真正兜底的是下面的“切换后重新校准”（见 [§通用自愈](#通用自愈第二层不依赖顺序)）。**

失败后 `scopedInstalls` 里留下一个**失败的 fiber**，`installScoped()` 之后永远早退——所以这两个工具在该 Agent 生命周期内不会回来，除非有别的机制迫使该 Agent 离开一次旧 composition。这正是“切换后重新校准”能修好它的原因：离开时 row 会 `removeScoped()`，把那条失败记录一并丢掉。

### 什么会让非默认 preset 先 mount

- 重启 DSH 后**恢复一个创造模式会话**：`dsh-api-session-controller` 的 `resumeObserved()`（`lib/index.js` 397-408）会按会话记录的 preset 执行 `presets.mount()`，于是 cordis 的 composition 成为本进程第一个被激活的 preset composition。此后新建的会话全部按默认 preset（standard）创建，再切到 cordis 就会丢工具。
- 任何让“非默认 preset 的 row 先激活”的路径都是同一类触发条件，包括 Profile 重新组合（安装/更新插件）之后 row 的重新激活顺序。

这解释了为什么同一台机器上“有时好、有时坏”，并且**重启后先新建会话正常、先恢复旧会话之后开始异常**。

## 本插件的处理（两层，都不改 DSH）

`dsh-tool-manager` 不是原因，但它会在探测冷 preset 时 mount 别人的 composition，所以它至少要做到不把顺序弄反，并且**即使顺序被弄反也能自己修回来**。

### 第一层：顺序预测（`DefaultPresetMount`）

[`src/index.ts`](../src/index.ts) 的 `DefaultPresetMount`：插件加载时立刻 `standingKeyFor(undefined)`（即部署配置的默认 preset，也就是新建会话所用的 preset），此后**所有**由插件发起的 mount（探针、`suggest-group`、`auto-group`、保存校验、快照）都先 `await` 它。

- 好处：只要默认 preset 在本次 Host 中先完成组合，WebUI 的“新建（默认模式）→ 切换模式”流程就是“先拆后建”，按 Agent 注册的工具不会丢；即使之后恢复了创造模式旧会话，顺序也不会被它抢先。
- 边界：Profile 重新组合会让 row 重新激活并重排监听器顺序，本插件无法阻止——所以要靠第二层。
- 失败只记为 warning，不会阻塞工具目录。

### 通用自愈（第二层，不依赖顺序）

[`src/composition-watch.ts`](../src/composition-watch.ts) 的 `CompositionWatch`：**不再预测竞速结果，而是让结果变得不重要**。

- 监听 `tools/change`（默认延迟 120 ms，等 DSH 自己的异步 reconciler 落地），记录每个存活 Agent 的 `composedPreset` 与**实际**工具集（`tools.schemas(agent)`）；
- 一旦某个会话的 preset 发生变化（= 发生过一次模式切换），就把这个会话**借另一个 Preset 空转一圈再切回来**：`recompose(transit)` → 等一个事件循环 → `recompose(target)`。离开时旧 composition 会 `removeScoped()`（连带丢掉失败记录），回来时目标 composition 面对的 Agent 身上已经没有同名注册，安装必然成功；
- 中转 Preset 取 `compositionInventory()` 里**composition row 最少**的那个（通常是极简模式）：它的 composition 最不可能自己也按 Agent 注册同名工具；
- 这一层**完全不认识任何工具名**：不管丢的是谁家的、几个工具，都在一条路径上修好。

安全边界：

- **只对“还没开始过对话的空白会话”动手**。DSH 本来就只允许空白会话切换模式（`agentPresets` 的 `swap()` 在会话开始过 turn 后直接抛 `agent-preset/locked`），本插件用同一条判据（[`isBlankSession()`](../src/composition-watch.ts)）自查后再动手，空白会话没有任何可损失的内容；
- 用 `recompose()` 而非 `select()`：不写会话记录、界面无感知，最终记录的 preset 与实际一致；
- 两条腿是串行的，**第二条腿永远会执行**：把会话留在中转 Preset 上比丢工具更糟，所以失败也会回滚到目标 Preset 并告警；
- 已经开始的会话不碰，只按参照系（探针 Agent 在同一 Preset 下的真实工具集）报出缺了哪些工具，并提示重开。

顺带得到的能力：日志里会出现一条明确的自我报告，例如

```
tool-manager: Session <id> lost 2 tool(s) on the switch to preset "cordis" — list_subagent_models, subagent — and re-calibration restored them.
```

这才是“某个会话少了工具”这件事第一次变得**可见**，而不是靠人去发现。

## 上游可以怎么修（本插件已不依赖）

真正的竞态在 `@deepseek-ai/dsh-tool-subagent` 的 `installScoped()`：安装失败时它把失败的 fiber 永久记在 `scopedInstalls` 里，等于把该 Agent 按需工具永久关掉。最小修法是失败后丢弃这条记录，让下一次 `tools/change` 重试（此时旧 composition 的注册已经拆完，必然成功）：

```js
      try {
        const policy = selectForSession(candidate.session);
        fiber = candidate.ctx.inject(["tools", "subagents", "systemPrompt"], (runtimeCtx) => {
          install(runtimeCtx, policy);
        });
        // 与该 Agent 上一个 composition 的拆除竞速失败时不要永久放弃：
        // 丢掉记录，下一次 tools/change 会重新安装。
        Promise.resolve(fiber).catch(() => {
          if (scopedInstalls.get(candidate) === fiber) scopedInstalls.delete(candidate);
        });
      } finally {
        installing.delete(candidate);
      }
```

也可以在 `dsh-agent-presets` 侧修：`recompose()` 在发出 `tools/change` 之前，先让旧 composition 对目标 Agent 的清理落地（或为“同一次切换”提供两阶段事件）。

本仓库**没有**修改 DSH 安装目录：升级会覆盖，且这类补丁应由上游吸收。

## 如何自查

插件现在会自己把这件事说清楚，先看日志：

- `... lost N tool(s) on the switch to preset "..." — <工具名> — and re-calibration restored them.` → 命中过竞态，**已经被自动修好**；
- `... is short of N tool(s) — <工具名> — and it already started ... Reopen the Session ...` → 会话已经开始、DSH 不允许再换 Preset，需要人工重开；
- `... lost N tool(s) — <工具名> — with no mode switch.` → 不是切换造成的同类损坏（例如安装/更新插件触发的 Profile 重新组合），同样需要重开。

需要更硬的证据时看会话日志（`$DSH_HOME/sessions/<cwd>/<sessionId>/session.v3.jsonl.zstd`，多帧 zstd，需逐帧解压）：`request/header` 事件的 `data.header.tools` 就是该次请求真正发出的工具清单。按 Agent 注册的工具缺席时，工具总数会比同 Preset 的健康会话少对应的个数（本次事故里创造模式是 35 → 33，缺 `subagent` + `list_subagent_models`）。

本插件页面（设置 → 工具管理）显示的目录反映 **registry 层**：如果页面里 cordis 有这两个工具而会话里没有，说明丢失发生在某个具体 Agent 上，而不是配置或页面探测错误。
