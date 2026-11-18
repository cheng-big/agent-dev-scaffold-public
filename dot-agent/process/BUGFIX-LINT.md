# Bugfix Lint 与验证证据

确定根因后，先选能拦截同类错误的验证方式。能静态判断时，写 Lint 规则，在业务源码和 CI 中将违规设为错误。时序、环境或交互问题不能静态判断时，写能区分修复前后行为的运行时回归。修复和检查均完成后再运行验证。需要延后时，运行 `bug close <id> --status 延后 --resolution <理由>`；延后不算修复通过。

## 项目配置

在目标项目的 `.agent/bug-lint.json` 中配置：

```json
{
  "project": ["npm", "run", "lint"],
  "inspect": ["node", "scripts/inspect-lint.mjs"],
  "comments": {
    "rule": "project/no-comments",
    "bad": "lint-fixtures/comments.bad.js",
    "good": "lint-fixtures/comments.good.js"
  }
}
```

- `project` 运行全项目 Lint。任何违规都必须返回非零状态。CI 运行同一入口。只排除依赖、生成文件和专用样例，不排除业务源码。
- `inspect` 用相同的规则和设置检查 CLI 传入的单个绝对路径；成功检查后在 stdout 输出规则 ID 数组，例如 `["project/no-comments"]`。载入失败、语法错误或配置无效时返回非零状态。正确样例必须输出 `[]`。两个命令来自项目配置，只在可信项目中运行。
- `comments.bad` 应覆盖行注释、块注释和 Lint 禁用指令。`comments.good` 应验证字符串里的 `//` 和 `/*` 不算注释。其他语言用本项目的语法树规则，不用全文正则。

JavaScript 项目可在 ESLint flat config 中导入 `.agent/scripts/lib/no-comments.mjs`，在 `plugins` 注册为 `project`，将 `project/no-comments` 设为 `error`。设置 `linterOptions.noInlineConfig: true`，禁止用行内指令绕过规则。`inspect` 可用 ESLint 的 `lintText` 读取样例，以适用相同规则的源码路径作为 `filePath`，输出 `messages` 中的 `ruleId`；遇到 `fatal` 或空规则 ID 时失败。

## 每条 Bug 的产物

每条 Bug 只登记一种检查。选择静态规则时，在 `.agent/bugs/<id>/lint.json` 登记专属规则和样例。样例路径相对于该 Bug 目录。

```json
{
  "rule": "project/no-unsafe-id-conversion",
  "bad": "lint-fixtures/unsafe.js",
  "good": "lint-fixtures/safe.js"
}
```

选择运行时回归时，在 `.agent/bugs/<id>/regression.json` 写入 `{"case":"checkout.retry-once"}`，在项目配置中加入 `"regression": ["node", "scripts/run-regression.mjs"]`。CLI 将用例 ID 和样例名追加到命令。适配器必须运行实际断言，并用零退出码和单个 JSON 对象报告观测结果，例如 `{"case":"checkout.retry-once","sample":"bad","result":"FAIL"}`；执行错误返回非零退出码。`bad` 是保留的错误行为，必须得到 `FAIL`；`good` 是正常样例，必须得到 `PASS`；`current` 针对当前项目，必须得到 `PASS`。把当前实现的回归测试纳入项目测试入口和 CI。

修复后只验证原复现路径和受影响功能。把截图（PNG、JPEG、GIF、WebP）或视频（MP4、MOV、WebM）放入 Bug 的 `evidence/`。非界面修复可截取实际命令和结果。Markdown、日志和测试说明可以补充，但不能替代媒体证据。

`bug close` 检查媒体文件头，再运行 Bug 专属检查、禁止注释规则的正反例和全项目 Lint。通过后生成 `evidence/lint-proof.json`。文件头不能证明截图内容；验证人须确认画面展示本次修复的实际结果。报告可以查看截图或打开视频。
