FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY mcp-server/package.json mcp-server/package-lock.json ./
RUN npm ci

COPY mcp-server/tsconfig.json ./
COPY mcp-server/src ./src
COPY mcp-server/test ./test
COPY docs/openapi ./docs/openapi
RUN npm run build

FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8787

WORKDIR /app

COPY mcp-server/package.json mcp-server/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/docs ./docs

EXPOSE 8787

CMD ["node", "dist/src/server.js"]
