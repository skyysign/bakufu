FROM node:24-bookworm-slim
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@10.34.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
ENV NODE_ENV=production
RUN mkdir -p /var/lib/card-engine-monitor && chown node:node /var/lib/card-engine-monitor && chmod 700 /var/lib/card-engine-monitor
USER node
EXPOSE 3000
CMD ["pnpm", "start"]
