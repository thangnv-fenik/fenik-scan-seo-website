###################
# BUILD FOR PRODUCTION
###################

FROM node:18-alpine As build

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY . .
RUN npm run build

USER node

###################
# PRODUCTION
###################

FROM node:18-alpine As production
WORKDIR /usr/src/app
COPY --chown=node:node --from=build /usr/src/app/node_modules ./node_modules
COPY --chown=node:node --from=build /usr/src/app/dist ./dist
COPY --chown=node:node --from=build /usr/src/app/package.json ./package.json
COPY --chown=node:node --from=build /usr/src/app/package-lock.json ./package-lock.json
COPY --chown=node:node upload ./upload

# Khởi động API
CMD ["node", "dist/src/main.js"]