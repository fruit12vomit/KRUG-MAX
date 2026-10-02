FROM node:20-alpine
RUN apk add --no-cache ffmpeg
COPY ru_ca.pem /etc/ru_ca.pem
ENV NODE_EXTRA_CA_CERTS=/etc/ru_ca.pem
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY bot.js .
EXPOSE 3000
CMD ["node", "bot.js"]
