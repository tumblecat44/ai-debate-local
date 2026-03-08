#!/usr/bin/env node
//
// AI Debate Orchestrator - Multi-round debate engine
// Forked from agent-council's council-job.js, extended for multi-stage debates
//

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const SCRIPT_DIR = __dirname;
const PLUGIN_DIR = path.resolve(SCRIPT_DIR, '..');
const WORKER_PATH = path.join(SCRIPT_DIR, 'debate-job-worker.js');
const TEMPLATES_DIR = path.join(PLUGIN_DIR, 'templates', 'prompts');
const DEBATES_DIR = path.join(PLUGIN_DIR, '.debates');

const CONFIG_PATH = path.join(PLUGIN_DIR, 'debate.config.json');

const STAGE_MAP = {
  position: { template: 'position.md', dir: '1-position' },
  'cross-exam': { template: 'cross-exam.md', dir: '2-cross-exam' },
  'common-ground': { template: 'common-ground.md', dir: '3-common-ground' },
  consensus: { template: 'consensus.md', dir: '4-consensus' },
};

// --- Utilities ---

function exitWithError(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function atomicWriteJson(filePath, payload) {
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

function readTextIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8');
  } catch { return ''; }
}

function sleepMs(ms) {
  const msNum = Number(ms);
  if (!Number.isFinite(msNum) || msNum <= 0) return;
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, Math.trunc(msNum));
}

function safeFileName(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'agent';
}

function parseConfig(configPath) {
  const fallback = {
    debate: {
      agents: [
        { name: 'claude', command: 'claude -p', emoji: '🧠', color: 'CYAN' },
        { name: 'codex', command: 'codex exec --skip-git-repo-check', emoji: '🤖', color: 'BLUE' },
        { name: 'gemini', command: 'gemini -p', emoji: '💎', color: 'GREEN' },
      ],
      personas: [
        { id: 'pragmatist', label: '실용주의자', emoji: '🧠', instruction: '현실적 구현 가능성을 중시합니다.' },
        { id: 'idealist', label: '이상주의자', emoji: '💡', instruction: '최선의 결과를 추구합니다.' },
        { id: 'devils_advocate', label: '악마의 변호인', emoji: '😈', instruction: '모든 주장에 반박합니다.' },
      ],
      stages: {
        position: { rounds: 1 },
        cross_exam: { rounds: 4 },
        common_ground: { rounds: 2 },
        consensus: { max_rounds: 15 },
      },
      settings: { timeout: 120, min_agents: 2, chairman: 'auto', exclude_chairman: true },
    },
  };

  if (!fs.existsSync(configPath)) return fallback;

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (parsed && parsed.debate) {
      return {
        debate: {
          agents: parsed.debate.agents || fallback.debate.agents,
          personas: parsed.debate.personas || fallback.debate.personas,
          stages: { ...fallback.debate.stages, ...(parsed.debate.stages || {}) },
          settings: { ...fallback.debate.settings, ...(parsed.debate.settings || {}) },
        },
      };
    }
  } catch {}
  return fallback;
}

// --- Template rendering ---

function loadTemplate(templateName) {
  const tplPath = path.join(TEMPLATES_DIR, templateName);
  if (!fs.existsSync(tplPath)) exitWithError(`Template not found: ${tplPath}`);
  return fs.readFileSync(tplPath, 'utf8');
}

function renderTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value || ''));
  }
  return result;
}

// --- History builder ---

