# Bug 证据闭环与外部写入硬门设计

日期：2026-08-27
状态：设计已确认，待实施计划
适用仓库：`agent-dev-scaffold` 源模板及已安装该模板的项目

## 1. 背景

一次真实 Bug 修复流程暴露出三类假完成风险：

1. Bug 源表状态与本轮验证状态共用一个 `status` 字段，报告无法区分“飞书仍待修复”和“代码已完成浏览器验证”。
2. Harness 证据已经写入 `.agent/evidence/`，但 Bug 报告只读取 Bug 目录下的截图，报告仍显示“暂无证据”。
3. 第三方 Canvas 表格可以在 DOM/公式栏中显示新文本，但没有真正提交云端；只有新标签重新读取时才能发现目标单元格仍为空。

底层任务记忆状态机没有失效。它在独立回读失败后保留了未完成 DoD，并记录 `fail-step`。缺口位于状态机之上的 Bug 扩展、报告新鲜度和外部写入证据契约。

## 2. 目标

- 将酒店项目已经验证过的 Bug 台账、架构扫描和报告能力提升为源模板的可选 Bug 修复扩展。
- 让源系统状态与本轮验证状态并存，禁止互相覆盖或推导。
- 让报告直接回读 Bug 文本证据、图片和 harness JSON 证据。
- 让报告对依赖数据建立内容指纹；台账或证据变化后，旧报告必须被判定为 stale。
- 对外部写入步骤增加独立真实回读硬门；没有持久化回读 PASS，不得 `commit-step`。
- 在不覆盖源仓库现有未提交升级的前提下，完成源模板和当前酒店项目的同步升级。

## 3. 非目标

- 不在 harness 内实现飞书、Google Sheets 或其他第三方产品的浏览器驱动。
- 不承诺跨 Git、文件系统、数据库和第三方系统的 ACID 事务。
- 不根据本轮验证结果自动修改源系统状态列。
- 不把运行时 `.agent/tasks`、`.agent/journal`、`.agent/evidence` 提交到 Git。
- 不把“DOM 中出现文本”“点击后无报错”或 HTTP 200 当作外部写入成功。

## 4. 当前基线与集成边界

`/Users/git/AI/agent-dev-scaffold` 当前 `main` 基于 `5d1fae3`，存在一组已授权保留的未提交升级，主要包括：

- 7 阶段默认方法论与独立页面契约阶段；
- 逐系统 worklist；
- DoD/依据在看板展开；
- post-commit 看板刷新；
- `docs/viewer.html` 产物可视化。

本设计必须叠加在这些改动之上。不得 reset、stash、回退或用干净 `origin/main` 覆盖它们。最终实施需先验证这组基线，再验证新增能力，最后作为同一升级批次提交。

## 5. 总体架构

新增两个彼此独立但可组合的能力层：

```text
任务记忆/状态机
  ├── External Effect Gate（通用）
  │     step.effect=external-write
  │     external-write-attempt evidence
  │     external-readback evidence
  │     commit-step hard guard
  │
  └── Bugfix Extension（可选）
        bug import / merge
        dual-status ledger
        repo-map
        evidence-aware report
        report freshness manifest/check
```

External Effect Gate 不依赖 Bug 模块，可供邮件发送、表格回填、权限修改、部署配置写入等任务使用。Bugfix Extension 只在项目启用 Bug 修复流程时安装或启用。

## 6. Bug 台账契约

### 6.1 核心字段

每条 Bug 至少支持：

```json
{
  "id": "BUG-001",
  "source_key": "feishu:sheet-id:row-27",
  "source_row": 27,
  "source_url": "https://...",
  "source_status": "待修复",
  "verification_status": "已验证",
  "verification_scope": "正式环境浏览器",
  "verified_at": "2026-08-27T10:00:00+08:00",
  "verification_note": "真实页面回读摘要",
  "evidence_refs": ["ev:abc123"]
}
```

