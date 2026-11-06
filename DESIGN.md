# DSH Tool Manager 可行性研究与架构设计

## 1. 结论

**可以实现，而且 DSH 现有工具 registry 已提供关键基础能力。**

需求应拆为两个层次：

1. **能力治理 / 上下文治理（本插件可完成）**
   - 某工具是否出现在模型请求的 tool schemas 中；
   - 某工具是否能被该 Agent dispatch；
   - 一组工具是否只通过 `tool_list` 被发现，打开后在当前会话一直可用。
2. **资源生命周期治理（不能仅靠 registry filter 完成）**
   - MCP server 子进程/HTTP connection 是否启动；
   - 某个 Cordis 插件 row 是否装载；
   - 插件提供的非 Tool service 是否常驻。

`tools.restrict()` 解决第一层，且会统一作用于 schema、lookup 和 execution。第二层若也需要，需要新增可写 Preset composition authoring API，或把 MCP 客户端升级为 lazy connection/provider；不应通过绕过 Loader 的方式硬停插件。

## 2. 已验证的 DSH 事实

### 2.1 工具统一汇入 `ctx.tools`

原生插件、第三方插件和 MCP bridge 都调用 `ctx.tools.register()`。MCP 的公开名稳定为：

```text
mcp__<serverName>__<rawToolName>
```

因此策略层无需关心来源类型，只需按工具名与 schema 工作。

### 2.2 Agent scope 支持可逆限制

`ToolRuntime.restrict({ allow?, deny? })`：

- 只能在 scoped context（如 `agent.ctx`）调用；
- 限制 inherited tools；
- 多个 restriction 求交；
- 被隐藏工具从 `schemas()`、`get()` 和 dispatch 同时消失；
- disposer 被调用后完整恢复；
- restriction 改变会发出 `tools/change`。

本次研究用动态 Cordis probe 实测：选择一个当前可见工具，施加 `deny` 后 `schemas(agent)` 中立刻消失，dispose 后立刻恢复。

`restrict()` 只作用于 inherited（global + 祖先 scope）注册，Agent 自身作用域的注册按设计始终可见。DSH 0.2.2 之前，这一块由 `system-prompt/assemble` 的 `assembly.tools` 过滤兜住；0.2.2 把该 waterfall 改成只含 `sections` / `contexts` / `variables` 的 `PromptPresentation`，并在 waterfall 之后挂回工具声明，提示词层已无法删除声明。

### 2.2.1 0.2.2 起改为过滤每一步的准入集合

0.2.2 的 agent loop 在 `preStep()` 中先 `tools.resolve({ agent, modelSelection, signal })` 得到该步准入集合，随后提示词声明（`definitions()` → `toolSet.view()`）、PTC 绑定与 `executable()` 查找全部从这份集合派生。

`resolve()` 不在 scope 链上做「own 层豁免」，因此它是隐藏 Agent 自身作用域注册的唯一受支持落点。插件包装 `ToolsService.prototype.resolve`：等 Host 解析完成后，按当前 Agent 的策略把隐藏名从 `view()` 投影中剔除；`dispose()` 原样转发。包装只替换 `view`，失败一律返回 Host 原对象，卸载时还原；旧版 DSH 没有 `resolve()`，自动跳过并沿用提示词过滤。这样 `subagent`、`schedule_*` 等 scope-local 工具与全局工具表现一致。

包装在调用 Host `resolve()` **之前**先用 `schemas(agent)` 核对一次 baseline（见 4.3）：热装插件、组合重载或 standing Preset 重新挂载都可能把注册落在 `install()` 与 `tools/change` 之间，过期快照会让按需组解析为空，组内工具反而照常出现在这一步的集合里。核对只在 live 面出现快照没有的名字时重算并 `reconcile()`，因此新工具在当步就归组并被剔除，`agent/pre-step` 的目录也在同一步更新；工具面收缩可能是组合切换的空窗，不在这里采用。

