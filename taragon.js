// ======================== TARAGON BOT - COMPLETE WITH WEB PAIRING & ALL AI APIs ========================
// Save as bot.js | Run: node bot.js
// Install: npm install express socket.io @whiskeysockets/baileys pino axios yt-search

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, downloadContentFromMessage, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
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
const TEMP_DIR = path.join(__dirname, 'temp');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const WARNINGS_FILE = path.join(__dirname, 'warnings.json');
const ANTIDELETE_FILE = path.join(__dirname, 'antidelete.json');
const SESSIONS_DIR = path.join(__dirname, 'sessions');
[path.join(__dirname, 'public'), TEMP_DIR, SESSIONS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

let settings = {};
let warnings = {};
let antidelete = {};
if (fs.existsSync(SETTINGS_FILE)) settings = JSON.parse(fs.readFileSync(SETTINGS_FILE));
if (fs.existsSync(WARNINGS_FILE)) warnings = JSON.parse(fs.readFileSync(WARNINGS_FILE));
if (fs.existsSync(ANTIDELETE_FILE)) antidelete = JSON.parse(fs.readFileSync(ANTIDELETE_FILE));

function saveSettings() { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); }
function saveWarnings() { fs.writeFileSync(WARNINGS_FILE, JSON.stringify(warnings, null, 2)); }
function saveAntidelete() { fs.writeFileSync(ANTIDELETE_FILE, JSON.stringify(antidelete, null, 2)); }

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
const api = axios.create({ timeout: 30000 });
const downloadBuffer = async (url) => (await api.get(url, { responseType: 'arraybuffer' })).data;
const getMediaBuffer = async (msg, type) => { const stream = await downloadContentFromMessage(msg, type); let buffer = Buffer.alloc(0); for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]); return buffer; };
async function getFolderSize(dirPath) { let total = 0; try { const files = fs.readdirSync(dirPath); for (const file of files) { const stats = fs.statSync(path.join(dirPath, file)); if (stats.isDirectory()) total += await getFolderSize(path.join(dirPath, file)); else total += stats.size; } } catch (e) {} return total; }
async function translate(text, targetLang) { try { const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`; const res = await api.get(url); return res.data[0][0][0]; } catch { return text; } }

async function toAudio(buffer, ext) {
    const inputFile = path.join(TEMP_DIR, `convert_in.${ext}`); const outputFile = path.join(TEMP_DIR, `convert_out.mp3`);
    fs.writeFileSync(inputFile, buffer);
    try { await execAsync(`ffmpeg -i "${inputFile}" -codec:a libmp3lame -qscale:a 2 "${outputFile}"`, { timeout: 30000 }); const outBuf = fs.readFileSync(outputFile); fs.unlinkSync(inputFile); fs.unlinkSync(outputFile); return outBuf; }
    catch (err) { fs.unlinkSync(inputFile); return buffer; }
}

// ======================== ALL AI APIs FOR CHATBOT ========================
const ALL_AI_APIS = [
    { name: 'ZellAPI', url: (q) => `https://zellapi.autos/ai/chatbot?text=${encodeURIComponent(q)}`, extract: (d) => d?.result },
    { name: 'Vapis Gemini', url: (q) => `https://vapis.my.id/api/gemini?q=${encodeURIComponent(q)}`, extract: (d) => d?.message },
    { name: 'Siputzx Gemini', url: (q) => `https://api.siputzx.my.id/api/ai/gemini-pro?content=${encodeURIComponent(q)}`, extract: (d) => d?.data },
    { name: 'Ryzen Gemini', url: (q) => `https://api.ryzendesu.vip/api/ai/gemini?text=${encodeURIComponent(q)}`, extract: (d) => d?.answer },
    { name: 'Gifted Gemini', url: (q) => `https://api.giftedtech.my.id/api/ai/geminiai?apikey=gifted&q=${encodeURIComponent(q)}`, extract: (d) => d?.answer },
    { name: 'Gifted Gemini Pro', url: (q) => `https://api.giftedtech.my.id/api/ai/geminiaipro?apikey=gifted&q=${encodeURIComponent(q)}`, extract: (d) => d?.answer },
    { name: 'ZellAPI Backup', url: (q) => `https://zellapi.autos/ai/chatbot?text=${encodeURIComponent('Reply to: ' + q)}`, extract: (d) => d?.result }
];

async function getAIResponse(userMessage, senderId, contextMessages = []) {
    const prompt = `You're Scottie Kiidrsa, a real person. Reply in 1-2 lines max. Use Hinglish naturally. Be savage if abused, sweet if treated well. NEVER say you're AI. Context: ${contextMessages.slice(-5).join(' | ')}. Message: ${userMessage}`;
    
    // Try all APIs in parallel
    const promises = ALL_AI_APIS.map(async (api) => {
        try {
            const res = await axios.get(api.url(prompt), { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            const answer = api.extract(res.data);
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
    
    // Final fallback
    const fallbacks = ["Haan bhai! 😊", "Kya scene hai? 😎", "Hmm soch raha hu... 🤔", "Achha samjha! 😄", "Kya baat hai! 🔥", "Bhai tu legend hai! 👑"];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

function extractUserInfo(message) { const info = {}; if (message.toLowerCase().includes('my name is')) info.name = message.split('my name is')[1].trim().split(' ')[0]; if (message.toLowerCase().includes('i am') && message.toLowerCase().includes('years old')) info.age = message.match(/\d+/)?.[0]; if (message.toLowerCase().includes('i live in') || message.toLowerCase().includes('i am from')) info.location = message.split(/(?:i live in|i am from)/i)[1].trim().split(/[.,!?]/)[0]; return info; }

// ======================== DOWNLOAD HELPERS ========================
const AXIOS_DEFAULTS = { timeout: 60000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } };
const tryRequest = async (fn, attempts = 3) => { for (let i = 1; i <= attempts; i++) { try { return await fn(); } catch (err) { if (i < attempts) await new Promise(r => setTimeout(r, 1000 * i)); else throw err; } } };

async function downloadSong(urlOrQuery) {
    const isUrl = /youtube\.com|youtu\.be/i.test(urlOrQuery); let video;
    if (isUrl) video = { url: urlOrQuery, title: 'YouTube Video' };
    else { const search = await yts(urlOrQuery); if (!search?.videos?.length) throw new Error('No results'); video = search.videos[0]; }
    const apis = [
        { url: `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(video.url)}&format=mp3`, extract: (d) => d?.data?.downloadURL },
        { url: `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(video.url)}`, extract: (d) => d?.data?.data?.download_url },
        { url: `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(video.url)}`, extract: (d) => d?.data?.dl }
    ];
    for (const a of apis) { try { const res = await tryRequest(() => axios.get(a.url, AXIOS_DEFAULTS)); const url = a.extract(res); if (url) { const buffer = await downloadBuffer(url); return { buffer, title: res.data?.title || video.title, mime: 'audio/mpeg', ext: 'mp3' }; } } catch {} }
    try { const out = path.join(TEMP_DIR, `audio_${Date.now()}.mp3`); await execAsync(`yt-dlp -x --audio-format mp3 -o "${out}" "${video.url}"`, { timeout: 120000 }); if (fs.existsSync(out)) { const buffer = fs.readFileSync(out); fs.unlinkSync(out); return { buffer, title: video.title, mime: 'audio/mpeg', ext: 'mp3' }; } } catch {}
    throw new Error('All download sources failed.');
}

async function ytDlpVideo(url) { const out = path.join(TEMP_DIR, `video_${Date.now()}.mp4`); await execAsync(`yt-dlp -f "best[ext=mp4]" -o "${out}" "${url}"`, { timeout: 300000 }); if (fs.existsSync(out)) { const buffer = fs.readFileSync(out); fs.unlinkSync(out); return { download: buffer, title: 'Video' }; } throw new Error('Failed'); }

async function downloadTikTok(url) { const res = await tryRequest(() => axios.get(`https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`, { timeout: 15000, headers: { accept: '*/*' } })); if (res?.data?.data) { const d = res.data.data; const u = d.urls?.[0] || d.video_url || d.url || d.download_url; if (u) return { videoUrl: u, title: d.metadata?.title || 'TikTok' }; } throw new Error('Failed'); }

async function spotifyCommand(input, jid, quoted, sendMsg) { if (!input) return sendMsg(jid, { text: 'Usage: !spotify <song>' }, { quoted }); try { const { data } = await axios.get(`https://okatsu-rolezapiiz.vercel.app/search/spotify?q=${encodeURIComponent(input)}`, { timeout: 20000 }); if (data?.status && data?.result?.audio) { const r = data.result; const cap = `🎵 ${r.title}\n👤 ${r.artist || ''}`; if (r.thumbnails) await sendMsg(jid, { image: { url: r.thumbnails }, caption: cap }, { quoted }); await sendMsg(jid, { audio: { url: r.audio }, mimetype: 'audio/mpeg', fileName: `${r.title || 'track'}.mp3` }, { quoted }); } else throw new Error('No audio'); } catch { await sendMsg(jid, { text: '❌ Spotify failed.' }, { quoted }); } }

// ======================== STYLED MESSAGE ========================
function createSendStyledMessage(sock, botName) { return async (jid, content, options = {}) => { content.contextInfo = { forwardingScore: 999, isForwarded: true, forwardedNewsletterMessageInfo: { newsletterJid: '120363@newsletter', newsletterName: `${botName} v3.0.7`, serverMessageId: 1 }, externalAdReply: content.contextInfo?.externalAdReply || undefined, ...(content.contextInfo || {}) }; return sock.sendMessage(jid, content, options); }; }

// ======================== BOT SETUP ========================
function setupBot(sock, botNumber) {
    const ownerNumber = `${botNumber}@s.whatsapp.net`; const botName = '𝐓𝐀𝐑𝐀𝐆𝐎𝐍 𝐒𝐐𝐔𝐀𝐃 𝐓𝐑𝐒🇻🇦'; const sendStyledMessage = createSendStyledMessage(sock, botName); const startTime = Date.now();
    
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0]; if (!msg?.message) return;
        const jid = msg.key.remoteJid; const isGroup = jid?.endsWith('@g.us'); const sender = isGroup ? msg.key.participant : jid;
        const isOwner = sender === ownerNumber; const isFromMe = msg.key.fromMe;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text || ''; const isCommand = text.startsWith('!');
        if (settings.autoread && !isFromMe) await sock.readMessages([msg.key]).catch(() => {});
        if (settings.autotyping && !isFromMe) { sock.sendPresenceUpdate('composing', jid).catch(() => {}); setTimeout(() => sock.sendPresenceUpdate('paused', jid).catch(() => {}), 2000); }
        if (settings.autoreact && !isCommand && !isFromMe) { const emojis = ['❤️','👍','😂','😮','😢','👏','🇻🇦','🔥']; await sock.sendMessage(jid, { react: { text: emojis[Math.floor(Math.random()*emojis.length)], key: msg.key } }).catch(() => {}); }
        if (jid === 'status@broadcast' && settings.autostatus && msg.key.participant && !isFromMe) { await sock.sendMessage(msg.key.participant, { react: { text: '❤️', key: msg.key } }).catch(() => {}); return; }
        if (msg.message?.call && settings.anticall && !isOwner) { await sendStyledMessage(jid, { text: '📞 Bot rejects calls.' }); return; }
        if (!isGroup && !isOwner && !isFromMe && settings.pmblocker) { await sendStyledMessage(jid, { text: settings.pmblockerMsg }); return; }
        if (isGroup && !isFromMe) { if (settings.antilink?.[jid] && /https?:\/\//i.test(text)) { await sock.sendMessage(jid, { delete: msg.key }); await sendStyledMessage(jid, { text: '🔗 Links not allowed.' }); return; } if (settings.antibadword?.[jid] && BAD_WORDS.some(w => text.toLowerCase().includes(w))) { await sock.sendMessage(jid, { delete: msg.key }); await sendStyledMessage(jid, { text: '🚫 Bad words prohibited.' }); return; } }

        // AI Chatbot
        const chatbotOn = settings.chatbotGlobal || (isGroup && settings.chatbotGroups?.[jid]);
        if (!isCommand && !isFromMe && chatbotOn && text) {
            let shouldReply = false; const botJids = [sock.user.id, `${botNumber}@s.whatsapp.net`, `${botNumber}@lid`];
            if (msg.message?.extendedTextMessage) { const mentioned = msg.message.extendedTextMessage.contextInfo?.mentionedJid || []; if (mentioned.some(j => botJids.some(b => j?.includes(b?.split('@')[0])))) shouldReply = true; if (botJids.some(b => msg.message.extendedTextMessage.contextInfo?.participant?.includes(b?.split('@')[0]))) shouldReply = true; }
            else if (text.includes(`@${botNumber}`)) shouldReply = true;
            else if (!isGroup) shouldReply = true;
            if (shouldReply) { await sock.sendPresenceUpdate('composing', jid).catch(() => {}); const uid = sender; if (!chatMemory.messages.has(uid)) chatMemory.messages.set(uid, []); const msgs = chatMemory.messages.get(uid); msgs.push(text); if (msgs.length > 20) msgs.shift(); const info = extractUserInfo(text); if (Object.keys(info).length) chatMemory.userInfo.set(uid, { ...(chatMemory.userInfo.get(uid)||{}), ...info }); const reply = await getAIResponse(text, uid, msgs); await sendStyledMessage(jid, { text: reply }, { quoted: msg }); return; }
        }

        if (!isCommand) return; if (settings.mode === 'private' && !isOwner) return;
        const args = text.slice(1).trim().split(/ +/); const command = args[0]?.toLowerCase(); const input = args.slice(1).join(' ');
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage; const quotedKey = msg.message?.extendedTextMessage?.contextInfo; const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        const getGroupMeta = async () => { if (!isGroup) throw new Error('Not group'); return sock.groupMetadata(jid); };
        const isAdmin = async () => { if (!isGroup) return false; if (isOwner) return true; try { const m = await getGroupMeta(); const u = m.participants.find(p => p.id === sender); return u?.admin === 'admin' || u?.admin === 'superadmin'; } catch { return false; } };

        try {
            switch(command) {
                case 'ping': { const s = Date.now(); await sendStyledMessage(jid, { text: `🏓 ${Date.now()-s}ms` }); break; }
                case 'alive': { const u = Date.now()-startTime; const h=Math.floor(u/3600000),m=Math.floor((u%3600000)/60000),s=Math.floor((u%60000)/1000); await sendStyledMessage(jid, { text: `✅ *${botName}*\n⏰ ${h}h ${m}m ${s}s` }); break; }
                case 'owner': await sendStyledMessage(jid, { text: `👑 wa.me/${botNumber}` }); break;
                case 'menu': case 'help': {
                    const menu = `╭━❮ *${botName}* ❯━╮\n┃ ⚡ [!] 🌐 ${settings.mode}\n╰━━━━━━━━━━━━╯\n🌐 !ping !alive !menu !owner\n🤖 !gpt !gemini !imagine\n📥 !play !ytmp3 !ytmp4 !tiktok !spotify !instagram !facebook\n👮 !ban !promote !mute !tagall !antilink !chatbot\n🔒 !mode !autoreact !settings`;
                    await sendStyledMessage(jid, { text: menu }); break;
                }
                case 'gpt': case 'gemini': { if (!input) return sendStyledMessage(jid, { text: `Usage: !${command} <question>` }); const reply = await getAIResponse(input, sender); await sendStyledMessage(jid, { text: `🤖 ${reply}` }); break; }
                case 'imagine': { if (!input) return sendStyledMessage(jid, { text: 'Usage: !imagine <prompt>' }); await sendStyledMessage(jid, { text: '🎨 Generating...' }); try { const { data } = await api.get(`https://api.siputzx.my.id/api/ai/stablediffusion?prompt=${encodeURIComponent(input)}`); const u = typeof data === 'string' ? data : data?.url || data?.image; if (u) { const b = await downloadBuffer(u); await sendStyledMessage(jid, { image: b, caption: input }); } else throw new Error('No image'); } catch { await sendStyledMessage(jid, { text: '❌ Failed.' }); } break; }
                case 'play': case 'ytmp3': { if (!input) return sendStyledMessage(jid, { text: 'Usage: !play <song/url>' }); await sendStyledMessage(jid, { text: '⏳ Downloading...' }); try { const { buffer, title, mime, ext } = await downloadSong(input); await sendStyledMessage(jid, { audio: buffer, mimetype: mime, fileName: `${title}.${ext}`, ptt: false }, { quoted: msg }); } catch(e) { await sendStyledMessage(jid, { text: `❌ ${e.message}` }); } break; }
                case 'ytmp4': { if (!input) return sendStyledMessage(jid, { text: 'Usage: !ytmp4 <url>' }); await sendStyledMessage(jid, { text: '⏳ Downloading...' }); try { let v; try { const r = await tryRequest(() => axios.get(`https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(input)}`, AXIOS_DEFAULTS)); if (r?.data?.data?.download_url) v = { url: r.data.data.download_url, title: r.data.data.title }; } catch {} if (!v) try { const r = await tryRequest(() => axios.get(`https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(input)}`, AXIOS_DEFAULTS)); if (r?.data?.result?.mp4) v = { url: r.data.result.mp4, title: r.data.result.title }; } catch {} if (!v) { const { download, title } = await ytDlpVideo(input); await sendStyledMessage(jid, { video: download, caption: title }); return; } const b = await downloadBuffer(v.url); await sendStyledMessage(jid, { video: b, caption: v.title }); } catch(e) { await sendStyledMessage(jid, { text: `❌ ${e.message}` }); } break; }
                case 'tiktok': { if (!input) return sendStyledMessage(jid, { text: 'Usage: !tiktok <url>' }); await sendStyledMessage(jid, { text: '⏳ Downloading...' }); try { const { videoUrl, title } = await downloadTikTok(input); const b = await downloadBuffer(videoUrl); await sendStyledMessage(jid, { video: b, caption: title }); } catch(e) { await sendStyledMessage(jid, { text: `❌ ${e.message}` }); } break; }
                case 'spotify': await spotifyCommand(input, jid, msg, sendStyledMessage); break;
                case 'instagram': { if (!input) return sendStyledMessage(jid, { text: 'Usage: !instagram <url>' }); try { const { data } = await api.get(`https://api.siputzx.my.id/api/d/instagram?url=${encodeURIComponent(input)}`); if (data?.data?.url) { const b = await downloadBuffer(data.data.url); await sendStyledMessage(jid, { video: b }); } else throw new Error('No media'); } catch { await sendStyledMessage(jid, { text: '❌ Failed.' }); } break; }
                case 'facebook': { if (!input) return sendStyledMessage(jid, { text: 'Usage: !facebook <url>' }); try { const { data } = await api.get(`https://api.siputzx.my.id/api/d/facebook?url=${encodeURIComponent(input)}`); if (data?.data?.url) { const b = await downloadBuffer(data.data.url); await sendStyledMessage(jid, { video: b }); } else throw new Error('No video'); } catch { await sendStyledMessage(jid, { text: '❌ Failed.' }); } break; }
                case 'trt': { const p = input.split(' '); const l = p.pop(); const t = p.join(' '); if (!t || !l) return sendStyledMessage(jid, { text: '!trt <text> <lang>' }); const tr = await translate(t, l); await sendStyledMessage(jid, { text: `🌐 ${tr}` }); break; }
                case 'check': { if (!input) return sendStyledMessage(jid, { text: '!check <host>' }); const host = input.trim(); await sendStyledMessage(jid, { text: `🔍 Checking ${host}...` }); try { const { stdout } = await execFileAsync('nmap', ['-p','80,443,8080',host], { timeout: 30000 }); await sendStyledMessage(jid, { text: `📡 nmap:\n\`\`\`${stdout.trim().substring(0,2000)}\`\`\`` }); } catch(e) { await sendStyledMessage(jid, { text: `❌ nmap: ${e.message}` }); } try { const { stdout } = await execAsync(`curl -I -s "${host}"`, { timeout: 15000 }); await sendStyledMessage(jid, { text: `🌐 curl:\n\`\`\`${stdout.trim().substring(0,2000)}\`\`\`` }); } catch(e) { await sendStyledMessage(jid, { text: `❌ curl: ${e.message}` }); } break; }
                case 'ban': case 'kick': { if (!isGroup || !await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); const t = mentionedJid || quotedKey?.participant; if (!t) return sendStyledMessage(jid, { text: 'Mention or reply.' }); await sock.groupParticipantsUpdate(jid, [t], 'remove'); await sendStyledMessage(jid, { text: `✅ Removed @${t.split('@')[0]}`, mentions: [t] }); break; }
                case 'promote': { if (!isGroup || !await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); if (!mentionedJid) return sendStyledMessage(jid, { text: 'Mention user.' }); await sock.groupParticipantsUpdate(jid, [mentionedJid], 'promote'); await sendStyledMessage(jid, { text: `👑 Promoted @${mentionedJid.split('@')[0]}`, mentions: [mentionedJid] }); break; }
                case 'demote': { if (!isGroup || !await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); if (!mentionedJid) return sendStyledMessage(jid, { text: 'Mention user.' }); await sock.groupParticipantsUpdate(jid, [mentionedJid], 'demote'); await sendStyledMessage(jid, { text: `📉 Demoted @${mentionedJid.split('@')[0]}`, mentions: [mentionedJid] }); break; }
                case 'mute': { if (!isGroup || !await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); const m = parseInt(input) || 60; await sock.groupSettingUpdate(jid, 'announcement'); setTimeout(() => sock.groupSettingUpdate(jid, 'not_announcement').catch(()=>{}), m*60000); await sendStyledMessage(jid, { text: `🔇 Muted ${m}m` }); break; }
                case 'unmute': { if (!isGroup || !await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); await sock.groupSettingUpdate(jid, 'not_announcement'); await sendStyledMessage(jid, { text: '🔊 Unmuted' }); break; }
                case 'delete': case 'del': { if (!await isAdmin() && !isOwner) return sendStyledMessage(jid, { text: '❌ Admins only.' }); if (quoted && quotedKey) await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: false, id: quotedKey.stanzaId, participant: quotedKey.participant } }); else await sock.sendMessage(jid, { delete: msg.key }); break; }
                case 'tagall': { if (!isGroup || !await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); const meta = await getGroupMeta(); await sendStyledMessage(jid, { text: input || '📢', mentions: meta.participants.map(p=>p.id) }); break; }
                case 'antilink': { if (!isGroup || !await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); settings.antilink[jid] = input==='on'?true:input==='off'?false:!settings.antilink[jid]; saveSettings(); await sendStyledMessage(jid, { text: `🔗 Anti-link ${settings.antilink[jid]?'ON':'OFF'}` }); break; }
                case 'antibadword': { if (!isGroup || !await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); settings.antibadword[jid] = input==='on'?true:input==='off'?false:!settings.antibadword[jid]; saveSettings(); await sendStyledMessage(jid, { text: `🚫 Anti-badword ${settings.antibadword[jid]?'ON':'OFF'}` }); break; }
                case 'chatbot': { if (isGroup && !await isAdmin() && !isOwner) return sendStyledMessage(jid, { text: '❌ Admins only.' }); if (isOwner && !isGroup) { settings.chatbotGlobal = input==='on'?true:input==='off'?false:!settings.chatbotGlobal; saveSettings(); await sendStyledMessage(jid, { text: `🤖 Global ${settings.chatbotGlobal?'ON':'OFF'}` }); } else if (isGroup) { settings.chatbotGroups[jid] = input==='on'?true:input==='off'?false:!settings.chatbotGroups[jid]; saveSettings(); await sendStyledMessage(jid, { text: `🤖 Group ${settings.chatbotGroups[jid]?'ON':'OFF'}` }); } break; }
                case 'welcome': { if (!isGroup || !await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); settings.welcome[jid] = input==='on'?true:input==='off'?false:!settings.welcome[jid]; saveSettings(); await sendStyledMessage(jid, { text: `👋 Welcome ${settings.welcome[jid]?'ON':'OFF'}` }); break; }
                case 'goodbye': { if (!isGroup || !await isAdmin()) return sendStyledMessage(jid, { text: '❌ Admins only.' }); settings.goodbye[jid] = input==='on'?true:input==='off'?false:!settings.goodbye[jid]; saveSettings(); await sendStyledMessage(jid, { text: `👋 Goodbye ${settings.goodbye[jid]?'ON':'OFF'}` }); break; }
                case 'mode': { if (!isOwner) return; settings.mode = input==='public'?'public':'private'; saveSettings(); await sendStyledMessage(jid, { text: `🌐 ${settings.mode}` }); break; }
                case 'autoreact': { if (!isOwner) return; settings.autoreact = input==='on'?true:input==='off'?false:!settings.autoreact; saveSettings(); await sendStyledMessage(jid, { text: `✨ ${settings.autoreact?'ON':'OFF'}` }); break; }
                case 'autotyping': { if (!isOwner) return; settings.autotyping = input==='on'?true:input==='off'?false:!settings.autotyping; saveSettings(); await sendStyledMessage(jid, { text: `✍️ ${settings.autotyping?'ON':'OFF'}` }); break; }
                case 'autoread': { if (!isOwner) return; settings.autoread = input==='on'?true:input==='off'?false:!settings.autoread; saveSettings(); await sendStyledMessage(jid, { text: `👀 ${settings.autoread?'ON':'OFF'}` }); break; }
                case 'anticall': { if (!isOwner) return; settings.anticall = input==='on'?true:input==='off'?false:!settings.anticall; saveSettings(); await sendStyledMessage(jid, { text: `📵 ${settings.anticall?'ON':'OFF'}` }); break; }
                case 'pmblocker': { if (!isOwner) return; if (input.startsWith('setmsg ')) { settings.pmblockerMsg = input.replace('setmsg ',''); saveSettings(); } else { settings.pmblocker = input==='on'?true:input==='off'?false:!settings.pmblocker; saveSettings(); } await sendStyledMessage(jid, { text: `🔒 PM blocker ${settings.pmblocker?'ON':'OFF'}` }); break; }
                case 'antidelete': { if (!isOwner) return; settings.antidelete = input==='on'?true:input==='off'?false:!settings.antidelete; saveSettings(); await sendStyledMessage(jid, { text: `🗑️ ${settings.antidelete?'ON':'OFF'}` }); break; }
                case 'settings': { if (!isOwner) return; await sendStyledMessage(jid, { text: `📋 ${JSON.stringify(settings,null,2).substring(0,3000)}` }); break; }
                case 'cleartmp': { if (!isOwner) return; fs.readdirSync(TEMP_DIR).forEach(f=>fs.unlinkSync(path.join(TEMP_DIR,f))); await sendStyledMessage(jid, { text: '🧹 Cleared' }); break; }
                default: await sendStyledMessage(jid, { text: '❌ Unknown. Type !menu' });
            }
        } catch(err) { console.error(err); await sendStyledMessage(jid, { text: `⚠️ Error` }).catch(()=>{}); }
    });

    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        try { if (action==='add' && settings.welcome?.[id]) for (const p of participants) await sendStyledMessage(id, { text: `👋 Welcome @${p.split('@')[0]}!`, mentions: [p] }); else if ((action==='remove'||action==='leave') && settings.goodbye?.[id]) for (const p of participants) await sendStyledMessage(id, { text: `👋 Goodbye @${p.split('@')[0]}!`, mentions: [p] }); } catch {}
    });
}

