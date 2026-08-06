FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY config ./config
COPY src ./src
COPY tests ./tests
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY config ./config
RUN mkdir -p /app/storage /app/logs && chown -R node:node /app
USER node
EXPOSE 8788
CMD ["sh", "-c", "node dist/src/db/setup.js && node dist/src/index.js"]
