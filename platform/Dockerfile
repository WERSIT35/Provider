FROM node:22-alpine AS build

WORKDIR /app

COPY platform/package*.json ./platform/
RUN cd platform && npm ci

COPY client ./client
COPY platform ./platform
RUN cd platform && npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

WORKDIR /app

COPY --from=build --chown=node:node /app/client ./client
COPY --from=build --chown=node:node /app/platform/package*.json ./platform/
COPY --from=build --chown=node:node /app/platform/node_modules ./platform/node_modules
COPY --from=build --chown=node:node /app/platform/dist ./platform/dist
COPY --from=build --chown=node:node /app/platform/migrations ./platform/migrations

USER node
WORKDIR /app/platform

EXPOSE 8080

CMD ["node", "dist/server.js"]
