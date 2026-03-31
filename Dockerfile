FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files and patches (needed for pnpm install)
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/

# Install dependencies (fresh install, no cache)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm build

# Expose port
EXPOSE 3000

# Start the application using the crypto-patching wrapper
CMD ["node", "start.mjs"]
