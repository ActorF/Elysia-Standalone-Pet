'use strict';

// The native helper sends numeric code points, never a growing text buffer.
function characterFromLine(line) {
  const match = /^KEY:(\d{2,3})$/.exec(line);
  if (!match) return null;
  const code = Number(match[1]);
  return code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : null;
}

function createTypedKeyListener({ spawn, platform = process.platform, script, parentProcessId = process.pid, onCharacter, onStatus }) {
  let child = null;
  const status = (active, error = null) => onStatus({ active, error });
  function stop() {
    const previous = child;
    child = null;
    if (previous) previous.kill();
    status(false);
  }
  function start(enabled = true) {
    stop();
    if (!enabled) return;
    if (platform !== 'win32') { status(false, '全局按键显示仅支持 Windows。'); return; }
    try {
      child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ParentProcessId', String(parentProcessId)], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch { status(false, '无法启动按键显示监听。'); return; }
    const current = child;
    let pending = '';
    current.stdout.setEncoding('utf8');
    current.stdout.on('data', chunk => {
      if (child !== current) return;
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      let latest = null;
      for (const line of lines) {
        if (line === 'READY') status(true);
        else {
          const character = characterFromLine(line);
          if (character !== null) latest = character;
        }
      }
      if (latest !== null) onCharacter(latest);
      if (pending.length > 1024) pending = '';
    });
    current.on('error', () => {
      if (child !== current) return;
      child = null; status(false, '无法启动按键显示监听。');
    });
    current.on('exit', () => {
      if (child !== current) return;
      child = null; status(false, '按键显示监听已停止，可在托盘关闭后重新打开。');
    });
  }
  return { start, stop };
}

module.exports = { characterFromLine, createTypedKeyListener };
