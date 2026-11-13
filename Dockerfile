FROM node:22-alpine AS base
# libc6-compat is required for Next.js 15 SWC native binary on Alpine musl
RUN apk add --no-cache libc6-compat

# Step 1: Dependencies
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

# Step 2: Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

# Step 3: Runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
CMD ["sh", "-c", "npx next start -p ${PORT:-3000}"]
