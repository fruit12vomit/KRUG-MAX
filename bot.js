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

async function sendText(chatId, text) {
  await axios.post(`${BASE}/messages`, { text },
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

const WELCOME = `⭕️ Привет! Я КРУЖОК — превращаю видео в кружочки! Подпишись на этот канал, чтобы бот работал

Просто отправь мне видео 🎥 и получи готовый кружочек за секунды ✨

⚠️ Ограничения:
• Длина: до 60 секунд
• Размер: до 50 МБ

Сделано с любовью
Лиза Требухова @fruit_vomit`;

const NOT_SUBSCRIBED = `🔒 Бот доступен только подписчикам канала!

Подпишись и напиши мне снова 👇
https://max.ru/channel/${CHANNEL_ID}`;

app.post('/webhook', async (req, res) => {
  res.json({ ok: true });

  const upd    = req.body;
  if (upd?.update_type !== 'message_created') return;

  const msg    = upd.message;
  const chatId = msg?.recipient?.chat_id;
  const userId = msg?.sender?.user_id;
  const mid    = msg?.body?.mid;
  const text   = (msg?.body?.text || '').trim().toLowerCase();
  const atts   = msg?.body?.attachments || [];
  const video  = atts.find(a => a.type === 'video');

  if (CHANNEL_ID && !(await isSubscribed(userId))) {
    await sendText(chatId, NOT_SUBSCRIBED);
    return;
  }

  if (!video) {
    if (text === '/start' || text === 'start') {
      await sendText(chatId, WELCOME);
    } else if (text) {
      await sendText(chatId, '🎥 Просто отправь мне видео — сделаю кружок!');
    }
    return;
  }

  const url = video?.payload?.url;
  if (!url) {
    await sendText(chatId, '❌ Не могу получить ссылку на видео');
    return;
  }

  await sendText(chatId, '📥 Скачиваю видео…');

  const inputPath = path.join(TMP, `in_${Date.now()}.mp4`);
  try {
    const r = await axios.get(url, {
      responseType: 'stream',
      headers: { Authorization: TOKEN },
      timeout: 60000
    });
    await new Promise((ok, fail) => {
      const w = fs.createWriteStream(inputPath);
      r.data.pipe(w);
      w.on('finish', ok);
      w.on('error', fail);
    });
  } catch {
    await sendText(chatId, '❌ Не удалось скачать видео');
    return;
  }

  processVideo(chatId, inputPath, mid);
});

app.get('/', (_req, res) => res.send('MAX Circle Bot ✅'));

app.get('/register', async (_req, res) => {
  const HOST = process.env.WEBHOOK_HOST;
  try {
    const r = await axios.post(`${BASE}/subscriptions`,
      { url: `${HOST}/webhook` },
      { headers: H() });
    res.send('✅ Webhook registered: ' + JSON.stringify(r.data));
  } catch(e) {
    res.send('❌ Error: ' + JSON.stringify(e.response?.data || e.message));
  }
});

app.listen(PORT, () => console.log(`Listening on :${PORT}`));