### 2.3 每个模型 step 都重新组装工具目录

Agent loop 在 `preStep()` 中**先** `systemPrompt.assemble()`，**再**跑 `agent/pre-step` waterfall。因此：

- `tool_list` 在 step N 执行并修改 restriction 后，step N+1 的 assemble 可以看到新 schema；
- 组一旦打开就保持到当前 Agent 结束或策略把该组删掉，不再按模型步数收回。

### 2.4 Preset 是 standing scope，不是每 Session 一套插件实例

一个 Preset composition 被 standing mount 一次，多个 Agent 通过 scope parent 加入。因此：

- **静态 preset 规则**可以放在 standing scope；
- **按会话临时曝光状态**必须应用在 Agent 自己的 scope；
- `tool_list` 注册在 host 全局层（否则 PTC 生成 SDK 看不到），每个 live Agent 只维护该会话的打开状态，避免同 Preset 会话互相解锁；
- Agent 安装时从该 Session 的持久事件日志恢复成功的 `tool_list` 调用，因此重启 DSH 并恢复同一 Session 后仍保持开放。原生调用通过成功配对的 `tool/call` + `tool/result` 恢复，PTC 调用通过成功的 `tool/ptc-dispatch` 恢复；fork 时跳过 `inheritedEventCount` 前缀，避免把父 Session 的临时开放状态带入子 Session。

### 2.5 Preset inventory 已有只读基础，但没有写 API

`agentPresets.compositionInventory()` 可给出每个 Preset 的插件 rows；内置 WebUI 的插件清单也明确只读。`agentPresets.copy()` 是唯一官方 authoring write，当前没有任意写回 composition 的公开 API。

工具开关保存在 `$DSH_HOME/tool-manager.json`（可由 `DSH_TOOL_MANAGER_CONFIG` 覆盖）的独立配置文件中，而不是修改 shipped preset、DSH Settings 或直接操作 Loader entry。

设置页为了列出每个 Preset 的实际 schema，会对未 broken 的 Preset 调用 `acquireScope()`。这会租用 standing mount（与开一个该 Preset 的会话相同）并在读完 schema 后释放租约，但不会改写 composition 文件。

### 2.6 `agentPresets` 的实例会在热重载时被替换

修改 `agent-preset-registry` 的配置（设置页写 patch，或 Loader 热重载同一节点）会让该节点在同一个 Fiber 上重新 `apply`，并构造 **新的** `AgentPresets` 实例：

- `definitions` / `generations` / `bindings` 全在实例上。旧实例的 `definitions` 会被各 preset 的 unregister disposer 清空，新实例则靠 `preset-*` 节点重新注册填充；
- 已存在 Agent 的 scope parent 指向旧实例的 generation key，新实例的 `generations` 里没有这个 key，因此 `composedPreset(agent.ctx)` 对这些 Agent 返回 `undefined`（DSH 没有重新绑定的公开路径，只能重建 Agent）；
- 在 Cordis 4 上，声明了 `inject` 的依赖方会随实例替换重新 `apply`；但这属于框架行为，且重载顺序不保证 `preset-*` 已注册完成，所以插件不能依赖它，也不能缓存实例引用。

因此本插件的规则是：**只缓存 resolver，不缓存实例**；所有按 Preset id 建立的缓存（probe 目录、live 观测、default composition 是否已挂载）都以"当前实例身份"为失效条件；对拿不到实例的请求返回 503，页面重试；对拿不到 preset id 的 Agent 保留最后一次观测到的 id，避免静默放开已关闭的工具。

**重载对在线会话是可修复的，但必须由插件代劳**：`dsh-scope` 的 `bindScopeParent()` 只允许绑定一次，重链必须走当初拿到的那份 `ScopeParentBinding.rebind()`；这份句柄存在旧实例的 `bindings` WeakMap 里，而新的注册表实例既没有它、也没有公开的"重新绑定"入口（`mount()`/`bind()` 会对已绑定的 key 直接抛错）。所以 DSH 自己没有恢复路径，`agents.resume` 还会因为会话已有 live Agent 而失败（Agent 注册在创建它的 fiber 上，`agents.list()` 在进程存活期间不会丢，GUI 也没有 close/dispose 入口）——这就是"只能重启"的表象。

