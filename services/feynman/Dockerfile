# Feynman CLI terminal for Yggdrasil Ask → Feynman (https://www.feynman.is)
# Serves a WebSocket PTY running `feynman` — no workbench GUI.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @advaitpaliwal/feynman@0.3.48 \
  && pip3 install --no-cache-dir --break-system-packages fastapi==0.115.0 "uvicorn[standard]==0.30.6"

ENV FEYNMAN_HOME=/data/feynman-home \
    FEYNMAN_WORKDIR=/workspace \
    FEYNMAN_TERM_PORT=6174 \
    HOME=/root \
    TERM=xterm-256color \
    npm_config_update_notifier=false

WORKDIR /workspace

COPY terminal_server.py /usr/local/bin/feynman-terminal.py

VOLUME ["/data/feynman-home", "/workspace"]

EXPOSE 6174

CMD ["python3", "/usr/local/bin/feynman-terminal.py"]
