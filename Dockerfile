FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY app.js ./
COPY cliente ./cliente
COPY private ./private

# cert.key/cert.pem NO se copian a la imagen: se montan como volúmenes de solo lectura
# en docker-compose.yml. Así los certificados no quedan horneados dentro de la imagen
# y se pueden rotar sin reconstruirla.

EXPOSE 3002

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('https').get({hostname:'localhost',port:process.env.PORT||3002,path:'/health',rejectUnauthorized:false},res=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "app.js"]
