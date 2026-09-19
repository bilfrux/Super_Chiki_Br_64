# Build from the REPOSITORY ROOT (the server needs ../shared and ../booster):
#   docker build -f server/Dockerfile -t mgp-server .
#   docker run --rm -p 8080:8080 -e ADMIN_KEY=<long random> -e PUBLIC_URL=https://your-host mgp-server
# Secrets (ADMIN_KEY, RELAYER_PRIVATE_KEY) are passed as environment variables at run time, never baked in.

FROM node:22-alpine AS build
WORKDIR /app
COPY shared ./shared
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci
COPY server ./server
RUN cd server && npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
# Layout must match the repo: the server finds ../booster and ./public relative to dist/.
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY server/public ./server/public
COPY booster ./booster
COPY game ./game
COPY driver ./driver
COPY test ./test
COPY shared ./shared
USER node
WORKDIR /app/server
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/src/index.js"]
