# 项目知识库

HTML 看板仍显示项目进度和「下一步」。同一看板的「知识」页显示功能、需求版本、相关文件和交付证据。看板是视图，信息保存在项目的 `docs/knowledge/index.json` 及它引用的文件中。

## 推进任务

1. 接到需求后，将来源保存为项目内的文档，再登记草稿。记录页面或入口、用户操作、预期结果及验收条件；缺少的内容标为待确认。不要登记密钥或私密原文。
2. 需求确认后执行 `confirm`。同一功能只有一个现行版本。草稿和旧版本不进入自动上下文。需求改变时先用新的文件路径登记草稿，确认后再替换现行版本。
3. 把任务关联到功能 ID。`next`、`context`、`resume` 和 `phase start` 会按已关联功能或匹配的工作项路径读取知识。不匹配就不注入。需要时用 `knowledge find <功能 ID>` 精确查找。
4. 开发完成后，只验收受影响的路径。将验收证据登记到任务，执行验证，再用 `complete --proof` 记录交付。该文件必须出现在本任务最近一次通过的验证中。进度与知识页随交付更新。

```bash
node .agent/scripts/agent.mjs knowledge capture --feature checkout.retry \
  --title '支付失败重试' --module checkout --source docs/product/checkout-retry-v1.md
node .agent/scripts/agent.mjs knowledge confirm checkout.retry --revision 1
node .agent/scripts/agent.mjs knowledge use checkout.retry
node .agent/scripts/agent.mjs next
node .agent/scripts/agent.mjs evidence add --kind report --ref docs/acceptance/checkout-retry.txt
node .agent/scripts/agent.mjs verify --evidence ev:实际证据ID
node .agent/scripts/agent.mjs complete --proof docs/acceptance/checkout-retry.txt
```

验收仍要满足原任务的完成条件。可选的 `--contract`、`--decision`、`--test`、`--code` 引用在登记时固定内容；对于频繁改动的实现文件，优先在长期维护的功能规格里记入口，不在开发前固定代码版本。引用内容变化时，脚手架提示复核，不把过时内容当作现行约定。

安装和升级保留已有知识索引。将索引和引用文件纳入项目 Git。`node .agent/scripts/agent.mjs knowledge check` 可在本地或项目 CI 检查现行引用是否缺失或变更；要强制拦截合并，仍须在目标项目启用该检查并将它设为必需项。这个流程不后台扫描聊天，也不会把未确认的需求写成现行事实。
