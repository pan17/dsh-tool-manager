# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [1.5.2] - 2026-11-26

### Added

- 自动命名和自动分组不再固定使用当前默认模型（issue #11）。会发起模型请求的两个对话框——「自动分组」确认框和「手动分组」对话框的「自动生成名称和描述」上方——各新增一行「生成模型」+「推理强度」两个下拉框，并排在同一行；模型下拉只显示模型自己的名字（同名时才补 Provider），推理强度下拉显示当前生效的档位——跟随默认模型时就是它自己那一档（例如你把它设成 Max，这里就是 Max），选一档即覆盖，选「默认」则表示不额外指定、交还给模型自己。默认就是 DSH 当前的默认模型，直接选别的模型即可换掉。整批工具做结构化分类用 flash / mini / haiku 这类快速模型就够，默认模型偏慢或开了高推理强度时，此前只能先把默认模型切走再切回来。两处改的是同一个全局设置：`tool-manager.json` 新增的 `generation` 字段，不属于任何 Preset；它可以是完整路由 `{provider, model}`，也可以只带 `reasoningEffort` 表示“默认模型 + 这一档”。改动立即写入配置文件（独立路由，不需要点页面的「保存」），写成功后会同步页面 revision，之后的「保存」不会被判成过期。
  - 切换模型时档位跟着走：新模型也声明这一档就原样保留，否则按相对位置映射（Off → 最低档、Max → Max），不会掉回默认模型自己的档位——那往往是最慢的一档，正是这次想避开的。
  - 候选列表来自 Host 的 `llm.listProviders()` / `llm.listModels()` / `llm.resolveModelInfo()`，只列出当前可用的模型；某个 Provider 的目录读不出来时单独提示，不影响其它 Provider。
  - 所选模型失效（被删除 / 未配置）时不再静默失败：生成会回退到默认模型，并在页面上用一句话说明回退原因与所用模型；推理强度若不在该模型声明的档位，改用它的默认档，没有默认档就不发送该参数（LLM 服务会直接拒绝未声明的 effort）。
  - 两个确认框（自动命名 / 自动分组）的说明文字会实时写明本次使用哪个模型，而不是笼统地写「当前默认模型」：在「自动分组」框里换了模型或档位，标题下的说明立刻跟着变。
  - 兼容性：老的页面保存时不会带上 `generation`，Host 把缺键视为「没有改」，只有显式 `null` 才表示清空这次选择，因此升级不会悄悄清掉它。

### Changed

- 设置页「加载模式」旁新增一个问号帮助入口，把「默认」「MCP 按需」按钮原来的悬停说明集中到该提示里；提示同时说明 MCP 按需模式依赖模型直接发出未声明的工具名，部分供应商（如 OpenCode Go）会限制工具调用名，模型只能反复调用 `tool_find`，无法真正调用组内工具，建议改用「默认」加载模式。

### Fixed

- 修复「复制配置」和「重置配置」会把目标 Preset 的加载模式悄悄改回默认的问题：两者都用一份新策略整体替换 `policy`，而新策略只重建了 `disabled` 与 `groups`，漏掉 `mode`，于是 MCP 按需的 Preset 作为复制目标或被重置后都会回到默认模式——`tool_find` 从工具表消失（没有 Preset 处于 mcp 模式时它会注销），组也从「只声明组名、随时按名调用」退回「需要先 `tool_list` 开组」。现在加载模式被视为目标 Preset 自身的设置：复制只覆盖按需组与关闭清单，重置只清空这两项，两者都不改动 `mode`；复制对话框的说明与逐目标预览会写明「加载模式保持默认 / MCP 按需」，复制是否产生改动的判断也把 `mode` 计入，模式相同、分组相同不再被误报为有修改。

## [1.5.1] - 2026-11-24

### Added

