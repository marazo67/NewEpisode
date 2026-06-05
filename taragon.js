// ======================== FULLY WORKING BOT WITH WEB PAIRING, UPGRADED AI, SPOTIFY, SONG DOWNLOAD & MORE ========================
// Save as bot.js
// Run: node bot.js

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, downloadContentFromMessage, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const yts = require('yt-search');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ======================== CONFIGURATION ========================
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const WARNINGS_FILE = path.join(__dirname, 'warnings.json');
const ANTIDELETE_FILE = path.join(__dirname, 'antidelete.json');
const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR);

const PORT = process.env.PORT || 3000;

let settings = {};
let warnings = {};
let antidelete = {};

if (fs.existsSync(SETTINGS_FILE)) settings = JSON.parse(fs.readFileSync(SETTINGS_FILE));
if (fs.existsSync(WARNINGS_FILE)) warnings = JSON.parse(fs.readFileSync(WARNINGS_FILE));
if (fs.existsSync(ANTIDELETE_FILE)) antidelete = JSON.parse(fs.readFileSync(ANTIDELETE_FILE));

function saveSettings() { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); }
function saveWarnings() { fs.writeFileSync(WARNINGS_FILE, JSON.stringify(warnings, null, 2)); }
function saveAntidelete() { fs.writeFileSync(ANTIDELETE_FILE, JSON.stringify(antidelete, null, 2)); }

// Default settings
if (!settings.mode) settings.mode = 'public';
if (!settings.chatbotGlobal) settings.chatbotGlobal = false;
if (!settings.autoreact) settings.autoreact = false;
if (!settings.autostatus) settings.autostatus = false;
if (!settings.autotyping) settings.autotyping = false;
if (!settings.autoread) settings.autoread = false;
if (!settings.anticall) settings.anticall = false;
if (!settings.pmblocker) settings.pmblocker = false;
if (!settings.pmblockerMsg) settings.pmblockerMsg = '🔒 Private messages are blocked. Contact owner.';
if (!settings.mention) settings.mention = false;
if (!settings.mentionMsg) settings.mentionMsg = '';
if (!settings.antidelete) settings.antidelete = false;
if (!settings.chatbotGroups) settings.chatbotGroups = {};
if (!settings.antilink) settings.antilink = {};
if (!settings.antibadword) settings.antibadword = {};
if (!settings.antitag) settings.antitag = {};
if (!settings.welcome) settings.welcome = {};
if (!settings.goodbye) settings.goodbye = {};

// Store active bot instances (up to 50)
const activeBots = new Map();

// Helper functions
const api = axios.create({ timeout: 30000 });
const downloadBuffer = async (url) => (await api.get(url, { responseType: 'arraybuffer' })).data;
const getMediaBuffer = async (msg, type) => {
    const stream = await downloadContentFromMessage(msg, type);
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return buffer;
};

const BAD_WORDS = ['badword1', 'stupid', 'idiot', 'fuck', 'shit', 'fokof', 'tsek', 'nggA', 'fusek', 'asshole', 'dumass', 'kill', 'you'];

async function getFolderSize(dirPath) {
    let total = 0;
    try {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            const stats = fs.statSync(path.join(dirPath, file));
            if (stats.isDirectory()) total += await getFolderSize(path.join(dirPath, file));
            else total += stats.size;
        }
    } catch (e) {}
    return total;
}

async function translate(text, targetLang) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await api.get(url);
    return res.data[0][0][0];
}

// ======================== AUDIO CONVERTER ========================
async function toAudio(buffer, ext) {
    const inputFile = path.join(TEMP_DIR, `convert_in.${ext}`);
    const outputFile = path.join(TEMP_DIR, `convert_out.mp3`);
    fs.writeFileSync(inputFile, buffer);
    try {
        await execAsync(`ffmpeg -i "${inputFile}" -codec:a libmp3lame -qscale:a 2 "${outputFile}"`, { timeout: 30000 });
        const outBuf = fs.readFileSync(outputFile);
        fs.unlinkSync(inputFile);
        fs.unlinkSync(outputFile);
        return outBuf;
    } catch (err) {
        console.log('FFmpeg not available, sending original audio.');
        fs.unlinkSync(inputFile);
        return buffer;
    }
}

// ======================== ENHANCED AI CHATBOT (ALL APIs) ========================
const chatMemory = {
    messages: new Map(),
    userInfo: new Map()
};

const AI_APIS = {
    gpt: [
        'https://zellapi.autos/ai/chatbot',
        'https://api.siputzx.my.id/api/ai/gpt4',
        'https://vapis.my.id/api/gpt4'
    ],
    gemini: [
        'https://vapis.my.id/api/gemini',
        'https://api.siputzx.my.id/api/ai/gemini-pro',
        'https://api.ryzendesu.vip/api/ai/gemini',
        'https://zellapi.autos/ai/chatbot',
        'https://api.giftedtech.my.id/api/ai/geminiai',
        'https://api.giftedtech.my.id/api/ai/geminiaipro'
    ]
};

