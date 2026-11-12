# The AI bot as one container: control panel (built once) + API on port 3000.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Main database tables are created/updated first, then the server starts (it updates every merchant database itself).
CMD ["sh", "-c", "npx tsx src/db/migrate.ts && exec npx tsx src/server/index.ts"]