- **MCP 按需模式现在也支持 PTC 传输**（issue #10 的 PTC 反馈）。PTC 的程序内绑定来自 `tools.schemas(agent, toolSet)`，而渲染给模型的 SDK 文本来自 `tools.definitions(agent, toolSet)`；宿主原本让这两个读取共用一次步骤集合遍历，因此组内工具在 `ReachableView` 里被排除出声明后，在 `run_code` 程序里同样没有绑定，`await tools.名字()` 直接 `TypeError`。现在插件单独包装 `ToolsService.prototype.schemas()`：仅当调用带 `toolSet` 且该 scope 的执行器有 `renderSdk`（即 PTC）时，改读步骤集合的第二面——所有可执行工具的完整 definition，并用宿主自己的 `projectToolSchema` 投影。结果是 SDK 文本里依然没有组内工具（模型照旧用 `tool_find` 取 schema），但每个组内工具都有绑定，参数校验与日志都用真实 schema。宿主里只有 PTC 绑定循环带 `toolSet` 调 `schemas()`，原生路径走 `executable()` → `get()`，所以两种传输下的 MCP 节省都不受影响。

### Fixed

- MCP 模式下设置页把「自动分组 / 手动分组 / 重置配置 / 复制配置」整行一起藏掉了，而 `groups` 恰恰是 MCP 模式唯一的隐藏来源：新建的 Preset 直接切到 MCP 会变成全量声明，页面上也没有任何建组入口。这行现在在两种模式下都显示。

### Removed

- 死字段 `mcp.expose`：设置页会写、服务端会归一化保存，运行时从不读。已删除，旧配置里的 `mcp.expose` 被直接忽略（不迁移、不报错）。
- 死代码 `MCP_OPEN_TOOL_NAME`（`tool_open`）与 `restoredOpenedToolNames()`：`tool_open` 从未注册成工具，相关引用只是在过滤/隐藏一个不存在的名字；`restoredOpenedToolNames` 没有调用方。


## [1.5.0] - 2026-11-22

### Added

- 新增 **MCP 按需加载模式**：每个 Preset 可在设置页把「加载模式」切换到 **MCP 按需**，用与 magpie 等 MCP 服务器相同的形态懒加载工具。
  - 工具分三档，与按需组同构：**常开**（未分组且未关闭，发送完整参数 schema）、**按需**（在某个组里，只在目录中列出组名与描述）、**已关闭**（不声明）。
  - 组内工具**不单独声明**，但始终可以直接按原名调用——MCP 模式没有“打开组”这一步；新增元工具 `tool_find({ group })` 只返回整组每个工具的完整参数 schema，不改变任何状态。
  - 加载提示只在组列表变化时注入一次，其余每个步骤零注入；提示的摘要只覆盖真正渲染的内容，避免 baseline 变化触发重发。
  - `mcp.expose` 白名单已取消：未分组的工具一律常开。
- 设置页在 MCP 模式下照常显示按需组卡片，组内工具不在工具列表中重复出现。

### Changed

- 工具声明投影按 `tools.resolve()` 的每步集合实现：迭代只给声明集合，`get()` 仍能命中组内工具——DSH 读声明靠迭代、派发靠按键查找，因此“组替代成员”不需要任何激活步骤。

### Fixed

- MCP 提示的 `source` 缺少 DSH `notice` 表单要求的 `summary`，聊天端会把整个 source 平铺出来，导致组名与描述出现两份。
- 提示每一步重复注入（实测 34 次，组模式只 1 次）：摘要曾包含 `exposed`/`hidden` 等未渲染字段，baseline 一变化就重发。
- 保存按钮的禁用状态说不清原因：四种情况（配置只读 / 有请求在跑 / 自动分组中 / 没有改动）都长成同一个灰按钮，点了没反应也报错，页面因此停在草稿态而配置文件没变。现在 `saveBlockReason()` 给出具体原因并挂到按钮 `title`，只读排在最前（等再久也不解决）。
- 保存失败不指出是哪个 Preset：错误只显示在顶部，`errorPresetId()` 现在从错误文本里认出被点名的 Preset（兼容页面用的弯引号与服务端的直引号），错误框提示「来自哪个 Preset」并给一键切换，Preset 下拉里那一项追加「保存失败」。

## [1.4.2] - 2026-11-21

### Changed

