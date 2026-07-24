# ---- build: produce the static Vite bundle ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# VITE_API_URL is baked into the client bundle at build time (see src/api/client.ts).
# Pass the public URL of mcp-studio-api via --build-arg during docker build.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ---- runner: serve the SPA with a tiny Node process on 8080 ----
# Node needs no root and writes no PID file, so it runs cleanly as the non-root user
# Cloud Foundry assigns (nginx could not — CF blocks its PID file write). Mirrors how
# Yoda's Node frontend runs on the same platform.
FROM node:20-alpine AS runner
WORKDIR /app
ENV PORT=8080
COPY --from=build /app/dist ./dist
COPY server.js ./server.js
EXPOSE 8080
CMD ["node", "server.js"]
