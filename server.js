const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 10000;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME || "uni_market_shop_bot";

const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// ======================================================
// DATA
// ======================================================

const products = [
  {
    id: "P123",
    name: "Sample Product",
    buyPrice: 500,
    sellPrice: 800,
    stock: 100
  }
];

const orders = [];
const userSessions = {};

// ======================================================
// PAYMENT ACCOUNT
// ======================================================

const paymentAccount = {
  bankName: "Commercial Bank of Ethiopia",
  accountNumber: "1000000000000",
  accountName: "UNI MARKET"
};

// ======================================================
// TELEGRAM API
// ======================================================

async function telegram(method, body) {
  if (!BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing");
  }

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

async function sendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...extra
  });
}

// ======================================================
// HELPERS
// ======================================================

function generateOrderId() {
  return (
    "ORD-" +
    Math.floor(10000000 + Math.random() * 90000000)
  );
}

function getProduct(productId) {
  return products.find(
    product => String(product.id) === String(productId)
  );
}

function getSession(userId) {
  if (!userSessions[userId]) {
    userSessions[userId] = {
      step: "START"
    };
  }

  return userSessions[userId];
}

// ======================================================
// START
// ======================================================

async function handleStart(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;

  userSessions[userId] = {
    step: "SELECT_PRODUCT"
  };

  const buttons = products.map(product => [
    {
      text: `${product.name} - ${product.sellPrice} ETB`,
      callback_data: `product:${product.id}`
    }
  ]);

  buttons.push([
    {
      text: "❌ Cancel",
      callback_data: "cancel_order"
    }
  ]);

  await sendMessage(
    chatId,
    "👋 እንኳን ወደ UNI MARKET በደህና መጡ!\n\n" +
      "🛒 እባክዎ የሚፈልጉትን እቃ ይምረጡ።",
    {
      reply_markup: {
        inline_keyboard: buttons
      }
    }
  );
}

// ======================================================
// PRODUCT SELECTION
// ======================================================

async function handleProductSelection(query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  const productId = query.data.split(":")[1];
  const product = getProduct(productId);

  if (!product) {
    await sendMessage(
      chatId,
      "❌ ይህ እቃ አልተገኘም።"
    );
    return;
  }

  userSessions[userId] = {
    step: "QUANTITY",
    productId: product.id,
    productName: product.name,
    buyPrice: product.buyPrice,
    sellPrice: product.sellPrice
  };

  await sendMessage(
    chatId,
    `📦 የመረጡት፦ ${product.name}\n\n` +
      `💰 ዋጋ፦ ${product.sellPrice} ETB\n\n` +
      "🔢 እባክዎ የሚፈልጉትን ብዛት ያስገቡ።"
  );
}

// ======================================================
// TEXT MESSAGE
// ======================================================

async function handleTextMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = String(message.text || "").trim();

  if (text === "/start") {
    await handleStart(message);
    return;
  }

  if (text === "/cancel") {
    delete userSessions[userId];

    await sendMessage(
      chatId,
      "❌ Order ተሰርዟል።\n\n/start በመጫን እንደገና መጀመር ይችላሉ።"
    );

    return;
  }

  const session = getSession(userId);

  // ====================================================
  // QUANTITY
  // ====================================================

  if (session.step === "QUANTITY") {
    const quantity = Number(text);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      await sendMessage(
        chatId,
        "❌ እባክዎ ትክክለኛ ብዛት ያስገቡ።\n\nለምሳሌ፦ 2"
      );
      return;
    }

    session.quantity = quantity;
    session.total =
      Number(session.sellPrice) * quantity;

    session.step = "NAME";

    await sendMessage(
      chatId,
      "👤 እባክዎ ሙሉ ስምዎን ያስገቡ።"
    );

    return;
  }

  // ====================================================
  // NAME
  // ====================================================

  if (session.step === "NAME") {
    if (text.length < 2) {
      await sendMessage(
        chatId,
        "❌ እባክዎ ትክክለኛ ስም ያስገቡ።"
      );
      return;
    }

    session.customerName = text;
    session.step = "PHONE";

    await sendMessage(
      chatId,
      "📱 እባክዎ ስልክ ቁጥርዎን ያስገቡ።\n\n" +
        "ለምሳሌ፦ 0912345678"
    );

    return;
  }

  // ====================================================
  // PHONE
  // ====================================================

  if (session.step === "PHONE") {
    const phone = text.replace(/[^\d+]/g, "");

    if (phone.length < 9) {
      await sendMessage(
        chatId,
        "❌ እባክዎ ትክክለኛ ስልክ ያስገቡ።"
      );
      return;
    }

    session.phone = phone;
    session.step = "PAYMENT";

    await sendMessage(
      chatId,

      "💳 የክፍያ መረጃ\n\n" +
        `🏦 ባንክ፦ ${paymentAccount.bankName}\n` +
        `🔢 አካውንት፦ ${paymentAccount.accountNumber}\n` +
        `👤 የአካውንት ስም፦ ${paymentAccount.accountName}\n\n` +
        `💰 የሚከፍሉት፦ ${session.total} ETB\n\n` +
        "⬇️ እባክዎ ክፍያውን ከፈጸሙ በኋላ " +
        "የክፍያ ደረሰኙን ፎቶ ይላኩ።"
    );

    return;
  }
}

