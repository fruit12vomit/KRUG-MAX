import 'dotenv/config';
import express from 'express';
import ffmpeg from 'fluent-ffmpeg';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';

const TOKEN = process.env.BOT_TOKEN;
const PORT  = process.env.PORT || 3000;
const BASE  = 'https://platform-api.max.ru';
const TMP   = path.join(tmpdir(), 'cbot');
fs.mkdirSync(TMP, { recursive: true });

const app = express();
app.use(express.json());

const H = () => ({ Authorization: TOKEN, 'Content-Type': 'application/json' });

async function sendText(chatId, text) {
  await axios.post(`${BASE}/messages`, { text },
    { params: { chat_id: chatId }, headers: H() }).catch(() => {});
}

async function uploadAndSend(chatId, filePath, replyMid) {
  const { data: up } = await axios.post(`${BASE}/uploads`, null,
    { params: { type: 'video' }, headers: { Authorization: TOKEN } });

  const form = new FormData();
  form.append('data', fs.createReadStream(filePath),
    { filename: 'circle.mp4', contentType: 'video/mp4' });
  const { data: upRes } = await axios.post(up.url, form,
    { headers: form.getHeaders(), maxBodyLength: Infinity });

  const token = upRes.token;
  if (!token) throw new Error('No token from MAX upload');

  await new Promise(r => setTimeout(r, 3500));

  const body = {
    attachments: [{ type: 'video', payload: { token } }],
    ...(replyMid ? { link: { type: 'reply', mid: replyMid } } : {})
  };
  await axios.post(`${BASE}/messages`, body,
    { params: { chat_id: chatId }, headers: H() });
}

function convertToCircle(src, dst) {
  return new Promise((resolve, reject) => {
    ffmpeg(src)
      .videoFilters([
        'crop=min(iw\\,ih):min(iw\\,ih)',
        'scale=480:480',
        'format=yuv420p'
      ])
      .outputOptions([
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '28',
        '-c:a', 'aac', '-b:a', '96k',
        '-movflags', '+faststart',
        '-t', '60'
      ])
      .output(dst)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

async function processVideo(chatId, inputPath, replyMid) {
  const out = inputPath + '_out.mp4';
  try {
    await sendText(chatId, '⏳ Конвертирую в кружок…');
    await convertToCircle(inputPath, out);
    await sendText(chatId, '☁️ Загружаю на сервер…');
    await uploadAndSend(chatId, out, replyMid);
    await sendText(chatId, '✅ Готово! Вот твой кружок 👆');
  } catch (e) {
    console.error(e.message);
    await sendText(chatId, '❌ Ошибка: ' + e.message);
  } finally {
    [inputPath, out].forEach(f => fs.unlink(f, () => {}));
  }
}

app.post('/webhook', async (req, res) => {
  res.json({ ok: true });

  const upd    = req.body;
  if (upd?.update_type !== 'message_created') return;

  const msg    = upd.message;
  const chatId = msg?.recipient?.chat_id;
  const mid    = msg?.body?.mid;
  const text   = (msg?.body?.text || '').trim().toLowerCase();
  const atts   = msg?.body?.attachments || [];
  const video  = atts.find(a => a.type === 'video');

  if (!video) {
    if (text === '/start' || text === 'start') {
      await sendText(chatId,
        '👋 Привет! Я делаю видеокружки.\n\n' +
        'Пришли видео в этот чат — верну его круглым 🎥\n\n' +
        '⚙️ до