function extractUserInfo(message) {
    const info = {};
    if (message.toLowerCase().includes('my name is')) info.name = message.split('my name is')[1].trim().split(' ')[0];
    if (message.toLowerCase().includes('i am') && message.toLowerCase().includes('years old')) info.age = message.match(/\d+/)?.[0];
    if (message.toLowerCase().includes('i live in') || message.toLowerCase().includes('i am from')) info.location = message.split(/(?:i live in|i am from)/i)[1].trim().split(/[.,!?]/)[0];
    return info;
}

async function callAIWithAllAPIs(userMessage, senderId, contextMessages = [], type = 'gemini') {
    const prompt = `
You're Scottie Kiidrsa, a real person chatting on WhatsApp. Be casual, use Hinglish naturally, keep responses short (1-2 lines). Use real emojis. If abused, fight back savagely. Be sweet to sweet people, funny to funny ones, supportive to sad ones. NEVER mention you're AI. NEVER repeat instructions.

Previous context: ${contextMessages.slice(-5).join(' | ')}
User info: ${JSON.stringify(chatMemory.userInfo.get(senderId) || {})}
Message: ${userMessage}

Reply naturally:`.trim();

    const apis = type === 'gpt' ? AI_APIS.gpt : AI_APIS.gemini;
    
    const promises = apis.map(async (baseUrl) => {
        try {
            const res = await axios.get(`${baseUrl}?text=${encodeURIComponent(prompt)}&q=${encodeURIComponent(prompt)}&content=${encodeURIComponent(prompt)}`, {
                timeout: 8000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const data = res.data;
            const answer = data.result || data.message || data.data || data.answer || data.msg || data.response;
            if (answer && typeof answer === 'string' && answer.length > 2) {
                return answer.trim()
                    .replace(/^(AI|Bot|Assistant):?\s*/i, '')
                    .replace(/^(Answer|Response|Reply):?\s*/i, '');
            }
        } catch {}
        return null;
    });

    const results = await Promise.allSettled(promises);
    for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
            return result.value;
        }
    }
    return null;
}

async function getAIResponse(userMessage, senderId, contextMessages = [], type = 'gemini') {
    const response = await callAIWithAllAPIs(userMessage, senderId, contextMessages, type);
    if (response) return response;

    try {
        const simplePrompt = `Reply casually to: ${userMessage}`;
        const res = await axios.get(`https://zellapi.autos/ai/chatbot?text=${encodeURIComponent(simplePrompt)}`, { timeout: 10000 });
        if (res.data?.result) return res.data.result.trim();
    } catch {}

    return "Hmm, let me think... 😅";
}

// ======================== SPOTIFY COMMAND ========================
async function spotifyCommand(input, jid, quoted, sendMsg) {
    if (!input) {
        await sendMsg(jid, { text: 'Usage: !spotify <song/artist/keywords>\nExample: !spotify con calma' }, { quoted });
        return;
    }
    try {
        const { data } = await axios.get(`https://okatsu-rolezapiiz.vercel.app/search/spotify?q=${encodeURIComponent(input)}`, { timeout: 20000 });
        if (data?.status && data?.result) {
            const r = data.result;
            const audioUrl = r.audio;
            if (!audioUrl) throw new Error('No audio');
            const caption = `🎵 ${r.title || r.name}\n👤 ${r.artist || ''}\n⏱ ${r.duration || ''}\n🔗 ${r.url || ''}`.trim();
            if (r.thumbnails) await sendMsg(jid, { image: { url: r.thumbnails }, caption }, { quoted });
            else await sendMsg(jid, { text: caption }, { quoted });
            await sendMsg(jid, {
                audio: { url: audioUrl },
                mimetype: 'audio/mpeg',
                fileName: `${(r.title || r.name || 'track').replace(/[\\/:*?"<>|]/g, '')}.mp3`
            }, { quoted });
        } else throw new Error('No result');
    } catch (err) {
        await sendMsg(jid, { text: '❌ Failed to fetch Spotify audio. Try another query later.' }, { quoted });
    }
}

// ======================== SONG DOWNLOAD ========================
const AXIOS_DEFAULTS = {
    timeout: 60000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
    }
};