- PTC 计价从「逐个工具重渲染整册」改为**整册两轮**：整册渲染一次，再把每个工具单独渲染一次、减去空名册的脚手架，得到该工具自己那段 SDK 成员块，129 个工具从每份快照 700–850ms（约占整次快照请求的 94%）降到约 10ms，面板从打开到出数由 ~1.9s 降到 ~0.25s（其中 ~0.14s 是宿主 HTTP 层固定开销，与本插件无关）。成员块与 1.4.1 的「去掉该工具后重新渲染」逐工具比对最大差 2 token，差额并入「平台常数」，两种取法等价，1.4.1 的行值口径因此不变。
- 修掉 1.4.1 里从未命中的缓存：每个租约的 scope 都是新对象，按 scope 做键的缓存永远 miss。现在按**执行器对象 + 定义签名**（名称、描述、参数、输出）缓存，最多保留 4 份（LRU），定义不变时后续请求完全不渲染，工具面一变签名即失效。

## [1.4.1] - 2026-11-21

### Added

- token 成本估算现在区分 transport（issue #6 后续讨论）：原生模式下模型读到的就是工具 schema 的 JSON，沿用 1.4.0 的口径不变；**PTC 模式下工具定义不在请求的 `tools` 里，而是渲染成 TypeScript SDK 文本放进系统提示词**，其中每个工具的 `output` 类型同样占上下文。现在 PTC 模式直接对执行器导出的 `renderSdk()` 产物计价：每个工具行显示「去掉该工具后重新渲染」得到的边际 token，统计卡新增第六格「平台常数」显示每轮固定开销（`run_code` 声明、PTC 指令段、`renderSdk([])` 的脚手架、被过滤掉的 `tool_list` 目录行，取「总计 − 各行之和」，不逐项拆），因此 PTC 下「各行之和 + 常数」即为总计。总计沿用 1.4.0 的「全部工具常驻」口径（按需组和已关闭的工具按开启后计入），不是单次请求实际渲染的集合。Preset 卡片旁显示 `PTC` / `原生` 徽标，悬停提示写明当次用的单位注（「PTC SDK 文本 ÷4」/「工具 JSON ÷4」）；快照为每个 Preset 附带 `transport`，PTC 下另附 `constantTokens`。两种口径量的是两段不同文本，不可横向比较。
- 取数不改宿主：`ToolRuntimeLike` 新增可选的 `definitions()` 与 `selectExecutor()`，配合执行器导出的 `renderSdk` 直接量渲染文本（`schemas()` 会裁掉 `output`，所以改读 `definitions()`）。同一 Preset 的渲染结果按定义内容（名称、描述、参数、输出）缓存，内容不变就不再重渲染（137 个工具的首次约 0.5s，之后约 0.3ms），工具面变化即失效。宿主不提供这些入口、或渲染抛错时，`measurePresetTokens` 返回 `undefined`，估算回落原有 JSON 口径；`PresetTokenStats` 结构不变，新增的 `transport` / `constantTokens` 挂在 Preset 视图上。

### Changed

- 工具目录的统计卡从「`auto-fit` 自适应网格」改为**始终一行**：六格（原生模式五格）等分宽度并排，卡片内边距 `9px 10px` → `6px 7px`，数值 `18px` → `15px`，标签 `11px` → `10px`，token 小字 `10px` → `9.5px`，于是 552px 宽的面板下统计区高度从 177px 降到 77px（少了一整行的滚动空间）。面板过窄时数值、标签与 token 小字以省略号收尾，视口 ≤560px 时回退为三列自动换行。

## [1.4.0] - 2026-11-21

### Added

- 工具目录新增「token 成本」视图（issue #6）：每个工具行与按需组成员行显示 `~N tok` 常驻估算（已关闭工具显示开启后的潜在成本），每个有效按需组显示收起后的净省 token（组内工具 schema 减去关闭态仍注入的目录行），五个统计卡片各自增加 token 小字：工具总量显示全部 schema 合计、分组数量显示全部收起可省、未分组工具显示每轮常驻、按需工具显示 schema 合计、已关闭工具显示关闭可省；悬停说明写明「按需工具 schema 毛额 − 关闭态目录行 = 分组净省」的完整算式。估算复用 DSH 的 4 字符/token 口径（`estimateToolsTokens` 的整数组估算额外计入 `+4` 框架），快照为每个工具附带 `tokens`、每个组附带 `tokens{schema,catalog,net}`（无效组为零）、每个可读取的 Preset 附带 `tokenStats`；页面草稿在保存前也能实时重算，旧配置与运行时行为不变。
- 工具目录标题旁新增「?」帮助入口，把原先直接显示的两段工具目录/tool_list 说明收进鼠标悬停提示，减少面板头部占用的垂直空间。

