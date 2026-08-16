FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source and seed database
COPY . .

# Copy seed data to a separate directory so it survives volume mounts
RUN mkdir -p /app/seed-data && cp -r /app/data/* /app/seed-data/ || true
RUN mkdir -p /app/data

# Environment configuration
ENV NODE_ENV=production
ENV PORT=3000

# Expose HTTP health check port
EXPOSE 3000

# Start bot process
CMD ["node", "src/index.js"]