插件侧的做法（`src/preset-repair.ts`）是**复用旧句柄**：只要本插件没随注册表一起重载，旧实例对象就还活着，它的 `bindings` 里仍握着每个在线 Agent 的句柄。

1. 每次解析服务时记录实例身份，替换发生时把旧实例留作 `retired`；
2. 在 `agent/pre-step` 里，若 `composedPreset(agent.ctx)` 为 `undefined`（说明 scope 指向已退役的 generation），就按 `Reflect.ownKeys(agent.ctx)` 找 `Symbol("dsh.scope")` 那个自带属性（`createScope()` 写上去的 scope key，值就是 Agent 的 loop 对象），再用 `retired.bindings.get(key)` 命中绑定，从而拿到 `parent.rebind`；
3. 用 `retain(id)` 租到新实例上同 id 的 generation，`parent.rebind(generation.key)` 把 Agent 的祖先链改指过去，并按 `join()` 的语义补上 `users++`、写入新实例的 `bindings`、释放旧 generation；
4. `refreshAllBaselines()` 重新快照工具集，策略、按需组、catalog 一起恢复。

全部按结构探测实现（`retain`/`collect`/`bindings`/`rebind` 缺一不可），失败时只告警一次并退回"策略兜底 + 用户横幅"，不会抛错。

**三个必须跨越重启的坑**（1.2.16/1.2.17 修）：其一，本插件在 `inject` 里声明了 `agentPresets`，注册表被替换时 DSH 会连带重启本插件，内存态（旧实例引用、通知箱）必须放在 `globalThis`（`Symbol.for` 键）上才不会被丢；其二，`Context.extend()` 在有 use-site shadow 时返回的对象把 scope 标记放在**原型**上，探测 scope key 必须沿原型链走，否则一律 `no-key`；其三，**"挂回哪个 preset"不能只问 Session 投影**——投影属于被替换的实例、按需重建，重载后第一次 pre-step 里往往还是空的，必须回落到丢失的那个 binding（`binding.generation.mount.presetId`）。`GET /tool-manager/api/repair` 暴露 `live`/`retired`/`liveCapable`/`retiredCapable`/`refusals`/`attempts` 以及每个 Agent 的 `composed`/`declared`，用于在真实 Host 上定位重挂失败原因。

仍无法修复的残余情况只有两种：**本插件与注册表同时被重载且旧实例从未被记录**（历史为空），或**新实例里已经没有被选 preset 的同名定义**——这两种才需要重启 DSH。

插件的应对分三层：

1. **策略不失效**：`composedPreset()` 拿不到时，用 `agentPresets.presetForSession(session)`（Session 日志里的 preset，跨实例有效）兜底，再退回内存里最后一次观测值。这样在线会话即使丢了工具，也不会把用户关掉的工具静默放回来。
2. **诊断说清楚**：`CompositionWatch` 把"上一轮有 preset、这一轮没有"识别为注册表重载而不是模式切换，只告警一次，并且不再尝试注定失败的 re-calibration。
3. **让用户知道**：`agent/pre-step` **不往会话里写任何东西**——工具丢失是用户要处理的事，模型既修不了也不该被提示去重试。用户侧走 `src/notices.ts` + `GET/POST /tool-manager/api/notices`，Web 端在 `shell.overlay`（全窗口浮层）渲染可关闭的横幅，不依赖用户打开工具管理设置页。注册表刚被替换时先给一条 transient 提示（"将在下次对话前自动重挂"），重挂成功由 `notices.settle()` 撤掉；只有失败才留下"需要重启 DSH"的正式提示。`UserNotice.kind`（`reloading`/`failed`）区分两级，同一会话+preset 去重。

