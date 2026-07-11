# 发布指南（安装 · 隐私 · 权限 · 恢复）

本文件对应架构计划第 8 节"编写安装、隐私、权限和恢复说明"，面向最终用户与运维人员。

---

## 1. 安装说明

### 1.1 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10 64 位及以上 |
| 内存 | 2 GB 以上（含模型调用缓存） |
| 磁盘空间 | 200 MB（含角色包与日志） |
| 网络 | 可选；断网时仍可使用本地提醒 |

### 1.2 安装步骤

1. 获取发布包 `PetFramework-portable.exe`（或 `release/Roxy桌宠-可发送版.zip`）。
2. 解压到任意可写目录（例如 `D:\PetFramework`）。**避免放入 `C:\Program Files`**，因为便携版需要对目录有写权限来存储数据库和日志。
3. 双击 `PetFramework.exe` 启动。首次启动会：
   - 在 `%APPDATA%\PetFramework` 下创建用户数据目录
   - 初始化 SQLite 数据库 `pet-data.sqlite`（执行 V1 migration）
   - 加载默认角色包 `character-packs/default`
   - 进入 Onboarding 引导
4. 按引导完成角色选择与 API Key 配置（可选，不配置也可使用本地功能）。

### 1.3 升级

升级到新版本时：

1. 关闭运行中的旧版本（右键托盘 → 退出）。
2. 用新版 `PetFramework.exe` 覆盖旧版可执行文件。
3. 启动新版本。
   - **用户数据不会丢失**：数据库、记忆、提醒、会话均存储在 `%APPDATA%\PetFramework`，与应用可执行文件分离。
   - 如检测到 schema 版本升级，系统会自动在数据库同目录创建 `.backup-{时间戳}` 备份文件（默认保留最近 3 份），然后执行 migration。
4. 如需回退到旧版本，恢复 `.backup-*` 文件为 `pet-data.sqlite` 即可。

### 1.4 卸载

1. 退出应用。
2. 删除应用目录（解压目录）。
3. 如需彻底清除用户数据，删除 `%APPDATA%\PetFramework` 目录。

### 1.5 开发模式

```powershell
npm install        # 自动触发 electron-rebuild 重建 better-sqlite3 原生模块
npm start          # 启动 Electron
npm run pack       # 生成免安装包到 release/
npm run dist       # 生成 portable 可执行文件
npm run rebuild    # 手动重建 native 依赖
```

---

## 2. 隐私说明

### 2.1 数据存储位置

| 数据类型 | 存储位置 | 说明 |
|---------|---------|------|
| 数据库 | `%APPDATA%\PetFramework\pet-data.sqlite` | 记忆、提醒、会话、消息、用户画像等 |
| 数据库备份 | `%APPDATA%\PetFramework\pet-data.sqlite.backup-*` | migration 前自动生成，保留最近 3 份 |
| 日志 | `%APPDATA%\PetFramework\logs\` | 运行日志，自动轮转 |
| 角色包 | `{安装目录}\resources\character-packs\` | 内置角色资源 |
| API Key | 操作系统 Keychain（`safeStorage`） | 加密存储，不明文落盘 |

### 2.2 数据流向

```
用户输入 ──→ ConversationGraph ──→ ModelGateway ──→ DeepSeek API
                                      │
                                      └─（API Key 从 Keychain 读取，不经过渲染进程）
