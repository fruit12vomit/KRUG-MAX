FROM node:20-alpine
RUN apk add --no-cache ffmpeg ca-certificates wget
RUN (wget -qO /usr/local/share/ca-certificates/ru_root.crt https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt \
 && wget -qO /usr/local/share/ca-certificates/ru_sub.crt https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt \
 && cat /usr/local/share/ca-certificates/ru_root.crt /usr/local/share/ca-certificates/ru_sub.crt > /etc/ru_ca.pem) || echo 'RU CA download failed'
ENV NODE_EXTRA_CA_CERTS=/etc/ru_ca.pem
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY bot.js .
EXPOSE 3000
CMD ["node", "bot.js"]
