import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from './store.mjs';

const begin = '<!-- agent-dev-scaffold:harness:start -->';
const end = '<!-- agent-dev-scaffold:harness:end -->';
const policy = [
  begin,
  '## Harness 工作协议',
  '',
  '- 收到需求或变更先回读相关功能，再将来源和验收条件写入项目需求文档，用 `knowledge capture` 登记。经确认后运行 `knowledge confirm`，草稿不当作现行需求。用 `knowledge use <功能 ID>` 关联当前任务，然后跟着「下一步」推进。',
  '- 交付时用 `complete --proof <项目内验收文件>` 将结果关联到现行需求。整体进度和项目知识都在 HTML 看板；遇到调整，登记新版本并重新确认。',
  '- 不等用户提醒。处理当前项目的具体 Bug 前，运行 `node .agent/scripts/agent.mjs bug list`，使用已有 ID，或运行 `node .agent/scripts/agent.mjs bug add --title "..." --symptom "..."`。假设、引用示例和功能需求不登记。',
  '- 开始工作前读取 `.agent/FEEDBACK-PROTOCOL.md`。按 `.agent/PORTING.md` 使用任务记忆和流程；如有独立 Bugfix 流程，用 `next --workflow bugfix` 和 `phase start <id> --workflow bugfix` 推进。',
  '- 定位根因后先选可执行防复发检查：能静态判断的用 Lint，运行时问题用回归检查。再修代码。用清楚的命名或单元测试说明意图，不写代码注释。改完运行 `impact-check`，只验证复现路径和受影响功能，并保存实际截图或视频。',
  '- 验证通过后运行 `node .agent/scripts/agent.mjs bug close <id>`，检查证据和 Lint，并更新本地 Harness。缺配置、规则或证据时保留未归档状态并报告。不重复登记普通反馈。通用改进用 `--scaffold-candidate` 记录。',
  end,
].join('\n');

function policyError(reason) {
  return Object.assign(new Error(`无法维护 AGENTS.md：${reason}`), { code: 'EAGENT_POLICY' });
}

export function installAgentPolicy(root) {
  const file = join(root, 'AGENTS.md');
  let previous = '';
  try {
    if (!lstatSync(file).isFile()) throw policyError('不是普通文件，已保留原路径');
    previous = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const start = previous.indexOf(begin);
  const finish = previous.indexOf(end);
  if ((start !== -1 || finish !== -1) && (
    start === -1 || finish < start || previous.lastIndexOf(begin) !== start || previous.lastIndexOf(end) !== finish
  )) throw policyError('Harness 区块标记损坏或重复，已保留原内容');
  const newline = previous.includes('\r\n') ? '\r\n' : '\n';
  const managed = policy.replaceAll('\n', newline);
  const next = start !== -1
    ? previous.slice(0, start) + managed + previous.slice(finish + end.length)
    : [previous, previous && (previous.endsWith(newline) ? newline : newline + newline), managed, newline].join('');
  if (next === previous) return 'AGENTS.md 已含当前 Harness 工作协议';
  atomicWriteFile(file, next);
  return '已注册 AGENTS.md Harness 工作协议，保留现有项目规则';
}
