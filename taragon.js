// ======================== TARAGON BOT - COMPLETE WORKING VERSION ========================
// Save as bot.js | Run: node bot.js
// Install: npm install express socket.io @whiskeysockets/baileys pino axios yt-search

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { 
    makeWASocket, 
    useMultiFileAuthState, 
    makeCacheableSignalKeyStore, 
    downloadContentFromMessage, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    Browsers,
    delay,
    PHONENUMBER_MCC
} = require('@whiskeysockets/baileys');
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
const PORT = process.env.PORT || 3000;
const OWNER_PHONE = '27785028986';
const TEMP_DIR = path.join(__dirname, 'temp');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const WARNINGS_FILE = path.join(__dirname, 'warnings.json');
const ANTIDELETE_FILE = path.join(__dirname, 'antidelete.json');
const SESSIONS_DIR = path.join(__dirname, 'sessions');

[path.join(__dirname, 'public'), TEMP_DIR, SESSIONS_DIR].forEach(d => { 
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); 
});

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

const activeBots = new Map();
const chatMemory = { messages: new Map(), userInfo: new Map() };
const BAD_WORDS = ['badword1', 'stupid', 'idiot', 'fuck', 'shit', 'fokof', 'tsek', 'nggA', 'fusek', 'asshole', 'dumass', 'kill', 'you'];

// ======================== HELPERS ========================
const api = axios.create({ timeout: 30000 });
const downloadBuffer = async (url) => (await api.get(url, { responseType: 'arraybuffer' })).data;
const getMediaBuffer = async (msg, type) => { const stream = await downloadContentFromMessage(msg, type); let buffer = Buffer.alloc(0); for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]); return buffer; };
const tryRequest = async (fn, attempts = 3) => { for (let i = 1; i <= attempts; i++) { try { return await fn(); } catch (err) { if (i < attempts) await delay(1000 * i); else throw err; } } };

async function getFolderSize(dirPath) { let total = 0; try { const files = fs.readdirSync(dirPath); for (const file of files) { const stats = fs.statSync(path.join(dirPath, file)); if (stats.isDirectory()) total += await getFolderSize(path.join(dirPath, file)); else total += stats.size; } } catch (e) {} return total; }

