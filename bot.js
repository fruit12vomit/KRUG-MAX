import 'dotenv/config';
import express from 'express';
import ffmpeg from 'fluent-ffmpeg';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';

const TOKEN      = process.env.BOT_TOKEN;
const PORT       = process.env.PORT || 3000;
const BASE       = 'https://platform-api.max.ru';
const CHANNEL_ID = process.env.CHANNEL_ID;
const TMP        = path.join(tmpdir(), 'cbot');
fs.mkdirSync(TMP, { recursive: true });

const app = express();
app.use(express.json());

const H = () => ({ Authorization: TOKEN, 'Content-Type': 'application/json' });

async function sendMessage(chatId, text, buttons) {
  const body = { text };
  if (buttons) {
    body.attachments = [{
      type: 'inline_keyboard',
      payload: { buttons }
    }];
  }
  await axios.post(`${BASE}/messages`, body,
    { params: { chat_id: chatId }, headers: H() }).catch(() => {});
}

async function isSubscribed(userId) {
  if (!CHANNEL_ID) return true;
  try {
    const res = await axios.get(`${BASE}/chats/${CHANNEL_ID}/members`,
      { headers: { Authorization: TOKEN } });
    const members = res.data?.members || [];
    return members.some(m => m.user_id === userId);
  } catch {
    return false;
  }
}

async function uploadAndSend(chatId, filePath, replyMid) {
  // Шаг 1: получить URL для загрузки
  const { data: up } = await axios.post(`${BASE}/uploads`, null,
    { params: { type: 'video' }, headers: { Authorization: TOKEN } });

  console.log('Upload URL response:', JSON.stringify(up));

  const uploadUrl = up.url;
  if (!uploadUrl) throw new Error('No upload URL from MAX');

  // Шаг 2: загрузить файл
  const form = new FormData();
  form.append('data', fs.createReadStream(filePath),
    { filename: 'circle.mp4', contentType: 'video/mp4' });

  const { data: upRes } = await axios.post(uploadUrl, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    timeout: 120000
  });

  console.log('Upload result:', JSON.stringify(upRes));

  // MAX может вернуть token по-разному
  const token = upRes?.token || upRes?.retval || up?.token;
  if (!token) throw new Error('No token from MAX upload: ' + JSON.stringify(upRes));

  // Шаг 3: подождать обработки
  await new Promise(r => setTimeout(r, 4000));

  // Шаг 4: отправить видео
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
    await sendMessage(chatId, '⏳ Конвертирую в кружок…');
    await convertToCircle(inputPath, out);
    await sendMessage(chatId, '☁️ Загружаю на сервер…');
    await uploadAndSend(chatId, out, replyMid);
    await sendMessage(chatId, '✅ Готово! Вот твой кружок 👆', [
      [{ type: 'callback', text: '🎥 Сделать ещё', payload: 'start' }]
    ]);
  } catch (e) {
    console.error(e.message);
    await sendMessage(chatId, '❌ Ошибка: ' + e.message, [
      [{ type: 'callback', text: '🔄 Попробовать снова', payload: 'start' }]
    ]);
  } finally {
    [inputPath, out].forEach(f => fs.unlink(f, () => {}));
  }
}

const WELCOME = `⭕️ Привет! Я КРУЖОК — превращаю видео в кружочки!

Просто отправь мне видео 🎥 и получи готовый кружочек за секунды ✨

⚠️ Ограничения:
• Длина: до 60 секунд
• Размер: до 50 МБ

Сделано с любовью
Лиза Требухова @fruit_vomit`;

const MAIN_BUTTONS = [
  [{ type: 'callback', text: '🎥 Отправить видео', payload: 'start' }],
  [{ type​​​​​​​​​​​​​​​​
