#!/usr/bin/env bash
# init-vault.sh — create the CERIC vault folder structure.
# Run once before `docker compose up`.
#
# Usage:
#   VAULT_HOST_PATH=/data/grb-vault bash scripts/init-vault.sh
#
# Or just run it — it defaults to ./vault relative to repo root.

set -euo pipefail

VAULT="${VAULT_HOST_PATH:-$(pwd)/vault}"

echo "→ Initialising vault at: $VAULT"

mkdir -p \
  "$VAULT/00-Inbox" \
  "$VAULT/10-Papers" \
  "$VAULT/15-Books" \
  "$VAULT/20-Concepts" \
  "$VAULT/30-Questions" \
  "$VAULT/40-Synthesis" \
  "$VAULT/50-Projects" \
  "$VAULT/60-Meta" \
  "$VAULT/70-LaTeX" \
  "$VAULT/80-Tasks"

# Write a README so Syncthing picks up the folder immediately
cat > "$VAULT/README.md" << 'EOF'
# Yggdrasil Reading Vault

Managed by the CERIC Reading System.
Do **not** hand-edit frontmatter in `10-Papers/` — use the CERIC Editor.

| Folder | Purpose |
|--------|---------|
| `00-Inbox` | Daily Brief files written by arxiv-daily cron |
| `10-Papers` | One `.md` per paper |
| `15-Books` | Book folders: `_book.md` + one note per section |
| `20-Concepts` | Concept notes |
| `30-Questions` | Open questions |
| `40-Synthesis` | Weekly synthesis notes |
| `50-Projects` | Project notes |
| `60-Meta` | Templates, config, and system notes |
| `70-LaTeX` | LaTeX documents written in the LaTeX Editor view |
| `80-Tasks` | Task / routine notes (one `.md` per task) |
EOF

# Drop a concept note template into 60-Meta
cat > "$VAULT/60-Meta/concept-note-template.md" << 'EOF'
---
name: ""
aliases: []
tags: [concept]
related_papers: []
related_concepts: []
created: ""
updated: ""
---

# {{name}}

## Definition
<!-- One-paragraph definition in your own words. -->

## Key Papers
<!-- [[citekey]] links to papers that establish or use this concept. -->

## My Current Understanding
<!-- What do you actually believe about this? Confidence level? -->

## Open Questions
<!-- What don't you understand yet? What would falsify this? -->

## Connections
<!-- Links to related concepts: [[concept-name]] -->
EOF

# Drop a question note template
cat > "$VAULT/60-Meta/question-note-template.md" << 'EOF'
---
question: ""
status: open
priority: high
related_papers: []
related_concepts: []
created: ""
---

# {{question}}

## Why This Matters
<!-- Scientific motivation. -->

## What We Know So Far
<!-- Brief summary of current understanding, with [[citekey]] links. -->

## Candidate Answers
<!-- Hypotheses you're currently entertaining. -->

## What Would Resolve This
<!-- Observation, simulation, or derivation that would close the question. -->
EOF

# Drop a starter LaTeX template
cat > "$VAULT/70-LaTeX/_template.tex" << 'EOF'
\documentclass[12pt]{article}
\usepackage{amsmath, amssymb, graphicx, hyperref}
\title{Your Title}
\author{Your Name}
\date{\today}
\begin{document}
\maketitle
\section{Introduction}
\end{document}
EOF

echo "✓ Vault structure ready."
echo ""
echo "Next steps:"
echo "  1. Copy .env.example → .env and fill in your API keys"
echo "  2. Set VAULT_HOST_PATH in .env to: $VAULT"
echo "  3. docker compose up -d"
echo "  4. Pull the embedding model (first run only):"
echo "     docker exec grb-ollama ollama pull nomic-embed-text"