async function translate(text, targetLang) { try { const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`; const res = await api.get(url); return res.data[0][0][0]; } catch { return text; } }

async function toAudio(buffer, ext) { const inputFile = path.join(TEMP_DIR, `convert_in.${ext}`); const outputFile = path.join(TEMP_DIR, `convert_out.mp3`); fs.writeFileSync(inputFile, buffer); try { await execAsync(`ffmpeg -i "${inputFile}" -codec:a libmp3lame -qscale:a 2 "${outputFile}"`, { timeout: 30000 }); const outBuf = fs.readFileSync(outputFile); fs.unlinkSync(inputFile); fs.unlinkSync(outputFile); return outBuf; } catch (err) { fs.unlinkSync(inputFile); return buffer; } }

// ======================== ALL AI APIs COMBINED ========================
const ALL_AI_APIS = [
    { name: 'ZellAPI', url: (q) => `https://zellapi.autos/ai/chatbot?text=${encodeURIComponent(q)}`, extract: (d) => d?.result },
    { name: 'Vapis Gemini', url: (q) => `https://vapis.my.id/api/gemini?q=${encodeURIComponent(q)}`, extract: (d) => d?.message },
    { name: 'Siputzx Gemini', url: (q) => `https://api.siputzx.my.id/api/ai/gemini-pro?content=${encodeURIComponent(q)}`, extract: (d) => d?.data },
    { name: 'Ryzen Gemini', url: (q) => `https://api.ryzendesu.vip/api/ai/gemini?text=${encodeURIComponent(q)}`, extract: (d) => d?.answer },
    { name: 'Gifted Gemini', url: (q) => `https://api.giftedtech.my.id/api/ai/geminiai?apikey=gifted&q=${encodeURIComponent(q)}`, extract: (d) => d?.answer },
    { name: 'Gifted Gemini Pro', url: (q) => `https://api.giftedtech.my.id/api/ai/geminiaipro?apikey=gifted&q=${encodeURIComponent(q)}`, extract: (d) => d?.answer }
];

async function getAIResponse(userMessage, senderId, contextMessages = []) {
    const prompt = `You're Scottie Kiidrsa, a real person on WhatsApp. Reply in 1-2 lines max. Use Hinglish naturally. Be savage if abused, sweet if treated well. NEVER say you're AI. NEVER repeat instructions. Context: ${contextMessages.slice(-5).join(' | ')}. Message: ${userMessage}`;
    
    const promises = ALL_AI_APIS.map(async (ai) => {
        try {
            const res = await axios.get(ai.url(prompt), { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const answer = ai.extract(res.data);
            if (answer && typeof answer === 'string' && answer.length > 2) {
                return answer.trim().replace(/^(AI|Bot|Assistant|Answer|Response|Reply):?\s*/i, '').replace(/Remember:.*$|IMPORTANT:.*$|CORE RULES:.*$|EMOJI USAGE:.*$|RESPONSE STYLE:.*$|EMOTIONAL RESPONSES:.*$|ABOUT YOU:.*$|SLANG EXAMPLES:.*$/g, '').trim();
            }
        } catch {}
        return null;
    });
    
    const results = await Promise.allSettled(promises);
    for (const r of results) {
        if (r.status === 'fulfilled' && r.value) return r.value;
    }
    
    const fallbacks = ["Haan bhai! 😊", "Kya scene hai? 😎", "Hmm soch raha hu... 🤔", "Achha samjha! 😄", "Kya baat hai! 🔥", "Bhai tu legend hai! 👑"];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

function extractUserInfo(message) { const info = {}; if (message.toLowerCase().includes('my name is')) info.name = message.split('my name is')[1].trim().split(' ')[0]; if (message.toLowerCase().includes('i am') && message.toLowerCase().includes('years old')) info.age = message.match(/\d+/)?.[0]; if (message.toLowerCase().includes('i live in') || message.toLowerCase().includes('i am from')) info.location = message.split(/(?:i live in|i am from)/i)[1].trim().split(/[.,!?]/)[0]; return info; }

// ======================== DOWNLOAD HELPERS ========================
const AXIOS_DEFAULTS = { timeout: 60000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' } };

async function downloadSong(urlOrQuery) {
    const isUrl = /youtube\.com|youtu\.be/i.test(urlOrQuery); let video;
    if (isUrl) video = { url: urlOrQuery, title: 'YouTube Video' };
    else { const search = await yts(urlOrQuery); if (!search?.videos?.length) throw new Error('No results'); video = search.videos[0]; }
    let audioBuffer = null; let title = video.title;
    const apis = [
        { url: `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(video.url)}&format=mp3`, extract: (d) => d?.data?.downloadURL },
        { url: `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(video.url)}`, extract: (d) => d?.data?.data?.download_url },
        { url: `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(video.url)}`, extract: (d) => d?.data?.dl }
    ];
    for (const a of apis) { try { const res = await tryRequest(() => axios.get(a.url, AXIOS_DEFAULTS)); const url = a.extract(res); if (url) { audioBuffer = await downloadBuffer(url); title = res.data?.title || video.title; break; } } catch {} }
    if (!audioBuffer) { try { const out = path.join(TEMP_DIR, `audio_${Date.now()}.mp3`); await execAsync(`yt-dlp -x --audio-format mp3 -o "${out}" "${video.url}"`, { timeout: 120000 }); if (fs.existsSync(out)) { audioBuffer = fs.readFileSync(out); fs.unlinkSync(out); } } catch {} }
    if (!audioBuffer || audioBuffer.length === 0) throw new Error('All download sources failed.');
    const firstBytes = audioBuffer.slice(0, 12); let mime = 'audio/mpeg', ext = 'mp3'; const ascii4 = firstBytes.toString('ascii', 4, 8);
    if (ascii4 === 'ftyp') { mime = 'audio/mp4'; ext = 'm4a'; } else if (firstBytes.toString('ascii', 0, 3) === 'ID3' || (firstBytes[0] === 0xFF && (firstBytes[1] & 0xE0) === 0xE0)) { mime = 'audio/mpeg'; ext = 'mp3'; }
    if (ext !== 'mp3') { audioBuffer = await toAudio(audioBuffer, ext); mime = 'audio/mpeg'; ext = 'mp3'; }
    return { buffer: audioBuffer, title, mime, ext };
}

async function ytDlpVideo(url) { const out = path.join(TEMP_DIR, `video_${Date.now()}.mp4`); await execAsync(`yt-dlp -f "best[ext=mp4]" -o "${out}" "${url}"`, { timeout: 300000 }); if (fs.existsSync(out)) { const buffer = fs.readFileSync(out); fs.unlinkSync(out); return { download: buffer, title: 'Video' }; } throw new Error('Failed'); }

async function downloadTikTok(url) { const res = await tryRequest(() => axios.get(`https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`, { timeout: 15000, headers: { accept: '*/*' } })); if (res?.data?.data) { const d = res.data.data; const u = d.urls?.[0] || d.video_url || d.url || d.download_url; if (u) return { videoUrl: u, title: d.metadata?.title || 'TikTok' }; } throw new Error('Failed'); }

async function spotifyCommand(input, jid, quoted, sendMsg) { if (!input) return sendMsg(jid, { text: 'Usage: !spotify <song>' }, { quoted }); try { const { data } = await axios.get(`https://okatsu-rolezapiiz.vercel.app/search/spotify?q=${encodeURIComponent(input)}`, { timeout: 20000 }); if (data?.status && data?.result?.audio) { const r = data.result; const cap = `🎵 ${r.title}\n👤 ${r.artist || ''}`; if (r.thumbnails) await sendMsg(jid, { image: { url: r.thumbnails }, caption: cap }, { quoted }); await sendMsg(jid, { audio: { url: r.audio }, mimetype: 'audio/mpeg', fileName: `${r.title || 'track'}.mp3` }, { quoted }); } } catch { await sendMsg(jid, { text: '❌ Spotify failed.' }, { quoted }); } }

// ======================== STYLED MESSAGE ========================
function createSendStyledMessage(sock, botName) { return async (jid, content, options = {}) => { content.contextInfo = { forwardingScore: 999, isForwarded: true, forwardedNewsletterMessageInfo: { newsletterJid: '120363@newsletter', newsletterName: `${botName} v3.0.7`, serverMessageId: 1 }, externalAdReply: content.contextInfo?.externalAdReply || undefined, ...(content.contextInfo || {}) }; return sock.sendMessage(jid, content, options); }; }

// ======================== BOT SETUP ========================
function setupBot(sock, botNumber, isOwnerBot = false) {
    const ownerNumber = `${botNumber}@s.whatsapp.net`;
    const botName = '𝐓𝐀𝐑𝐀𝐆𝐎𝐍 𝐒𝐐𝐔𝐀𝐃 𝐓𝐑𝐒🇻🇦';
    const sendStyledMessage = createSendStyledMessage(sock, botName);
    const startTime = Date.now();
    
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0]; if (!msg?.message) return;
        const jid = msg.key.remoteJid; const isGroup = jid?.endsWith('@g.us'); const sender = isGroup ? msg.key.participant : jid;
        const senderClean = sender?.split('@')[0]; const ownerClean = ownerNumber?.split('@')[0];
        const isOwner = (sender === ownerNumber) || (senderClean === ownerClean);
        const isFromMe = msg.key.fromMe;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text || ''; const isCommand = text.startsWith('!');
        
        if (settings.antidelete && !isFromMe) { const key = msg.key.id; antidelete[key] = { message: msg.message, timestamp: Date.now(), jid }; saveAntidelete(); setTimeout(() => { delete antidelete[key]; saveAntidelete(); }, 3600000); }
        if (settings.autoread && !isFromMe) await sock.readMessages([msg.key]).catch(() => {});
        if (settings.autotyping && !isFromMe) { sock.sendPresenceUpdate('composing', jid).catch(() => {}); setTimeout(() => sock.sendPresenceUpdate('paused', jid).catch(() => {}), 2000); }
        if (settings.autoreact && !isCommand && !isFromMe) { const emojis = ['❤️','👍','😂','😮','😢','👏','🤧','🇻🇦','🤨','😕','🖕','🥺','🥱','🚮','🕳','📍','🔜','🚀','🆘️']; const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)]; await sock.sendMessage(jid, { react: { text: randomEmoji, key: msg.key } }).catch(() => {}); }
        if (jid === 'status@broadcast' && settings.autostatus && msg.key.participant && !isFromMe) { await sock.sendMessage(msg.key.participant, { react: { text: '❤️', key: msg.key } }).catch(() => {}); return; }
        if (msg.message?.call && settings.anticall && !isOwner) { await sendStyledMessage(jid, { text: '📞 Bot rejects calls. Please text only.' }); return; }
        if (!isGroup && !isOwner && !isFromMe && settings.pmblocker) { await sendStyledMessage(jid, { text: settings.pmblockerMsg }); return; }
        if (settings.mention && isGroup && !isFromMe && !isCommand) { await sendStyledMessage(jid, { text: `@${sender.split('@')[0]} ${settings.mentionMsg || 'Mentioned!'}`, mentions: [sender] }); }
        if (isGroup && !isFromMe) { 
            if (settings.antilink?.[jid] && /https?:\/\//i.test(text)) { await sock.sendMessage(jid, { delete: msg.key }); await sendStyledMessage(jid, { text: '🔗 Links are not allowed here.' }); return; }
            if (settings.antibadword?.[jid] && BAD_WORDS.some(word => text.toLowerCase().includes(word))) { await sock.sendMessage(jid, { delete: msg.key }); await sendStyledMessage(jid, { text: '🚫 Bad words are prohibited.' }); return; }
            if (settings.antitag?.[jid] && msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.length) { await sock.sendMessage(jid, { delete: msg.key }); await sendStyledMessage(jid, { text: '🚫 Tagging is not allowed here.' }); return; }
        }

        // AI Chatbot
        const chatbotOn = settings.chatbotGlobal || (isGroup && settings.chatbotGroups?.[jid]);
        if (!isCommand && !isFromMe && chatbotOn) {
            let shouldReply = false; const botJids = [sock.user.id, `${botNumber}@s.whatsapp.net`, `${botNumber}@lid`];
            if (msg.message?.extendedTextMessage) { const mentionedJid = msg.message.extendedTextMessage.contextInfo?.mentionedJid || []; const quotedParticipant = msg.message.extendedTextMessage.contextInfo?.participant; if (mentionedJid.some(j => botJids.includes(j))) shouldReply = true; if (quotedParticipant && botJids.includes(quotedParticipant)) shouldReply = true; }
            else if (msg.message?.conversation) { if (text.includes(`@${botNumber}`)) shouldReply = true; }
            else { shouldReply = !isGroup; }
            if (shouldReply) { await sock.sendPresenceUpdate('composing', jid).catch(() => {}); const userId = sender; if (!chatMemory.messages.has(userId)) chatMemory.messages.set(userId, []); const msgs = chatMemory.messages.get(userId); msgs.push(text); if (msgs.length > 20) msgs.shift(); const info = extractUserInfo(text); if (Object.keys(info).length > 0) chatMemory.userInfo.set(userId, { ...(chatMemory.userInfo.get(userId) || {}), ...info }); const reply = await getAIResponse(text, userId, msgs); await sendStyledMessage(jid, { text: reply }, { quoted: msg }); return; }
        }

        if (!isCommand) return;
        if (settings.mode === 'private' && !isOwner) return;

        const args = text.slice(1).trim().split(/ +/); const command = args[0]?.toLowerCase(); const input = args.slice(1).join(' ');
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage; const quotedKey = msg.message?.extendedTextMessage?.contextInfo; const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

        const getGroupMeta = async () => { if (!isGroup) throw new Error('Not a group'); return await sock.groupMetadata(jid); };
        const isAdmin = async () => { if (!isGroup) return false; if (isOwner) return true; const meta = await getGroupMeta(); const user = meta.participants.find(p => p.id === sender); return user?.admin === 'admin' || user?.admin === 'superadmin'; };

        try {
            // Owner commands
            if (isOwner) {
                if (command === 'mode') { settings.mode = input === 'public' ? 'public' : 'private'; saveSettings(); return sendStyledMessage(jid, { text: `🌐 Mode set to *${settings.mode}*` }); }
                if (command === 'chatbot') { if (input === 'on') { settings.chatbotGlobal = true; saveSettings(); return sendStyledMessage(jid, { text: `🤖 AI Chatbot *ENABLED* globally.` }); } if (input === 'off') { settings.chatbotGlobal = false; saveSettings(); return sendStyledMessage(jid, { text: `🤖 AI Chatbot *DISABLED* globally.` }); } return sendStyledMessage(jid, { text: `Usage: !chatbot on/off\nCurrent: ${settings.chatbotGlobal ? 'ON' : 'OFF'}` }); }
                if (command === 'clearsession') { fs.rmSync('auth_info_baileys', { recursive: true, force: true }); await sendStyledMessage(jid, { text: '🗑️ Session cleared. Restart bot.' }); return process.exit(0); }
                if (command === 'antidelete') { settings.antidelete = input === 'on' ? true : input === 'off' ? false : !settings.antidelete; saveSettings(); return sendStyledMessage(jid, { text: `🗑️ Anti-delete *${settings.antidelete ? 'ON' : 'OFF'}*` }); }
                if (command === 'cleartmp') { const files = fs.readdirSync(TEMP_DIR); for (const f of files) fs.unlinkSync(path.join(TEMP_DIR, f)); return sendStyledMessage(jid, { text: '🧹 Temp folder cleared.' }); }
                if (command === 'settings') { return sendStyledMessage(jid, { text: `📋 Current settings:\n${JSON.stringify(settings, null, 2)}` }); }
                if (command === 'setpp') { if (!quoted?.imageMessage) return sendStyledMessage(jid, { text: 'Reply to an image.' }); const buffer = await getMediaBuffer(quoted.imageMessage, 'image'); await sock.updateProfilePicture(sock.user.id, buffer); return sendStyledMessage(jid, { text: '✅ Bot profile picture updated.' }); }
                if (command === 'autoreact') { settings.autoreact = input === 'on' ? true : input === 'off' ? false : !settings.autoreact; saveSettings(); return sendStyledMessage(jid, { text: `✨ Auto-react *${settings.autoreact ? 'ON' : 'OFF'}*` }); }
                if (command === 'autostatus') { settings.autostatus = input === 'on' ? true : input === 'off' ? false : !settings.autostatus; saveSettings(); return sendStyledMessage(jid, { text: `📱 Auto-status like *${settings.autostatus ? 'ON' : 'OFF'}*` }); }
                if (command === 'autotyping') { settings.autotyping = input === 'on' ? true : input === 'off' ? false : !settings.autotyping; saveSettings(); return sendStyledMessage(jid, { text: `✍️ Auto-typing *${settings.autotyping ? 'ON' : 'OFF'}*` }); }
                if (command === 'autoread') { settings.autoread = input === 'on' ? true : input === 'off' ? false : !settings.autoread; saveSettings(); return sendStyledMessage(jid, { text: `👀 Auto-read *${settings.autoread ? 'ON' : 'OFF'}*` }); }
                if (command === 'anticall') { settings.anticall = input === 'on' ? true : input === 'off' ? false : !settings.anticall; saveSettings(); return sendStyledMessage(jid, { text: `📵 Anti-call *${settings.anticall ? 'ON' : 'OFF'}*` }); }
                if (command === 'pmblocker') { if (input.startsWith('setmsg')) { settings.pmblockerMsg = input.replace('setmsg', '').trim() || '🔒 Private messages are blocked.'; saveSettings(); return sendStyledMessage(jid, { text: `✅ PM blocker message updated to:\n${settings.pmblockerMsg}` }); } if (input === 'on') { settings.pmblocker = true; saveSettings(); return sendStyledMessage(jid, { text: '🔒 PM blocker *ON*' }); } if (input === 'off') { settings.pmblocker = false; saveSettings(); return sendStyledMessage(jid, { text: '🔓 PM blocker *OFF*' }); } if (input === 'status') return sendStyledMessage(jid, { text: `PM Blocker: *${settings.pmblocker ? 'ON' : 'OFF'}*\nMessage: ${settings.pmblockerMsg}` }); return sendStyledMessage(jid, { text: 'Usage: !pmblocker on/off/status or !pmblocker setmsg <text>' }); }
                if (command === 'setmention') { if (!quoted) return sendStyledMessage(jid, { text: 'Reply to a message to set mention text.' }); settings.mentionMsg = quoted.conversation || quoted.extendedTextMessage?.text || 'Mentioned!'; saveSettings(); return sendStyledMessage(jid, { text: `✅ Mention message set to: ${settings.mentionMsg}` }); }
                if (command === 'mention') { settings.mention = input === 'on' ? true : input === 'off' ? false : !settings.mention; saveSettings(); return sendStyledMessage(jid, { text: `🔔 Auto-mention *${settings.mention ? 'ON' : 'OFF'}*` }); }
                
                // !pair command
                if (command === 'pair') {
                    if (!input || input.length < 10) return sendStyledMessage(jid, { text: 'Usage: !pair <phone number with country code>\nExample: !pair 27712345678' });
                    const phone = input.replace(/\D/g, '');
                    try {
                        const sessionDir = path.join(SESSIONS_DIR, `session_${phone}_${Date.now()}`);
                        const { state: st, saveCreds: sc } = await useMultiFileAuthState(sessionDir);
                        const { version: v } = await fetchLatestBaileysVersion();
                        const newSock = makeWASocket({ version: v, auth: { creds: st.creds, keys: makeCacheableSignalKeyStore(st.keys, pino({ level: 'silent' })) }, printQRInTerminal: false, logger: pino({ level: 'silent' }), browser: Browsers.macOS('Chrome'), markOnlineOnConnect: false });
                        const code = await newSock.requestPairingCode(phone);
                        await sendStyledMessage(jid, { text: `🔑 *Pairing Code for ${phone}:*\n\n\`\`\`${code}\`\`\`\n\n📱 *How to link:*\n1. Open WhatsApp\n2. Linked Devices\n3. Link a Device\n4. Enter: ${code}\n\n⏰ Code expires in 2 minutes.` });
                        let done = false;
                        newSock.ev.on('connection.update', (u) => { if (u.connection === 'open' && !done) { done = true; const n = newSock.user.id.split(':')[0]; activeBots.set(sessionDir, { sock: newSock, phone, number: n }); setupBot(newSock, n); sendStyledMessage(jid, { text: `✅ ${phone} connected as +${n}!` }).catch(()=>{}); } if (u.connection === 'close') activeBots.delete(sessionDir); });
                        newSock.ev.on('creds.update', sc);
                        setTimeout(() => { if (!done) sendStyledMessage(jid, { text: `⏰ Pairing code for ${phone} expired.` }).catch(()=>{}); }, 120000);
                    } catch(e) { await sendStyledMessage(jid, { text: `❌ Failed: ${e.message}` }); }
                }
            }

            // General commands
            if (command === 'menu' || command === 'help') {
                const pingStart = Date.now(); await sendStyledMessage(jid, { text: '...' });
                const ping = Date.now() - pingStart; const uptime = Date.now() - startTime;
                const hours = Math.floor(uptime / 3600000); const minutes = Math.floor((uptime % 3600000) / 60000); const seconds = Math.floor((uptime % 60000) / 1000);
                const ram = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
                const usageBytes = await getFolderSize(TEMP_DIR); const usageMB = (usageBytes / (1024 * 1024)).toFixed(2);

                const menu = `╭━❮ *${botName}* ❯━╮
┃ ✦ 👤 𝐔𝐒𝐄𝐑 : @${sender.split('@')[0]}
┃ ✦ ⚡ 𝐏𝐑𝐄𝐅𝐈𝐗 : [ ! ]
┃ ✦ 🌐 𝐌𝐎𝐃𝐄 : ${settings.mode === 'public' ? 'Public' : 'Private'}
┃ ✦ 🚀 𝐒𝐏𝐄𝐄𝐃 : ${ping}ms
┃ ✦ ⏰ 𝐔𝐏𝐓𝐈𝐌𝐄 : ${hours}h ${minutes}m ${seconds}s
┃ ✦ 💾 𝐑𝐀𝐌 : ${ram} MB
┃ ✦ 📊 𝐔𝐒𝐀𝐆𝐄 : ${usageMB} MB
╰━━━━━━━━━━━━━━━━━━━╯

╔═══════════════════╗
🌐 *General Commands*
║ ➤ !menu / !help
║ ➤ !ping
║ ➤ !alive
║ ➤ !owner
║ ➤ !joke
║ ➤ !quote
║ ➤ !fact
║ ➤ !weather <city>
║ ➤ !attp <text>
║ ➤ !tts <text>
║ ➤ !lyrics <song>
║ ➤ !8ball <question>
║ ➤ !groupinfo
║ ➤ !staff / !admins
║ ➤ !vv
║ ➤ !trt <text> <lang>
║ ➤ !jid
║ ➤ !check <host>
╚═══════════════════╝

╔═══════════════════╗
👮‍♂️ *Admin Commands*
║ ➤ !ban / !kick @user
║ ➤ !promote @user
║ ➤ !demote @user
║ ➤ !mute <minutes>
║ ➤ !unmute
║ ➤ !delete / !del
║ ➤ !warn @user
║ ➤ !warnings @user
║ ➤ !antilink <on/off>
║ ➤ !antibadword <on/off>
║ ➤ !tagall <msg>
║ ➤ !tagnotadmin <msg>
║ ➤ !hidetag <msg>
║ ➤ !chatbot <on/off> (per group)
║ ➤ !resetlink
║ ➤ !antitag <on/off>
║ ➤ !welcome <on/off>
║ ➤ !goodbye <on/off>
║ ➤ !setgdesc <desc>
║ ➤ !setgname <name>
║ ➤ !setgpp (reply img)
╚═══════════════════╝

╔═══════════════════╗
🔒 *Owner Commands*
║ ➤ !mode <public/private>
║ ➤ !chatbot <on/off> (global)
║ ➤ !autoreact <on/off>
║ ➤ !autostatus <on/off>
║ ➤ !autotyping <on/off>
║ ➤ !autoread <on/off>
║ ➤ !anticall <on/off>
║ ➤ !antidelete <on/off>
║ ➤ !pmblocker <on/off>
║ ➤ !mention <on/off>
║ ➤ !pair <phone> 🔑
║ ➤ !setpp (reply img)
║ ➤ !cleartmp
║ ➤ !settings
╚═══════════════════╝

╔═══════════════════╗
🤖 *AI Commands*
║ ➤ !gpt <question>
║ ➤ !gemini <question>
║ ➤ !imagine <prompt>
╚═══════════════════╝

╔═══════════════════╗
📥 *Downloader*
║ ➤ !play / !ytmp3 <song/url>
║ ➤ !ytmp4 <url>
║ ➤ !tiktok <url>
║ ➤ !instagram <url>
║ ➤ !facebook <url>
║ ➤ !spotify <query>
╚═══════════════════╝`;

                await sendStyledMessage(jid, { text: menu, mentions: [sender], contextInfo: { externalAdReply: { title: botName, body: `Status: Online | Mode: ${settings.mode === 'public' ? 'Public' : 'Private'}`, thumbnailUrl: 'https://imgur.com/a/jULJGsZ', mediaType: 1, renderLargerThumbnail: true } } });
            }

            else if (command === 'ping') { const start = Date.now(); await sendStyledMessage(jid, { text: `🏓 Pong! *${Date.now() - start}ms*` }); }
            else if (command === 'alive') { await sendStyledMessage(jid, { text: `✅ *${botName}* is online and ready!` }); }
            else if (command === 'owner') { await sendStyledMessage(jid, { text: `👑 Owner: wa.me/${botNumber}` }); }
            else if (command === 'jid') { await sendStyledMessage(jid, { text: `📇 JID: ${jid}\nSender: ${sender}` }); }
            else if (command === 'vv') { if (quoted?.viewOnceMessageV2) { const viewOnce = quoted.viewOnceMessageV2.message; let media, type; if (viewOnce.imageMessage) { media = viewOnce.imageMessage; type = 'image'; } else if (viewOnce.videoMessage) { media = viewOnce.videoMessage; type = 'video'; } if (media) { const buffer = await getMediaBuffer(media, type); if (type === 'image') await sendStyledMessage(jid, { image: buffer }); else await sendStyledMessage(jid, { video: buffer }); } } else await sendStyledMessage(jid, { text: 'Reply to a view-once message.' }); }
            else if (command === 'trt') { const parts = input.split(' '); const lang = parts.pop(); const textToTranslate = parts.join(' '); if (!textToTranslate || !lang) return sendStyledMessage(jid, { text: 'Usage: !trt <text> <lang_code>\nExample: !trt Hello es' }); const translated = await translate(textToTranslate, lang); await sendStyledMessage(jid, { text: `🌐 ${translated}` }); }
            else if (command === 'tts') { if (!input) return sendStyledMessage(jid, { text: 'Usage: !tts <text>' }); const { data } = await api.get(`https://api.ryzendesu.vip/api/tools/tts?text=${encodeURIComponent(input)}`); if (data.audio) { const buffer = await downloadBuffer(data.audio); await sendStyledMessage(jid, { audio: buffer, mimetype: 'audio/mpeg', ptt: true }); } else throw new Error('TTS failed'); }
            else if (command === 'attp') { if (!input) return sendStyledMessage(jid, { text: 'Usage: !attp <text>' }); const { data } = await api.get(`https://api.ryzendesu.vip/api/maker/attp?text=${encodeURIComponent(input)}`); if (data.url) { const buffer = await downloadBuffer(data.url); await sendStyledMessage(jid, { sticker: buffer }); } else throw new Error('ATTP failed'); }
            else if (command === 'lyrics') { if (!input) return sendStyledMessage(jid, { text: 'Usage: !lyrics <song>' }); const { data } = await api.get(`https://api.ryzendesu.vip/api/search/lyrics?text=${encodeURIComponent(input)}`); await sendStyledMessage(jid, { text: data.lyrics || 'Lyrics not found.' }); }
            else if (command === 'quote') { const { data } = await api.get('https://api.quotable.io/random'); await sendStyledMessage(jid, { text: `💬 "${data.content}"\n— ${data.author}` }); }
            else if (command === 'fact') { const { data } = await api.get('https://uselessfacts.jsph.pl/random.json?language=en'); await sendStyledMessage(jid, { text: `💡 ${data.text}` }); }
            else if (command === 'joke') { const { data } = await api.get('https://v2.jokeapi.dev/joke/Any'); const joke = data.type === 'single' ? data.joke : `${data.setup}\n\n${data.delivery}`; await sendStyledMessage(jid, { text: `😂 ${joke}` }); }
            else if (command === '8ball') { if (!input) return sendStyledMessage(jid, { text: 'Usage: !8ball <question>' }); const answers = ['Yes!', 'No!', 'Maybe...', 'Ask again later', 'Definitely!', 'I cannot predict now', 'Without a doubt!', 'Very doubtful']; await sendStyledMessage(jid, { text: `🎱 ${answers[Math.floor(Math.random() * answers.length)]}` }); }
            else if (command === 'weather') { if (!input) return sendStyledMessage(jid, { text: 'Usage: !weather <city>' }); const apiKey = 'YOUR_OPENWEATHER_API_KEY'; const { data } = await api.get(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(input)}&appid=${apiKey}&units=metric`); await sendStyledMessage(jid, { text: `🌤️ *${data.name}*\nTemp: ${data.main.temp}°C\nFeels like: ${data.main.feels_like}°C\nCondition: ${data.weather[0].description}\nHumidity: ${data.main.humidity}%` }); }
            else if (command === 'groupinfo' && isGroup) { const meta = await getGroupMeta(); const owner = meta.owner || 'Unknown'; const admins = meta.participants.filter(p => p.admin).map(p => `@${p.id.split('@')[0]}`).join(', '); await sendStyledMessage(jid, { text: `📊 *Group Info*\nName: ${meta.subject}\nOwner: @${owner.split('@')[0]}\nMembers: ${meta.participants.length}\nAdmins: ${admins}\nDesc: ${meta.desc || 'None'}`, mentions: [owner] }); }
            else if ((command === 'staff' || command === 'admins') && isGroup) { const meta = await getGroupMeta(); const admins = meta.participants.filter(p => p.admin); if (!admins.length) return sendStyledMessage(jid, { text: 'No admins found.' }); await sendStyledMessage(jid, { text: `👮 *Admins:*\n${admins.map(p => `@${p.id.split('@')[0]}`).join('\n')}`, mentions: admins.map(p => p.id) }); }

            // Admin commands
            else if (['ban', 'kick'].includes(command) && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); const target = mentionedJid || quotedKey?.participant; if (!target) return sendStyledMessage(jid, { text: 'Mention or reply to a user.' }); if (target.split('@')[0] === ownerClean) return sendStyledMessage(jid, { text: '❌ Cannot kick the owner.' }); await sock.groupParticipantsUpdate(jid, [target], 'remove'); await sendStyledMessage(jid, { text: `✅ Kicked @${target.split('@')[0]}`, mentions: [target] }); }
            else if (command === 'promote' && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); const target = mentionedJid; if (!target) return sendStyledMessage(jid, { text: 'Mention a user.' }); await sock.groupParticipantsUpdate(jid, [target], 'promote'); await sendStyledMessage(jid, { text: `👑 Promoted @${target.split('@')[0]}`, mentions: [target] }); }
            else if (command === 'demote' && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); const target = mentionedJid; if (!target) return sendStyledMessage(jid, { text: 'Mention a user.' }); await sock.groupParticipantsUpdate(jid, [target], 'demote'); await sendStyledMessage(jid, { text: `📉 Demoted @${target.split('@')[0]}`, mentions: [target] }); }
            else if (command === 'mute' && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); const minutes = parseInt(input) || 60; await sock.groupSettingUpdate(jid, 'announcement'); setTimeout(async () => { await sock.groupSettingUpdate(jid, 'not_announcement').catch(() => {}); }, minutes * 60000); await sendStyledMessage(jid, { text: `🔇 Group muted for *${minutes} minutes*.` }); }
            else if (command === 'unmute' && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); await sock.groupSettingUpdate(jid, 'not_announcement'); await sendStyledMessage(jid, { text: '🔊 Group unmuted.' }); }
            else if (command === 'delete' || command === 'del') { if (!await isAdmin() && !isOwner) return sendStyledMessage(jid, { text: '❌ Admins only.' }); if (quoted && quotedKey) await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: quotedKey.stanzaId, participant: quotedKey.participant } }); else await sock.sendMessage(jid, { delete: msg.key }); }
            else if (command === 'warn' && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); const target = mentionedJid; if (!target) return sendStyledMessage(jid, { text: 'Mention a user.' }); if (!warnings[target]) warnings[target] = 0; warnings[target]++; if (warnings[target] >= 3) { await sock.groupParticipantsUpdate(jid, [target], 'remove'); delete warnings[target]; await sendStyledMessage(jid, { text: `⚠️ @${target.split('@')[0]} reached 3 warnings and was kicked.`, mentions: [target] }); } else await sendStyledMessage(jid, { text: `⚠️ Warned @${target.split('@')[0]} (${warnings[target]}/3)`, mentions: [target] }); saveWarnings(); }
            else if (command === 'warnings' && isGroup) { const target = mentionedJid; if (!target) return sendStyledMessage(jid, { text: 'Mention a user.' }); const count = warnings[target] || 0; await sendStyledMessage(jid, { text: `⚠️ @${target.split('@')[0]} has *${count}* warning(s).`, mentions: [target] }); }
            else if (command === 'tagall' && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); const meta = await getGroupMeta(); const mentions = meta.participants.map(p => p.id); await sendStyledMessage(jid, { text: input || '📢 Attention everyone!', mentions }); }
            else if (command === 'tagnotadmin' && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); const meta = await getGroupMeta(); const nonAdmins = meta.participants.filter(p => !p.admin).map(p => p.id); if (!nonAdmins.length) return sendStyledMessage(jid, { text: 'No non-admin members.' }); await sendStyledMessage(jid, { text: input || '📢 Attention members:', mentions: nonAdmins }); }
            else if (command === 'hidetag' && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); const meta = await getGroupMeta(); const mentions = meta.participants.map(p => p.id); await sendStyledMessage(jid, { text: input || '​', mentions }); }
            else if (command === 'antilink' && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); if (!settings.antilink) settings.antilink = {}; settings.antilink[jid] = input === 'on' ? true : input === 'off' ? false : !settings.antilink[jid]; saveSettings(); await sendStyledMessage(jid, { text: `🔗 Anti-link *${settings.antilink[jid] ? 'ON' : 'OFF'}*` }); }
            else if (command === 'antibadword' && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); if (!settings.antibadword) settings.antibadword = {}; settings.antibadword[jid] = input === 'on' ? true : input === 'off' ? false : !settings.antibadword[jid]; saveSettings(); await sendStyledMessage(jid, { text: `🚫 Anti-badword *${settings.antibadword[jid] ? 'ON' : 'OFF'}*` }); }
            else if (command === 'chatbot' && isGroup) { if (!await isAdmin() && !isOwner) return sendStyledMessage(jid, { text: '❌ Admins only.' }); if (!settings.chatbotGroups) settings.chatbotGroups = {}; settings.chatbotGroups[jid] = input === 'on' ? true : input === 'off' ? false : !settings.chatbotGroups[jid]; saveSettings(); await sendStyledMessage(jid, { text: `🤖 AI Chatbot in this group *${settings.chatbotGroups[jid] ? 'ON' : 'OFF'}*` }); }
            else if (command === 'resetlink' && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); const code = await sock.groupRevokeInvite(jid); await sendStyledMessage(jid, { text: `🔗 New invite link:\nhttps://chat.whatsapp.com/${code}` }); }
            else if (command === 'antitag' && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); if (!settings.antitag) settings.antitag = {}; settings.antitag[jid] = input === 'on' ? true : input === 'off' ? false : !settings.antitag[jid]; saveSettings(); await sendStyledMessage(jid, { text: `🏷️ Anti-tag *${settings.antitag[jid] ? 'ON' : 'OFF'}*` }); }
            else if (command === 'welcome' && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); if (!settings.welcome) settings.welcome = {}; settings.welcome[jid] = input === 'on' ? true : input === 'off' ? false : !settings.welcome[jid]; saveSettings(); await sendStyledMessage(jid, { text: `👋 Welcome message *${settings.welcome[jid] ? 'ON' : 'OFF'}*` }); }
            else if (command === 'goodbye' && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); if (!settings.goodbye) settings.goodbye = {}; settings.goodbye[jid] = input === 'on' ? true : input === 'off' ? false : !settings.goodbye[jid]; saveSettings(); await sendStyledMessage(jid, { text: `👋 Goodbye message *${settings.goodbye[jid] ? 'ON' : 'OFF'}*` }); }
            else if (command === 'setgdesc' && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); if (!input) return sendStyledMessage(jid, { text: 'Provide a description.' }); await sock.groupUpdateDescription(jid, input); await sendStyledMessage(jid, { text: '✅ Group description updated.' }); }
            else if (command === 'setgname' && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); if (!input) return sendStyledMessage(jid, { text: 'Provide a name.' }); await sock.groupUpdateSubject(jid, input); await sendStyledMessage(jid, { text: '✅ Group name updated.' }); }
            else if (command === 'setgpp' && isGroup) { if (!await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); if (!quoted?.imageMessage) return sendStyledMessage(jid, { text: 'Reply to an image.' }); const buffer = await getMediaBuffer(quoted.imageMessage, 'image'); await sock.updateProfilePicture(jid, buffer); await sendStyledMessage(jid, { text: '✅ Group icon updated.' }); }

            // AI commands
            else if (command === 'gpt' || command === 'gemini') { if (!input) return sendStyledMessage(jid, { text: `Usage: !${command} <question>` }); await sock.sendPresenceUpdate('composing', jid).catch(() => {}); const reply = await getAIResponse(input, sender); await sendStyledMessage(jid, { text: `🤖 ${reply}` }); }
            else if (command === 'imagine') { if (!input) return sendStyledMessage(jid, { text: 'Usage: !imagine <prompt>' }); await sendStyledMessage(jid, { text: '🎨 Generating image, please wait...' }); const { data } = await api.get(`https://api.siputzx.my.id/api/ai/stablediffusion?prompt=${encodeURIComponent(input)}`); const imgUrl = typeof data === 'string' ? data : data.url || data.image; if (imgUrl) { const buffer = await downloadBuffer(imgUrl); await sendStyledMessage(jid, { image: buffer, caption: `🎨 ${input}` }); } else throw new Error('Image generation failed'); }

            // Host check
            else if (command === 'check') { if (!input) return sendStyledMessage(jid, { text: 'Usage: !check <host>\nExample: !check example.com' }); const host = input.trim(); if (!/^[a-zA-Z0-9.-]+$/.test(host) || host.length > 253) return sendStyledMessage(jid, { text: '❌ Invalid host.' }); await sendStyledMessage(jid, { text: `🔍 Checking host: *${host}*\nRunning nmap and curl...` }); try { const { stdout } = await execFileAsync('nmap', ['-p', '80,443,8080', host], { timeout: 30000, maxBuffer: 1024 * 1024 }); await sendStyledMessage(jid, { text: `📡 *nmap*:\n\`\`\`${stdout.trim().substring(0, 2000)}\`\`\`` }); } catch (err) { await sendStyledMessage(jid, { text: `❌ nmap failed: ${err.message}` }); } try { const { stdout } = await execAsync(`curl -I -s "${host}"`, { timeout: 15000, maxBuffer: 1024 * 1024 }); await sendStyledMessage(jid, { text: `🌐 *curl*:\n\`\`\`${stdout.trim().substring(0, 2000)}\`\`\`` }); } catch (err) { await sendStyledMessage(jid, { text: `❌ curl failed: ${err.message}` }); } }

            // Download commands
            else if (command === 'play' || command === 'ytmp3') { if (!input) return sendStyledMessage(jid, { text: `Usage: !${command} <song name or YouTube link>` }); await sendStyledMessage(jid, { text: '⏳ Downloading audio...' }); try { const { buffer, title, mime, ext } = await downloadSong(input); await sendStyledMessage(jid, { audio: buffer, mimetype: mime, fileName: `${title.replace(/[\\/:*?"<>|]/g, '')}.${ext}`, ptt: false }, { quoted: msg }); } catch (err) { await sendStyledMessage(jid, { text: `❌ ${err.message}` }); } }
            else if (command === 'ytmp4') { if (!input) return sendStyledMessage(jid, { text: 'Usage: !ytmp4 <YouTube URL>' }); await sendStyledMessage(jid, { text: '⏳ Downloading video...' }); try { const isUrl = /youtube\.com|youtu\.be/i.test(input); if (!isUrl) throw new Error('Invalid YouTube URL'); let video; try { const res = await tryRequest(() => axios.get(`https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(input)}`, AXIOS_DEFAULTS)); if (res?.data?.data?.download_url) video = { url: res.data.data.download_url, title: res.data.data.title }; } catch {} if (!video) { const { download, title } = await ytDlpVideo(input); await sendStyledMessage(jid, { video: download, caption: title || '' }); return; } const buffer = await downloadBuffer(video.url); await sendStyledMessage(jid, { video: buffer, caption: video.title || '' }); } catch (err) { await sendStyledMessage(jid, { text: `❌ ${err.message}` }); } }
            else if (command === 'tiktok') { if (!input) return sendStyledMessage(jid, { text: 'Usage: !tiktok <url>' }); await sendStyledMessage(jid, { text: '⏳ Downloading TikTok...' }); try { const { videoUrl, title } = await downloadTikTok(input); const buffer = await downloadBuffer(videoUrl); await sendStyledMessage(jid, { video: buffer, caption: title || 'TikTok' }); } catch (err) { await sendStyledMessage(jid, { text: `❌ ${err.message}` }); } }
            else if (command === 'instagram') { if (!input) return sendStyledMessage(jid, { text: 'Usage: !instagram <url>' }); await sendStyledMessage(jid, { text: '⏳ Downloading Instagram...' }); const { data } = await api.get(`https://api.siputzx.my.id/api/d/instagram?url=${encodeURIComponent(input)}`); const mediaUrl = data?.data?.url; if (mediaUrl) { const buffer = await downloadBuffer(mediaUrl); await sendStyledMessage(jid, { video: buffer }); } else await sendStyledMessage(jid, { text: '❌ Failed to download.' }); }
            else if (command === 'facebook') { if (!input) return sendStyledMessage(jid, { text: 'Usage: !facebook <url>' }); await sendStyledMessage(jid, { text: '⏳ Downloading Facebook...' }); const { data } = await api.get(`https://api.siputzx.my.id/api/d/facebook?url=${encodeURIComponent(input)}`); const videoUrl = data?.data?.url; if (videoUrl) { const buffer = await downloadBuffer(videoUrl); await sendStyledMessage(jid, { video: buffer }); } else await sendStyledMessage(jid, { text: '❌ Failed to download.' }); }
            else if (command === 'spotify') { await spotifyCommand(input, jid, msg, sendStyledMessage); }
            else { await sendStyledMessage(jid, { text: `❌ Unknown command. Type *!menu* to see all commands.` }); }

        } catch (err) { console.error('Command error:', command, err.message); await sendStyledMessage(jid, { text: `⚠️ Error running *!${command}*: ${err.message}` }).catch(() => {}); }
    });

    // Welcome / Goodbye
    sock.ev.on('group-participants.update', async (update) => { const { id, participants, action } = update; try { if (action === 'add' && settings.welcome?.[id]) { for (const p of participants) { await sendStyledMessage(id, { text: `👋 Welcome @${p.split('@')[0]}! Glad to have you here.`, mentions: [p] }); } } else if ((action === 'remove' || action === 'leave') && settings.goodbye?.[id]) { for (const p of participants) { await sendStyledMessage(id, { text: `👋 Goodbye @${p.split('@')[0]}. We'll miss you!`, mentions: [p] }); } } } catch (e) { console.error('Welcome/goodbye error:', e.message); } });
}