// ======================================================
// RECEIPT / PHOTO
// ======================================================

async function handlePhoto(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;

  const session = userSessions[userId];

  if (!session || session.step !== "PAYMENT") {
    await sendMessage(
      chatId,
      "⚠️ እባክዎ መጀመሪያ Order ይጀምሩ።\n\n/start"
    );
    return;
  }

  const photos = message.photo;

  if (!photos || photos.length === 0) {
    return;
  }

  const receiptPhoto =
    photos[photos.length - 1];

  const orderId = generateOrderId();

  const order = {
    id: orderId,
    productId: session.productId,
    productName: session.productName,

    customerId: userId,
    customerName: session.customerName,
    phone: session.phone,

    username: message.from.username
      ? "@" + message.from.username
      : "",

    quantity: session.quantity,

    buyPrice: Number(session.buyPrice || 0),
    sellPrice: Number(session.sellPrice || 0),

    total: Number(session.total || 0),

    profit:
      (
        Number(session.sellPrice || 0) -
        Number(session.buyPrice || 0)
      ) * Number(session.quantity || 1),

    paymentAccount: {
      bankName: paymentAccount.bankName,
      accountNumber: paymentAccount.accountNumber,
      accountName: paymentAccount.accountName
    },

    receipt: {
      fileId: receiptPhoto.file_id
    },

    status: "PENDING_PAYMENT",
    createdAt: new Date().toISOString()
  };

  orders.push(order);

  delete userSessions[userId];

  await sendMessage(
    chatId,

    "✅ ደረሰኙ ተቀብለናል።\n\n" +
      `🆔 Order ID፦ ${order.id}\n` +
      `📦 እቃ፦ ${order.productName}\n` +
      `🔢 ብዛት፦ ${order.quantity}\n` +
      `💰 ጠቅላላ፦ ${order.total} ETB\n\n` +
      "⏳ ክፍያዎ በAdmin እየተረጋገጠ ነው።\n" +
      "እባክዎ ማረጋገጫውን ይጠብቁ።"
  );

  if (ADMIN_CHAT_ID) {
    await sendMessage(
      ADMIN_CHAT_ID,

      "🆕 አዲስ የክፍያ ማረጋገጫ ጥያቄ\n\n" +
        `🆔 Order ID፦ ${order.id}\n` +
        `👤 ስም፦ ${order.customerName}\n` +
        `📱 ስልክ፦ ${order.phone}\n` +
        `💬 Telegram፦ ${order.username || "-"}\n\n` +
        `📦 እቃ፦ ${order.productName}\n` +
        `🔢 ብዛት፦ ${order.quantity}\n` +
        `💰 ጠቅላላ፦ ${order.total} ETB\n\n` +
        "🧾 ደረሰኙ ከታች ተልኳል።",

      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✅ ክፍያ አረጋግጥ",
                callback_data:
                  `confirm_payment:${order.id}`
              }
            ],
            [
              {
                text: "❌ ክፍያ አልተረጋገጠም",
                callback_data:
                  `reject_payment:${order.id}`
              }
            ]
          ]
        }
      }
    );

    await telegram("sendPhoto", {
      chat_id: ADMIN_CHAT_ID,
      photo: receiptPhoto.file_id,
      caption:
        `🧾 የOrder ${order.id} ደረሰኝ`
    });
  }
}

// ======================================================
// ADMIN PAYMENT CONFIRMATION
// ======================================================

async function handlePaymentConfirmation(query) {
  const chatId = query.message.chat.id;

  if (
    ADMIN_CHAT_ID &&
    String(chatId) !== String(ADMIN_CHAT_ID)
  ) {
    return;
  }

  const parts = query.data.split(":");
  const action = parts[0];
  const orderId = parts[1];

  const order = orders.find(
    item => item.id === orderId
  );

  if (!order) {
    await sendMessage(
      chatId,
      "❌ Order አልተገኘም።"
    );
    return;
  }

  if (action === "confirm_payment") {
    if (order.status === "CONFIRMED") {
      await sendMessage(
        chatId,
        "ℹ️ ይህ Order ቀድሞ ተረጋግጧል።"
      );
      return;
    }

    order.status = "CONFIRMED";
    order.confirmedAt =
      new Date().toISOString();

    await sendMessage(
      chatId,
      `✅ Order ${order.id} ተረጋግጧል።`
    );

    await sendMessage(
      order.customerId,

      "✅ ክፍያዎ ተረጋግጧል!\n\n" +
        `🆔 Order ID፦ ${order.id}\n` +
        `📦 እቃ፦ ${order.productName}\n` +
        `🔢 ብዛት፦ ${order.quantity}\n` +
        `💰 ጠቅላላ፦ ${order.total} ETB\n\n` +
        "🎉 Orderዎ በተሳካ ሁኔታ ተቀብሏል።"
    );

    return;
  }

  if (action === "reject_payment") {
    order.status = "PAYMENT_REJECTED";
    order.rejectedAt =
      new Date().toISOString();

    await sendMessage(
      chatId,
      `❌ Order ${order.id} የክፍያ ማረጋገጫ ተቀባይነት አላገኘም።`
    );

    await sendMessage(
      order.customerId,

      "❌ የክፍያ ደረሰኝዎ ሊረጋገጥ አልቻለም።\n\n" +
        `🆔 Order ID፦ ${order.id}\n\n` +
        "እባክዎ ትክክለኛ ደረሰኝ እንደገና ይላኩ።"
    );
  }
}

