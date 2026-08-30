FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci --include=dev
RUN npx prisma generate

RUN mkdir -p /app/public

COPY . .

# Build the Next.js app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# Production runner image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DATABASE_URL="file:/app/db/thermalops.db"

RUN apk add --no-cache libc6-compat

# Copy built application and required assets
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json* ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/public ./public

# Create data and db directories for SQLite
RUN mkdir -p /app/db /app/data

EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push --accept-data-loss && (node scripts/seed-sites.mjs || true) && npm start"]
