import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

function lintError(message) {
  return Object.assign(new Error(message), { code: 'EBUG_LINT' });
}

function run(root, command, args = []) {
  if (!Array.isArray(command) || !command.length || command.some((part) => typeof part !== 'string' || !part.trim())) {
    throw lintError('Lint 命令必须是非空 argv 数组');
  }
  const result = spawnSync(command[0], [...command.slice(1), ...args], {
    cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw lintError(`Lint 命令失败：${command[0]} (${result.error?.code || result.signal || result.status})`);
  return result.stdout;
}

function readFixture(root, path) {
  try {
    if (typeof path !== 'string' || !path || isAbsolute(path)) throw new Error();
    const file = realpathSync(join(root, path));
    const scoped = relative(realpathSync(root), file);
    if (!scoped || scoped === '..' || scoped.startsWith(`..${sep}`) || isAbsolute(scoped) || !statSync(file).isFile() || !statSync(file).size) throw new Error();
    return file;
  } catch {
    throw lintError(`Lint 样例不可读或不在指定目录内：${path}`);
  }
}

function assertRule(root, inspect, { rule, bad, good }) {
  const findings = (file) => {
    const output = run(root, inspect, [file]);
    let result;
    try { result = JSON.parse(output); } catch { throw lintError('Lint inspect 必须输出 JSON 规则 ID 数组'); }
    if (!Array.isArray(result) || result.some((item) => typeof item !== 'string')) throw lintError('Lint inspect 必须输出 JSON 规则 ID 数组');
    return result;
  };
  if (bad === good || !findings(bad).includes(rule) || findings(good).length) {
    throw lintError(`规则 ${rule} 必须拦截错误样例，并且正确样例不得有 Lint 违规`);
  }
  return { rule, bad: relative(root, bad), good: relative(root, good) };
}

export function verifyBugLint({ root, agentRoot, directory }) {
  let config;
  let regression;
  const runtime = existsSync(join(directory, 'regression.json'));
  try {
    config = JSON.parse(readFileSync(readFixture(agentRoot, 'bug-lint.json'), 'utf8'));
    if (existsSync(join(directory, 'lint.json')) === runtime) throw lintError('Bug 目录必须在 lint.json 和 regression.json 中选择一项');
    regression = JSON.parse(readFileSync(readFixture(directory, runtime ? 'regression.json' : 'lint.json'), 'utf8'));
  } catch (cause) {
    if (cause.code === 'EBUG_LINT') throw cause;
    throw lintError('请正确配置 .agent/bug-lint.json 和 Bug 的防复发配置');
  }
  const rule = regression?.rule;
  const commentRule = config?.comments?.rule;
  if (typeof commentRule !== 'string' || !commentRule.trim() || (!runtime && (typeof rule !== 'string' || !rule.trim() || rule === commentRule))) {
    throw lintError('必须指定禁止注释规则；静态检查还需要不同的 Bug 专属规则');
  }
  const rules = [assertRule(root, config.inspect, { rule: commentRule, bad: readFixture(root, config.comments.bad), good: readFixture(root, config.comments.good) })];
  let regressionCase;
  if (runtime) {
    regressionCase = regression?.case;
    if (typeof regressionCase !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(regressionCase)) throw lintError('regression.json 必须指定有效的回归用例 ID');
    for (const [sample, expected] of [['bad', 'FAIL'], ['good', 'PASS'], ['current', 'PASS']]) {
      let result;
      try { result = JSON.parse(run(root, config.regression, [regressionCase, sample])); }
      catch { throw lintError(`回归检查无法执行或结果无效：${regressionCase} ${sample}`); }
      if (result?.case !== regressionCase || result.sample !== sample || result.result !== expected) throw lintError(`回归检查未得到预期结果：${regressionCase} ${sample} 应返回 ${expected}`);
    }
  } else {
    rules.unshift(assertRule(root, config.inspect, { rule, bad: readFixture(directory, regression.bad), good: readFixture(directory, regression.good) }));
  }
  run(root, config.project);
  return { result: 'PASS', mode: runtime ? 'runtime' : 'lint', rules, project: config.project, ...(runtime ? { regression_case: regressionCase } : {}) };
}
