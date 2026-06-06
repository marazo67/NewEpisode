// pairing.js – Run once in Railway console, stays alive for 15 minutes
const { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function startPairing() {
    // Generate a unique session ID (folder name)
    const sessionId = crypto.randomBytes(8).toString('hex');
    const sessionPath = path.join(SESSIONS_DIR, sessionId);
    fs.mkdirSync(sessionPath, { recursive: true });

    console.log(`\n📁 Session will be saved in: ${sessionPath}\n`);

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Chrome'),
        markOnlineOnConnect: false
    });

    // Ask for phone number
    const phoneNumber = await new Promise(resolve => {
        rl.question('📱 Enter your WhatsApp number (country code + number, no + or spaces, e.g., 27785028986): ', resolve);
    });
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    if (cleanNumber.length < 10) {
        console.error('❌ Invalid number. Must include country code.');
        process.exit(1);
    }

    // Request pairing code
    let code;
    try {
        code = await sock.requestPairingCode(cleanNumber);
        console.log(`\n🔑 YOUR PAIRING CODE: ${code}\n`);
        console.log('Open WhatsApp → Settings → Linked Devices → Link a Device\n');
    } catch (err) {
        console.error('❌ Failed to request pairing code:', err.message);
        process.exit(1);
    }

    // Wait for successful connection – 15 minutes timeout
    let paired = false;
    let keepAliveInterval;

    const timeout = setTimeout(() => {
        if (!paired) {
            if (keepAliveInterval) clearInterval(keepAliveInterval);
            console.error('\n⏰ Timeout: No device linked within 15 minutes.');
            process.exit(1);
        }
    }, 15 * 60 * 1000); // 15 minutes

    // Start keep-alive: print a dot every 30 seconds to prevent console sleep
    keepAliveInterval = setInterval(() => {
        if (!paired) {
            process.stdout.write('.');
        } else {
            clearInterval(keepAliveInterval);
        }
    }, 30000);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open' && !paired) {
            paired = true;
            clearTimeout(timeout);
            clearInterval(keepAliveInterval);
            await saveCreds();
            console.log(`\n\n✅ Successfully linked with +${sock.user.id.split(':')[0]}`);
            console.log(`\n🎉 YOUR SESSION ID: ${sessionId}\n`);
            console.log(`🔐 IMPORTANT: Copy this Session ID. You will use it in your main bot as SESSION_ID.\n`);
            console.log(`📁 Session files saved in: ${sessionPath}`);
            await sock.end();
            rl.close();
            process.exit(0);
        }
        if (connection === 'close' && !paired) {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (!shouldReconnect) {
                clearInterval(keepAliveInterval);
                console.error('❌ Session logged out. Restart script.');
                process.exit(1);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

startPairing().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