```

- **渲染进程永远不接触 API Key**。所有模型调用在主进程完成，API Key 通过 `safeStorage` 加密后存储。
- 模型调用仅发送当前对话上下文与角色 Prompt，不发送无关历史数据。
- 记忆检索按需触发，仅当用户提到相关内容时检索对应记忆。

### 2.3 日志脱敏

日志系统会自动脱敏以下字段：

- `apiKey`、`api_key`、`secret`、`token`、`bearer`、`password` → 替换为 `[REDACTED]`
- Prompt 内容只记录长度，不记录全文
- 模型响应只记录长度，不记录全文
- 用户消息在 `ConversationGraph:create_reminder_branch` 中记录为 `[content-redacted]`

**验证方式**：运行 `npx tsx tests/unit/contracts.test.ts`，其中 Logger 测试用例验证 API Key、bearer token、password 字段均被脱敏。

### 2.4 数据导出

用户可通过 `BackupService.exportUserData(userId)` 导出全部个人数据：

- 导出格式：JSON
- 包含：记忆、提醒、任务、会话、消息、用户画像、角色关系、设置
- **排除**：所有 key 包含 `secret` 或 `api_key` 的设置项
- 导出文件不含 `graph_checkpoints` 表内容

**验证方式**：运行 `npx tsx tests/unit/fault-injection.test.ts`，`testBackupExportImport` 和 `testNoApiKeyLeakage` 验证导出文件不包含密钥。

### 2.5 模型调用预算

每轮对话的模型调用上限由 `maxModelCallsPerTurn` 控制（默认 3 次）。**每次 HTTP 调用（含重试）均计入配额**，确保费用保护覆盖真实 API 请求次数。超过上限的调用会被拒绝并记录日志。这避免恶意输入导致高昂的模型成本。

---

## 3. 权限说明

### 3.1 权限分级

| 权限等级 | 说明 | 典型操作 |
|---------|------|---------|
| `auto_allow` | 自动允许，无需用户确认 | 创建提醒、查看今日日程、切换表情 |
| `confirm` | 需要用户在对话框确认 | 修改用户画像、删除记忆 |
| `deny` | 始终拒绝 | 访问其他用户数据、执行系统命令 |

### 3.2 技能权限

每个技能注册时声明所需权限等级。`PermissionGuard` 在技能执行前检查：

```
用户消息 → Intent 识别 → 技能匹配 → PermissionGuard 检查
                                              ├─ auto_allow → 直接执行
                                              ├─ confirm → 生成 checkpoint，询问用户
                                              └─ deny → 拒绝并记录