## [1.3.0] - 2026-11-20

### Added

- 新增「复制配置」：在工具目录面板「手动分组」旁，可把当前 Preset 的全部按需组和已关闭工具清单复制到一个或多个其他 Preset。目标配置整份覆盖；复制时按目标实际拥有的工具裁剪组员，整组无可用工具则跳过并在结果中提示；复制只写入页面草稿，点击「保存」后生效。该功能回应 issue #5 的跨 Preset 复用诉求，采用显式复制而非新增 `global` 策略桶，`tool-manager.json` 结构与运行时策略解析保持不变。
- 新增「重置配置」：清空当前 Preset 的全部按需组和已关闭工具，恢复为所有工具常开、未分组；只修改页面草稿，点击「保存」后生效。

### Fixed

- 修复「折叠工具后，按族名注册的 `tool:*` 提示词段仍然留在系统提示词里」（issue #4）。`dsh-tool-jobs` 的 `tool:jobs`、`dsh-tool-goal` 的 `tool:goal`、`dsh-tool-session-query` 的 `tool:session-query`、`dsh-tool-terminal` 的 `tool:pty`、`dsh-terminal-panel` 的 `tool:pty-panel`、`dsh-tool-schedule` 的 `tool:schedule` 都以能力族而不是单个工具命名，而旧实现把 `tool:` 后面的整段当成工具名，于是 `owners=["jobs"]` 永远匹配不到任何隐藏工具，模型仍会读到「可以调用 `job_output` / `session_search` / `create_goal`」的指令，真正调用却被 guard 拒绝。现在包装 `systemPrompt.section()` 与 `tools.register()`，按**注册该段落的 plugin entry / fiber** 收集它注册的工具，作为该段落的工具族；族内全部被隐藏或折叠时删除段落，任一可见则保留。DSH 的默认 `preset-standard` 属于 web-app bundle，可能在 profile bundle 应用前就完成注册，也可能由 `DefaultPresetMount` 在本插件启动后才组合出来；因此启动时先从仍存活的 Cordis fiber registry 恢复历史注册，并在每次提示词组装发现 `systemPrompt` / `tools` 层的名字集合变化时按当前层再懒恢复一次：读取每个 plugin entry 的 callback 及其委托模块函数中的 section / `defineTool` 声明，再按 `fiber.getEffects()` 记录的 section/register 顺序精确配对，解决「明明是新启动的会话，`tool:jobs` / `tool:goal` 段落仍然存在」的启动顺序问题。该恢复不读取 section 正文、不做词干/前后缀/标签猜测，也不维护任何「包名 → 工具列表」的硬编码表；`tool:pty-panel` 这类 section 与工具分属不同 helper 的插件按模块函数声明配对。无法从声明恢复时保持旧行为（不误删）。issue #3 的「子代理 baseline 被上游 `restrict()` 裁空、按 Preset 策略判定折叠」路径保持不变。

## [1.2.13] - 2026-11-10

### Fixed

- 修复「按需组的开放状态读不出来」的问题：恢复逻辑只按 provider 形状读取 `tool/result`（`message.content` 里的 `tool-result` 块），而 DSH 落盘的是它自己的工具消息（`toolCallId` / `isError` 在 message 上，`content` 是 text/image 块）。于是原生 `tool_list` 调用在真实会话里一条都匹配不上，`restoredExposureNames()` 始终返回空——不只是 fork，重启 DSH 并恢复同一 Session 后组也照样隐藏。现在两种形状都读，错误结果（`isError`）仍然不算开放。
- 修复「`tool_list` 打开的按需组在 fork 出来的子会话里重新隐藏」的问题。此前恢复开放状态时跳过 `inheritedEventCount` 之前的 fork 前缀，于是子会话的历史里明明有一条成功的 `tool_list` 结果（写着这些工具「在本会话内可用」），工具却不在该步的工具集合里，模型调用还会被 guard 拒绝。现在恢复会读完整份 Session 日志，fork 子会话沿用 fork 点之前已开放的组；fork 点之后父 Session 新打开的组不在子会话日志里，仍保持隐藏，全新会话没有前缀，行为不变。

