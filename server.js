const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(express.static(path.join(__dirname, "public")));

app.use(cors());
app.use(express.json());

// ==================================================
// CONFIG
// ==================================================

const PORT = process.env.PORT || 10000;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME || "uni_market_shop_bot";

const ADMIN_CHAT_ID =
  process.env.ADMIN_CHAT_ID || "";

// ==================================================
// BASIC CHECK
// ==================================================

if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN is missing");
}

// ==================================================
// HOME
// ==================================================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ==================================================
// TELEGRAM API
// ==================================================

async function telegram(method, body = {}) {
  if (!BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing");
  }

  const url =
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  console.log(`Telegram ${method}:`, data);

  return data;
}

// ==================================================
// TEMPORARY PRODUCTS
// Later → Supabase
// ==================================================

const products = [
  {
    id: "P123",
    name: "Sample Product",
    buyPrice: 500,
    sellPrice: 800,
    stock: 20,
    photoUrl: ""
  },
  {
    id: "P124",
    name: "Sample Product 2",
    buyPrice: 700,
    sellPrice: 1000,
    stock: 15,
    photoUrl: ""
  }
];

// ==================================================
// TEMPORARY ORDERS
// Later → Supabase
// ==================================================

const orders = [];

// ==================================================
// SEND MESSAGE
// ==================================================

async function sendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra
  });
}

// ==================================================
// MAIN MENU
// ==================================================

function mainMenu() {
  return {
    inline_keyboard: [
      [
        {
          text: "🛍️ ምርቶችን ይመልከቱ",
          callback_data: "products"
        }
      ],
      [
        {
          text: "📦 ትዕዛዞቼ",
          callback_data: "my_orders"
        }
      ]
    ]
  };
}

// ==================================================
// PRODUCT LIST
// ==================================================

async function showProducts(chatId) {
  if (!products.length) {
    await sendMessage(
      chatId,
      "😔 በአሁኑ ጊዜ ምርት የለም።"
    );

    return;
  }

  const keyboard = products.map(product => [
    {
      text:
        `${product.name} — ${product.sellPrice} ETB`,
      callback_data: `product_${product.id}`
    }
  ]);

  await sendMessage(
    chatId,
    "🛍️ <b>የሚገኙ ምርቶች</b>\n\n" +
    "ከታች ያለውን ምርት ይምረጡ።",
    {
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
  );
}

// ==================================================
// SHOW PRODUCT
// ==================================================

async function showProduct(chatId, productId) {
  const product = products.find(
    p => p.id === productId
  );

  if (!product) {
    await sendMessage(
      chatId,
      "❌ ይህ ምርት አልተገኘም።"
    );

    return;
  }

  if (product.stock <= 0) {
    await sendMessage(
      chatId,
      `❌ <b>${product.name}</b>\n\n` +
      `ይህ ምርት አሁን ከክምችት ውጪ ነው።`
    );

    return;
  }

  const text =
    `🛍️ <b>${product.name}</b>\n\n` +
    `💰 ዋጋ: <b>${product.sellPrice} ETB</b>\n` +
    `📦 የቀረ: ${product.stock}\n\n` +
    `ለመዘዝ ከታች ያለውን ይጫኑ።`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "🛒 ይዘዙ",
          callback_data: `order_${product.id}`
        }
      ],
      [
        {
          text: "⬅️ ምርቶች",
          callback_data: "products"
        }
      ]
    ]
  };

  if (product.photoUrl) {
    try {
      await telegram("sendPhoto", {
        chat_id: chatId,
        photo: product.photoUrl,
        caption: text,
        parse_mode: "HTML",
        reply_markup: keyboard
      });

      return;
    } catch (error) {
      console.error(
        "Photo send error:",
        error.message
      );
    }
  }

  await sendMessage(
    chatId,
    text,
    {
      reply_markup: keyboard
    }
  );
}

// ==================================================
// ORDER
// ==================================================