无法自动修复的部分属于 DSH 侧：`agent-preset-registry` 若能在配置热更新时复用实例/`definitions`，或提供"重新绑定 Agent"的公开路径，就不会有这一段。

## 3. 推荐架构

```text
                        ┌──────────────────────────┐
Web Settings page ─────▶│ tool-manager.json        │
                        │ presets[presetId] policy │
                        └────────────┬─────────────┘
                                     │ save/update
                                     ▼
┌──────────────────┐       ┌────────────────────────┐
│ Agent Preset      │──────▶│ Host Policy Runtime    │
│ standing scope    │       │ one state per Agent    │
└────────┬─────────┘       └───────┬───────────────┘
         │ inherited tools          │ agent.ctx.tools.restrict()
         ▼                          │ + global tool_list
┌──────────────────┐                ▼
│ ToolRuntime       │◀──────── per-step visibility
│ native/plugin/MCP │
└──────────────────┘
```

### 3.1 数据模型

```ts
interface ToolManagerSettings {
  presets: Record<string, {
    disabled: string[]
    groups: Array<{
      name: string
      description?: string
      patterns: string[] // exact names from the settings UI; older `*` wildcards still match
    }>
  }>
}
```

### 3.2 优先级

从高到低：

1. DSH 其他安全 restriction / guard；
2. 本插件 `disabled`；
3. 按需组默认隐藏；
4. `tool_list(group)` 打开该组（当前会话一直可用）；
5. 原始 Preset 工具目录。

显式 disabled 永远不能被临时曝光反向开启。PTC 的 `run_code` 永远不会进入 deny 集合。`tool_list` 注册在 host 全局层；没有按需组的 Preset 会把它 deny 掉。

### 3.3 `tool_list` 语义

- `tool_list({ group: "GitHub MCP" })`：按名称打开该组，该组全部工具立刻可用，直到当前 Agent 结束或该组被删掉；
- 每个 Agent 独立应用打开状态，不跨会话共享；成功调用由 Session 事件日志持久记录，同一 Session 重启恢复时重建状态；
- `tool_list` 注册在 host 全局层，这样 PTC 生成 SDK 能绑定它；没有按需组的 Preset 用 restriction 隐藏；
- PTC 模式应在 `run_code` 内调用 `await tools.tool_list({ group })`；
- 按需组说明不走 `systemPrompt.section`。所有 Preset（含极简模式的 `complete: true` persona）都在 `agent/pre-step` 写入一条 skill 式的持久 user 角色 `<system-reminder>` 目录；目录为每组列出实际工具数量和完整工具名；
- 只有至少匹配一个当前真实且未被显式关闭工具的组才是有效组。空组或仅含关闭工具的组不进入目录、不能通过 `tool_list` 打开，且当某 Preset 没有有效组时会隐藏 `tool_list`；
- 工具状态互斥：一个工具只能是常开、已关闭，或属于一个按需组。WebUI 不提供已关闭或被其他组占用的工具；Host 保存接口拒绝关闭工具入组和跨组重复；
- 旧 wildcard 配置在编辑时投影为当前实际成员的精确工具名。运行时对尚未修复的重叠配置按组顺序 first-match，确保目录中一个工具最多出现一次；
- WebUI 和 Host 保存接口都禁止保存空组。旧配置中的空组或冲突组仍会在设置页中标为无效，供用户修复或删除；
- 保存校验与设置页必须读**同一份**工具目录：standing composition 与 Agent 作用域注册（探针 + 运行中 Agent 观测）的并集。只读 standing 会把 `@deepseek-ai/dsh-schedule` 注入每个 root Agent 的 `schedule_*`、以及 `modelSelectionSettings` 注入的 `subagent` 判成不存在，从而拒绝一个页面能列出、运行时也能正常打开的组。只有真正读不到 standing composition 时才跳过该校验。

## 4. 关键实现陷阱

### 4.1 不要只过滤 prompt schema