`status` 保留为向后兼容字段，只表示源状态。新代码优先读 `source_status`，不得用 `verification_status` 覆盖源状态。

### 6.2 导入与合并

- 导入器不得直接丢弃已验收/已关闭记录；应保留完整源快照，并用 `in_scope` 或 CLI 状态过滤决定本轮处理范围。
- 默认范围可配置为 `待修复,待开发`，但报告仍可展示历史已验收记录。
- 重复导入按 `source_key` 合并；没有 `source_key` 时依次回退到稳定源 ID、源行号和 Bug ID。
- 重新导入只能更新源字段，不得清除已有验证字段和证据引用。
- 源行删除时标记 `source_presence=missing`，不得静默删除历史验证记录。

## 7. 证据契约

### 7.1 通用证据元数据

证据文件继续存于 `.agent/evidence/<task-id>/ev_<id>.json`，新增可选字段：

```json
{
  "kind": "external-readback",
  "task_id": "task-id",
  "step_id": "write-result",
  "created_at": "...",
  "target": "feishu:sheet-id:I27",
  "data": {}
}
```

证据必须绑定 `task_id` 和当前 `step_id`。`commit-step` 不接受其他任务、其他步骤或早于当前 `step_started` 的证据。

### 7.2 外部写入尝试

`external-write-attempt` 只证明执行过写入，不证明成功：

```json
{
  "kind": "external-write-attempt",
  "target": "feishu:sheet-id:I27",
  "data": {
    "operation": "set-cell",
    "expected_fingerprint": "sha256:...",
    "result": "attempted"
  }
}
```

### 7.3 独立外部回读

`external-readback` 是外部写入完成的唯一硬证据：

```json
{
  "kind": "external-readback",
  "target": "feishu:sheet-id:I27",
  "data": {
    "result": "PASS",
    "independent_context": true,
    "readback_mode": "fresh-tab",
    "observed_fingerprint": "sha256:...",
    "expected_fingerprint": "sha256:..."
  }
}
```

PASS 必须同时满足：

- `independent_context=true`；
- expected/observed 指纹一致；
- target 与当前步骤声明的目标一致；
- 证据时间晚于当前步骤开始时间；
- 证据所属 task/step 与当前打开步骤一致。

`DOM_VISIBLE`、`attempted`、`HTTP_200`、同页面公式栏回读和截图中的临时 UI 均不能替代 PASS。

## 8. 外部写入状态机硬门

### 8.1 CLI

`start-step` 增加：

```bash
node .agent/scripts/agent.mjs start-step \
  --step write-feishu \
  --intent "回填验证结论" \
  --effect external-write \
  --target "feishu:sheet-id:I27,I30"
```

`effect` 枚举：

- `none`：默认，本地或只读步骤；
- `external-write`：第三方系统写入，要求独立回读；
- 为未来保留 `destructive`、`financial`，本期不实现额外逻辑。

### 8.2 `commit-step` 守卫

当打开步骤的 `effect=external-write`：

1. 至少引用一条 `external-write-attempt`；
2. 每个声明 target 都必须有对应 `external-readback: PASS`；
3. 任一 readback 为 FAIL/BLOCKED、缺失、过期或指纹不一致时，非零退出 `EEXTERNALREADBACK`；
4. 失败步骤必须走 `fail-step`，不得用普通 browser/test 证据绕过。

`recover --reconcile` 对外部写入步骤应用同一守卫，防止恢复时凭摘要补提交。

## 9. Bug 报告与新鲜度

### 9.1 报告内容

报告卡片同时展示：

- 源系统状态：`source_status`；
- 本轮验证状态：`verification_status`；
- 验证范围、时间、结论；
- Bug 目录中的 Markdown/TXT/JSON；
- 图片证据；
- `evidence_refs` 指向的 harness JSON；
- 缺失证据引用的显式警告。

`部分验证`、`待真机验收`、`BLOCKED` 必须使用独立视觉状态，不得计入“已验证”。