const tryRequest = async (fn, attempts = 3) => {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try { return await fn(); } catch (err) {
            lastError = err;
            if (attempt < attempts) await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
    throw lastError;
};

async function downloadSong(urlOrQuery) {
    const isUrl = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/i.test(urlOrQuery);
    let video;
    if (isUrl) {
        video = { url: urlOrQuery, title: 'YouTube Video', timestamp: '' };
    } else {
        const search = await yts(urlOrQuery);
        if (!search || !search.videos.length) throw new Error('No results found');
        video = search.videos[0];
    }

    let audioBuffer = null;
    let title = video.title;

    const apis = [
        async () => {
            const res = await tryRequest(() => axios.get(`https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(video.url)}&format=mp3`, AXIOS_DEFAULTS));
            if (res?.data?.success && res?.data?.downloadURL) return { url: res.data.downloadURL, title: res.data.title };
            throw new Error('No download');
        },
        async () => {
            const res = await tryRequest(() => axios.get(`https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(video.url)}`, AXIOS_DEFAULTS));
            if (res?.data?.success && res?.data?.data?.download_url) return { url: res.data.data.download_url, title: res.data.data.title };
            throw new Error('No download');
        },
        async () => {
            const res = await tryRequest(() => axios.get(`https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(video.url)}`, AXIOS_DEFAULTS));
            if (res?.data?.dl) return { url: res.data.dl, title: res.data.title };
            throw new Error('No download');
        }
    ];

    for (const getter of apis) {
        try {
            const { url, title: t } = await getter();
            if (url) {
                const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 90000, headers: AXIOS_DEFAULTS.headers });
                audioBuffer = Buffer.from(response.data);
                title = t || title;
                break;
            }
        } catch {}
    }

    if (!audioBuffer) {
        try {
            const outputTemplate = path.join(TEMP_DIR, `yt_audio_${Date.now()}.%(ext)s`);
            const args = ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', outputTemplate, '--print', 'title', '--no-playlist', video.url];
            const { stdout } = await execAsync(`yt-dlp ${args.map(a => `"${a}"`).join(' ')}`, { timeout: 120000 });
            const lines = stdout.trim().split('\n');
            title = lines[0].trim();
            const baseOutput = outputTemplate.replace('%(ext)s', 'mp3');
            if (fs.existsSync(baseOutput)) {
                audioBuffer = fs.readFileSync(baseOutput);
                fs.unlinkSync(baseOutput);
            } else throw new Error('No output');
        } catch (ytdlpErr) {
            throw new Error('All download sources failed.');
        }
    }

    if (!audioBuffer || audioBuffer.length === 0) throw new Error('Empty audio');

    const firstBytes = audioBuffer.slice(0, 12);
    let mime = 'audio/mpeg';
    let ext = 'mp3';
    const ascii4 = firstBytes.toString('ascii', 4, 8);
    if (ascii4 === 'ftyp') { mime = 'audio/mp4'; ext = 'm4a'; }
    else if (firstBytes.toString('ascii', 0, 3) === 'ID3' || (firstBytes[0] === 0xFF && (firstBytes[1] & 0xE0) === 0xE0)) { mime = 'audio/mpeg'; ext = 'mp3'; }
    else if (firstBytes.toString('ascii', 0, 4) === 'OggS') { mime = 'audio/ogg; codecs=opus'; ext = 'ogg'; }
    else if (firstBytes.toString('ascii', 0, 4) === 'RIFF') { mime = 'audio/wav'; ext = 'wav'; }

    if (ext !== 'mp3') {
        audioBuffer = await toAudio(audioBuffer, ext);
        mime = 'audio/mpeg';
        ext = 'mp3';
    }

    return { buffer: audioBuffer, title, mime, ext };
}

async function ytDlpVideo(url) {
    const outputTemplate = path.join(TEMP_DIR, `yt_video_${Date.now()}.mp4`);
    const args = ['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4', '-o', outputTemplate, '--print', 'title', '--no-playlist', url];
    const { stdout } = await execAsync(`yt-dlp ${args.map(a => `"${a}"`).join(' ')}`, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 });
    const lines = stdout.trim().split('\n');
    const title = lines[0].trim();
    if (!fs.existsSync(outputTemplate)) throw new Error('No output file');
    const buffer = fs.readFileSync(outputTemplate);
    fs.unlinkSync(outputTemplate);
    return { download: buffer, title: title || 'Unknown Title' };
}

async function downloadTikTok(url) {
    const res = await tryRequest(() => axios.get(`https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`, { timeout: 15000, headers: { 'accept': '*/*', 'User-Agent': 'Mozilla/5.0' } }));
    if (res?.data?.status && res?.data?.data) {
        let videoUrl = null, title = null;
        if (Array.isArray(res.data.data.urls) && res.data.data.urls.length) { videoUrl = res.data.data.urls[0]; title = res.data.data.metadata?.title || 'TikTok'; }
        else if (res.data.data.video_url) { videoUrl = res.data.data.video_url; title = res.data.data.metadata?.title || 'TikTok'; }
        else if (res.data.data.url) { videoUrl = res.data.data.url; title = res.data.data.metadata?.title || 'TikTok'; }
        else if (res.data.data.download_url) { videoUrl = res.data.data.download_url; title = res.data.data.metadata?.title || 'TikTok'; }
        if (videoUrl) return { videoUrl, title };
    }
    throw new Error('TikTok download failed.');
}

// ======================== WEB SERVER SETUP ========================
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Serve pairing page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Create public directory
if (!fs.existsSync(path.join(__dirname, 'public'))) {
    fs.mkdirSync(path.join(__dirname, 'public'));
}

