FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG NEXT_PUBLIC_SITE_URL=https://simki.cc
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_CRYPTO_PAYMENT_ENABLED=true
ENV NEXT_PUBLIC_CRYPTO_PAYMENT_ENABLED=$NEXT_PUBLIC_CRYPTO_PAYMENT_ENABLED
RUN node node_modules/next/dist/bin/next build
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "scripts/start-server.mjs"]