## [1.2.12] - 2026-11-06

### Fixed

- 修复「折叠的 `tool:*` 提示词段在子代理上未被隐藏」（issue #3）。子代理在 tool-manager install 之前就被委派层 `childCtx.tools.restrict(toolFilter)` 裁过工具面，baseline 里可能一个被折叠工具都没有，`denyNames()` 因此返回空、`system-prompt/assemble` 直接放行，全局注册的 `tool:<名称>` 段照旧出现在子代理提示词里。现在段落判定不再只依赖 baseline：只要该工具落在预设的 `disabled` 里，或命中某个未 open 的按需组 patterns，就按「已折叠」处理并删除其说明段；`tool:<名称>`、`mcp:<服务器>`、`mcp-resource-servers` 三种段落都适用。族内成员取 baseline 与实际策略字面名的并集，全部被隐藏才删除，任一可见则保留。
- 修复「工具已收进按需组或已关闭，系统提示词里却仍保留只介绍这些工具的段落」的问题。此前只按 `tool:<名称>` 剔除单工具说明段，因此 MCP 的 `mcp-resource-servers`（三个共享资源工具）和 `mcp:<服务器>`（服务器 instructions）即使对应工具全部不可见也照样出现在提示词里，模型会读到「可以调用」的指令却找不到工具，调用还会被 guard 拒绝。DSH 的提示词段落没有工具归属元数据，现在按命名约定把段落归到工具族：`tool:<名称>`、`mcp:<服务器>`（该服务器全部 `mcp__<服务器>__*` 工具）、`mcp-resource-servers`（三个共享资源工具）。族内工具**全部**被隐藏时整段删除，任一工具可见则保留；无归属或族内没有注册工具的段落不处理。
- 修复「安装新插件后，把它的工具加入按需组，新旧会话都不生效，必须重启 DSH」的问题。按需组是否有效取决于该 Agent 的 baseline（继承工具名快照），而 baseline 只在 `install()`（`agent/created`）与 `tools/change` 时刷新；插件热装/组合重载可能把工具注册落在两者之间，于是组解析为 0 个工具、从目录里消失，组内工具反而一直可见，直到重启重建快照。现在每一步都在 `tools.resolve()` 之前、`agent/pre-step` 里以及 `tool_list` 打开组时用 live `schemas(agent)` 核对 baseline（一次 map 遍历）：只要 live 面出现快照没有的名字，就立即采用并 `reconcile()`，新工具在当步就归入按需组并从该步的工具集合中剔除，目录同一步更新，不需要重启。只对「新增」生效——工具面收缩可能是组合切换的空窗，仍交给 `tools/change` 的防抖刷新，避免为一步把组内工具放出来。
- 修复本插件的 HTTP 路由在插件重载后残留的问题：`context.inject(["webServer"], ...)` 的回调没有保留也没有返回 `webServer.register()` 的 disposer，重载后新实例注册同一路径会抛 `webserver: duplicate exact route`，而旧实例的 handler 仍在服务——设置页会继续读写一个已经没人驱动的 runtime。现在所有路由的 disposer 都被收集，并在注入作用域卸载时统一释放；若中途某条路由被拒绝，已注册的部分也会立刻回滚。

### Changed

- 最低支持的 DSH 版本提升到 `0.2.2-rc.1`（`engines.dsh` 由 `>=0.2.0-rc.2` 改为 `>=0.2.2-rc.1`）。提示词段落隐藏现在依赖 `0.2.2` 的 `PromptPresentation` 语义（工具声明在 waterfall 之后挂回），工具隐藏依赖 `tools.resolve()` 的 per-step 过滤，两者都是 `0.2.2` 才有的能力。仍停留在 `0.2.0` / `0.2.1` 的用户请继续使用 `1.2.11`；升级到 `0.2.2` 前记得移除 `tools.mode` / `DSH_TOOLS_MODE`，并把 Node.js 升到 24.9 以上。
- README 同步适配范围（`>=0.2.2-rc.1`，旧版用 `1.2.11`）。
- 版本提升至 `1.2.12`。