// Create enhanced beautiful index.html with Google Fonts
const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>𝐓𝐀𝐑𝐀𝐆𝐎𝐍 𝐒𝐐𝐔𝐀𝐃 𝐓𝐑𝐒 - WhatsApp Pairing</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;family=Space+Grotesk:wght@500;600&amp;display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        :root {
            --primary: #667eea;
            --secondary: #764ba2;
            --accent: #f093fb;
            --glass-bg: rgba(255, 255, 255, 0.03);
            --glass-border: rgba(255, 255, 255, 0.08);
            --text-primary: #ffffff;
            --text-secondary: rgba(255, 255, 255, 0.7);
            --success: #51cf66;
            --error: #ff6b6b;
            --radius-lg: 24px;
            --radius-md: 16px;
            --radius-sm: 12px;
            --shadow-lg: 0 25px 50px rgba(0, 0, 0, 0.5);
            --shadow-glow: 0 0 40px rgba(102, 126, 234, 0.3);
        }
        
        body {
            font-family: 'Inter', sans-serif;
            background: #0a0a0f;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: hidden;
            position: relative;
        }
        
        .bg-gradient {
            position: fixed;
            top: -50%; left: -50%;
            width: 200%; height: 200%;
            background: radial-gradient(circle at 20% 50%, rgba(102,126,234,0.15) 0%, transparent 50%),
                        radial-gradient(circle at 80% 20%, rgba(118,75,162,0.15) 0%, transparent 50%),
                        radial-gradient(circle at 50% 80%, rgba(240,147,251,0.1) 0%, transparent 50%);
            animation: bgRotate 30s linear infinite;
            z-index: 0;
        }
        
        @keyframes bgRotate {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .flags {
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none;
            z-index: 2;
        }
        
        .flag {
            position: absolute;
            font-size: 24px;
            animation: float linear infinite;
            text-shadow: 0 0 20px rgba(255,255,255,0.3);
        }
        
        @keyframes float {
            0% { transform: translateY(110vh) rotate(0deg); opacity: 0; }
            10% { opacity: 0.4; }
            90% { opacity: 0.4; }
            100% { transform: translateY(-10vh) rotate(720deg); opacity: 0; }
        }
        
        .container {
            position: relative;
            z-index: 10;
            background: var(--glass-bg);
            backdrop-filter: blur(30px);
            border: 1px solid var(--glass-border);
            border-radius: var(--radius-lg);
            padding: 48px 40px;
            max-width: 500px;
            width: 92%;
            box-shadow: var(--shadow-lg), var(--shadow-glow);
            animation: containerAppear 0.6s ease;
        }
        
        @keyframes containerAppear {
            0% { opacity: 0; transform: translateY(30px) scale(0.95); }
            100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        
        .logo-section { text-align: center; margin-bottom: 32px; }
        
        .logo-icon {
            font-size: 56px;
            margin-bottom: 16px;
            animation: logoPulse 3s ease-in-out infinite;
        }
        
        @keyframes logoPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.08); }
        }
        
        .logo {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 32px;
            font-weight: 600;
            background: linear-gradient(135deg, #667eea, #764ba2, #f093fb);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 8px;
        }
        
        .subtitle { color: var(--text-secondary); font-size: 14px; }
        
        .status-badges {
            display: flex;
            gap: 8px;
            justify-content: center;
            margin-top: 12px;
            flex-wrap: wrap;
        }
        
        .badge {
            padding: 6px 14px;
            border-radius: 100px;
            font-size: 11px;
            font-weight: 500;
            background: rgba(255,255,255,0.06);
            border: 1px solid var(--glass-border);
            color: var(--text-secondary);
        }
        
        .badge.online { color: var(--success); border-color: rgba(81,207,102,0.3); background: rgba(81,207,102,0.08); }
        
        .input-section { margin-bottom: 20px; }
        
        .input-label {
            color: var(--text-secondary);
            font-size: 12px;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 8px;
        }
        
        .input-group { position: relative; }
        
        .input-icon {
            position: absolute;
            left: 16px;
            top: 50%;
            transform: translateY(-50%);
            font-size: 18px;
            z-index: 1;
        }
        
        input {
            width: 100%;
            padding: 16px 16px 16px 48px;
            border-radius: var(--radius-md);
            border: 1px solid var(--glass-border);
            background: rgba(255,255,255,0.04);
            color: var(--text-primary);
            font-size: 16px;
            font-family: 'Inter', sans-serif;
            outline: none;
            transition: all 0.3s;
        }
        
        input:focus {
            border-color: var(--primary);
            background: rgba(255,255,255,0.06);
            box-shadow: 0 0 0 4px rgba(102,126,234,0.1), var(--shadow-glow);
        }
        
        input::placeholder { color: rgba(255,255,255,0.5); }
        
        .btn {
            width: 100%;
            padding: 16px;
            border-radius: var(--radius-md);
            border: none;
            font-size: 15px;
            font-weight: 600;
            font-family: 'Inter', sans-serif;
            cursor: pointer;
            transition: all 0.3s;
            position: relative;
            overflow: hidden;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            box-shadow: 0 4px 20px rgba(102,126,234,0.3);
            margin-bottom: 12px;
        }
        
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 30px rgba(102,126,234,0.4);
        }
        
        .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        
        .btn-copy {
            background: rgba(255,255,255,0.1);
            color: white;
            border: 1px solid var(--glass-border);
        }
        
        .btn-copy:hover { background: rgba(255,255,255,0.2); }
        
        .result {
            margin-top: 24px;
            padding: 24px;
            border-radius: var(--radius-md);
            background: rgba(0,0,0,0.3);
            border: 1px solid var(--glass-border);
            display: none;
            animation: slideDown 0.4s ease;
        }
        
        .result.show { display: block; }
        
        @keyframes slideDown {
            0% { opacity: 0; transform: translateY(-10px); }
            100% { opacity: 1; transform: translateY(0); }
        }
        
        .result-label {
            color: var(--text-secondary);
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 8px;
        }
        
        .code {
            font-family: 'Space Grotesk', monospace;
            font-size: 40px;
            font-weight: 600;
            letter-spacing: 12px;
            color: var(--primary);
            padding: 20px;
            background: rgba(102,126,234,0.1);
            border-radius: var(--radius-sm);
            border: 2px dashed rgba(102,126,234,0.3);
            text-align: center;
            margin: 16px 0;
            text-shadow: 0 0 30px rgba(102,126,234,0.5);
            user-select: all;
        }
        
        .instructions {
            background: rgba(255,255,255,0.05);
            border-radius: var(--radius-sm);
            padding: 16px;
            margin-top: 16px;
        }
        
        .instruction-step {
            display: flex;
            align-items: center;
            gap: 10px;
            color: var(--text-secondary);
            font-size: 13px;
            padding: 6px 0;
        }
        
        .step-number {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: var(--primary);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 600;
            flex-shrink: 0;
        }
        
        .status {
            color: var(--text-secondary);
            font-size: 13px;
            margin-top: 12px;
            line-height: 1.6;
        }
        
        .status.success { color: var(--success); }
        .status.error { color: var(--error); }
        
        .loader {
            display: inline-flex;
            align-items: center;
            gap: 10px;
        }
        
        .spinner {
            width: 22px; height: 22px;
            border: 2.5px solid rgba(255,255,255,0.2);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 0.7s linear infinite;
        }
        
        @keyframes spin { to { transform: rotate(360deg); } }
        
        .stats-bar {
            margin-top: 24px;
            padding-top: 20px;
            border-top: 1px solid var(--glass-border);
            display: flex;
            justify-content: center;
            gap: 32px;
        }
        
        .stat { text-align: center; }
        
        .stat-value {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 20px;
            font-weight: 600;
            color: var(--text-primary);
        }
        
        .stat-label {
            font-size: 11px;
            color: rgba(255,255,255,0.5);
            text-transform: uppercase;
            letter-spacing: 1px;
        }
    </style>