function buildHistory(debateDir, upToStage, upToRound) {
  const stageOrder = ['1-position', '2-cross-exam', '3-common-ground', '4-consensus'];
  const stagesDir = path.join(debateDir, 'stages');
  const lines = [];
  const debateMeta = readJsonIfExists(path.join(debateDir, 'debate.json'));
  const agentPersonaMap = {};
  if (debateMeta && debateMeta.participants) {
    for (const p of debateMeta.participants) {
      agentPersonaMap[p.agent] = `${p.persona_emoji} ${p.agent} (${p.persona_label})`;
    }
  }

  for (const stageDir of stageOrder) {
    const stagePath = path.join(stagesDir, stageDir);
    if (!fs.existsSync(stagePath)) continue;

    // Check if we've reached the limit
    if (upToStage && stageDir === upToStage) {
      // Include rounds up to upToRound - 1
      const roundDirs = fs.readdirSync(stagePath)
        .filter(d => d.startsWith('round-'))
        .sort((a, b) => {
          const na = parseInt(a.split('-')[1]);
          const nb = parseInt(b.split('-')[1]);
          return na - nb;
        });

      for (const roundDir of roundDirs) {
        const roundNum = parseInt(roundDir.split('-')[1]);
        if (upToRound && roundNum >= upToRound) break;
        const agentsDir = path.join(stagePath, roundDir, 'agents');
        if (!fs.existsSync(agentsDir)) continue;
        lines.push(`\n--- ${stageDir} / ${roundDir} ---`);
        for (const agent of fs.readdirSync(agentsDir).sort()) {
          const output = readTextIfExists(path.join(agentsDir, agent, 'output.txt')).trim();
          if (output) {
            const label = agentPersonaMap[agent] || agent;
            lines.push(`\n[${label}]:\n${output}`);
          }
        }
      }
      break;
    }

    // Include all rounds of previous stages
    const roundDirs = fs.readdirSync(stagePath)
      .filter(d => d.startsWith('round-'))
      .sort((a, b) => {
        const na = parseInt(a.split('-')[1]);
        const nb = parseInt(b.split('-')[1]);
        return na - nb;
      });

    for (const roundDir of roundDirs) {
      const agentsDir = path.join(stagePath, roundDir, 'agents');
      if (!fs.existsSync(agentsDir)) continue;
      lines.push(`\n--- ${stageDir} / ${roundDir} ---`);
      for (const agent of fs.readdirSync(agentsDir).sort()) {
        const output = readTextIfExists(path.join(agentsDir, agent, 'output.txt')).trim();
        if (output) {
          const label = agentPersonaMap[agent] || agent;
          lines.push(`\n[${label}]:\n${output}`);
        }
      }
    }
  }

  let history = lines.join('\n');

  // Truncate if too long - keep recent 3 rounds + position
  if (history.length > 12000) {
    const positionIdx = history.indexOf('--- 1-position');
    const positionEnd = history.indexOf('\n--- 2-', positionIdx);
    const positionSection = positionEnd > 0 ? history.substring(positionIdx, positionEnd) : '';

    const parts = history.split(/\n--- /);
    const recentParts = parts.slice(-3);
    history = `${positionSection}\n\n[...이전 라운드 생략...]\n\n--- ${recentParts.join('\n--- ')}`;
  }

  return history;
}

function buildConsensusHistory(debateDir, upToRound) {
  const consensusDir = path.join(debateDir, 'stages', '4-consensus');
  if (!fs.existsSync(consensusDir)) return '';

  const lines = [];
  const roundDirs = fs.readdirSync(consensusDir)
    .filter(d => d.startsWith('round-'))
    .sort((a, b) => parseInt(a.split('-')[1]) - parseInt(b.split('-')[1]));

  for (const roundDir of roundDirs) {
    const roundNum = parseInt(roundDir.split('-')[1]);
    if (upToRound && roundNum >= upToRound) break;
    const agentsDir = path.join(consensusDir, roundDir, 'agents');
    if (!fs.existsSync(agentsDir)) continue;
    lines.push(`\n--- 합의 시도 ${roundNum}회차 ---`);
    for (const agent of fs.readdirSync(agentsDir).sort()) {
      const output = readTextIfExists(path.join(agentsDir, agent, 'output.txt')).trim();
      if (output) lines.push(`\n[${agent}]:\n${output}`);
    }
  }

  return lines.join('\n');
}

// --- Argument parsing ---

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { out._.push(...args.slice(i + 1)); break; }
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