// ======================== WEB SERVER & PAIRING ========================
const app = express(); const server = http.createServer(app); const io = socketIO(server);
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Taragon Bot - Pairing</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;background:#0a0a0f;min-height:100vh;display:flex;justify-content:center;align-items:center;overflow:hidden}.bg{position:fixed;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle at 30% 40%,rgba(102,126,234,0.15),transparent 50%),radial-gradient(circle at 70% 60%,rgba(118,75,162,0.15),transparent 50%);animation:rotate 30s linear infinite;z-index:0}@keyframes rotate{to{transform:rotate(360deg)}}.flags{position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1}.flag{position:absolute;font-size:24px;animation:float linear infinite;opacity:0.4}@keyframes float{0%{transform:translateY(110vh) rotate(0deg)}to{transform:translateY(-10vh) rotate(720deg)}}.card{position:relative;z-index:10;background:rgba(255,255,255,0.03);backdrop-filter:blur(30px);border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:40px;max-width:460px;width:92%;box-shadow:0 25px 50px rgba(0,0,0,0.5)}.logo{font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:700;text-align:center;background:linear-gradient(135deg,#667eea,#764ba2,#f093fb);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px}.subtitle{text-align:center;color:rgba(255,255,255,0.6);font-size:14px;margin-bottom:28px}.input-group{position:relative;margin-bottom:16px}.input-group span{position:absolute;left:16px;top:50%;transform:translateY(-50%);font-size:18px;z-index:1}input{width:100%;padding:16px 16px 16px 48px;border-radius:16px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:white;font-size:16px;font-family:'Inter',sans-serif;outline:none;transition:.3s}input:focus{border-color:#667eea;box-shadow:0 0 0 4px rgba(102,126,234,0.1)}input::placeholder{color:rgba(255,255,255,0.4)}.btn{width:100%;padding:16px;border-radius:16px;border:none;font-size:15px;font-weight:600;font-family:'Inter',sans-serif;cursor:pointer;transition:.3s}.btn-primary{background:linear-gradient(135deg,#667eea,#764ba2);color:white;box-shadow:0 4px 20px rgba(102,126,234,0.3)}.btn-primary:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(102,126,234,0.5)}.btn-primary:disabled{opacity:0.5;cursor:not-allowed;transform:none}.btn-copy{background:rgba(255,255,255,0.08);color:white;border:1px solid rgba(255,255,255,0.1);margin-top:12px}.result{margin-top:20px;padding:24px;border-radius:16px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);display:none}.result.show{display:block;animation:slideIn .4s ease}@keyframes slideIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}.code{font-family:'Space Grotesk',monospace;font-size:44px;font-weight:700;letter-spacing:14px;color:#667eea;padding:20px;background:rgba(102,126,234,0.08);border-radius:12px;border:2px dashed rgba(102,126,234,0.3);text-align:center;margin:16px 0;text-shadow:0 0 30px rgba(102,126,234,0.4);user-select:all}.steps{background:rgba(255,255,255,0.03);border-radius:12px;padding:16px;margin-top:16px}.step{display:flex;align-items:center;gap:10px;color:rgba(255,255,255,0.7);font-size:13px;padding:6px 0}.step-num{width:22px;height:22px;border-radius:50%;background:#667eea;color:white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0}.status{color:rgba(255,255,255,0.7);font-size:13px;margin-top:12px;text-align:center}.status.success{color:#51cf66}.status.error{color:#ff6b6b}.spinner{display:inline-block;width:20px;height:20px;border:2px solid rgba(255,255,255,0.2);border-top-color:white;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:8px}@keyframes spin{to{transform:rotate(360deg)}}.counter{text-align:center;color:rgba(255,255,255,0.4);font-size:12px;margin-top:20px}</style></head><body><div class="bg"></div><div class="flags" id="flags"></div><div class="card"><div class="logo">🇻🇦 TARAGON SQUAD TRS</div><div class="subtitle">WhatsApp Multi-Device Pairing</div><div class="input-group"><span>📱</span><input type="tel" id="phone" placeholder="Phone with country code (e.g., 27785028986)" maxlength="15"></div><button class="btn btn-primary" id="pairBtn" onclick="requestCode()"><span id="btnText">🔗 Generate Pairing Code</span></button><div class="result" id="result"><div style="color:rgba(255,255,255,0.6);font-size:12px;text-transform:uppercase;letter-spacing:1px;text-align:center">Your 8-Digit Pairing Code</div><div class="code" id="code">--------</div><button class="btn btn-copy" onclick="copyCode()">📋 Copy Code</button><div class="steps"><div class="step"><span class="step-num">1</span> Open WhatsApp on your phone</div><div class="step"><span class="step-num">2</span> Tap ⋮ → <strong>Linked Devices</strong></div><div class="step"><span class="step-num">3</span> Tap <strong>Link a Device</strong></div><div class="step"><span class="step-num">4</span> Enter the 8-digit code above</div></div><p class="status" id="status"></p></div><div class="counter">Active Bots: <span id="count">0</span>/50</div></div><script src="/socket.io/socket.io.js"></script><script>const flagsEl=document.getElementById('flags');const emojis=['🇻🇦','🔮','⚡','🌟','💎','🔥','🛡️','👑'];for(let i=0;i<50;i++){const f=document.createElement('div');f.className='flag';f.textContent=emojis[Math.floor(Math.random()*emojis.length)];f.style.left=Math.random()*100+'%';f.style.animationDuration=(Math.random()*10+8)+'s';f.style.animationDelay=Math.random()*8+'s';f.style.fontSize=(Math.random()*20+16)+'px';flagsEl.appendChild(f)}const socket=io();let code='';socket.on('code',(data)=>{document.getElementById('code').textContent=data.code;document.getElementById('result').classList.add('show');document.getElementById('status').innerHTML='<span class="success">✅ Code ready! Enter it in WhatsApp.</span>';document.getElementById('btnText').textContent='🔗 Generate Pairing Code';document.getElementById('pairBtn').disabled=false;code=data.code});socket.on('error',(data)=>{document.getElementById('status').innerHTML='<span class="error">❌ '+data.msg+'</span>';document.getElementById('result').classList.add('show');document.getElementById('btnText').textContent='🔗 Generate Pairing Code';document.getElementById('pairBtn').disabled=false});socket.on('connected',(data)=>{document.getElementById('status').innerHTML='<span class="success">✅ Connected as +'+data.num+'!</span>';document.getElementById('btnText').textContent='🔗 Generate Pairing Code';document.getElementById('pairBtn').disabled=false});socket.on('count',(data)=>{document.getElementById('count').textContent=data.count});function requestCode(){const phone=document.getElementById('phone').value.replace(/\\D/g,'');if(!phone||phone.length<10)return alert('Enter valid number');document.getElementById('btnText').innerHTML='<span class="spinner"></span>Generating...';document.getElementById('pairBtn').disabled=true;document.getElementById('result').classList.remove('show');socket.emit('pair',{phone})}function copyCode(){if(!code)return;navigator.clipboard.writeText(code).then(()=>{const btn=document.querySelector('.btn-copy');btn.textContent='✅ Copied!';setTimeout(()=>btn.textContent='📋 Copy Code',2000)}).catch(()=>{const ta=document.createElement('textarea');ta.value=code;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);const btn=document.querySelector('.btn-copy');btn.textContent='✅ Copied!';setTimeout(()=>btn.textContent='📋 Copy Code',2000)})}document.getElementById('phone').addEventListener('keydown',e=>{if(e.key==='Enter')requestCode()})</script></body></html>`;
fs.writeFileSync(path.join(__dirname, 'public', 'index.html'), html);