async function createOrder(chatId, user, productId) {
  const product = products.find(
    p => p.id === productId
  );

  if (!product) {
    await sendMessage(
      chatId,
      "❌ ምርቱ አልተገኘም።"
    );

    return;
  }

  if (product.stock <= 0) {
    await sendMessage(
      chatId,
      "❌ ይህ ምርት ከክምችት ውጪ ነው።"
    );

    return;
  }

  const orderId =
    "ORD-" +
    Date.now().toString().slice(-8);

  const order = {
    id: orderId,
    productId: product.id,
    productName: product.name,

    customerId: chatId,

    customerName:
      [user.first_name, user.last_name]
        .filter(Boolean)
        .join(" ") || "Unknown",

    username:
      user.username
        ? `@${user.username}`
        : "",

    quantity: 1,

    buyPrice: product.buyPrice,

    sellPrice: product.sellPrice,

    total:
      product.sellPrice,

    profit:
      product.sellPrice -
      product.buyPrice,

    status: "NEW",

    createdAt:
      new Date().toISOString()
  };

  orders.push(order);

  // Reduce stock
  product.stock -= 1;

  // -----------------------------------------------
  // Customer confirmation
  // -----------------------------------------------

  await sendMessage(
    chatId,

    `✅ <b>ትዕዛዝዎ ተመዝግቧል!</b>\n\n` +

    `🧾 Order ID: <b>${order.id}</b>\n` +

    `🛍️ ምርት: ${order.productName}\n` +

    `🔢 ብዛት: ${order.quantity}\n` +

    `💰 ጠቅላላ: <b>${order.total} ETB</b>\n\n` +

    `📌 ሁኔታ: አዲስ ትዕዛዝ`
  );

  // -----------------------------------------------
  // Admin notification
  // -----------------------------------------------

  if (ADMIN_CHAT_ID) {

    await sendMessage(
      ADMIN_CHAT_ID,

      `🔔 <b>አዲስ ትዕዛዝ!</b>\n\n` +

      `🧾 Order ID: <b>${order.id}</b>\n` +

      `👤 ደንበኛ: ${order.customerName}\n` +

      `📱 Telegram: ${order.username || "N/A"}\n` +

      `🆔 Chat ID: ${order.customerId}\n\n` +

      `🛍️ ምርት: ${order.productName}\n` +

      `🔢 ብዛት: ${order.quantity}\n` +

      `💰 ሽያጭ: ${order.total} ETB\n` +

      `📈 ትርፍ: ${order.profit} ETB`
    );

  }
}

// ==================================================
// MY ORDERS
// ==================================================

async function showMyOrders(chatId) {

  const customerOrders =
    orders.filter(
      order =>
        String(order.customerId) ===
        String(chatId)
    );

  if (!customerOrders.length) {

    await sendMessage(
      chatId,
      "📦 እስካሁን ያደረጉት ትዕዛዝ የለም።"
    );

    return;
  }

  let text =
    "📦 <b>ትዕዛዞቼ</b>\n\n";

  customerOrders.forEach(order => {

    text +=
      `🧾 <b>${order.id}</b>\n` +
      `🛍️ ${order.productName}\n` +
      `💰 ${order.total} ETB\n` +
      `📌 ${order.status}\n\n`;

  });

  await sendMessage(
    chatId,
    text
  );
}

// ==================================================
// /START
// ==================================================

async function handleStart(message) {

  const chatId =
    message.chat.id;

  const user =
    message.from || {};

  const text =
    message.text || "";

  const parts =
    text.split(" ");

  const startParameter =
    parts[1] || "";

  // -----------------------------------------------
  // Product deep link
  // /start product_P123
  // -----------------------------------------------

  if (
    startParameter.startsWith("product_")
  ) {

    const productId =
      startParameter.replace(
        "product_",
        ""
      );

    await showProduct(
      chatId,
      productId
    );

    return;
  }

  // -----------------------------------------------
  // Normal /start
  // -----------------------------------------------

  const name =
    user.first_name || "ደንበኛ";

  await sendMessage(

    chatId,

    `👋 <b>ሰላም ${name}!</b>\n\n` +

    `🛍️ ወደ ${BOT_USERNAME} እንኳን በደህና መጡ።\n\n` +

    `ከታች ያለውን አማራጭ ይምረጡ።`,

    {
      reply_markup:
        mainMenu()
    }

  );
}

