FROM node:22-bookworm-slim

WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev
COPY backend ./backend
COPY frontend ./frontend
RUN mkdir -p /app/backend/data && chown -R node:node /app

USER node
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "backend/server.js"]