```

### 3.3 Checkpoint 恢复机制

当技能需要用户确认时：

1. Graph 生成 `checkpointId`，将当前状态（reminder draft、缺失字段、错误）序列化为 JSON。
2. 通过 `checkpointRepository.save()` 存入 `graph_checkpoints` 表。
3. 向用户展示确认问题。
4. 用户回复后，Graph 启动时通过 `checkpointRepository.getActive()` 加载未消费的 checkpoint。
5. 合并状态后继续执行，通过 `checkpointRepository.consume()` 标记为已消费。

**容错**：checkpoint 加载失败时不会崩溃，会消费损坏的 checkpoint 并从初始状态继续。

**验证方式**：`testCheckpointSaveAndResume` 验证完整流程。

### 3.4 禁止事项

以下行为被系统设计阻止：

- Renderer 注入未知 IPC 通道 → 被 IPC 白名单拦截
- 模型尝试调用未注册技能 → `SkillRegistry` 返回未注册错误
- 技能输入包含目录穿越路径 → `CharacterPackManager` 检测并拒绝
- 角色 A 请求角色 B 的记忆 → `MemoryStore` 按用户 + 角色隔离
- 模型决定权限是否通过 → 权限由 `PermissionGuard` 静态判定，模型不参与
- 伪造 `permission_resolved` 事件 → 事件需匹配数据库中的待确认记录

---

## 4. 恢复说明

### 4.1 数据库损坏恢复

**症状**：启动时报 `SQLITE_CORRUPT` 或 `database disk image is malformed`。

**恢复步骤**：

1. 关闭应用。
2. 进入 `%APPDATA%\PetFramework`。
3. 找到最新的 `.backup-*` 文件（由 migration 前自动生成）。
4. 将 `pet-data.sqlite` 重命名为 `pet-data.sqlite.broken`。
5. 将最新的 `.backup-*` 复制为 `pet-data.sqlite`。
6. 重启应用。

如无备份文件，可删除 `pet-data.sqlite`，应用会重新初始化空数据库（原有数据将丢失，但应用可启动）。

### 4.2 角色包损坏回退

**症状**：启动时角色显示为占位图（彩色方块），日志报 `character pack load failed`。

**机制**：`CharacterPackManager.load()` 在加载失败时自动回退到上一个可用的角色包。首次启动时如默认包损坏，会抛出 `CharacterPackInvalidError`。

**恢复步骤**：

1. 检查 `{安装目录}\resources\character-packs\default\` 下文件完整性。
2. 如文件损坏，从发布包中重新解压 `character-packs/default` 目录覆盖。
3. 重启应用。

### 4.3 模型调用失败降级

| 失败类型 | 错误码 | 行为 |
|---------|--------|------|
| 网络超时 | `network_timeout` | 自动重试 2 次（指数退避 500ms → 1s），每次重试计入配额 |
| 网络故障 | `network_failure` | 自动重试 2 次，每次重试计入配额 |
| 模型不可用 | `model_unavailable` | 自动重试 2 次；配额耗尽后不再降级 |
| 模型输出错误 | `model_invalid_output` | **不重试**（4xx 错误，重试无意义） |
| 无 API Key | `model_unavailable` | 返回失败，本地提醒功能仍可用 |

**断网场景**：

- 本地提醒（已存储在数据库中的 reminders）照常触发
- 对话功能不可用，但应用不会崩溃
- `ConversationGraph` 会返回错误 DTO，UI 显示"无法连接网络"

**验证方式**：`testOfflineRemindersWork`、`testRetryOnTransientFailure`、`testNoRetryOnNonRetryable`、`testRetryExhaustedThenFallback`。

### 4.4 预算耗尽降级

当模型调用次数达到 `maxModelCallsPerTurn`（默认 3）时：

- 后续调用被 `ModelCallLimitExceededError` 拒绝
- Graph 不会崩溃，返回当前已生成的响应
- Reflection 任务入队但标记为待重试

**验证方式**：`testBudgetExhaustion` 验证预算为 1 时 Graph 仍正常运行。

### 4.5 数据迁移失败

**症状**：启动时 migration 报错。

**机制**：migration 在单个事务内执行，任一 SQL 失败则整体回滚，数据库回到 migration 前状态。migration 前已自动备份。

**恢复步骤**：

1. 查看 `%APPDATA%\PetFramework\logs\` 下最新日志，定位失败 SQL。
2. 如为磁盘空间不足，清理空间后重启。
3. 如为 schema 冲突，使用 `.backup-*` 文件回退数据库。
4. 重新启动应用。

### 4.5.1 旧版 JSON 数据迁移

从旧版本升级时，系统会自动将旧版 JSON 数据迁移到 SQLite：

- **迁移内容**：用户档案（昵称、称呼）、记忆（user/longTerm/shortTerm）、好感度、API 配置（provider/endpoint/model，不含 API Key）
- **幂等性**：通过 `app_settings` 中的 `migration.legacy_json.completed` 标记确保只执行一次
- **不覆盖**：如用户已通过 Onboarding 配置过设置，旧值不会覆盖新值
- **不删除原文件**：迁移后 `pet-data.json` 和 `api-config.json` 保留在原位
- **API Key**：仍由 `safeStorage` 加密管理，不迁移到 SQLite（通过 `SecretStore` adapter 读取）

**验证方式**：`npx tsx tests/unit/legacy-migration.test.ts`

### 4.6 日志清理

日志目录 `%APPDATA%\PetFramework\logs\` 不会自动清理。建议定期手动删除旧日志文件。

数据库备份文件自动保留最近 3 份，超出部分由 `backupDatabaseIfNeeded()` 自动清理。

Checkpoint 表中已消费超过 1 天的记录可手动清理：`checkpointRepository.cleanConsumedBefore(1)`。

---

## 5. 测试清单

发布前需运行完整测试套件，所有测试必须通过：

```powershell
# 契约与基础
npx tsx tests/unit/contracts.test.ts          # 19 tests
npx tsx tests/unit/database.test.ts           # 54 tests
npx tsx tests/unit/character-pack.test.ts     # 71 tests
npx tsx tests/unit/app-paths.test.ts          # 28 tests

