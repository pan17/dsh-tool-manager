# 发布与部署指南

## 发布前检查

### 检查 README.md 是否需要同步

README 是用户文档，以下情况**需要更新**：
- **用户可见的行为变更**（工具开关、分组、按需加载、页面交互变化）
- **功能增减**（新增特性或移除功能）
- **安装方式变化**（包名、安装命令变化）
- **配置选项变化**（新增/删除配置键、环境变量变化）

以下情况**不需要更新**：
- 内部逻辑优化但用户行为不变
- 仅修改注释、变量名、代码结构
- 纯 bug 修复（行为修正到预期状态）

### 检查 CHANGELOG.md 是否需要同步

CHANGELOG.md 是 GitHub Release Notes 的数据源，以下情况**需要更新**：
- **每次发版前**：在 `[Unreleased]` 下方写好本次版本的变更说明
- **用户可见的变更**：新增功能、行为变化、Bug 修复
- **格式**：遵循 [Keep a Changelog](https://keepachangelog.com/) 规范，分 `Added` / `Changed` / `Fixed` / `Removed` 等分类

以下情况**不需要更新**：
- 内部重构（不影响用户）
- 文档/注释调整

### 检查 DSH 版本约束

确认 `package.json` 的 `engines.dsh` 是否需要更新，通常使用精确版本：`"dsh": "=x.y.z"`。

---

## 发布流程

### 0. 本地构建与测试（必做）

发版前先在本地跑一遍，确认 build 和 test 都通过再推 tag：

```bash
npm ci          # 安装依赖（lockfile 精确版本）
npm run build   # tsc → dist/ + client bundle
npm test        # node:test 全部用例
```

发布前可本地验证产物：

```bash
npm pack --dry-run   # 查看将发布的文件清单（dist/、README、LICENSE、cordis.patch.yml 等）
```

### 1. 更新 CHANGELOG.md（必做）

在 `[Unreleased]` 下方写好本次版本的变更说明，格式遵循 [Keep a Changelog](https://keepachangelog.com/)：

```markdown
## [0.1.1] - 2026-08-16

### Added
- 新增功能...

### Changed
- 行为变化...

### Fixed
- Bug 修复...
```

> 这是 GitHub Release Notes 的数据源，**每次发版必做**。抽不到该版本段落，`release` job 会直接失败。

### 2. 更新版本号

用一条命令同时改 `package.json` 与 `package-lock.json`（版本号在 lockfile 里也出现，手改一处会让 `npm ci` 失败）：

```bash
npm version 1.5.1 --no-git-tag-version
```

> 注意：`dsh-tool-manager` 曾在 npm 发布过 `1.1.0` 后被撤回。该版本号永远不能再用。首次重新发布建议使用 `1.1.1` 或更高版本。

### 3. 提交代码并推送 Tag

注意，执行下列步骤前需要发送消息（已完成以上检查和修改）获取用户确认，然后才能执行。

```bash
git add -A
git commit -m "release: v1.5.1"
git tag v1.5.1
git push origin main --tags
```

> **tag 必须与 `package.json` 的 `version` 完全一致**：`verify` job 会在动手前比对 `v$version` 与 tag 名，不一致直接失败，此时还没有创建 Release 或 npm 版本，删 tag 重打即可。

> **注意**：`git push` 的"同步"按钮**不会推送 tags**，必须单独执行 `git push origin --tags` 或 `git push origin v1.5.1`。

### 4. 自动验证与发布

推送 tag 后，GitHub Actions 自动触发 `.github/workflows/release.yml`，依赖链是 `verify → release → publish-npm`：

1. **`verify`** — 在**该 tag 指向的提交上**自己跑 `npm ci` / `npm run build` / `npm test`，并校验 tag 与 `package.json` 的 `version` 一致。不一致就在这里失败，此时**还没有**创建任何 Release 或 npm 版本，删掉 tag 重打即可，无副作用。
2. **`release`** — 从 CHANGELOG 抽取该版本段落，创建 GitHub Release。抽不到该版本段落会失败。
3. **`publish-npm`** — `npm ci` → `npm publish`（`prepublishOnly` 已内置 build + test 双保险，工作流不再重复 build）。

> **为什么不再轮询 CI**：早期版本用 `gh api` 轮询该提交的 CI 结论。但 `ci.yml` 只在 `push: branches: [main]` 触发，单独推 tag 时根本没有 CI 可等（必然超时），所以现在 `verify` 在 tag 提交上原地验证，没有需要等待的对象。

> **`publish-npm` 等的是 `release`，不是 `verify`**。这是有意的：Release 创建失败（CHANGELOG 缺段落、API 抖动）时 npm 必须**不发**，否则两个产物会漂移。

> **前置条件（npm 认证走 OIDC Trusted Publishing，不需要 secret）**：`publish-npm` 不读任何 token，而是用 GitHub Actions 的 OIDC 身份向 npm 换一个短时凭证。第一次配置：
>
> 1. npmjs.com → 包 `dsh-tool-manager` → **Settings → Trusted publishing** → Add trusted publisher → **GitHub Actions**；
> 2. 填 **Organization or user** `pan17`、**Repository** `dsh-tool-manager`、**Workflow filename** `release.yml`（只写文件名、必须带 `.yml`）；
> 3. **勾上 Allow `npm publish`**——2026-09-03 之后创建的配置默认只允许 `npm stage publish`，不勾这一项直接 `npm publish` 会被拒；
> 4. 保存后 **2 天内**必须完成一次成功发布，否则配置作废（只能删掉重建）。
>
> 依赖门槛：npm ≥ 11.5.1、Node ≥ 22.14、GitHub 托管 runner，三者 workflow 里已钉住（Node 24 + 显式升级 npm）。`package.json` 的 `repository.url` 必须与 GitHub 仓库一致。首次发布成功后可以再收紧：包 Settings → Publishing access → **Require two-factor authentication and disallow tokens**，并删掉仓库里已失效的 `DSH_TOOL_MANAGER` secret。
>
> **发布后核对**：npm 提示「Your package is being processed」后通常要等 1–3 分钟才可查。用 `npm view dsh-tool-manager version` 确认 `latest` 已指向新版本——`publish-npm` 显示成功只代表上传完成，registry 生效有延迟。

### 失败时怎么办

| 失败点 | 后果 | 处理 |
|---|---|---|
| `verify` 红（测试或 tag/版本不一致） | 无 Release、无 npm 版本 | 修好、删 tag 重打（`git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`，再 `git tag vX.Y.Z && git push origin vX.Y.Z`） |
| `release` 红（CHANGELOG 缺该版本段落） | 无 npm 版本 | 补 CHANGELOG 后重打 tag |
| `publish-npm` 红（`E404 ... PUT https://registry.npmjs.org/dsh-tool-manager`） | Release 已存在、npm 没有 | 404 是「没认证上」，不是「包不存在」：token 已失效，或 trusted publisher 没配对。按上面的 OIDC 前置条件配好后 `gh run rerun <run-id> --failed` |
| `publish-npm` 红（其它原因） | Release 已存在、npm 没有 | `gh run rerun <run-id> --failed` 重跑即可，**不需要**重打 tag |

> 重打 tag 的前提是 npm 上**还没有**这个版本，先 `npm view dsh-tool-manager@X.Y.Z version` 确认 404。