// --- Commands ---

function cmdStart(options) {
  const topic = options.topic;
  if (!topic) exitWithError('start: missing --topic');

  const agentNames = options.agents ? options.agents.split(',').map(s => s.trim()) : null;
  const config = parseConfig(options.config || CONFIG_PATH);
  const settings = config.debate.settings;

  // Filter agents
  let agents = config.debate.agents;
  if (agentNames) {
    agents = agents.filter(a => agentNames.includes(a.name));
  }
  // Exclude chairman if configured
  if (settings.exclude_chairman) {
    const chairman = settings.chairman === 'auto' ? 'claude' : settings.chairman;
    agents = agents.filter(a => a.name !== chairman);
  }

  if (agents.length < (settings.min_agents || 2)) {
    exitWithError(`start: need at least ${settings.min_agents || 2} agents, got ${agents.length}`);
  }

  // Assign personas
  const personas = config.debate.personas;
  const participants = agents.map((agent, i) => {
    const persona = personas[i % personas.length];
    return {
      agent: agent.name,
      command: agent.command,
      agent_emoji: agent.emoji || '',
      persona_id: persona.id,
      persona_label: persona.label,
      persona_emoji: persona.emoji,
      persona_instruction: persona.instruction,
    };
  });

  // Create debate directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
  const id = crypto.randomBytes(3).toString('hex');
  const safeTopic = topic.substring(0, 30).replace(/[^a-zA-Z0-9가-힣\s-]/g, '').trim().replace(/\s+/g, '-');
  const debateDirName = `debate-${timestamp}-${id}`;
  const debateDir = path.join(DEBATES_DIR, debateDirName);

  ensureDir(debateDir);
  ensureDir(path.join(debateDir, 'stages'));

  const debateMeta = {
    id: debateDirName,
    topic,
    createdAt: new Date().toISOString(),
    participants,
    stages: config.debate.stages,
    settings: { timeout: settings.timeout },
    state: 'started',
    currentStage: null,
    currentRound: null,
    totalRounds: 0,
    consensusReached: false,
    consensusRound: null,
  };

  atomicWriteJson(path.join(debateDir, 'debate.json'), debateMeta);

  process.stdout.write(JSON.stringify({ debateDir, ...debateMeta }, null, 2) + '\n');
}