# Graph 流程
npx tsx tests/unit/onboarding-graph.test.ts    # 47 tests
npx tsx tests/unit/conversation-graph.test.ts # 78 tests
npx tsx tests/unit/proactive-graph.test.ts    # 57 tests
npx tsx tests/unit/reflection-graph.test.ts   # 87 tests

# 故障注入
npx tsx tests/unit/fault-injection.test.ts    # 50 tests

# 数据迁移
npx tsx tests/unit/legacy-migration.test.ts   # 36 checks

# 旧版 harness（可选，过渡期保留）
npm run test:harness
npm run test:crash-recovery
npm run test:api-security
```

**总计：527 个新架构测试 + 旧版 harness 测试，0 失败方可发布 V1。**

---

## 6. 打包验证

### 6.1 打包前检查

1. 确认 `npm run rebuild` 执行成功（`better-sqlite3` 原生模块已针对 Electron 31.7.7 重建）。
2. 确认 `character-packs/default` 目录完整（含 `manifest.json`、`persona.json`、`prompt.md`、`motion-map.json`、`spritesheet/`）。
3. 确认 `package.json` 中 `build.files` 包含 `app/**/*`、`dist/**/*`、`package.json`（`dist/` 为编译后的新架构 JavaScript）。
4. 确认 `build.extraResources` 配置了 `character-packs → character-packs` 映射。
5. 确认 `build.asarUnpack` 包含 `node_modules/better-sqlite3/**/*`（native 模块不能打包进 asar）。

### 6.2 干净环境验证

在未安装 Node.js、Electron、Codex 的干净 Windows 机器上：

1. 解压发布包到 `D:\PetFramework`。
2. 双击 `PetFramework.exe`。
3. 验证：
   - 应用正常启动，显示桌宠窗口
   - 默认角色加载成功（非占位图）
   - 数据库文件在 `%APPDATA%\PetFramework\pet-data.sqlite` 创建
   - 日志文件在 `%APPDATA%\PetFramework\logs\` 创建
   - Onboarding 流程正常进入
4. 配置 API Key 后验证对话功能。
5. 断网后验证本地提醒功能。

### 6.3 路径验证

打包环境下的路径映射：

| 用途 | 开发模式 | 打包模式 |
|------|---------|---------|
| 数据库 | `{cwd}/data/pet-data.sqlite` | `%APPDATA%\PetFramework\pet-data.sqlite` |
| 日志 | `{cwd}/data/logs/` | `%APPDATA%\PetFramework\logs\` |
| 角色包 | `{cwd}/resources/character-packs/` | `{exe目录}\resources\character-packs\` |
| 备份 | `{cwd}/data/backups/` | `%APPDATA%\PetFramework\backups\` |

路径解析由 `src/infrastructure/config/app-paths.ts` 的 `resolveAppPaths()` 统一管理，调用方（main 进程）传入 `isPackaged`、`userDataDir`、`resourcesDir`。

---

## 7. V1 修正状态

本节记录 V1 计划修正后的实际完成状态。

### 7.1 已完成并验证

| 修正项 | 状态 | 说明 |
|--------|------|------|
| P0-1 新架构接入 Electron | 已完成 | `app/main.js` 加载 `dist/main/integration.js`，聊天走新架构 + 旧链路 fallback |
| P0-2 打包产物包含 dist | 已完成 | `package.json` 新增 `build:ts` 脚本，`build.files` 包含 `dist/**/*` |
| P0-3 角色包打包路径 | 已完成 | `build.extraResources` 映射 `character-packs → character-packs` |
| P0-4 提醒主链修复 | 已完成 | 追问继续创建、下午时间解析、缺失时间追问、重复提醒首触发、recurrence 格式统一 |
| P0-5 Scheduler 两阶段投递 | 已完成 | `markOccurrencePending` → outbox → `markOccurrenceDelivered` |
| P1-1 stub 实现 | 已完成 | Notification（Electron API）、Sound（shell.beep）、Fullscreen 接线、Reflection Worker |
| P1-2 Onboarding 中断恢复 | 已完成 | 条件边 + `resumeWithPreferences` 方法 |
| P1-3 IPC Schema 真实使用 | 已完成 | `app/main.js` 调用 `validateIpcInput` 校验所有 IPC 输入 |
| P1-4 Safe Shell 移除 | 已完成 | V1 中 Safe Shell IPC 返回"不可用"消息 |
| P1-5 旧 JSON 数据迁移 | 已完成 | `legacy-json-migrator.ts` 幂等迁移，36 项测试通过 |
| P2-2 模型调用上限修复 | 已完成 | 重试计入 HTTP 次数，配额耗尽停止重试和降级 |

### 7.2 已知限制（V1 不阻塞）

- **P2-1 测试覆盖**：单元测试 + 集成测试均已覆盖（含 ACK、Reflection 恢复、记忆隔离、天气 Adapter、Onboarding 流程），但无 Electron 窗口级真实 E2E。建议在打包后进行手动 smoke test。
- **P2-3 路径前缀绕过**：`CharacterPackManager` 和 `SpriteSheetRenderer` 使用 `path.relative()` + `..` 检查已在之前修复。角色包资源通过 `pet-character://` 自定义协议访问，限制在角色包目录内。
- **Onboarding UI**：已实现完整的 Onboarding 表单和恢复入口（`submitOnboardingPreferences` + `resumeOnboarding`），首次启动自动触发。
- **天气适配器**：已接入 Open-Meteo 真实 API（Geocoding + Forecast），支持缓存（30 分钟 TTL）和过期缓存回退。需用户在 Onboarding 中明确授权联网。

