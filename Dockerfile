# Resolve and record an approved immutable digest before live deployment.
FROM node:22.23.3-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM dependencies AS build
COPY . .
# No production environment file or provider secret is available during the build.
RUN node node_modules/next/dist/bin/next build apps/web --webpack
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22.23.3-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/apps/web ./apps/web
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/deploy ./deploy
RUN mkdir -p /data /backups /app/apps/web/.next/cache && chown node:node /data /backups /app/apps/web/.next/cache && chmod 700 /data /backups
USER node
EXPOSE 3100
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 CMD ["node", "--experimental-strip-types", "scripts/production-check.mjs", "--http"]
ENTRYPOINT ["node", "--experimental-strip-types"]
CMD ["scripts/production-start.mjs"]
