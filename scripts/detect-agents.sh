#!/bin/bash
#
# Detect installed AI CLI agents
# Output: JSON { "available": [...], "missing": [...] }
#

set -e

AGENTS=(
  "claude:claude -p"
  "codex:codex exec --skip-git-repo-check"
  "gemini:gemini -p"
  "kimi:kimi --prompt"
  "opencode:opencode -p"
  "qwen:qwen -p"
  "aider:aider --message"
)

available="[]"
missing="[]"

for entry in "${AGENTS[@]}"; do
  name="${entry%%:*}"
  command="${entry#*:}"

  bin="${command%% *}"

  if command -v "$bin" >/dev/null 2>&1; then
    path="$(command -v "$bin")"
    available=$(printf '%s' "$available" | node -e "
      const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
      d.push({name:'$name',command:'$command',path:'$path'});
      process.stdout.write(JSON.stringify(d));
    ")
  else
    missing=$(printf '%s' "$missing" | node -e "
      const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
      d.push('$name');
      process.stdout.write(JSON.stringify(d));
    ")
  fi
done

node -e "
  const available = $available;
  const missing = $missing;
  console.log(JSON.stringify({ available, missing }, null, 2));
"