</head>
<body>
    <div class="bg-gradient"></div>
    <div class="flags" id="flags"></div>
    
    <div class="container">
        <div class="logo-section">
            <div class="logo-icon">🇻🇦</div>
            <div class="logo">𝐓𝐀𝐑𝐀𝐆𝐎𝐍 𝐒𝐐𝐔𝐀𝐃 𝐓𝐑𝐒🇻🇦</div>
            <div class="subtitle">WhatsApp Multi-Device Pairing Portal</div>
            <div class="status-badges">
                <span class="badge online">🟢 Online</span>
                <span class="badge">🚀 Multi-Session</span>
                <span class="badge">🔐 Secure</span>
            </div>
        </div>
        
        <div class="input-section">
            <div class="input-label">📱 Phone Number (with country code)</div>
            <div class="input-group">
                <span class="input-icon">🌍</span>
                <input type="tel" id="phone" placeholder="Example: 27785028986" maxlength="15" autocomplete="off">
            </div>
        </div>
        
        <button class="btn btn-primary" id="pairBtn" onclick="requestPairing()">
            <span id="btnText">⚡ Get Pairing Code</span>
        </button>
        
        <div class="result" id="result">
            <div class="result-label">🔑 Your 8-Digit Pairing Code</div>
            <div class="code" id="pairingCode">--------</div>
            <button class="btn btn-copy" onclick="copyCode()" id="copyBtn">📋 Copy Code</button>
            
            <div class="instructions">
                <div class="instruction-step">
                    <span class="step-number">1</span>
                    Open WhatsApp on your phone
                </div>
                <div class="instruction-step">
                    <span class="step-number">2</span>
                    Tap <strong>⋮</strong> → <strong>Linked Devices</strong>
                </div>
                <div class="instruction-step">
                    <span class="step-number">3</span>
                    Tap <strong>Link a Device</strong>
                </div>
                <div class="instruction-step">
                    <span class="step-number">4</span>
                    Enter the code shown above
                </div>
            </div>
            
            <p class="status" id="statusMsg"></p>
        </div>
        
        <div class="stats-bar">
            <div class="stat">
                <div class="stat-value" id="botCount">0</div>
                <div class="stat-label">Active Bots</div>
            </div>
            <div class="stat">
                <div class="stat-value">50</div>
                <div class="stat-label">Max</div>
            </div>
            <div class="stat">
                <div class="stat-value">24/7</div>
                <div class="stat-label">Uptime</div>
            </div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const flagsContainer = document.getElementById('flags');
        const flagEmojis = ['🇻🇦', '🔮', '⚡', '🌟', '💎', '🔥', '🛡️', '👑'];
        
        for (let i = 0; i < 60; i++) {
            const flag = document.createElement('div');
            flag.className = 'flag';
            flag.textContent = flagEmojis[Math.floor(Math.random() * flagEmojis.length)];
            flag.style.left = Math.random() * 100 + '%';
            flag.style.fontSize = (Math.random() * 28 + 14) + 'px';
            flag.style.animationDuration = (Math.random() * 12 + 8) + 's';
            flag.style.animationDelay = Math.random() * 10 + 's';
            flagsContainer.appendChild(flag);
        }
        
        const socket = io();
        let pairingCode = '';
        
        socket.on('pairingCode', (data) => {
            document.getElementById('pairingCode').textContent = data.code;
            document.getElementById('result').classList.add('show');
            document.getElementById('statusMsg').innerHTML = '<span class="success">✅ Code ready! Enter it in WhatsApp to link.</span>';
            document.getElementById('btnText').innerHTML = '⚡ Get Pairing Code';
            document.getElementById('pairBtn').disabled = false;
            pairingCode = data.code;
        });
        
        socket.on('pairingError', (data) => {
            document.getElementById('statusMsg').innerHTML = '<span class="error">❌ ' + data.error + '</span>';
            document.getElementById('btnText').innerHTML = '⚡ Get Pairing Code';
            document.getElementById('pairBtn').disabled = false;
            document.getElementById('result').classList.add('show');
        });
        
        socket.on('botConnected', (data) => {
            document.getElementById('statusMsg').innerHTML = '<span class="success">✅ Connected as +' + data.number + '</span>';
            document.getElementById('btnText').innerHTML = '⚡ Get Pairing Code';
            document.getElementById('pairBtn').disabled = false;
        });
        
        socket.on('botCount', (data) => {
            document.getElementById('botCount').textContent = data.count;
        });
        
        function requestPairing() {
            const phoneNumber = document.getElementById('phone').value.replace(/\\D/g, '');
            if (!phoneNumber || phoneNumber.length < 10) {
                alert('Please enter a valid phone number with country code');
                return;
            }
            document.getElementById('btnText').innerHTML = '<span class="loader"><span class="spinner"></span> Generating...</span>';
            document.getElementById('pairBtn').disabled = true;
            document.getElementById('result').classList.remove('show');
            socket.emit('requestPairing', { phone: phoneNumber });
        }
        
        function copyCode() {
            if (pairingCode) {
                navigator.clipboard.writeText(pairingCode).then(() => {
                    const btn = document.getElementById('copyBtn');
                    btn.textContent = '✅ Copied!';
                    btn.style.borderColor = 'rgba(81,207,102,0.5)';
                    btn.style.color = '#51cf66';
                    setTimeout(() => {
                        btn.textContent = '📋 Copy Code';
                        btn.style.borderColor = 'rgba(255,255,255,0.08)';
                        btn.style.color = 'white';
                    }, 2500);
                }).catch(() => {
                    // Fallback for older browsers
                    const textArea = document.createElement('textarea');
                    textArea.value = pairingCode;
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                    const btn = document.getElementById('copyBtn');
                    btn.textContent = '✅ Copied!';
                    setTimeout(() => { btn.textContent = '📋 Copy Code'; }, 2000);
                });
            }
        }
        
        document.getElementById('phone').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') requestPairing();
        });
    </script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'public', 'index.html'), htmlContent);

