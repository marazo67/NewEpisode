const { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, downloadContentFromMessage, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const readline = require('readline');

// ======================== CONFIG ========================
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

const api = axios.create({
  timeout: 30000,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
});

// ======================== APIs ========================
const APIs = {
  generateImage: async (prompt) => {
    const r = await api.get(`https://api.siputzx.my.id/api/ai/stablediffusion`, { params: { prompt } });
    return r.data;
  },
  chatAI: async (text) => {
    const r = await api.get(`https://api.shizo.top/ai/gpt?apikey=shizo&query=${encodeURIComponent(text)}`);
    return r.data.msg? { msg: r.data.msg } : r.data;
  },
  getTikTokDownload: async (url) => {
    const r = await api.get(`https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`);
    if(r.data?.status && r.data?.data) {
      const d = r.data.data;
      let v = null;
      if(d.urls?.length) v = d.urls[0];
      else if(d.video_url) v = d.video_url;
      else if(d.url) v = d.url;
      return { videoUrl: v, title: d.metadata?.title || 'TikTok' };
    }
    throw new Error();
  },
  textToSpeech: async (text) => {
    const r = await api.get(`https://www.laurine.site/api/tts/tts-nova?text=${encodeURIComponent(text)}`);
    let url = null;
    if(typeof r.data === 'string' && r.data.startsWith('http')) url = r.data;
    else if(r.data.data){
      const d = r.data.data;
      url = d.URL || d.url || (d.MP3? `https://ttsmp3.com/created_mp3_ai/${d.MP3}` : null);
    }
    if(!url) throw new Error();
    return url;
  }
};

// ======================== HELPERS ========================
function tempFile(ext) {
  return path.join(TEMP_DIR, `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
}

async function downloadBuffer(url) {
  const res = await api.get(url, { responseType: 'arraybuffer', timeout: 120000 });
  return Buffer.from(res.data);
}

// ======================== EDITING FUNCTIONS ========================
function trim(input, start, end, output) {
  return new Promise((res, rej) => ffmpeg(input).setStartTime(start).setDuration(end-start).output(output).on('end',res).on('error',rej).run());
}
function blackVideo(audioPath, out) {
  return new Promise((res, rej) => ffmpeg().input(audioPath).input('color=c=black:s=320x240:r=30').inputFormat('lavfi').outputOptions(['-shortest','-c:v','libx264','-preset','ultrafast','-c:a','copy','-pix_fmt','yuv420p']).save(out).on('end',res).on('error',rej));
}
function slowmo(input, out) {
  return new Promise((res, rej) => ffmpeg(input).videoFilters('minterpolate=fps=120,setpts=4*PTS').noAudio().save(out).on('end',res).on('error',rej));
}
function gifConv(input, out) {
  return new Promise((res, rej) => ffmpeg(input).fps(13).videoBitrate(500).save(out).on('end',res).on('error',rej));
}
function rotate(input, angle, out) {
  const f = {left:'transpose=2',right:'transpose=1',flip:'hflip'};
  return new Promise((res, rej) => ffmpeg(input).videoFilters(f[angle]).save(out).on('end',res).on('error',rej));
}
function circleCrop(input, out) {
  return new Promise((res, rej) => ffmpeg(input).videoFilters("crop=min(in_w\\,in_h):min(in_w\\,in_h),format=rgba,geq='alpha=if(lt(sqrt((X-W/2)^2+(Y-H/2)^2)\\,W/2)\\,255\\,0)'").save(out).on('end',res).on('error',rej));
}
function interp(input, fps, out) {
  return new Promise((res, rej) => ffmpeg(input).videoFilters(`minterpolate=fps=${fps}:mi_mode=mci:me_mode=bidir`).save(out).on('end',res).on('error',rej));
}

// ======================== BOT START ========================
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) },
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
  });

  if (!state.creds.registered) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const phone = await new Promise(resolve => {
      rl.question('\n🔑 Enter your WhatsApp number (country code + number, digits only)\n> ', resolve);
    });
    rl.close();
    const cleanPhone = phone.replace(/\D/g, '');
    try {
      const code = await sock.requestPairingCode(cleanPhone);
      console.log('\n==============================');
      console.log('PAIRING CODE:', code);
      console.log('==============================');
    } catch (err) {
      console.error('Pairing code error:', err);
      process.exit(1);
    }
  }

  const ownerNumber = '1234567890@s.whatsapp.net';
  const botName = 'X-Bot';
  const startTime = Date.now();
  const avmixStore = new Map();
  const vmixStore = new Map();

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('🤖 Bot is online!');
      try {
        await sock.sendMessage(ownerNumber, { text: `✅ Device linked successfully! Bot is now online.\n\nNumber: ${ownerNumber.split('@')[0]}` });
      } catch (e) { console.error('Failed to send link notification:', e); }
    }
  });

  // SINGLE MESSAGES.UPSECT LISTENER - FIXED
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;

    // Auto typing + react (non-blocking)
    sock.sendPresenceUpdate('composing', jid).catch(() => {});
    setTimeout(() => sock.sendPresenceUpdate('paused', jid).catch(() => {}), 2000);
    if (!msg.message.reactionMessage) {
      sock.sendMessage(jid, { react: { text: '❤️', key: msg.key } }).catch(() => {});
    }

    // Auto like status
    if (msg.key.remoteJid === 'status@broadcast' && msg.key.participant) {
      sock.sendMessage(msg.key.participant, { react: { text: '👍', key: msg.key } }).catch(() => {});
      return;
    }

    // COMMAND HANDLER
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    console.log('TEXT:', text); // Debug log
    if (!text.startsWith('!')) return;

    const args = text.slice(1).trim().split(/ (.+)/);
    const command = args[0]?.toLowerCase();
    const input = args[1] || '';
    const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;

    async function getMediaBuffer(mediaObject, type) {
      const stream = await downloadContentFromMessage(mediaObject, type);
      let buffer = Buffer.from([]);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      return buffer;
    }

    try {
      if (command === 'ping') {
        const diff = Date.now() - (msg.messageTimestamp * 1000);
        await sock.sendMessage(jid, { text: `🏓 Pong! ${diff}ms` });
      }
      else if (command === 'uptime') {
        const uptime = Date.now() - startTime;
        const hours = Math.floor(uptime / 3600000);
        const minutes = Math.floor((uptime % 3600000) / 60000);
        const seconds = Math.floor((uptime % 60000) / 1000);
        await sock.sendMessage(jid, { text: `⏱️ Uptime: ${hours}h ${minutes}m ${seconds}s` });
      }
      else if (command === 'menu') {
        const menuText = `📋 *${botName} MENU*\n🎵!song <query>\n🤖!ai <question>\n!image <prompt>\n!tts <text>\n!tiktok <url>\n😂!meme!quote!joke\n✂️!trim start,end (reply to media)\n!slowmo!gif!black`;
        await sock.sendMessage(jid, { text: menuText });
      }
      else if (command === 'ai') {
        if (!input) return sock.sendMessage(jid, { text: '❌ Ask something.' });
        const res = await APIs.chatAI(input);
        await sock.sendMessage(jid, { text: res.msg || res.response || 'No response.' });
      }
      else if (command === 'image') {
        if (!input) return sock.sendMessage(jid, { text: '❌ Usage:!image prompt' });
        const data = await APIs.generateImage(input);
        const imgUrl = typeof data === 'string'? data : data.url || data.image;
        if (imgUrl) {
          const buffer = await downloadBuffer(imgUrl);
          await sock.sendMessage(jid, { image: buffer });
        }
      }
      else if (command === 'tiktok') {
        if (!input) return sock.sendMessage(jid, { text: '❌ Usage:!tiktok url' });
        const { videoUrl, title } = await APIs.getTikTokDownload(input);
        const buffer = await downloadBuffer(videoUrl);
        await sock.sendMessage(jid, { video: buffer, caption: title });
      }
      else if (command === 'trim' && quoted) {
        if (!input.includes(',')) return sock.sendMessage(jid, { text: 'Usage:!trim start,end' });
        const [s, e] = input.split(',').map(Number);
        const mediaType = quoted.videoMessage? 'video' : 'audio';
        const mediaObj = quoted.videoMessage || quoted.audioMessage;
        if (!mediaObj) return sock.sendMessage(jid, { text: 'Reply to audio/video.' });
        const buf = await getMediaBuffer(mediaObj, mediaType);
        const inExt = mediaType === 'audio'? 'ogg' : 'mp4';
        const inFile = tempFile(inExt);
        const outFile = tempFile('mp4');
        fs.writeFileSync(inFile, buf);
        await trim(inFile, s, e, outFile);
        await sock.sendMessage(jid, { video: fs.readFileSync(outFile) });
        fs.unlinkSync(inFile); fs.unlinkSync(outFile);
      }

    } catch (err) {
      console.error('Command error:', err);
      await sock.sendMessage(jid, { text: '❌ Internal error.' });
    }
  });
}

process.on('unhandledRejection', (reason) => console.error('Unhandled:', reason));
startBot();