## [1.2.11] - 2026-11-05

### Fixed

- 适配 DSH 0.2.2（含 `0.2.2-rc.1`）：`system-prompt/assemble` 的载荷由 `PromptAssembly` 改为 `PromptPresentation`，只带 `sections` / `contexts` / `variables`，工具声明改由工具注册表在 waterfall **之后**挂回。旧实现要求载荷同时包含 `tools` 数组，在 0.2.2 上判断失败并原样返回，导致 `tool:<名称>` 提示词段落不再剔除。现在只要求 `sections`：旧版继续同时过滤工具声明与段落，新版过滤段落文本。
- 恢复 DSH 0.2.2 上「所有工具都能隐藏」的行为：新增 per-step 过滤，包装 `tools.resolve()` 返回的准入集合，把策略隐藏的工具名从该步的工具集合中剔除。0.2.2 的提示词工具声明、PTC 绑定与执行查找全部由这份集合派生，因此按 **Agent 自身作用域** 注册的工具（`subagent`、`list_subagent_models`、`schedule_*` 等）与全局工具表现一致：未打开按需组或已关闭时，既不在模型工具列表中，也无法调用。这是 `tools.restrict()` 之外的补充路径——`restrict()` 按设计只作用于 global/祖先层，无法隐藏 Agent 自身作用域的注册。包装只改写 `view()` 的投影，失败时原样返回 Host 的集合，插件卸载时还原；旧版 DSH 没有 `resolve()`，自动跳过。
- 若上述包装无法安装（Host 改动了该接口），保留 0.2.2 的降级路径并**只告警一次**：继续过滤提示词段落，调用仍由 guard 拦截，并列出受影响的工具名。

### Changed

- 移除工具目录快照中的 `trust` 字段：DSH 自 0.1.7 起不再上报 Preset 信任级别，快照此前始终填 `system`，属于误导性数据；设置页从未渲染该字段。
- README 补充 DSH 0.2.2 的适配范围、Node.js 24.9 最低要求，以及升级前需移除 `tools.mode` / `DSH_TOOLS_MODE` 的提醒。
- 版本提升至 `1.2.11`；`engines.dsh` 保持 `>=0.2.0-rc.2`，0.2.1 用户无需改变。

## [1.2.10] - 2026-10-08

### Fixed

- 修复保存按需分组时把「只按 Agent 作用域注册」的工具误判为空组、导致无法保存的问题。典型表现：为 `@deepseek-ai/dsh-schedule` 提供的 `schedule_create` / `schedule_list` / `schedule_delete` / `schedule_update` 建组后点保存，报 `Preset "standard" has empty tool groups: "定时提醒管理"`，而页面明明列出了这些工具、`tool_list` 也能正常打开该组。根因是保存校验只读 Preset 的 standing composition（`acquireScope()`），而页面目录是 standing 与 Agent 作用域注册（探针 + 运行中 Agent 观测）的并集；`subagent` 等由 `modelSelectionSettings` 注入的工具同样受影响。现在校验与页面使用同一份目录，并且只在真正读不到 standing composition 时才跳过该校验。同时修正了同一根因下的两个次生问题：仅含 Agent 作用域工具的组里出现已关闭成员时误报「空组」而非「已关闭工具不能入组」，以及两个此类组之间的重复成员漏检。

## [1.2.9] - 2026-10-08

### Changed

- 适配 DSH 0.2.0-rc.2：`engines.dsh` 提升为 `>=0.2.0-rc.2`，README 同步标明适配范围；旧版本请继续使用 `1.2.8`。
- 工具管理页「工具目录」面板补充说明：`tool_list` 只在当前 Preset 有有效按需组时才出现（保存后从下一个模型步骤生效），没有有效按需组时模型看不到它；并说明它由插件自动管理，不出现在本页工具目录中，也不能在本页开关或分组。