// ==================================================
// TELEGRAM WEBHOOK
// ==================================================

app.post(
  "/api/telegram/webhook",
  async (req, res) => {

    try {

      const update =
        req.body;

      console.log(
        "📩 Telegram update:",
        JSON.stringify(update)
      );

      // Respond immediately
      res.json({
        ok: true
      });

      // ---------------------------------------------
      // Message
      // ---------------------------------------------

      if (update.message) {

        const message =
          update.message;

        const text =
          message.text || "";

        if (
          text.startsWith("/start")
        ) {

          await handleStart(
            message
          );

          return;
        }

        await sendMessage(
          message.chat.id,

          "👋 እባክዎ `/start` ይጫኑ።"
        );

        return;
      }

      // ---------------------------------------------
      // Callback query
      // ---------------------------------------------

      if (update.callback_query) {

        const callback =
          update.callback_query;

        const chatId =
          callback.message.chat.id;

        const user =
          callback.from;

        const data =
          callback.data || "";

        // Answer callback
        await telegram(
          "answerCallbackQuery",
          {
            callback_query_id:
              callback.id
          }
        );

        // -------------------------------------------
        // Products
        // -------------------------------------------

        if (data === "products") {

          await showProducts(
            chatId
          );

          return;
        }

        // -------------------------------------------
        // My orders
        // -------------------------------------------

        if (data === "my_orders") {

          await showMyOrders(
            chatId
          );

          return;
        }

        // -------------------------------------------
        // Product
        // -------------------------------------------

        if (
          data.startsWith("product_")
        ) {

          const productId =
            data.replace(
              "product_",
              ""
            );

          await showProduct(
            chatId,
            productId
          );

          return;
        }

        // -------------------------------------------
        // Order
        // -------------------------------------------

        if (
          data.startsWith("order_")
        ) {

          const productId =
            data.replace(
              "order_",
              ""
            );

          await createOrder(
            chatId,
            user,
            productId
          );

          return;
        }

      }

    } catch (error) {

      console.error(
        "❌ Webhook error:",
        error
      );

    }

  }
);

// ==================================================
// WEBHOOK SETUP
// ==================================================

app.get(
  "/api/telegram/setup-webhook",
  async (req, res) => {

    try {

      const webhookUrl =
        "https://telegram-sales-manager-r26j.onrender.com/api/telegram/webhook";

      const result =
        await telegram(
          "setWebhook",
          {
            url: webhookUrl,

            allowed_updates: [
              "message",
              "callback_query"
            ]
          }
        );

      console.log(
        "✅ Webhook setup:",
        result
      );

      res.json(result);

    } catch (error) {

      console.error(
        "❌ Webhook setup error:",
        error
      );

      res.status(500).json({
        ok: false,
        error: error.message
      });

    }

  }
);

// ==================================================
// WEBHOOK INFO
// ==================================================

app.get(
  "/api/telegram/webhook-info",
  async (req, res) => {

    try {

      const result =
        await telegram(
          "getWebhookInfo"
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

// ==================================================
// PRODUCTS API
// ==================================================

app.get(
  "/api/products",
  (req, res) => {

    res.json({
      ok: true,
      products
    });

  }
);

// ==================================================
// ORDERS API
// ==================================================

app.get(
  "/api/orders",
  (req, res) => {

    res.json({
      ok: true,
      orders
    });

  }
);

// ==================================================
// SERVER
// ==================================================

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
