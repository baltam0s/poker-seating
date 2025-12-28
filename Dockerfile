FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./
COPY public ./public

EXPOSE 6006
CMD ["node", "server.js"]
