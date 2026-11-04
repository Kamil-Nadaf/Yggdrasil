# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python FastAPI ───────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends curl git openssh-client && \
    rm -rf /var/lib/apt/lists/*

# Python deps
# Slow or distant networks: override with --build-arg PIP_INDEX_URL=<mirror>
ARG PIP_INDEX_URL=https://pypi.org/simple
ENV PIP_DEFAULT_TIMEOUT=120 PIP_RETRIES=10
COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

# Copy API source
COPY gate.py zotero.py main.py data_manifest.py graph_links.py graph_keywords.py note_tags.py reading.py citations.py updater.py analysis_tags.py arxiv_topics.py task_statuses.py goals.py notifications.py ./

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