### 7.3 发布前必做

1. 执行 `npm run build:ts` 生成 `dist/`。
2. 运行全部测试套件（见第 5 节）。
3. 在干净环境验证打包产物。

---

V1 发布检查清单修正完成。新架构已接入 Electron、打包配置已修正、数据迁移已实现、费用保护已完善。

---

## 8. 新架构验证（LangGraph）

V1 之后框架运行 LangGraph 新架构，发布前必须验证打包版实际运行的是新架构，而不是静默回退到旧链路。

### 8.1 验证方式

1. 运行自动测试（推荐）：

```powershell
npm.cmd run test:packaged-new-arch
```

该测试会启动真实的 `release/win-unpacked/PetFramework.exe`，使用隔离的 `--user-data-dir`，通过 `architecture:get-status` IPC 验证 LangGraph 已实际运行。

2. 手动验证：打开应用后点击"状态"按钮打开 State 面板，查看 "Agent 架构状态" 区域。

3. 读取状态文件：检查 `userData/architecture-status.json`，确认 `state` 字段为 `langgraph_ready`。

### 8.2 架构状态说明

| 状态 | 含义 |
|------|------|
| `langgraph_ready` | 新架构正常初始化，`ConversationGraph` 处理聊天 |
| `initialization_failed` | 新架构加载失败，回退旧链路，UI 显示红色警告 |
| `loading` | 正在初始化，尚未完成 |

新架构采用 **no-silent-fallback** 行为：如果加载失败，不会静默回退到旧链路，而是写入 `initialization_failed` 状态并在 UI 显示红色警告，便于发现和排查问题。

### 8.3 失败排查

1. 检查 `userData/architecture-status.json` 中的 `error` 字段（已脱敏，不含 API Key）。
2. 常见失败原因：
   - `@langchain/core` 未打包进 `app.asar`（依赖配置错误，需移到 `dependencies`）
   - `better-sqlite3` ABI 与 Electron 版本不匹配（需 `npm run rebuild`）
   - 数据库 migration 失败（查看 `%APPDATA%\PetFramework\logs\` 下最新日志定位失败 SQL）

### 8.4 打包依赖检查

`app.asar` 必须包含以下依赖：

- `node_modules/@langchain/core/`
- `node_modules/@langchain/langgraph/`
- `node_modules/zod-to-json-schema/`

`test:packaged-new-arch` 会自动检查这些依赖是否存在于打包产物中，并验证新架构实际启动。如果上述依赖未在 `package.json` 的 `dependencies` 中，electron-builder 不会将其打包进 `app.asar`，导致打包后新架构无法加载（这是 V1 修复的 P0 问题）。
