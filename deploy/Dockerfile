# Programme: Actualites publiques - Image auto-hebergee
# Date: 2026-09-14 - Auteur: nemesiaa
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=3190 DATA_DIR=/app/data
EXPOSE 3190
CMD ["node", "src/server.js"]