function cmdRound(options) {
  const debateDir = options['debate-dir'];
  const stage = options.stage;
  const round = parseInt(options.round || '1');

  if (!debateDir) exitWithError('round: missing --debate-dir');
  if (!stage) exitWithError('round: missing --stage');
  if (!STAGE_MAP[stage]) exitWithError(`round: unknown stage "${stage}"`);

  const debateMeta = readJsonIfExists(path.join(debateDir, 'debate.json'));
  if (!debateMeta) exitWithError('round: debate.json not found');

  const stageInfo = STAGE_MAP[stage];
  const template = loadTemplate(stageInfo.template);
  const roundDir = path.join(debateDir, 'stages', stageInfo.dir, `round-${round}`);
  const agentsDir = path.join(roundDir, 'agents');

  // Build history from previous stages/rounds
  const history = stage === 'position' ? '' : buildHistory(debateDir, stageInfo.dir, round);
  const consensusHistory = stage === 'consensus' ? buildConsensusHistory(debateDir, round) : '';

  // Spawn workers for each participant
  const participants = debateMeta.participants;
  const timeout = debateMeta.settings.timeout || 120;

  for (const p of participants) {
    const agentSafe = safeFileName(p.agent);
    const agentDir = path.join(agentsDir, agentSafe);
    ensureDir(agentDir);

    // Render prompt
    const prompt = renderTemplate(template, {
      persona_emoji: p.persona_emoji,
      persona_label: p.persona_label,
      persona_instruction: p.persona_instruction,
      topic: debateMeta.topic,
      round: String(round),
      history,
      consensus_history: consensusHistory,
    });

    fs.writeFileSync(path.join(agentDir, 'prompt.txt'), prompt, 'utf8');
    atomicWriteJson(path.join(agentDir, 'status.json'), {
      member: p.agent, state: 'queued',
      queuedAt: new Date().toISOString(), command: p.command,
    });

    // Spawn detached worker
    const workerArgs = [
      WORKER_PATH,
      '--agent-dir', agentDir,
      '--member', p.agent,
      '--command', p.command,
      '--timeout', String(timeout),
    ];

    const child = spawn(process.execPath, workerArgs, {
      detached: true, stdio: 'ignore', env: process.env,
    });
    child.unref();
  }

  // Update debate meta
  debateMeta.currentStage = stage;
  debateMeta.currentRound = round;
  debateMeta.totalRounds++;
  atomicWriteJson(path.join(debateDir, 'debate.json'), debateMeta);

  // Poll until all workers complete
  const startTime = Date.now();
  const maxWait = (timeout + 30) * 1000;

  while (true) {
    let allDone = true;
    for (const p of participants) {
      const statusPath = path.join(agentsDir, safeFileName(p.agent), 'status.json');
      const status = readJsonIfExists(statusPath);
      if (!status || status.state === 'queued' || status.state === 'running') {
        allDone = false;
        break;
      }
    }
    if (allDone) break;
    if (Date.now() - startTime > maxWait) break;
    sleepMs(500);
  }

  // Collect results
  const results = [];
  for (const p of participants) {
    const agentSafe = safeFileName(p.agent);
    const status = readJsonIfExists(path.join(agentsDir, agentSafe, 'status.json'));
    const output = readTextIfExists(path.join(agentsDir, agentSafe, 'output.txt')).trim();
    results.push({
      agent: p.agent,
      persona: `${p.persona_emoji} ${p.persona_label}`,
      state: status ? status.state : 'unknown',
      output: output || (status && status.message) || '[응답 없음]',
    });
  }

  process.stdout.write(JSON.stringify({
    debateDir, stage, round, results,
  }, null, 2) + '\n');
}

function cmdStatus(options) {
  const debateDir = options['debate-dir'];
  if (!debateDir) exitWithError('status: missing --debate-dir');

  const debateMeta = readJsonIfExists(path.join(debateDir, 'debate.json'));
  if (!debateMeta) exitWithError('status: debate.json not found');

  process.stdout.write(JSON.stringify(debateMeta, null, 2) + '\n');
}

function cmdCheckConsensus(options) {
  const debateDir = options['debate-dir'];
  const round = parseInt(options.round || '1');
  if (!debateDir) exitWithError('check-consensus: missing --debate-dir');

  const debateMeta = readJsonIfExists(path.join(debateDir, 'debate.json'));
  if (!debateMeta) exitWithError('check-consensus: debate.json not found');

  const consensusDir = path.join(debateDir, 'stages', '4-consensus', `round-${round}`, 'agents');
  if (!fs.existsSync(consensusDir)) {
    process.stdout.write(JSON.stringify({ consensus: false, round, reason: 'round not found' }) + '\n');
    return;
  }

  const participants = debateMeta.participants;
  let consensusCount = 0;
  let totalResponded = 0;

  for (const p of participants) {
    const output = readTextIfExists(path.join(consensusDir, safeFileName(p.agent), 'output.txt'));
    if (output.trim()) {
      totalResponded++;
      if (output.includes('[CONSENSUS]')) consensusCount++;
    }
  }

  const allAgree = consensusCount === totalResponded && totalResponded > 0;
  const majorityAgree = consensusCount > totalResponded / 2 && totalResponded > 0;

  if (allAgree || majorityAgree) {
    debateMeta.consensusReached = true;
    debateMeta.consensusRound = round;
    debateMeta.state = 'consensus_reached';
    atomicWriteJson(path.join(debateDir, 'debate.json'), debateMeta);
  }

  process.stdout.write(JSON.stringify({
    consensus: allAgree || majorityAgree,
    unanimous: allAgree,
    round,
    agreed: consensusCount,
    total: totalResponded,
  }, null, 2) + '\n');
}

