FROM oven/bun:1.3.10
WORKDIR /app
COPY package.json bun.lock ./
COPY scripts ./scripts
RUN bun install --frozen-lockfile
COPY . .
EXPOSE 3131
CMD ["bun", "run", "src/cli.ts", "serve", "--http", "--port", "3131", "--bind", "0.0.0.0", "--suppress-bootstrap-token"]
