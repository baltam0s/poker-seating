# Use Node 20 Alpine image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies inside container
COPY package.json ./
RUN npm install --production

# Copy app code and frontend
COPY server.js ./
COPY public ./public

# Expose the port the app listens on
EXPOSE 3000

# Run the server
CMD ["node", "server.js"]