// Socket.io handling for pairing
io.on('connection', (socket) => {
    socket.emit('botCount', { count: activeBots.size });

    socket.on('requestPairing', async (data) => {
        const { phone } = data;
        
        if (activeBots.size >= 50) {
            socket.emit('pairingError', { error: 'Maximum 50 bots reached. Please wait for a slot.' });
            return;
        }

        try {
            const sessionName = `session_${phone}_${Date.now()}`;
            const sessionDir = path.join(SESSIONS_DIR, sessionName);
            
            const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
            const { version } = await fetchLatestBaileysVersion();

            // Create socket with proper configuration for pairing
            const sock = makeWASocket({
                version,
                auth: { 
                    creds: state.creds, 
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) 
                },
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                browser: Browsers.macOS('Chrome'),
                syncFullHistory: false,
                markOnlineOnConnect: false,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
            });

            // Request pairing code
            try {
                const code = await sock.requestPairingCode(phone);
                console.log(`📱 Pairing code generated for ${phone}: ${code}`);
                socket.emit('pairingCode', { code });
            } catch (pairErr) {
                console.error('Pairing error:', pairErr);
                socket.emit('pairingError', { error: 'Failed to generate code. Make sure the number is correct and includes country code (no + or spaces).' });
                return;
            }

            // Listen for connection events
            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                if (connection === 'open') {
                    const botNumber = sock.user.id.split(':')[0];
                    activeBots.set(sessionName, { sock, phone, number: botNumber });
                    io.emit('botCount', { count: activeBots.size });
                    socket.emit('botConnected', { number: botNumber });
                    console.log(`✅ Bot ${botNumber} connected! Total: ${activeBots.size}/50`);
                    setupBotHandlers(sock, botNumber);
                } else if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode !== DisconnectReason.loggedOut) {
                        // Reconnect attempt
                        console.log('Connection closed, attempting reconnect...');
                    } else {
                        activeBots.delete(sessionName);
                        io.emit('botCount', { count: activeBots.size });
                        console.log('Logged out, session removed');
                    }
                }
            });

            sock.ev.on('creds.update', saveCreds);

        } catch (err) {
            console.error('General error:', err);
            socket.emit('pairingError', { error: 'Server error. Please try again.' });
        }
    });
});

