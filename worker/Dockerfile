# AI Workforce execution worker (R2).
#
# Build:
#   docker build -t gcr.io/ai-workforce-agents/execution-worker:latest -f worker/Dockerfile .
# Push (after `gcloud auth configure-docker`):
#   docker push gcr.io/ai-workforce-agents/execution-worker:latest
# Deploy (see worker/README.md for the full gcloud command):
#   gcloud run deploy execution-worker --image gcr.io/ai-workforce-agents/execution-worker:latest ...

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev=false
COPY tsconfig.json ./
COPY contracts/ contracts/
COPY core/ core/
COPY adapters/ adapters/
COPY agents/ agents/
COPY control/ control/
COPY api/ api/
COPY functions/ functions/
COPY worker/ worker/
RUN npx tsc -p tsconfig.json

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# node:22-slim already has a non-root `node` user. Run under it.
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Default to Cloud Run's $PORT; HEALTHCHECK is defined on the Cloud Run side.
USER node
EXPOSE 8080
ENV PORT=8080
CMD ["node", "dist/worker/index.js"]
