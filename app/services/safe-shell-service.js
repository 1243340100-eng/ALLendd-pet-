const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { atomicWriteJson, readJsonWithFallback } = require('./pet-data-store');

const PENDING_TTL_MS = 2 * 60 * 1000;
const OUTPUT_LIMIT = 8000;
const BLOCKED_TEXT = /(?:remove-item|\bdel\b|\berase\b|\brmdir\b|\brd\b|format|shutdown|restart-computer|stop-process|stop-service|set-executionpolicy|invoke-expression|\biex\b|invoke-webrequest|\biwr\b|\bcurl\b|\bwget\b|takeown|icacls|set-content|add-content|out-file|copy-item|move-item|rename-item|start-process|cmd(?:\.exe)?\s*\/c|powershell|pwsh|npm\s+run|git\s+(?:reset|clean|push|pull)|[;&><`]|\$\(|\r|\n)/i;
const SENSITIVE_PATH = /(?:^|[\\/])(?:\.env|api-config\.json|pet-data\.json|id_rsa|id_ed25519|credentials?|secrets?)(?:$|[\\/])/i;

function quotePowerShellLiteral(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function extractWindowsPath(text) {
  const value = String(text || '');
  const quoted = value.match(/["\u201c]([a-zA-Z]:\\[^"\u201d\r\n]+)["\u201d]/);
  if (quoted) return path.win32.normalize(quoted[1].trim());
  const raw = value.match(/[a-zA-Z]:\\[^\r\n\uff0c\u3002;!?]+/);
  if (!raw) return '';
  return path.win32.normalize(raw[0]
    .replace(/\s+(?:\u91cc|\u4e0b|\u4e2d|\u91cc\u9762|\u76ee\u5f55\u91cc|\u76ee\u5f55\u4e0b|\u6709\u54ea\u4e9b|\u6709\u4ec0\u4e48|\u662f\u5426|\u80fd\u5426|\u5417|\u5462|please).*$/iu, '')
    .trim());
}

function extractExplicitCommand(text) {
  const value = String(text || '').trim();
  const fenced = value.match(/```(?:powershell|pwsh|ps1)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) return fenced[1].trim();
  const patterns = [
    /(?:\u7528|\u901a\u8fc7)\s*(?:powershell|pwsh|\u547d\u4ee4\u884c)\s*(?:\u8fd0\u884c|\u6267\u884c|\u8dd1\u4e00\u4e0b|run|execute)\s*[:\uff1a]?\s*(.+)$/iu,
    /(?:powershell|pwsh)\s*[:\uff1a]\s*(.+)$/iu,
    /(?:\u8bf7)?(?:\u5e2e\u6211)?(?:\u8fd0\u884c|\u6267\u884c|run|execute)\s*(?:(?:powershell|pwsh|\u547d\u4ee4|command)\s*)?[:\uff1a]?\s+(.+)$/iu
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

function inferSafeShellCommand(text) {
  const value = String(text || '').trim();
  const targetPath = extractWindowsPath(value);
  const pathLiteral = targetPath ? quotePowerShellLiteral(targetPath) : '';
  const explicit = extractExplicitCommand(value);
  if (explicit) return explicit;

  if (/(?:\u5217\u51fa|\u663e\u793a|\u770b\u770b|\u67e5\u770b|\u6709\u54ea\u4e9b).*(?:\u6587\u4ef6|\u6587\u4ef6\u5939|\u76ee\u5f55\u5185\u5bb9)|(?:\u5f53\u524d\u76ee\u5f55|\u8fd9\u4e2a\u76ee\u5f55).*(?:\u6709\u4ec0\u4e48|\u6709\u54ea\u4e9b)|(?:list|show me|show).*(?:files|directory contents)/iu.test(value)) {
    return pathLiteral ? `Get-ChildItem -LiteralPath ${pathLiteral}` : 'Get-ChildItem';
  }
  if (/(?:\u6211\u73b0\u5728|\u6211\u5f53\u524d).*(?:\u5728\u54ea\u4e2a\u76ee\u5f55|\u5728\u4ec0\u4e48\u8def\u5f84)|(?:\u5f53\u524d\u76ee\u5f55|\u5f53\u524d\u8def\u5f84).*(?:\u662f\u4ec0\u4e48|\u5728\u54ea)|where am i|what is the current (?:directory|path)/iu.test(value)) {
    return 'Get-Location';
  }
  if (targetPath && /(?:\u5b58\u5728\u5417|\u662f\u5426\u5b58\u5728|\u68c0\u67e5.*\u5b58\u5728|does .* exist|test.*path)/iu.test(value)) {
    return `Test-Path -LiteralPath ${pathLiteral}`;
  }
  if (targetPath && /(?:\u6587\u4ef6\u4fe1\u606f|\u5c5e\u6027|\u5927\u5c0f|\u4fee\u6539\u65f6\u95f4|file info|file properties)/iu.test(value)) {
    return `Get-Item -LiteralPath ${pathLiteral}`;
  }
  if (/(?:\u6b63\u5728\u8fd0\u884c\u7684|\u5f53\u524d).*(?:\u8fdb\u7a0b)|(?:\u5217\u51fa|\u67e5\u770b|\u770b\u770b).*(?:\u8fdb\u7a0b)|running processes|list processes/iu.test(value)) {
    return 'Get-Process | Select-Object Name,Id';
  }
  if (/(?:\u6b63\u5728\u8fd0\u884c\u7684|\u5f53\u524d).*(?:\u670d\u52a1)|running services/iu.test(value)) {
    return 'Get-Service | Where-Object Status -eq Running | Format-Table Name,Status';
  }
  if (/(?:\u5217\u51fa|\u67e5\u770b|\u770b\u770b).*(?:windows )?\u670d\u52a1|list services/iu.test(value)) return 'Get-Service';
  if (/(?:git|\u4ed3\u5e93).*(?:\u72b6\u6001|\u6709\u4ec0\u4e48\u6539\u52a8|\u6539\u4e86\u4ec0\u4e48)|(?:\u67e5\u770b|\u770b\u770b).*(?:git|\u4ed3\u5e93).*(?:\u72b6\u6001|\u6539\u52a8)/iu.test(value)) return 'git status';
  if (/(?:git|\u4ed3\u5e93).*(?:\u6700\u8fd1|\u63d0\u4ea4\u8bb0\u5f55|\u5386\u53f2)|recent git commits|git history/iu.test(value)) return 'git log --oneline -n 10';
  if (/(?:git|\u4ed3\u5e93).*(?:\u5dee\u5f02|\u5177\u4f53\u6539\u52a8)|git diff/iu.test(value)) return 'git diff';
  if (/(?:node|nodejs).*(?:\u7248\u672c|version)/iu.test(value)) return 'node --version';
  if (/npm.*(?:\u7248\u672c|version)/iu.test(value)) return 'npm --version';
  if (targetPath && /\.(?:js|cjs|mjs)$/iu.test(targetPath) && /(?:\u8bed\u6cd5|\u68c0\u67e5.*js|syntax check|check.*javascript)/iu.test(value)) {
    return `node --check ${pathLiteral}`;
  }
  return '';
}

function resolveInsideRoot(workingRoot, requestedPath) {
  const resolved = path.resolve(workingRoot, requestedPath || '.');
  const root = path.resolve(workingRoot);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('path_outside_working_root');
  if (SENSITIVE_PATH.test(resolved)) throw new Error('sensitive_path_denied');
  return resolved;
}

// 用于在 git diff 等“会输出工作区改动”的命令结果进入聊天/LLM 前进行脱敏。
// 掩码：密钥/令牌、本地路径、网络路径、明显的长 token。
const SENSITIVE_OUTPUT_PATTERNS = [
  { pattern: /\b(?:sk|rk|pk|ghp|gho|github_pat|xox[baprs]|AIza)[-_][A-Za-z0-9_-]{12,}\b/g, replacement: '[secret]' },
  { pattern: /\b(?:api[_-]?key|access[_-]?token|authorization|secret|password|passwd|pwd|token)\s*[:=]\s*\S+/gi, replacement: '[secret]' },
  { pattern: /\b[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]+/g, replacement: '[local path]' },
  { pattern: /\\\\[^\\\s]+\\[^\s]+/g, replacement: '[network path]' }
];

function sanitizeShellOutput(command, output) {
  if (!output || typeof output !== 'string') return output || '';
  // 仅对可能输出工作区改动的命令做脱敏；其他命令（Get-Process 等）保持原样。
  if (!/(?:^|\s)git\s+diff\b/.test(String(command || ''))) return output;
  let sanitized = output;
  for (const { pattern, replacement } of SENSITIVE_OUTPUT_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

function analyzeSafeCommand(command, workingRoot) {
  const value = String(command || '').trim();
  if (!value || BLOCKED_TEXT.test(value)) return { allowed: false, reason: '\u547d\u4ee4\u5305\u542b\u5199\u5165\u3001\u63d0\u6743\u3001\u7cfb\u7edf\u63a7\u5236\u6216\u4e32\u8054\u8bed\u6cd5\u3002' };
  const exact = new Set([
    'Get-Location',
    'Get-ChildItem',
    'Get-Process | Select-Object Name,Id',
    'Get-Service',
    'Get-Service | Where-Object Status -eq Running | Format-Table Name,Status',
    'git status',
    'git log --oneline -n 10',
    'git diff',
    'node --version',
    'npm --version'
  ]);
  if (exact.has(value)) return { allowed: true, normalizedCommand: value };
  const pathCommand = value.match(/^(Get-ChildItem|Get-Item|Test-Path)\s+-LiteralPath\s+'([^']|'')+'$/i);
  if (pathCommand) {
    try {
      const literal = value.slice(value.indexOf("'") + 1, -1).replace(/''/g, "'");
      const resolved = resolveInsideRoot(workingRoot, literal);
      return {
        allowed: true,
        normalizedCommand: `${pathCommand[1]} -LiteralPath ${quotePowerShellLiteral(resolved)}`
      };
    } catch (error) {
      return { allowed: false, reason: error.message };
    }
  }
  const nodeCheck = value.match(/^node\s+--check\s+'([^']|'')+'$/i);
  if (nodeCheck) {
    try {
      const literal = value.slice(value.indexOf("'") + 1, -1).replace(/''/g, "'");
      const resolved = resolveInsideRoot(workingRoot, literal);
      if (!/\.(?:js|cjs|mjs)$/i.test(resolved)) return { allowed: false, reason: '\u53ea\u5141\u8bb8\u68c0\u67e5 JavaScript \u6587\u4ef6\u3002' };
      return { allowed: true, normalizedCommand: `node --check ${quotePowerShellLiteral(resolved)}` };
    } catch (error) {
      return { allowed: false, reason: error.message };
    }
  }
  return { allowed: false, reason: '\u547d\u4ee4\u4e0d\u5728\u6846\u67b6\u7684\u53ea\u8bfb\u767d\u540d\u5355\u4e2d\u3002' };
}

function createSafeEnvironment(source = process.env) {
  const result = {};
  for (const name of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE']) {
    if (source[name] !== undefined) result[name] = source[name];
  }
  result.GIT_OPTIONAL_LOCKS = '0';
  result.GIT_TERMINAL_PROMPT = '0';
  result.GIT_EXTERNAL_DIFF = '';
  result.GIT_PAGER = 'cat';
  return result;
}

class SafeShellService {
  constructor(options = {}) {
    this.app = options.app;
    this.workingRoot = path.resolve(options.workingRoot || this.app.getAppPath());
    this.spawnProcess = options.spawnProcess || spawn;
    this.pending = new Map();
    this.activeChildren = new Set();
    this.settingsPath = path.join(this.app.getPath('userData'), 'safe-shell-config.json');
  }

  getSettings() {
    const result = readJsonWithFallback(this.settingsPath);
    return { enabled: Boolean(result.data?.enabled), workingRoot: this.workingRoot };
  }

  setEnabled(enabled) {
    atomicWriteJson(this.settingsPath, { enabled: Boolean(enabled) });
    return this.getSettings();
  }

  interpret(text) {
    const command = inferSafeShellCommand(text);
    if (!command) return { handled: false };
    const analysis = analyzeSafeCommand(command, this.workingRoot);
    if (!analysis.allowed) {
      return { handled: true, ok: false, tone: 'danger', reply: `\u8fd9\u4e2a\u547d\u4ee4\u4e0d\u4f1a\u6267\u884c\u3002\n\n${analysis.reason}` };
    }
    const id = `safe_shell_${Date.now()}_${crypto.randomBytes(12).toString('hex')}`;
    this.pending.set(id, {
      command: analysis.normalizedCommand,
      expiresAt: Date.now() + PENDING_TTL_MS,
      enableOnConfirm: !this.getSettings().enabled
    });
    return {
      handled: true,
      ok: true,
      tone: 'question',
      reply: `\u5df2\u8f6c\u6362\u4e3a\u53ea\u8bfb\u547d\u4ee4\uff1a\n\n${analysis.normalizedCommand}\n\n\u662f\u5426\u786e\u8ba4\u6267\u884c\uff1f`,
      pendingAction: {
        id,
        label: this.getSettings().enabled ? '\u786e\u8ba4\u6267\u884c' : '\u542f\u7528\u5b89\u5168 Shell \u5e76\u6267\u884c'
      }
    };
  }

  async confirm(id) {
    const pending = this.pending.get(String(id || ''));
    this.pending.delete(String(id || ''));
    if (!pending || pending.expiresAt <= Date.now()) return { ok: false, reply: '\u8fd9\u4e2a\u547d\u4ee4\u786e\u8ba4\u5df2\u8fc7\u671f\u3002' };
    if (pending.enableOnConfirm) this.setEnabled(true);
    if (!this.getSettings().enabled) return { ok: false, reply: '\u5b89\u5168 Shell \u5c1a\u672a\u542f\u7528\u3002' };
    const analysis = analyzeSafeCommand(pending.command, this.workingRoot);
    if (!analysis.allowed || analysis.normalizedCommand !== pending.command) {
      return { ok: false, reply: '\u547d\u4ee4\u6267\u884c\u524d\u590d\u6838\u5931\u8d25\uff0c\u5df2\u62d2\u7edd\u3002' };
    }
    const result = await this.run(pending.command);
    const output = [result.ok ? '\u547d\u4ee4\u6267\u884c\u5b8c\u6210\u3002' : '\u547d\u4ee4\u6267\u884c\u5931\u8d25\u3002', `\u9000\u51fa\u7801\uff1a${result.exitCode ?? '-'}`];
    const safeStdout = sanitizeShellOutput(pending.command, result.stdout);
    const safeStderr = sanitizeShellOutput(pending.command, result.stderr);
    if (safeStdout.trim()) output.push(`\u8f93\u51fa\uff1a\n${safeStdout.trim()}`);
    if (safeStderr.trim()) output.push(`\u9519\u8bef\u8f93\u51fa\uff1a\n${safeStderr.trim()}`);
    return { ...result, reply: output.join('\n\n') };
  }

  cancel(id) {
    const removed = this.pending.delete(String(id || ''));
    return { ok: removed, reply: removed ? '\u597d\u7684\uff0c\u8fd9\u6b21\u547d\u4ee4\u5df2\u53d6\u6d88\u3002' : '\u8fd9\u4e2a\u786e\u8ba4\u5df2\u5931\u6548\u3002' };
  }

  run(command) {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      let child;
      let timer = null;
      try {
        child = this.spawnProcess('powershell.exe', [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ${command}`
        ], {
          cwd: this.workingRoot,
          env: createSafeEnvironment(),
          windowsHide: true,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (error) {
        resolve({ ok: false, stdout: '', stderr: error.message, exitCode: null });
        return;
      }
      this.activeChildren.add(child);
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.activeChildren.delete(child);
        resolve(result);
      };
      child.stdout?.on('data', (chunk) => { stdout = (stdout + chunk).slice(0, OUTPUT_LIMIT); });
      child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(0, OUTPUT_LIMIT); });
      child.on('error', () => finish({ ok: false, stdout, stderr, exitCode: null }));
      child.on('close', (code) => finish({ ok: code === 0, stdout, stderr, exitCode: Number.isInteger(code) ? code : null }));
      timer = setTimeout(() => {
        try { child.kill(); } catch {}
        finish({ ok: false, stdout, stderr: `${stderr}\ncommand_timeout`.trim(), exitCode: null });
      }, 10000);
    });
  }

  shutdown() {
    for (const child of this.activeChildren) {
      try { child.kill(); } catch {}
    }
    this.activeChildren.clear();
  }
}

module.exports = {
  SafeShellService,
  analyzeSafeCommand,
  inferSafeShellCommand,
  sanitizeShellOutput
};
