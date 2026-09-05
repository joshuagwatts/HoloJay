FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared ./shared
COPY server ./server

# Install hub + shared (tsx is a server dependency for running TS in prod)
RUN npm install --workspace=@holojay/server --workspace=@holojay/shared --include-workspace-root

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "server/src/index.ts"]