只在 `system-prompt/assemble` 删除 `assembly.tools` 并不等于权限控制：历史/恶意模型仍可能猜工具名直接调用。必须使用 `tools.restrict()` 或 guard，让 lookup 和 dispatch 同步拒绝。

### 4.2 不要用一个代理工具执行所有隐藏工具

可以设计 `tool_call({name,args})` 代理，但它会：

- 绕过原工具 schema 的模型侧参数约束；
- 让权限、审批、调用卡片和 telemetry 都聚合到代理名；
- 使历史中的工具身份不稳定；
- 增加手工 dispatch 复杂度。

“先发现，再让原工具 schema 在下一 step 出现”更符合 DSH 的原生 registry 设计。

### 4.3 `restrict()` 只接受已知 inherited tool 名

它会拒绝 unknown、scope-local 和 reserved transport 名。实现必须：

- 在 host/global 层注册 `tool_list`（与 `skill` 一样进入 PTC SDK 的继承面），再 snapshot inherited baseline，并排除 `tool_list` / `run_code`；
- 没有按需组的 Preset 用 `restrict({ deny: ['tool_list'] })` 隐藏它，避免无关会话看到空的 discovery 工具；
- 只对 baseline 中真实存在的名字构造 deny；
- 监听 `tools/change`：先暂时卸下 restriction 再重读 baseline，避免把已隐藏的工具当成“已消失”；刷新期间抑制重入，防止自己的 restrict/register 再次触发刷新；
- 每一步 `tools.resolve()` 之前、`agent/pre-step` 里以及 `tool_list` 打开组时，再用 live `schemas(agent)` 核对一次 baseline（一次 map 遍历）：快照只靠事件刷新会漏掉落在 `install()` 与 `tools/change` 之间的注册，过期快照会让按需组解析为 0 个工具、从目录消失，组内工具却一直可见，直到重启重建快照；只在出现新名字时采用，收缩交给 `tools/change` 的防抖刷新；
- 若仍撞上 unknown-name 错误，从诊断文本解析 `known global tools` 后重试交集；
- scope-local 名无法用 `restrict()` 隐藏：0.2.2 之前由提示词过滤兜底，0.2.2 起改由 `tools.resolve()` 的 per-step 过滤兜底（见 2.2.1）；两者都失效时保留 guard 拦截并告警一次。

### 4.4 PTC 模式需单独定义产品语义

PTC 模式模型表面只见 `run_code`，但生成 SDK 仍包含所有可见 end-capability tools。restriction 仍有效，也会缩小 SDK。`tool_list` 必须注册在 host/global 层，才能进入 PTC 的继承面并成为 SDK binding；按 Agent 的 scope-local 注册对 `schemas(agent)` 可见，但不会稳定出现在 PTC 系统提示的 SDK 里。模型应在 `run_code` 内调用 `await tools.tool_list({ group })`。若希望 PTC 模式也把 `tool_list` 作为原生 discovery tool 与 `run_code` 并列，需要 DSH 为 mixed presentation 提供更细粒度机制。

### 4.5 Prompt guidance 可能残留

DSH 内置文件/Web 等工具 guidance 会通过 `ctx.tools.get(name, scope)` 判断可见性，所以 restriction 后说明会消失。第三方插件若无条件注册 guidance，schema 虽隐藏但文字可能仍占上下文；平台层可未来引入“tool-owned guidance metadata”，或要求第三方遵循条件渲染约定。

极简模式 persona 配了 `complete: true`：`assemble()` 的 waterfall 仍会跑，但随后把 complete 段恢复成唯一系统提示，其它 `systemPrompt.section` 全部丢掉。本插件因此不往系统提示里写组名单，而是对齐 `dsh-tool-skill`：在 `agent/pre-step` 追加一条 `source.kind = tool-manager-catalog` 的持久 user 消息。每条 entry 保存组名、描述和实际工具名；digest 也覆盖这三项，因此成员变化会触发替换目录。可见目录未变则不重发；有效组被删光或变空且曾经发过则追加清空目录。`tool_list` 是全局一份 schema，description 不带组名；当前会话可用的组名和成员只出现在这条 catalog 里。旧消息缺少工具名字段时按空列表读取，以兼容升级前会话历史。