### 9.2 Freshness manifest

每次 `report` 同时生成 `.agent/reports/manifest.json`，至少包含：

```json
{
  "schema_version": 1,
  "generated_at": "...",
  "inputs": [
    { "path": ".agent/bugs.json", "sha256": "..." },
    { "path": ".agent/bugs/BUG-001/evidence/verification.md", "sha256": "..." },
    { "ref": "ev:abc123", "sha256": "..." }
  ],
  "output_sha256": "..."
}
```

`report check` 重新计算全部输入和输出指纹：

- 一致：退出 0，输出 `REPORT_FRESH`；
- 输入变化、引用缺失、输出变化：非零退出 `ESTALE_REPORT`；
- `report` 阶段完成前必须通过 `report check`。

报告生成不得依赖修改时间；统一使用内容 SHA-256，避免复制文件或时钟差造成假新鲜。

## 10. 可选扩展与移植

源模板新增 Bugfix Extension 文件：

- `schemas/bug.schema.json`；
- `scripts/lib/bugimport.mjs`；
- `scripts/lib/repomap.mjs`；
- `scripts/lib/report.mjs`；
- `scripts/bugfix.test.mjs`；
- 可选 `process/bugfix.template.json`。

CLI 暴露：

```text
repo-map
bug import
bug list
bug sync
report
report check
```

`install` 默认携带代码但不强制启用 Bug 流程。项目通过复制 `process/bugfix.template.json` 或在 `process.json` 声明 `workflow: bugfix` 启用。

升级当前酒店项目时：

- 只覆盖 committed 模板/脚本/Schema；
- 保留 `PROJECT.md`、`process.json`、`bugs.json` 和所有运行时目录；
- 对现有双状态台账执行兼容读取，不做破坏性迁移；
- 重新生成报告并执行 `report check`。

## 11. 错误处理

- 未找到 evidence ref：报告显示缺失，`report check` 失败。
- 外部回读 target 不匹配：`EEXTERNALREADBACK`。
- 外部写入受浏览器/权限/验证码阻塞：记录 BLOCKED/FAIL 证据并 `fail-step`，DoD 保持未满足。
- 源表读取不完整：台账标记 source snapshot 不完整，不允许把未读取行推断为已关闭。
- 超过三次相同外部写入尝试仍无法持久化：停止自动化，要求人工接管；不得切换到未授权通道绕过。

## 12. 测试与失败演练

只在全部实现完成后运行影响面测试。新增测试至少覆盖：

1. Bug 导入保留源状态，重复同步不清除验证字段。
2. 报告同时渲染双状态、Bug 文本/图片和 harness JSON。
3. 台账或证据变化后 `report check` 返回 `ESTALE_REPORT`。
4. 缺失 evidence ref 时报告显式告警且 freshness 失败。
5. 普通步骤维持现有 `commit-step` 行为。
6. external-write 只有 attempt 时拒绝提交。
7. DOM 可见但独立回读 FAIL 时拒绝提交。
8. 独立回读 target/step/task/时间/指纹任一不匹配时拒绝提交。
9. 每个 target 都有新鲜 PASS readback 时允许提交。
10. `recover --reconcile` 不能绕过 external-write 守卫。
11. 现有 29 条基线测试保持通过。
12. 将模板升级到酒店项目后，现有任务、journal、evidence 和报告数据仍可读取。

## 13. 完成标准

- 源模板现有未提交升级与新增能力全部通过影响面测试。
- Bugfix Extension 可从源模板安装到临时项目并完成导入、证据、报告、freshness 演练。
- 外部写入失败演练能稳定阻止 `commit-step` 和任务完成。
- 当前酒店项目升级后报告为 fresh，双状态与证据完整。
- 不把飞书 Canvas 自动写入能力宣称为已解决；只有人工或受支持客户端写入并独立回读后，酒店任务最后一条 DoD 才能完成。
