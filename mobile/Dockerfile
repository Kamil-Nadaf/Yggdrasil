# syntax=docker/dockerfile:1

# ---- build the web app ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# --ignore-scripts: skips pdfjs-dist's optional native `canvas` build (unused in the browser).
# Optional build secret `ca` = extra CA bundle, only needed behind a TLS-intercepting proxy:
#   docker build --secret id=ca,src=/path/ca-bundle.crt .
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --ignore-scripts
COPY . .
RUN npm run build && npm test

# ---- runtime: tiny dependency-free Node server + built app ----
FROM node:22-alpine
WORKDIR /app
# Optional LaTeX compiler for the Write tab:  docker build --build-arg WITH_LATEX=1 .
ARG WITH_LATEX=0
RUN if [ "$WITH_LATEX" = "1" ]; then apk add --no-cache tectonic; fi
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY package.json ./
COPY server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "server/index.js"]