async function createPairing(phone, socket) {
    try {
        const sessionName = `session_${phone}_${Date.now()}`; const sessionDir = path.join(SESSIONS_DIR, sessionName);
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir); const { version } = await fetchLatestBaileysVersion();
        const sock = makeWASocket({ version, auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) }, printQRInTerminal: false, logger: pino({ level: 'silent' }), browser: Browsers.macOS('Chrome'), markOnlineOnConnect: false });
        const code = await sock.requestPairingCode(phone);
        console.log(`📱 Code for ${phone}: ${code}`); socket.emit('code', { code });
        let connected = false;
        sock.ev.on('connection.update', async (u) => {
            if (u.connection === 'open' && !connected) { connected = true; const num = sock.user.id.split(':')[0]; activeBots.set(sessionName, { sock, phone, number: num }); io.emit('count', { count: activeBots.size }); socket.emit('connected', { num }); console.log(`✅ ${num} connected! Total: ${activeBots.size}/50`); setupBot(sock, num); }
            if (u.connection === 'close') { activeBots.delete(sessionName); io.emit('count', { count: activeBots.size }); }
        });
        sock.ev.on('creds.update', saveCreds);
        setTimeout(() => { if (!connected) { socket.emit('error', { msg: 'Timeout. Try again.' }); } }, 120000);
    } catch(err) { socket.emit('error', { msg: `Failed: ${err.message}` }); }
}

