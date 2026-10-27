FROM oven/bun:1-alpine

WORKDIR /app

# The proxy has no runtime dependencies, so there is nothing to install.
COPY src ./src

ENV PORT=3000
EXPOSE 3000

USER bun
CMD ["bun", "src/index.ts"]
