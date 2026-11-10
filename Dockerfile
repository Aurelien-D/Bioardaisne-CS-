# BioArd'Aisne Strike — image de production (client compilé + serveur de jeu)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080
# Le serveur est un bundle autonome : aucun node_modules nécessaire à l'exécution.
COPY --from=build /app/dist ./dist
EXPOSE 8080
USER node
CMD ["node", "dist/server/index.js"]