function cmdResults(options) {
  const debateDir = options['debate-dir'];
  if (!debateDir) exitWithError('results: missing --debate-dir');

  const debateMeta = readJsonIfExists(path.join(debateDir, 'debate.json'));
  if (!debateMeta) exitWithError('results: debate.json not found');

  const fullHistory = buildHistory(debateDir, null, null);

  process.stdout.write(JSON.stringify({
    id: debateMeta.id,
    topic: debateMeta.topic,
    participants: debateMeta.participants,
    totalRounds: debateMeta.totalRounds,
    consensusReached: debateMeta.consensusReached,
    consensusRound: debateMeta.consensusRound,
    history: fullHistory,
  }, null, 2) + '\n');
}

function cmdFinalize(options) {
  const debateDir = options['debate-dir'];
  if (!debateDir) exitWithError('finalize: missing --debate-dir');

  const debateMeta = readJsonIfExists(path.join(debateDir, 'debate.json'));
  if (!debateMeta) exitWithError('finalize: debate.json not found');

  const stagesDir = path.join(debateDir, 'stages');
  const lines = [];

  // Header
  const participantList = debateMeta.participants
    .map(p => `${p.persona_emoji} ${p.agent} (${p.persona_label})`)
    .join(', ');

  const consensusStatus = debateMeta.consensusReached
    ? `✅ ${debateMeta.consensusRound}라운드에서 합의 달성`
    : '❌ 합의 미달성';

  lines.push(`# 🎭 AI 끝장 토론: ${debateMeta.topic}`);
  lines.push('');
  lines.push(`> **일시**: ${debateMeta.createdAt.split('T')[0]} ${debateMeta.createdAt.split('T')[1].substring(0, 5)}`);
  lines.push(`> **참여자**: ${participantList}`);
  lines.push(`> **총 라운드**: ${debateMeta.totalRounds}회`);
  lines.push(`> **합의**: ${consensusStatus}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Stage 1: Position
  const posDir = path.join(stagesDir, '1-position', 'round-1', 'agents');
  if (fs.existsSync(posDir)) {
    lines.push('## 📢 Stage 1: 입장 제시');
    lines.push('');
    for (const p of debateMeta.participants) {
      const output = readTextIfExists(path.join(posDir, safeFileName(p.agent), 'output.txt')).trim();
      lines.push(`### ${p.persona_emoji} ${p.agent} — ${p.persona_label}`);
      lines.push(output || '[응답 없음]');
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  // Stage 2: Cross-exam
  const crossDir = path.join(stagesDir, '2-cross-exam');
  if (fs.existsSync(crossDir)) {
    lines.push('## ⚔️ Stage 2: 교차 질문');
    lines.push('');
    const rounds = fs.readdirSync(crossDir).filter(d => d.startsWith('round-')).sort();
    for (const rd of rounds) {
      const roundNum = rd.split('-')[1];
      lines.push(`### Round ${roundNum}`);
      const agentsPath = path.join(crossDir, rd, 'agents');
      if (fs.existsSync(agentsPath)) {
        for (const p of debateMeta.participants) {
          const output = readTextIfExists(path.join(agentsPath, safeFileName(p.agent), 'output.txt')).trim();
          lines.push(`#### ${p.persona_emoji} ${p.agent}`);
          lines.push(output || '[응답 없음]');
          lines.push('');
        }
      }
    }
    lines.push('---');
    lines.push('');
  }

  // Stage 3: Common ground
  const cgDir = path.join(stagesDir, '3-common-ground');
  if (fs.existsSync(cgDir)) {
    lines.push('## 🤝 Stage 3: 공통점 추출');
    lines.push('');
    const rounds = fs.readdirSync(cgDir).filter(d => d.startsWith('round-')).sort();
    for (const rd of rounds) {
      const roundNum = rd.split('-')[1];
      lines.push(`### Round ${roundNum}`);
      const agentsPath = path.join(cgDir, rd, 'agents');
      if (fs.existsSync(agentsPath)) {
        for (const p of debateMeta.participants) {
          const output = readTextIfExists(path.join(agentsPath, safeFileName(p.agent), 'output.txt')).trim();
          lines.push(`#### ${p.persona_emoji} ${p.agent}`);
          lines.push(output || '[응답 없음]');
          lines.push('');
        }
      }
    }
    lines.push('---');
    lines.push('');
  }

  // Stage 4: Consensus
  const consDir = path.join(stagesDir, '4-consensus');
  if (fs.existsSync(consDir)) {
    lines.push('## ✅ Stage 4: 합의안 도출');
    lines.push('');
    const rounds = fs.readdirSync(consDir).filter(d => d.startsWith('round-')).sort();
    for (const rd of rounds) {
      const roundNum = rd.split('-')[1];
      lines.push(`### ${roundNum}회차`);
      const agentsPath = path.join(consDir, rd, 'agents');
      if (fs.existsSync(agentsPath)) {
        for (const p of debateMeta.participants) {
          const output = readTextIfExists(path.join(agentsPath, safeFileName(p.agent), 'output.txt')).trim();
          const hasConsensus = output.includes('[CONSENSUS]');
          lines.push(`#### ${p.persona_emoji} ${p.agent} ${hasConsensus ? '✅' : ''}`);
          lines.push(output || '[응답 없음]');
          lines.push('');
        }
      }
    }
    lines.push('---');
    lines.push('');
  }

  // Final consensus extract
  if (debateMeta.consensusReached && debateMeta.consensusRound) {
    lines.push('## 📋 최종 합의안');
    lines.push('');
    const finalRoundDir = path.join(consDir, `round-${debateMeta.consensusRound}`, 'agents');
    if (fs.existsSync(finalRoundDir)) {
      for (const p of debateMeta.participants) {
        const output = readTextIfExists(path.join(finalRoundDir, safeFileName(p.agent), 'output.txt')).trim();
        if (output.includes('[CONSENSUS]')) {
          lines.push(output.replace('[CONSENSUS]', '').trim());
          lines.push('');
          break;
        }
      }
    }
    lines.push('---');
  }

  lines.push('');
  lines.push('*Generated by ai-debate plugin*');

  const markdown = lines.join('\n');
  const outputPath = path.join(debateDir, 'output.md');
  fs.writeFileSync(outputPath, markdown, 'utf8');

  // Update state
  debateMeta.state = 'finalized';
  atomicWriteJson(path.join(debateDir, 'debate.json'), debateMeta);

  process.stdout.write(JSON.stringify({ outputPath, size: markdown.length }, null, 2) + '\n');
}

function cmdClean(options) {
  const debateDir = options['debate-dir'];
  if (!debateDir) exitWithError('clean: missing --debate-dir');
  // Only clean stages data, keep output.md
  const stagesDir = path.join(debateDir, 'stages');
  if (fs.existsSync(stagesDir)) {
    fs.rmSync(stagesDir, { recursive: true, force: true });
  }
  process.stdout.write(`cleaned stages: ${debateDir}\n`);
}

// --- Main ---

function main() {
  const options = parseArgs(process.argv);
  const [command] = options._;

  if (!command) { process.stderr.write('Usage: debate-job.js <command> [options]\n'); process.exit(1); }

  switch (command) {
    case 'start': return cmdStart(options);
    case 'round': return cmdRound(options);
    case 'status': return cmdStatus(options);
    case 'check-consensus': return cmdCheckConsensus(options);
    case 'results': return cmdResults(options);
    case 'finalize': return cmdFinalize(options);
    case 'clean': return cmdClean(options);
    default: exitWithError(`Unknown command: ${command}`);
  }
}

if (require.main === module) {
  main();
}