// ======================================================
// CALLBACK QUERY
// ======================================================

async function handleCallbackQuery(query) {
  const data = query.data || "";

  try {
    await telegram("answerCallbackQuery", {
      callback_query_id: query.id
    });
  } catch (error) {
    console.error(
      "Callback answer error:",
      error.message
    );
  }

  if (data.startsWith("product:")) {
    await handleProductSelection(query);
    return;
  }

  if (
    data.startsWith("confirm_payment:") ||
    data.startsWith("reject_payment:")
  ) {
    await handlePaymentConfirmation(query);
    return;
  }

  if (data === "cancel_order") {
    const userId = query.from.id;

    delete userSessions[userId];

    await sendMessage(
      query.message.chat.id,
      "❌ Order ተሰርዟል።\n\n/start በመጫን እንደገና መጀመር ይችላሉ።"
    );
  }
}

// ======================================================
// TELEGRAM WEBHOOK
// ======================================================

app.post(
  "/api/telegram/webhook",
  async (req, res) => {
    res.sendStatus(200);

    try {
      const update = req.body;

      if (update.message) {
        if (update.message.photo) {
          await handlePhoto(update.message);
          return;
        }

        if (update.message.text) {
          await handleTextMessage(update.message);
          return;
        }
      }

      if (update.callback_query) {
        await handleCallbackQuery(update.callback_query);
      }

    } catch (error) {
      console.error(
        "Telegram webhook error:",
        error
      );
    }
  }
);

// ======================================================
// PRODUCTS API
// ======================================================

app.get(
  "/api/products",
  (req, res) => {
    res.json({
      ok: true,
      products
    });
  }
);

// ADD PRODUCT
app.post(
  "/api/products",
  (req, res) => {

    // ==================================================
    // DEBUG LOG
    // ==================================================

    console.log("🔥 POST /api/products RECEIVED");
    console.log("📦 PRODUCT BODY:", req.body);

    const {
      name,
      buyPrice,
      sellPrice,
      stock
    } = req.body || {};

    if (!name || String(name).trim() === "") {

      console.log(
        "❌ ERROR: Product name is missing"
      );

      return res.status(400).json({
        ok: false,
        error: "Product name is required"
      });
    }

    const product = {
      id: "P" + Date.now(),
      name: String(name).trim(),
      buyPrice: Number(buyPrice || 0),
      sellPrice: Number(sellPrice || 0),
      stock: Number(stock || 0)
    };

    console.log(
      "🆕 NEW PRODUCT:",
      product
    );

    products.push(product);

    console.log(
      "📋 PRODUCTS AFTER PUSH:",
      products
    );

    return res.status(201).json({
      ok: true,
      message: "Product added successfully",
      product,
      totalProducts: products.length
    });
  }
);

// ======================================================
// ORDERS API
// ======================================================

app.get(
  "/api/orders",
  (req, res) => {
    res.json({
      ok: true,
      orders
    });
  }
);

// ======================================================
// ROOT
// ======================================================

app.get(
  "/",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin.html"
      )
    );
  }
);

// ======================================================
// WEBHOOK SETUP
// ======================================================

app.get(
  "/api/telegram/setup-webhook",
  async (req, res) => {
    try {
      const webhookUrl =
        "https://telegram-sales-manager-r26j.onrender.com/api/telegram/webhook";

      const result = await telegram(
        "setWebhook",
        {
          url: webhookUrl
        }
      );

      res.json({
        ok: true,
        result
      });

    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

// ======================================================
// WEBHOOK INFO
// ======================================================

app.get(
  "/api/telegram/webhook-info",
  async (req, res) => {
    try {
      const result = await telegram(
        "getWebhookInfo",
        {}
      );

      res.json(result);

    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

// ======================================================
// SERVER
// ======================================================

app.listen(
  PORT,
  () => {
    console.log(
      `🚀 Telegram Sales Manager running on port ${PORT}`
    );

    console.log(
      `🤖 Bot: @${BOT_USERNAME}`
    );
  }
);