## 5. WebUI 与持久化选择

当前实现：

- `settings.section` 新增「工具管理」页面；
- Host 使用独立的 `$DSH_HOME/tool-manager.json`，也可由 `DSH_TOOL_MANAGER_CONFIG` 指定路径；
- 同源 HTTP endpoint 提供 snapshot/save；
- 保存携带文件存储 revision，拒绝 stale write，并以临时文件原子替换；
- WebUI 不直接编辑 `agent.cordis.yml`，因此绝不会损坏 shipped preset；
- 设置页支持搜索、常开/按需/关闭筛选、组内筛选勾选、以及 orphan disable 清理。

生产版仍可：

- 给包生成 Typert Host/Remote artifacts，并让 client contribution 通过 `ctx.remote.toolManager` 调用；
- 增加 settings change / tools change 的事件订阅，替代手动刷新；
- 显示来源（插件 row、MCP server）需要 registry 增加 registration metadata，因为当前 `ToolDefinition` 没有标准 owner/source 字段。

## 6. “关闭插件/MCP 进程”扩展路线

若用户真正目标还包括减少资源常驻，建议分阶段：

### A. Preset row authoring（静态，推荐）

新增受保护的 Host API：

1. 只允许修改 `trust: user` 的 Preset；
2. shipped preset 必须先 `agentPresets.copy()`；
3. 用 Loader YAML AST/官方 authoring helper 修改 row 的 `disabled`；
4. 原子写入、mount validate；
5. 修改只影响之后建立/加入新 standing generation 的 Session；已有会话不热切换 composition。

这适合永久关闭某类 tool plugin 或整个 MCP client row。

### B. Lazy MCP（资源级按需）

让 MCP bridge 分成：

- 轻量目录：缓存/声明服务器与工具元数据；
- 第一次曝光或调用时建立 transport；
- idle timeout 后断开；
- schema identity 保持稳定。

这需要修改 MCP client 本身；仅在上层过滤 schema 无法停止其连接 supervisor。

## 7. MVP 验收标准

- WebUI 能列出所有 Preset 及各自实际工具 schema；
- 关闭工具后，live Agent 下一 step 不再看到也不能调用它；
- 按需组工具默认不进入模型 schema；
- `tool_list` 能列组并打开目标组；
- 打开仅影响当前 Agent，该会话内一直可用；
- MCP 工具可用 `mcp__server__*` 分组；
- settings 在重启后保留；
- shipped preset 文件从不被修改。

## 8. 当前实现已补强 / 仍待生产化

已补强：

1. 监听 `tools/change`，MCP 动态 tools/list 或插件 HMR 后刷新每个 Agent baseline；
2. 设置页提示并一键清除 orphan disable；旧配置中的空组在草稿中标记为无效，必须补选工具或删除后才能保存；
3. `tool_list` 支持 `query`，大组只返回 preview + 截断列表；
4. 打开后的组在当前会话一直可用，重启恢复同一 Session 时从成功的原生/PTC 工具事件重建；fork 不继承父 Session 的开放状态；策略更新不取消正在执行的工具；
5. 自动命名和自动分组在执行前显示确认框，并允许配置 5–600 秒请求超时（默认 60/120 秒）；Host 校验范围，超时及供应商中止会返回明确错误。

仍待：

1. Typert Remote 替换 HTTP API，并订阅 settings/tools 变化；
2. E2E：真实 Agent 两个连续 step、两个并行 Session、PTC preset、MCP 重连；
3. WebUI 国际化、可访问性和大目录虚拟列表；
4. 工具来源（插件 row / MCP server）元数据，需 registry 先提供 owner 字段。
