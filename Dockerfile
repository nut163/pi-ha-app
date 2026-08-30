# The Home Assistant App builder and the release workflow build this file from
# the repository root. The app folder contains the Supervisor-facing manifest.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src ./src
COPY web ./web
COPY skills ./skills
COPY tsconfig.json tsconfig.server.json tsconfig.web.json vite.config.ts vitest.config.ts ./
RUN npm run build

FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8099
ENV PI_HOME_AGENT_WEB_DIR=/app/dist-web
ENV PI_HOME_AGENT_SKILLS_DIR=/app/skills
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/dist-web ./dist-web
COPY --from=build /app/skills ./skills

# The App needs to write only the mapped Home Assistant configuration files and
# its persistent /data directory. Supervisor/AppArmor remain the outer boundary.
EXPOSE 8099
CMD ["node", "dist-server/server.js"]
