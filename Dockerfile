FROM node:20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY bot.js .
EXPOSE 3000
CMD ["node", "bot.js"]