// ======================== MAIN PAIRING PROCESS ========================
async function startOwnerPairing(io) {
    console.log('\n📱 ==========================================');
    console.log('📱 STARTING OWNER PAIRING PROCESS');
    console.log('📱 ==========================================\n');
    console.log(`📱 Phone: ${OWNER_PHONE}\n`);
    
    // Clean any existing owner sessions
    const existingSessions = fs.readdirSync(SESSIONS_DIR).filter(f => f.startsWith('owner_'));
    existingSessions.forEach(f => {
        const sessionPath = path.join(SESSIONS_DIR, f);
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log(`🗑️ Cleaned old session: ${f}`);
        }
    });
    
    // Clean old auth_info_baileys if exists
    if (fs.existsSync('auth_info_baileys')) {
        fs.rmSync('auth_info_baileys', { recursive: true, force: true });
        console.log('🗑️ Cleaned old auth_info_baileys');
    }
    
    const sessionDir = path.join(SESSIONS_DIR, `owner_${OWNER_PHONE}`);
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();
        
        console.log('🔌 Creating WhatsApp socket...');
        
        const sock = makeWASocket({
            version,
            auth: { 
                creds: state.creds, 
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) 
            },
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Chrome'),
            markOnlineOnConnect: false,
            syncFullHistory: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000
        });
        
        console.log('🔑 Requesting pairing code from WhatsApp...');
        
        // Request the pairing code - this triggers WhatsApp to send the "Link a Device" prompt
        const code = await sock.requestPairingCode(OWNER_PHONE);
        
        console.log('\n╔══════════════════════════════════════════╗');
        console.log('║                                          ║');
        console.log('║     🔑 YOUR PAIRING CODE                 ║');
        console.log('║                                          ║');
        console.log(`║          ${code}                         ║');
        console.log('║                                          ║');
        console.log('╚══════════════════════════════════════════╝\n');
        
        console.log('📱 WHATSAPP SHOULD NOW SHOW "Link a Device" ON YOUR PHONE');
        console.log('📱 IF NOT: Open WhatsApp > Settings > Linked Devices > Link a Device\n');
        console.log(`📋 ENTER THIS CODE: ${code}\n`);
        console.log(`🌐 Web panel: http://localhost:${PORT}\n`);
        console.log('⏰ Code expires in 2 minutes\n');
        console.log('⏳ Waiting for you to enter the code in WhatsApp...\n');
        
        // Emit code to web clients
        io.emit('code', { code, phone: OWNER_PHONE });
        
        // Set timeout
        const timeout = setTimeout(() => {
            console.log('\n⏰ Pairing code expired!');
            console.log('🔄 Restart the bot to get a new code.\n');
            io.emit('codeExpired', { msg: 'Code expired' });
            process.exit(1);
        }, 120000);
        
        // Listen for connection
        sock.ev.on('connection.update', (update) => {
            const { connection } = update;
            
            if (connection === 'open') {
                clearTimeout(timeout);
                const botNumber = sock.user.id.split(':')[0];
                activeBots.set(`owner_${OWNER_PHONE}`, { sock, phone: OWNER_PHONE, number: botNumber });
                
                console.log('\n╔══════════════════════════════════════════╗');
                console.log('║                                          ║');
                console.log('║     ✅ CONNECTED SUCCESSFULLY!           ║');
                console.log('║                                          ║');
                console.log(`║     Bot Number: +${botNumber}              ║');
                console.log('║                                          ║');
                console.log('╚══════════════════════════════════════════╝\n');
                console.log('🤖 Bot is now online and fully operational!\n');
                console.log('💬 Send !menu in WhatsApp to see all commands.\n');
                
                io.emit('connected', { num: botNumber });
                io.emit('count', { count: activeBots.size });
                
                setupBot(sock, botNumber, true);
            }
            
            if (connection === 'close') {
                activeBots.delete(`owner_${OWNER_PHONE}`);
                io.emit('count', { count: activeBots.size });
                console.log('❌ Connection closed.');
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
    } catch (err) {
        console.error('\n❌ Pairing failed:', err.message);
        console.log('\n🔄 Retrying in 5 seconds...\n');
        setTimeout(() => startOwnerPairing(io), 5000);
    }
}

// ======================== WEB SERVER ========================
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/code', (req, res) => res.json({ code: currentPairingCode || '--------', phone: OWNER_PHONE }));

// Track current code
let currentPairingCode = null;

// HTML for web panel
const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Taragon Bot - WhatsApp Pairing</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{
            font-family:'Inter',sans-serif;
            background:#0a0a0f;
            min-height:100vh;
            display:flex;
            justify-content:center;
            align-items:center;
            overflow:hidden;
        }
        .bg{
            position:fixed;top:-50%;left:-50%;
            width:200%;height:200%;
            background:radial-gradient(circle at 30% 40%,rgba(102,126,234,0.15),transparent 50%),
                       radial-gradient(circle at 70% 60%,rgba(118,75,162,0.15),transparent 50%);
            animation:rotate 30s linear infinite;
            z-index:0;
        }
        @keyframes rotate{to{transform:rotate(360deg)}}
        .flags{
            position:fixed;top:0;left:0;
            width:100%;height:100%;
            pointer-events:none;z-index:1;
        }
        .flag{
            position:absolute;font-size:24px;
            animation:float linear infinite;opacity:0.4;
        }
        @keyframes float{
            0%{transform:translateY(110vh) rotate(0deg)}
            to{transform:translateY(-10vh) rotate(720deg)}
        }
        .card{
            position:relative;z-index:10;
            background:rgba(255,255,255,0.03);
            backdrop-filter:blur(30px);
            border:1px solid rgba(255,255,255,0.08);
            border-radius:24px;
            padding:40px;
            max-width:500px;width:92%;
            box-shadow:0 25px 50px rgba(0,0,0,0.5);
        }
        .logo{
            font-family:'Space Grotesk',sans-serif;
            font-size:28px;font-weight:700;text-align:center;
            background:linear-gradient(135deg,#667eea,#764ba2,#f093fb);
            -webkit-background-clip:text;-webkit-text-fill-color:transparent;
            margin-bottom:8px;
        }
        .subtitle{
            text-align:center;color:rgba(255,255,255,0.6);
            font-size:14px;margin-bottom:24px;
        }
        .code-box{text-align:center;margin:24px 0;}
        .code-label{
            color:rgba(255,255,255,0.6);
            font-size:12px;text-transform:uppercase;
            letter-spacing:1px;margin-bottom:12px;
        }
        .code{
            font-family:'Space Grotesk',monospace;
            font-size:52px;font-weight:700;
            letter-spacing:18px;
            color:#667eea;
            padding:28px 20px;
            background:rgba(102,126,234,0.08);
            border-radius:16px;
            border:2px dashed rgba(102,126,234,0.3);
            text-shadow:0 0 40px rgba(102,126,234,0.5);
            user-select:all;-webkit-user-select:all;
        }
        .btn{
            width:100%;
            padding:16px;
            border-radius:16px;
            border:none;
            font-size:15px;font-weight:600;
            font-family:'Inter',sans-serif;
            cursor:pointer;
            transition:.3s;
            margin-top:8px;
        }
        .btn-copy{
            background:rgba(255,255,255,0.08);
            color:white;
            border:1px solid rgba(255,255,255,0.1);
        }
        .btn-copy:hover{background:rgba(255,255,255,0.15)}
        .btn-new{
            background:linear-gradient(135deg,#667eea,#764ba2);
            color:white;
            box-shadow:0 4px 20px rgba(102,126,234,0.3);
        }
        .btn-new:hover{transform:translateY(-2px)}
        .steps{
            background:rgba(255,255,255,0.03);
            border-radius:12px;
            padding:16px;
            margin-top:20px;
        }
        .step{
            display:flex;align-items:center;gap:10px;
            color:rgba(255,255,255,0.7);font-size:13px;
            padding:6px 0;
        }
        .step-num{
            width:22px;height:22px;
            border-radius:50%;
            background:#667eea;color:white;
            display:flex;align-items:center;justify-content:center;
            font-size:11px;font-weight:700;flex-shrink:0;
        }
        .status{
            text-align:center;
            color:rgba(255,255,255,0.7);
            font-size:14px;margin-top:16px;
        }
        .status.success{color:#51cf66}
        .status.error{color:#ff6b6b}
        .status.waiting{color:#ffd43b}
        .spinner{
            display:inline-block;
            width:20px;height:20px;
            border:2px solid rgba(255,255,255,0.2);
            border-top-color:white;
            border-radius:50%;
            animation:spin .7s linear infinite;
            vertical-align:middle;margin-right:8px;
        }
        @keyframes spin{to{transform:rotate(360deg)}}
        .counter{
            text-align:center;
            color:rgba(255,255,255,0.4);
            font-size:12px;margin-top:16px;
        }
        @media(max-width:480px){
            .card{padding:24px}
            .code{font-size:36px;letter-spacing:12px;padding:20px}
        }
    </style>
</head>
<body>
    <div class="bg"></div>
    <div class="flags" id="flags"></div>
    
    <div class="card">
        <div class="logo">🇻🇦 TARAGON SQUAD TRS</div>
        <div class="subtitle">WhatsApp Multi-Device Pairing Portal</div>
        
        <div class="code-box">
            <div class="code-label">Your 8-Digit Pairing Code</div>
            <div class="code" id="code">--------</div>
        </div>
        
        <button class="btn btn-copy" onclick="copyCode()">📋 Copy Code</button>
        <button class="btn btn-new" onclick="refreshCode()">🔄 Generate New Code</button>
        
        <div class="steps">
            <div class="step"><span class="step-num">1</span> Open WhatsApp on your phone</div>
            <div class="step"><span class="step-num">2</span> Tap ⋮ → <strong>Linked Devices</strong></div>
            <div class="step"><span class="step-num">3</span> Tap <strong>Link a Device</strong></div>
            <div class="step"><span class="step-num">4</span> Enter the code shown above</div>
        </div>
        
        <p class="status" id="status">Waiting for pairing code...</p>
        <div class="counter" id="counter">Active Bots: 0/50</div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const flagsEl=document.getElementById('flags');
        const emojis=['🇻🇦','🔮','⚡','🌟','💎','🔥','🛡️','👑'];
        for(let i=0;i<60;i++){
            const f=document.createElement('div');f.className='flag';
            f.textContent=emojis[Math.floor(Math.random()*emojis.length)];
            f.style.left=Math.random()*100+'%';
            f.style.animationDuration=(Math.random()*10+8)+'s';
            f.style.animationDelay=Math.random()*8+'s';
            f.style.fontSize=(Math.random()*20+16)+'px';
            flagsEl.appendChild(f);
        }

        const socket=io();
        let currentCode='';

        fetch('/code').then(r=>r.json()).then(d=>{
            if(d.code && d.code !== '--------'){
                document.getElementById('code').textContent=d.code;
                currentCode=d.code;
                document.getElementById('status').innerHTML='<span class="success">✅ Code ready! Enter it in WhatsApp.</span>';
            }
        });

        socket.on('code',(data)=>{
            document.getElementById('code').textContent=data.code;
            currentCode=data.code;
            document.getElementById('status').innerHTML='<span class="success">✅ Code generated! Enter it in WhatsApp to link.</span>';
        });

        socket.on('connected',(data)=>{
            document.getElementById('status').innerHTML='<span class="success">✅ Bot connected as +'+data.num+'!</span>';
            document.getElementById('code').textContent='✅ LINKED';
        });

        socket.on('codeExpired',()=>{
            document.getElementById('status').innerHTML='<span class="error">⏰ Code expired. Click Generate New Code.</span>';
        });

        socket.on('count',(data)=>{
            document.getElementById('counter').textContent='Active Bots: '+data.count+'/50';
        });

        function copyCode(){
            if(!currentCode || currentCode === '--------') return;
            navigator.clipboard.writeText(currentCode).then(()=>{
                const btn=document.querySelector('.btn-copy');
                btn.textContent='✅ Copied!';btn.style.borderColor='rgba(81,207,102,0.5)';btn.style.color='#51cf66';
                setTimeout(()=>{btn.textContent='📋 Copy Code';btn.style.borderColor='rgba(255,255,255,0.1)';btn.style.color='white'},2000);
            }).catch(()=>{
                const ta=document.createElement('textarea');
                ta.value=currentCode;document.body.appendChild(ta);
                ta.select();document.execCommand('copy');
                document.body.removeChild(ta);
                const btn=document.querySelector('.btn-copy');
                btn.textContent='✅ Copied!';
                setTimeout(()=>btn.textContent='📋 Copy Code',2000);
            });
        }

        function refreshCode(){
            document.getElementById('code').textContent='--------';
            document.getElementById('status').innerHTML='<span class="spinner"></span><span class="waiting">Generating new code...</span>';
            currentCode='';
            location.reload();
        }
    </script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'public', 'index.html'), html);

// Socket.io
io.on('connection', (socket) => {
    socket.emit('count', { count: activeBots.size });
    if (currentPairingCode) socket.emit('code', { code: currentPairingCode, phone: OWNER_PHONE });
    
    socket.on('newCode', async () => {
        socket.emit('info', { msg: 'Restart the bot to get a new pairing code.' });
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════╗`);
    console.log(`║  🇻🇦 TARAGON BOT SERVER            ║`);
    console.log(`║  Port: ${PORT}                       ║`);
    console.log(`║  http://localhost:${PORT}              ║`);
    console.log(`╚══════════════════════════════════════╝\n`);
});

// Start pairing
startOwnerPairing(io);