## [1.2.8] - 2026-09-23

### Changed

- 适配 DSH 0.1.7：Preset standing 目录改为 `agentPresets.acquireScope()`，并在读完 schema 后释放租约。`standingKeyFor()` 已从 DSH 移除，继续调用会让设置页快照和保存校验失败。
- 插件管理页补充中英文 `locale` 标题与描述。
- 设置页 API 请求改为相对当前文档 base URI，避免 Web 部署在反向代理子路径下打到错误主机。
- `engines.dsh` 提升为 `>=0.1.7-alpha.1`。
- README 标明仅适配 DSH 0.1.7-alpha.1 及更新版本；更早版本请继续使用 `1.2.7`。

## [1.2.7] - 2026-09-18

### Fixed

- 修复在其他设置页与“工具管理”之间往返时，动态 Agent 作用域工具可能隔次从目录消失、又隔次恢复的问题。Preset 目录现在保留已完成的 live/probe 观测并与当前观测取并集，避免在 `tools/change` 后的短暂注册空窗中把 `subagent`、`list_subagent_models` 等真实工具误报成“已不存在的关闭项”。

## [1.2.6] - 2026-09-18

### Fixed

- 按需组尚未打开时直接调用组内工具，现在会明确提示该工具所属的按需组，并给出需要先调用的 `tool_list` 参数；不再误报成工具已被 Preset 策略关闭。明确关闭的工具仍保留原有禁用提示。

## [1.2.5] - 2026-10-22

### Fixed

- 新增**通用**的组合切换自愈（[`src/composition-watch.ts`](src/composition-watch.ts)）：插件监听 `tools/change`，发现某个会话的 Preset 发生切换后，把它借另一个 Preset（`compositionInventory()` 中 composition row 最少者，通常是极简模式）空转一圈再切回目标 Preset。旧 composition 在离开时执行的 `removeScoped()` 会连带丢掉 DSH 因撞名失败而永久缓存的记录，目标 composition 于是在一个没有同名注册的 Agent 上干净安装。该机制**不含任何工具名假设**：任何插件按 Agent 注册的工具、无论丢了几个，都走同一条路径恢复。只对**未开始对话的空白会话**执行（DSH 本身也只允许空白会话切换模式），用 `recompose()` 因而不写会话记录、界面无感知；两条腿串行且第二条永远执行，失败会回滚到目标 Preset 并告警；已经开始的会话不被改动，只按探针参照系报出缺失工具并提示重开。自愈成功时输出一条自我报告日志（`... re-calibration restored them.`）。

- 定位并缓解“标准模式新建会话 → 切到创造模式后丢失 `subagent` / `list_subagent_models`”：根因是 DSH 自身的组合切换竞态（`@deepseek-ai/dsh-tool-subagent` 的按 Agent 注册与上一个 composition 的异步拆除竞速，失败后该 Agent 被永久记住），与本插件的开关策略无关（出问题的会话里 `disabled` 为空、也不存在隐藏这两个工具的按需分组）。插件侧现在于加载时立刻组合部署默认 Agent Preset 的 standing composition，并让此后所有由插件发起的 mount（冷 Preset 探针、自动命名/自动分组、保存校验、快照）都先等它完成，从而不再由插件引入反向顺序。分析与上游修复建议见 [docs/composition-switch-race.md](docs/composition-switch-race.md)。
- 修复共享冷 Preset 探针在切换作用域时把上一 Preset 的动态 Agent 工具串入下一 Preset 目录的问题；例如“极简模式”不再误显示仅 standard/ptc/cordis 提供的 `subagent` 和 `list_subagent_models`。
- 探针切换后会等待动态作用域注册完成清理，并且探针自身的过渡态不再写入运行中 Agent 的持久观察缓存。
- 修复 Preset 切换或新会话初始化期间，动态 Agent 作用域工具短暂卸载时被采样为永久 baseline，导致在 standard 关闭代理工具后，创造模式中的 `subagent` / `list_subagent_models` 也消失且重新开启无法恢复的问题；工具目录变化现在延迟到下一事件循环再刷新。

## [1.2.4] - 2026-10-22

### Fixed