io.on('connection', (socket) => { socket.emit('count', { count: activeBots.size }); socket.on('pair', async (data) => { if (activeBots.size >= 50) return socket.emit('error', { msg: 'Max 50 bots.' }); const phone = data.phone.replace(/\D/g, ''); if (!phone || phone.length < 10) return socket.emit('error', { msg: 'Invalid number.' }); await createPairing(phone, socket); }); });

server.listen(PORT, () => { console.log(`\n╔══════════════════════════════════╗\n║   🇻🇦 TARAGON BOT ONLINE        ║\n║   http://localhost:${PORT}          ║\n║   Max: 50 bots                  ║\n╚══════════════════════════════════╝\n`); });

// Start existing session
(async () => { if (fs.existsSync('auth_info_baileys')) { try { const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys'); const { version } = await fetchLatestBaileysVersion(); const sock = makeWASocket({ version, auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) }, printQRInTerminal: false, logger: pino({ level: 'info' }), browser: Browsers.macOS('Chrome') }); sock.ev.on('connection.update', (u) => { if (u.connection === 'open') { const num = sock.user.id.split(':')[0]; console.log(`✅ Existing session: ${num}`); setupBot(sock, num); } }); sock.ev.on('creds.update', saveCreds); } catch { console.log('Use web panel to pair.\n'); } } })();