// Bot handler setup for each instance
function setupBotHandlers(sock, botNumber) {
    const ownerNumber = `${botNumber}@s.whatsapp.net`;
    const botName = '𝐓𝐀𝐑𝐀𝐆𝐎𝐍 𝐒𝐐𝐔𝐀𝐃 𝐓𝐑𝐒🇻🇦';

    const sendStyledMessage = async (jid, content, options = {}) => {
        const baseContext = {
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363@newsletter',
                newsletterName: `${botName} v3.0.7`,
                serverMessageId: 1
            }
        };
        const existingContext = content.contextInfo || {};
        const mergedContext = { ...baseContext, externalAdReply: existingContext.externalAdReply || undefined, ...existingContext };
        mergedContext.forwardedNewsletterMessageInfo = baseContext.forwardedNewsletterMessageInfo;
        const full = { ...content, contextInfo: mergedContext };
        return sock.sendMessage(jid, full, options);
    };

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');
        const sender = isGroup ? msg.key.participant : jid;
        const isOwner = sender === ownerNumber;
        const isFromMe = msg.key.fromMe;

        let text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const isCommand = text.startsWith('!');

        if (settings.autoread) await sock.readMessages([msg.key]).catch(() => {});
        if (settings.autotyping) {
            sock.sendPresenceUpdate('composing', jid).catch(() => {});
            setTimeout(() => sock.sendPresenceUpdate('paused', jid).catch(() => {}), 2000);
        }
        if (settings.autoreact && !isCommand && !isFromMe) {
            const emojis = ['❤️', '👍', '😂', '😮', '😢', '👏', '🇻🇦', '🤨', '😕', '🖕', '🥺', '🚀'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            await sock.sendMessage(jid, { react: { text: randomEmoji, key: msg.key } }).catch(() => {});
        }
        if (msg.message.call && settings.anticall && !isOwner) {
            await sendStyledMessage(jid, { text: '📞 Bot rejects calls. Please text only.' });
            return;
        }
        if (!isGroup && !isOwner && !isFromMe && settings.pmblocker) {
            await sendStyledMessage(jid, { text: settings.pmblockerMsg });
            return;
        }
        if (isGroup && !isFromMe) {
            if (settings.antilink?.[jid] && /https?:\/\//i.test(text)) {
                await sock.sendMessage(jid, { delete: msg.key });
                await sendStyledMessage(jid, { text: '🔗 Links are not allowed here.' });
                return;
            }
            if (settings.antibadword?.[jid] && BAD_WORDS.some(word => text.toLowerCase().includes(word))) {
                await sock.sendMessage(jid, { delete: msg.key });
                await sendStyledMessage(jid, { text: '🚫 Bad words are prohibited.' });
                return;
            }
        }

        const isChatbotActive = settings.chatbotGlobal || (isGroup && settings.chatbotGroups?.[jid]);
        if (!isCommand && !isFromMe && isChatbotActive) {
            let shouldReply = false;
            const botJids = [sock.user.id, `${botNumber}@s.whatsapp.net`, `${botNumber}@lid`];
            if (msg.message?.extendedTextMessage) {
                const mentionedJid = msg.message.extendedTextMessage.contextInfo?.mentionedJid || [];
                const quotedParticipant = msg.message.extendedTextMessage.contextInfo?.participant;
                if (mentionedJid.some(j => botJids.includes(j))) shouldReply = true;
                if (quotedParticipant && botJids.includes(quotedParticipant)) shouldReply = true;
            } else if (!isGroup) {
                shouldReply = true;
            }
            if (shouldReply) {
                await sock.sendPresenceUpdate('composing', jid).catch(() => {});
                const userId = sender;
                if (!chatMemory.messages.has(userId)) chatMemory.messages.set(userId, []);
                const msgs = chatMemory.messages.get(userId);
                msgs.push(text);
                if (msgs.length > 20) msgs.shift();
                const reply = await getAIResponse(text, userId, msgs);
                await sendStyledMessage(jid, { text: reply }, { quoted: msg });
                return;
            }
        }

        if (!isCommand) return;
        if (settings.mode === 'private' && !isOwner) return;

        const args = text.slice(1).trim().split(/ +/);
        const command = args[0].toLowerCase();
        const input = args.slice(1).join(' ');
        const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;

        try {
            if (command === 'ping') {
                const start = Date.now();
                await sendStyledMessage(jid, { text: `🏓 Pong! *${Date.now() - start}ms*` });
            }
            else if (command === 'alive') {
                await sendStyledMessage(jid, { text: `✅ *${botName}* is online and ready!` });
            }
            else if (command === 'gpt' || command === 'gemini') {
                if (!input) return sendStyledMessage(jid, { text: `Usage: !${command} <question>` });
                await sock.sendPresenceUpdate('composing', jid).catch(() => {});
                const reply = await getAIResponse(input, sender, [], command);
                await sendStyledMessage(jid, { text: `🤖 ${reply}` });
            }
            else if (command === 'play' || command === 'ytmp3') {
                if (!input) return sendStyledMessage(jid, { text: `Usage: !${command} <song name or YouTube link>` });
                await sendStyledMessage(jid, { text: '⏳ Downloading audio...' });
                try {
                    const { buffer, title, mime, ext } = await downloadSong(input);
                    await sendStyledMessage(jid, {
                        audio: buffer,
                        mimetype: mime,
                        fileName: `${title.replace(/[\\/:*?"<>|]/g, '')}.${ext}`,
                        ptt: false
                    }, { quoted: msg });
                } catch (err) {
                    await sendStyledMessage(jid, { text: `❌ ${err.message}` });
                }
            }
            else if (command === 'ytmp4') {
                if (!input) return sendStyledMessage(jid, { text: 'Usage: !ytmp4 <YouTube URL>' });
                await sendStyledMessage(jid, { text: '⏳ Downloading video...' });
                try {
                    let video;
                    try {
                        const res = await tryRequest(() => axios.get(`https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(input)}`, AXIOS_DEFAULTS));
                        if (res?.data?.success && res?.data?.data?.download_url) video = { url: res.data.data.download_url, title: res.data.data.title };
                    } catch {}
                    if (!video) {
                        const { download, title } = await ytDlpVideo(input);
                        await sendStyledMessage(jid, { video: download, caption: title || '' });
                        return;
                    }
                    const buffer = await downloadBuffer(video.url);
                    await sendStyledMessage(jid, { video: buffer, caption: video.title || '' });
                } catch (err) {
                    await sendStyledMessage(jid, { text: `❌ ${err.message}` });
                }
            }
            else if (command === 'tiktok') {
                if (!input) return sendStyledMessage(jid, { text: 'Usage: !tiktok <url>' });
                await sendStyledMessage(jid, { text: '⏳ Downloading TikTok...' });
                try {
                    const { videoUrl, title } = await downloadTikTok(input);
                    const buffer = await downloadBuffer(videoUrl);
                    await sendStyledMessage(jid, { video: buffer, caption: title || 'TikTok' });
                } catch (err) {
                    await sendStyledMessage(jid, { text: `❌ ${err.message}` });
                }
            }
            else if (command === 'spotify') {
                await spotifyCommand(input, jid, msg, sendStyledMessage);
            }
            else {
                await sendStyledMessage(jid, { text: '❌ Unknown command. Type *!menu*' });
            }
        } catch (err) {
            console.error('Command error:', command, err.message);
        }
    });
}

