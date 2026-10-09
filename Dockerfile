# Node.js 22 LTS Alpine (includes native node:sqlite support)
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Copy package manifests and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Ensure backups directory exists and set permissions
RUN mkdir -p /app/backups && chown -R node:node /app

# Switch to non-root user
USER node

# Expose default port
EXPOSE 5000

# Container healthcheck using Node 22 native fetch
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:5000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Run server
CMD ["node", "server.js"]
