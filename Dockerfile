FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY app.js ./
COPY cliente ./cliente
COPY private ./private

EXPOSE 3002

# La imagen base COPY-ea como root; sin este chown, el usuario no-root de abajo no
# podría escribir Errores.log dentro de /app (EACCES).
RUN chown -R node:node /app
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get({hostname:'localhost',port:process.env.PORT||3002,path:'/health'},res=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "app.js"]
