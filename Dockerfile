# Era dos Gigantes: the game (static files) and the co-op server in one container.
#   docker build --build-arg BUILD_SHA=$(git rev-parse --short HEAD) -t era-dos-gigantes .
#   docker run -p 8787:8787 era-dos-gigantes        → http://localhost:8787
# See docs/multiplayer.md.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG BUILD_SHA=""
ENV BUILD_SHA=$BUILD_SHA
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 STATIC_DIR=dist
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY src/net/protocol.ts ./src/net/protocol.ts
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health >/dev/null || exit 1
CMD ["node", "server/server.ts"]