- Preset 动态工具探测不再为每次页面请求和每个空闲 Preset 创建随机 `tool-manager-probe-*` Session。现在所有冷 Preset 串行复用唯一的 `tool-manager-probe-internal-v1`，跨插件重载恢复同一个持久化 Session，并以 `origin: subagent` 从普通会话列表隐藏。
- 固定探针恢复失败时直接报错并回退现有工具目录，不创建随机或递增 ID 的替代 Session，避免会话存储持续增长。

## [1.2.3] - 2026-10-22

### Fixed

- 修复仅在 Agent 自身作用域注册的工具（如启用 `modelSelectionSettings` 后动态注入的 `subagent`）在工具管理页面无法显示、无法关闭的问题：现在通过运行中 Agent 的真实工具目录与必要时对空闲 Preset 临时挂载探测 Agent 来补齐页面目录，不再依赖工具名硬编码。
- 修复关闭 Agent 本地作用域注册的工具后，模型请求仍然能看到该工具并附带 `tool:<name>` 提示词段的问题：在 `system-prompt/assemble` 阶段过滤 `assembly.tools` 与对应提示词段，并安装 `tools.guard()` 拒绝执行已关闭工具，与原有 `tools.restrict()` 形成三层防护。
- 自动命名与自动分组的可用工具目录也同步使用相同合并策略，避免页面能关闭的工具在生成接口中找不到。

## [1.2.2] - 2026-09-17

### Changed

- 工具管理页中“自动分组”旁的“分组”按钮改名为“手动分组”，让操作含义更明确。

### Fixed

- 修复通过 `tool_list` 打开的按需工具组在 DSH 重启并恢复同一 Session 后重新隐藏的问题；现在会从成功的原生或 PTC 工具调用事件恢复开放状态，同时新建会话和 fork 子会话仍保持默认隐藏。

## [1.2.1] - 2026-09-16

### Changed

- 自动命名和自动分组不再设置提示词、请求体、工具数量、分组数量、名称/描述长度、模型返回文本长度或输出 Token 上限；实际可用范围由当前模型、供应商和运行环境决定。
- README 新增工具管理页面截图。

## [1.2.0] - 2026-09-16

### Added

- 当前会话的工具组 catalog reminder 会显示每组的实际工具数量和完整工具名称。
- 自动分组确认框支持搜索、批量选择和单独勾选候选工具，只对选中的工具进行分组。
- 自动命名和自动分组支持预览、编辑及重置模型提示词，并校验提示词内容和长度。

### Changed

- 按需组必须至少匹配一个当前可用工具；WebUI 与 Host 保存接口都会阻止空组，运行时也不会向模型暴露旧配置中的空组。
- 工具状态改为互斥：已关闭工具不能加入按需组，一个工具也不能同时属于多个组；Host 会拒绝冲突配置，运行时对旧重叠配置按首个组唯一归属。
- 自动命名与自动分组改用带超时输入的确认框，默认超时分别为 60 秒和 120 秒，支持手动设置 5–600 秒。

### Fixed

- 将 `tool_list` 注册到 host 全局工具层，使 PTC 模式的生成 SDK 能看到它；没有按需组的 Preset 仍会把它隐藏。
- `tool_list` 的 schema description 不再罗列组名；当前会话可用组只出现在该会话的 catalog reminder 里。

## [1.1.1] - 2026-09-16

### Added

- 按 Agent Preset 开启或关闭工具。
- 将工具放入按需组，并通过 `tool_list` 像 Skill 一样在当前会话中开放原始工具。
- WebUI 工具管理页面、搜索筛选、分组编辑和配置保存。
- 使用当前默认模型生成分组名称和描述。
- 自动整理尚未分组且未关闭的工具，并在确认前预览结果。
- 工具总量、分组数量、未分组、按需和已关闭统计。
- 独立配置文件、原子写入和 revision 冲突保护。

### Changed

- 分组创建和自动分组完成后保留当前工具目录筛选，不再自动跳转到“按需”。
- 页面草稿发生变化时显示未保存提醒，并在刷新或离开页面前提醒用户。
- README 改为面向用户介绍工具开关、分组和类似 Skill 的按需加载能力。
