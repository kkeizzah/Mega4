const express = require('express');
const fs = require('fs');
const { exec } = require("child_process");
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser
} = require("@whiskeysockets/baileys");
const { upload } = require('./mega');

// Initialize express router
let router = express.Router();

// Function to remove file or directory
function removeFile(filePath) {
    if (!fs.existsSync(filePath)) return false;
    fs.rmSync(filePath, { recursive: true, force: true });
}

// Handle incoming GET request
router.get('/', async (req, res) => {
    let num = req.query.number; // Extract number from query string

    // Function to handle pairing process
    async function PrabathPair() {
        const { state, saveCreds } = await useMultiFileAuthState(`./session`);
        
        try {
            // Initialize the socket with auth credentials
            let PrabathPairWeb = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
            });

            // Check if user is registered, otherwise request pairing code
            if (!PrabathPairWeb.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, ''); // Clean the number input
                const code = await PrabathPairWeb.requestPairingCode(num);
                
                if (!res.headersSent) {
                    return res.send({ code });
                }
            }

            // Save credentials and handle connection updates
            PrabathPairWeb.ev.on('creds.update', saveCreds);
            PrabathPairWeb.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === "open") {
                    // Once connected, join group and send session details
                    await PrabathPairWeb.groupAcceptInvite("LURfBACgpY01flBYFTXfxu");

                    try {
                        await delay(10000); // Wait for the group join to complete

                        // Read session credentials and upload to Mega
                        const sessionPrabath = fs.readFileSync('./session/creds.json');
                        const authPath = './session/';
                        const userJid = jidNormalizedUser(PrabathPairWeb.user.id);
                        const megaUrl = await upload(fs.createReadStream(authPath + 'creds.json'), `${userJid}.json`);

                        // Generate session link and send to user
                        const stringSession = megaUrl.replace('https://mega.nz/file/', '');
                        const sid = stringSession;

                        // Send session ID to user
                        await PrabathPairWeb.sendMessage(userJid, { text: sid });

                    } catch (e) {
                        // If error occurs, restart service
                        exec('pm2 restart prabath');
                    }

                    // Clean up session files and exit process
                    await delay(100);
                    await removeFile('./session');
                    process.exit(0);

                } else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode !== 401) {
                    // If disconnected unexpectedly, retry pairing
                    await delay(10000);
                    PrabathPair();
                }
            });
        } catch (err) {
            // Restart service in case of an error
            exec('pm2 restart prabath-md');
            console.log("Service restarted due to an error");
            PrabathPair(); // Retry pairing
            await removeFile('./session');
            if (!res.headersSent) {
                return res.send({ code: "Service Unavailable" });
            }
        }
    }

    // Start the pairing process
    await PrabathPair();
});

// Handle uncaught exceptions globally
process.on('uncaughtException', function (err) {
    console.log('Caught exception: ' + err);
    exec('pm2 restart prabath');
});

// Export the router for use in other parts of the application
module.exports = router;
