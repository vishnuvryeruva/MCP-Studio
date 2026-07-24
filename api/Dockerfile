# ---- deps: install all deps (incl. build toolchain for native bcrypt) ----
FROM node:20-alpine AS deps
WORKDIR /app
# bcrypt is a native module; musl/alpine needs a compile toolchain to build it.
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci

# ---- build: compile TypeScript, then drop dev deps (keeps compiled bcrypt) ----
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
# Cloud Foundry routes to 8080 by default; NestJS reads process.env.PORT.
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/main"]
