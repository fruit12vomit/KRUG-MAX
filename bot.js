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
    { params: { chat_id: chatId }, headers: H() }).catch(e => {
      console.error('sendMessage error:', e.response?.data || e.message);
    });
}

async function uploadAndSend(chatId, filePath, replyMid) {
  // Шаг 1: получить URL
  const { data: up } = await axios.post(
    `${BASE}/uploads`,
    null,
    { params: { type: 'video' }, headers: { Authorization: TOKEN } }
  );

  const uploadUrl = up.url;
  const token = up.token;

  console.log('Upload URL:', uploadUrl?.slice(0, 50));
  console.log('Pre-token:', token?.slice(0, 30));

  if (!uploadUrl) throw new Error('Нет URL для загрузки');
  if (!token) throw new Error('Нет токена');

  // Шаг 2: загрузить файл
  const form = new FormData();
  form.append('data', fs.createReadStream(filePath), {
    filename: 'circle.mp4',
    contentType: 'video/mp4'
  });

  const uploadRes = await axios.post(uploadUrl, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    timeout: 120000,
    responseType: 'text'
  });

  console.log('Upload response:', uploadRes.data?.slice(0, 100));

  // Шаг 3: подождать обработки
  await new Promise(r => setTimeout(r, 7000));

  // Шаг 4: отправить с токеном из шага 1
  // Пробуем с width/height как у кружка
  const body = {
    attachments: [{
      type: 'video',
      payload: {
        token,
        width: 480,
        height: 480
      }
    }]
  };
  if (replyMid) body.link = { type: 'reply', mid: replyMid };

  const sendRes = await axios.post(`${BASE}/messages`, body,
    { params: { chat_id: chatId }, headers: H() });
  console.log('Send result:', JSON.stringify(sendRes.data)?.slice(0, 100));
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
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '28',
        '-c:a', 'aac',
        '-b:a', '96k',
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
    await sendMessage(chatId, '✅ Готово! Кружок выше 👆', [
      [{ type: 'callback', text: '🎥 Сделать ещё', payload: 'start' }]
    ]);
  } catch (e) {
    console.error('Error:', e.message);
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

app.post('/webhook', async (req, res) => {
  res.json({ ok: true });

  const upd    = req.body;
  const msg    = upd?.message;
  const chatId = msg?.recipient?.chat_id;
  const userId = msg?.sender?.user_id;
  const mid    = msg?.body?.mid;

  if (upd?.update_type === 'bot_started') {
    const id = upd.chat_id || upd.message?.recipient?.chat_id;
    await sendMessage(id, WELCOME);
    return;
  }

  if (upd?.update_type === 'message_callback') {
    const cbChatId = upd.callback?.message?.recipient?.chat_id;
    await sendMessage(cbChatId, '🎥 Отправь мне видео — сделаю кружок!');
    return;
  }

  if (upd?.update_type !== 'message_created') return;

  const text  = (msg?.body?.text || '').trim().toLowerCase();
  const atts  = msg?.body?.attachments || [];
  const video = atts.find(a => a.type === 'video');

  if (!video) {
    if (text === '/start' || text === 'start') {
      await sendMessage(chatId, WELCOME);
    } else if (text) {
      await sendMessage(chatId, '🎥 Просто отправь мне видео — сделаю кружок!');
    }
    return;
  }

  const url = video?.payload?.url;
  if (!url) {
    await sendMessage(chatId, '❌ Не могу получить ссылку на видео');
    return;
  }

  await sendMessage(chatId, '📥 Скачиваю видео…');

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
    await sendMessage(chatId, '❌ Не удалось скачать видео');
    return;
  }

  processVideo(chatId, inputPath, mid);
});

app.get('/', (_req, res) => res.send('MAX Circle Bot OK'));

app.get('/register', async (_req, res) => {
  const HOST = process.env.WEBHOOK_HOST;
  try {
    const r = await axios.post(
      `${BASE}/subscriptions`,
      { url: `${HOST}/webhook` },
      { headers: H() }
    );
    res.send('Webhook registered: ' + JSON.stringify(r.data));
  } catch (e) {
    res.send('Error: ' + JSON.stringify(e.response?.data || e.message));
  }
});

app.listen(PORT, () => console.log(`Listening on :${PORT}`));
