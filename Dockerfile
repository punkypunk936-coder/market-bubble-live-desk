FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY gui ./gui

ENV PORT=8899
EXPOSE 8899

CMD ["npm", "start"]
