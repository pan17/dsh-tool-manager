# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
