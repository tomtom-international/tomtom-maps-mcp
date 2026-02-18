FROM docker.io/ubuntu:22.04

ARG VERSION

LABEL version=${VERSION}
LABEL description="TomTom MCP Server"

# Set working directory
WORKDIR /app

# Install Node.js 24 (NodeSource)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# Runtime libs for skia-canvas (fonts for map label rendering)
RUN apt-get update && apt-get install -y --no-install-recommends \
  fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY rollup.config.js ./
COPY scripts ./scripts
# Copy source code
COPY src ./src
COPY bin ./bin

RUN npm install

# Make scripts executable
RUN chmod +x ./bin/*

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

CMD ["node", "./bin/tomtom-mcp-http.js"]
