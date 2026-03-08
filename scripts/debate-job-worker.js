#!/usr/bin/env node
//
// AI Debate Worker - Executes a single agent's prompt
// Forked from agent-council's council-job-worker.js
// Key difference: reads prompt from round-specific prompt.txt (not job-level)
//

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

function exitWithError(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const [key, rawValue] = a.split('=', 2);
    if (rawValue != null) { out[key.slice(2)] = rawValue; continue; }
    const next = args[i + 1];
    if (next == null || next.startsWith('--')) { out[key.slice(2)] = true; continue; }
    out[key.slice(2)] = next;
    i++;
  }
  return out;
}

function splitCommand(command) {
  const tokens = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escapeNext = false;
  for (const ch of String(command || '')) {
    if (escapeNext) { current += ch; escapeNext = false; continue; }
    if (!inSingle && ch === '\\') { escapeNext = true; continue; }
    if (!inDouble && ch === "'") { inSingle = !inSingle; continue; }
    if (!inSingle && ch === '"') { inDouble = !inDouble; continue; }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  if (inSingle || inDouble) return null;
  return tokens;
}

function atomicWriteJson(filePath, payload) {
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function main() {
  const options = parseArgs(process.argv);
  const agentDir = options['agent-dir'];
  const member = options.member;
  const command = options.command;
  const timeoutSec = options.timeout ? Number(options.timeout) : 120;

  if (!agentDir) exitWithError('worker: missing --agent-dir');
  if (!member) exitWithError('worker: missing --member');
  if (!command) exitWithError('worker: missing --command');

  const statusPath = path.join(agentDir, 'status.json');
  const outPath = path.join(agentDir, 'output.txt');
  const errPath = path.join(agentDir, 'error.txt');
  const promptPath = path.join(agentDir, 'prompt.txt');

  if (!fs.existsSync(promptPath)) {
    atomicWriteJson(statusPath, {
      member, state: 'error',
      message: 'prompt.txt not found',
      finishedAt: new Date().toISOString(), command,
    });
    process.exit(1);
  }

  const prompt = fs.readFileSync(promptPath, 'utf8');

  const tokens = splitCommand(command);
  if (!tokens || tokens.length === 0) {
    atomicWriteJson(statusPath, {
      member, state: 'error',
      message: 'Invalid command string',
      finishedAt: new Date().toISOString(), command,
    });
    process.exit(1);
  }

  const program = tokens[0];
  const args = tokens.slice(1);

  atomicWriteJson(statusPath, {
    member, state: 'running',
    startedAt: new Date().toISOString(), command, pid: null,
  });

  const outStream = fs.createWriteStream(outPath, { flags: 'w' });
  const errStream = fs.createWriteStream(errPath, { flags: 'w' });

  let child;
  try {
    child = spawn(program, [...args, prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
  } catch (error) {
    atomicWriteJson(statusPath, {
      member, state: 'error',
      message: error && error.message ? error.message : 'Failed to spawn',
      finishedAt: new Date().toISOString(), command,
    });
    process.exit(1);
  }

  atomicWriteJson(statusPath, {
    member, state: 'running',
    startedAt: new Date().toISOString(), command, pid: child.pid,
  });

  if (child.stdout) child.stdout.pipe(outStream);
  if (child.stderr) child.stderr.pipe(errStream);

  let timeoutHandle = null;
  let timeoutTriggered = false;
  if (Number.isFinite(timeoutSec) && timeoutSec > 0) {
    timeoutHandle = setTimeout(() => {
      timeoutTriggered = true;
      try { process.kill(child.pid, 'SIGTERM'); } catch {}
    }, timeoutSec * 1000);
    timeoutHandle.unref();
  }

  const finalize = (payload) => {
    try { outStream.end(); errStream.end(); } catch {}
    atomicWriteJson(statusPath, payload);
  };

  child.on('error', (error) => {
    const isMissing = error && error.code === 'ENOENT';
    finalize({
      member,
      state: isMissing ? 'missing_cli' : 'error',
      message: error && error.message ? error.message : 'Process error',
      finishedAt: new Date().toISOString(), command,
      exitCode: null, pid: child.pid,
    });
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    const timedOut = Boolean(timeoutTriggered) && signal === 'SIGTERM';
    const canceled = !timedOut && signal === 'SIGTERM';
    finalize({
      member,
      state: timedOut ? 'timed_out' : canceled ? 'canceled' : code === 0 ? 'done' : 'error',
      message: timedOut ? `Timed out after ${timeoutSec}s` : canceled ? 'Canceled' : null,
      finishedAt: new Date().toISOString(), command,
      exitCode: typeof code === 'number' ? code : null,
      signal: signal || null, pid: child.pid,
    });
    process.exit(code === 0 ? 0 : 1);
  });
}

if (require.main === module) {
  main();
}
