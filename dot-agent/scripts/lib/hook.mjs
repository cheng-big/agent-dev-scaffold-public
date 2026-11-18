// git post-commit hook：每次 commit 后自动刷新 board.html。幂等、不覆盖用户已有 hook。
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

export const HOOK_MARK_START = '# >>> agent-dev-scaffold board refresh >>>';
export const HOOK_MARK_END = '# <<< agent-dev-scaffold board refresh <<<';
export const HOOK_BLOCK = [
  HOOK_MARK_START,
  'node .agent/scripts/agent.mjs board >/dev/null 2>&1 || true',
  HOOK_MARK_END,
].join('\n');

// 装/补 git post-commit hook。返回一句人读状态。
export function installBoardHook({ cwd = process.cwd() } = {}) {
  const gitDir = join(cwd, '.git');
  if (!existsSync(gitDir)) return '未检测到 .git，跳过 post-commit hook（在 git 仓库里跑 `hook install` 可补装）';
  const hooksDir = join(gitDir, 'hooks');
  const hookFile = join(hooksDir, 'post-commit');
  mkdirSync(hooksDir, { recursive: true });
  if (existsSync(hookFile)) {
    const cur = readFileSync(hookFile, 'utf8');
    if (cur.includes(HOOK_MARK_START)) return 'post-commit hook 已含 board 刷新块，跳过';
    // 追加到已有 hook 末尾，不动用户原逻辑
    appendFileSync(hookFile, (cur.endsWith('\n') ? '' : '\n') + '\n' + HOOK_BLOCK + '\n');
    chmodSync(hookFile, 0o755);
    return '已把 board 刷新块追加到现有 post-commit hook（保留原逻辑）';
  }
  writeFileSync(hookFile, '#!/bin/sh\n' + HOOK_BLOCK + '\n');
  chmodSync(hookFile, 0o755);
  return '已装 post-commit hook（每次 commit 自动刷新 board.html）';
}
