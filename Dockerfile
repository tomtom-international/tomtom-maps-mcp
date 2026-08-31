FROM docker.io/ubuntu:22.04

LABEL description="TomTom Maps MCP Server"

# Set working directory
WORKDIR /app

# Install Node.js 24 (NodeSource) and pnpm.
# Keep PNPM_VERSION in sync with the "packageManager" field in package.json.
ARG PNPM_VERSION=11.22.0
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@${PNPM_VERSION}

# Runtime libs for skia-canvas (fonts for map label rendering)
RUN apt-get update && apt-get install -y --no-install-recommends \
  fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# Copy package files
# pnpm-workspace.yaml carries the overrides and allowBuilds settings that pnpm 11
# moved out of package.json; without it --frozen-lockfile sees no overrides and
# rejects the lockfile (ERR_PNPM_LOCKFILE_CONFIG_MISMATCH).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json ./
COPY rolldown.config.js ./
COPY manifest-binary.json ./
COPY scripts ./scripts
# Copy source code
COPY src ./src
COPY bin ./bin

# CI=true keeps pnpm non-interactive: outside CI it prompts to approve the
# install scripts of packages missing from `allowBuilds`, and `docker build`
# has no TTY to answer with.
RUN CI=true pnpm install --frozen-lockfile

# Make scripts executable
RUN chmod +x ./bin/*

# Build the application
RUN pnpm run build

# Expose port
EXPOSE 3000

CMD ["node", "./bin/tomtom-mcp-http.js"]
