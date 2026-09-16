# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