// Start server
server.listen(PORT, () => {
    console.log(`\n`);
    console.log(`╔══════════════════════════════════════════╗`);
    console.log(`║       🌐 Taragon Bot Web Panel          ║`);
    console.log(`║                                        ║`);
    console.log(`║   🔗 URL: http://localhost:${PORT}         ║`);
    console.log(`║   🤖 Max Bots: 50                      ║`);
    console.log(`║   📱 Pairing: Enter phone → Get Code   ║`);
    console.log(`║                                        ║`);
    console.log(`║   HOW TO PAIR:                          ║`);
    console.log(`║   1. Open web panel                      ║`);
    console.log(`║   2. Enter phone with country code       ║`);
    console.log(`║   3. Click "Get Pairing Code"           ║`);
    console.log(`║   4. In WhatsApp: Linked Devices        ║`);
    console.log(`║   5. Tap "Link a Device"               ║`);
    console.log(`║   6. Enter the 8-digit code             ║`);
    console.log(`╚══════════════════════════════════════════╝\n`);
});

// Start main bot if session exists
async function startMainBot() {
    if (fs.existsSync('auth_info_baileys')) {
        try {
            const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
            const { version } = await fetchLatestBaileysVersion();
            const sock = makeWASocket({
                version,
                auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) },
                printQRInTerminal: false,
                logger: pino({ level: 'info' }),
                browser: Browsers.macOS('Chrome'),
            });
            const botNumber = '27785028986';
            setupBotHandlers(sock, botNumber);
            console.log('✅ Main bot started from existing session\n');
        } catch (err) {
            console.log('No existing session found. Use web panel to pair.\n');
        }
    }
}

startMainBot().catch(() => {
    console.log('Open the web panel to pair your first device.\n');
});
