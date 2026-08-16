FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source and seed database
COPY . .
COPY data/database.json /app/seed-database.json

# Ensure data directory exists
RUN mkdir -p /app/data

# Environment configuration
ENV NODE_ENV=production
ENV PORT=3000

# Expose HTTP health check port
EXPOSE 3000

# Start bot process
CMD ["node", "src/index.js"]
