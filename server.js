const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "uni_market_shop_bot";

if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN is missing");
}

// --------------------------------------------------
// Telegram API
// --------------------------------------------------

async function telegram(method, body = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return response.json();
}

// --------------------------------------------------
// Temporary products
// Later this will come from Supabase/PostgreSQL
// --------------------------------------------------

const products = [
  {
    id: "P123",
    name: "Sample Product",
    buyPrice: 500,
    sellPrice: 800,
    stock: 20,
    photoUrl: ""
  }
];

// --------------------------------------------------
// Telegram Webhook
// --------------------------------------------------

app.post("/api/telegram/webhook", async (req, res) => {

  try {

    const update = req.body;

    console.log("📩 Telegram update:", JSON.stringify(update));

    if (!update.message) {
      return res.json({ ok: true });
    }

    const message = update.message;

    const chatId = message.chat.id;

    const text = message.text || "";

    // ----------------------------------------------
    // /start
    // ----------------------------------------------

    if (text.startsWith("/start")) {

      const parts = text.split(" ");

      const startParameter = parts[1] || "";

      // --------------------------------------------
      // Product deep link
      // /start product_P123
      // --------------------------------------------

      if (startParameter.startsWith("product_")) {

        const productId =
          startParameter.replace("product_", "");

        const product =
          products.find(p => p.id === productId);

        if (!product) {

          await telegram("sendMessage", {
            chat_id: chatId,
            text:
              "❌ ይቅርታ፣ ይህ ምርት አልተገኘም።"
          });

          return res.json({ ok: true });
        }

        if (product.stock <= 0) {

          await telegram("sendMessage", {
            chat_id: chatId,
            text:
              `❌ ${product.name}\n\nይህ ምርት አሁን አልቋል።`
          });

          return res.json({ ok: true });
        }

        const caption = `
🛍️ ${product.name}

💰 ዋጋ: ${product.sellPrice} ETB

📦 የቀረው: ${product.stock}

🛒 ለማዘዝ ከታች ይጫኑ።
`;

        const keyboard = {
          inline_keyboard: [
            [
              {
                text: "🛒 እዘዝ",
                callback_data: `order_${product.id}`
              }
            ]
          ]
        };

        if (product.photoUrl) {

          await telegram("sendPhoto", {
            chat_id: chatId,
            photo: product.photoUrl,
            caption,
            reply_markup: keyboard
          });

        } else {

          await telegram("sendMessage", {
            chat_id: chatId,
            text: caption,
            reply_markup: keyboard
          });

        }

        return res.json({ ok: true });
      }

      // --------------------------------------------
      // General catalog
      // /start products
      // --------------------------------------------

      if (startParameter === "products") {

        await telegram("sendMessage", {
          chat_id: chatId,
          text:
            "🛍️ እንኳን ወደ UNI MARKET በደህና መጡ!\n\n" +
            "ምርቶቻችንን ለማየት ከታች ይጫኑ።",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🛍️ ምርቶችን ይመልከቱ",
                  callback_data: "catalog"
                }
              ]
            ]
          }
        });

        return res.json({ ok: true });
      }

      // --------------------------------------------
      // Normal /start
      // --------------------------------------------

      await telegram("sendMessage", {
        chat_id: chatId,
        text:
          "👋 እንኳን ወደ UNI MARKET በደህና መጡ!\n\n" +
          "🛍️ የምንሸጣቸውን ምርቶች ለማዘዝ ከታች ይጫኑ።",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🛍️ ምርቶች",
                callback_data: "catalog"
              }
            ]
          ]
        }
      });

      return res.json({ ok: true });
    }

    // ------------------------------------------------
    // Button: 🛒 እዘዝ
    // ------------------------------------------------

    if (update.callback_query) {

      const callback = update.callback_query;

      const callbackId = callback.id;

      const callbackData = callback.data;

      const chatId =
        callback.message.chat.id;

      await telegram("answerCallbackQuery", {
        callback_query_id: callbackId
      });

      // ----------------------------------------------
      // Order product
      // ----------------------------------------------

      if (callbackData.startsWith("order_")) {

        const productId =
          callbackData.replace("order_", "");

        const product =
          products.find(p => p.id === productId);

        if (!product) {

          await telegram("sendMessage", {
            chat_id: chatId,
            text:
              "❌ ምርቱ አልተገኘም።"
          });

          return res.json({ ok: true });
        }

        await telegram("sendMessage", {
          chat_id: chatId,
          text:
            `🛒 ${product.name}\n\n` +
            `💰 ዋጋ: ${product.sellPrice} ETB\n\n` +
            `ስንት እቃ ይፈልጋሉ?`,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "1",
                  callback_data: `qty_${product.id}_1`
                },
                {
                  text: "2",
                  callback_data: `qty_${product.id}_2`
                },
                {
                  text: "3",
                  callback_data: `qty_${product.id}_3`
                }
              ],
              [
                {
                  text: "5",
                  callback_data: `qty_${product.id}_5`
                },
                {
                  text: "10",
                  callback_data: `qty_${product.id}_10`
                }
              ]
            ]
          }
        });

        return res.json({ ok: true });
      }

      // ----------------------------------------------
      // Quantity
      // ----------------------------------------------

      if (callbackData.startsWith("qty_")) {

        const parts =
          callbackData.split("_");

        const productId = parts[1];

        const quantity =
          Number(parts[2]);

        const product =
          products.find(p => p.id === productId);

        if (!product) {
          return res.json({ ok: true });
        }

        if (quantity > product.stock) {

          await telegram("sendMessage", {
            chat_id: chatId,
            text:
              `❌ የቀረው እቃ ${product.stock} ብቻ ነው።`
          });

          return res.json({ ok: true });
        }

        const total =
          product.sellPrice * quantity;

        await telegram("sendMessage", {
          chat_id: chatId,
          text:
            `🧾 የትዕዛዝ ማጠቃለያ\n\n` +
            `📦 ${product.name}\n` +
            `🔢 ብዛት: ${quantity}\n` +
            `💰 ጠቅላላ: ${total} ETB\n\n` +
            `ትዕዛዙን ለመቀጠል ከታች ይጫኑ።`,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "✅ ትዕዛዝ ቀጥል",
                  callback_data:
                    `continue_${product.id}_${quantity}`
                }
              ],
              [
                {
                  text: "❌ ሰርዝ",
                  callback_data: "cancel_order"
                }
              ]
            ]
          }
        });

        return res.json({ ok: true });
      }

      // ----------------------------------------------
      // Continue order
      // ----------------------------------------------

      if (callbackData.startsWith("continue_")) {

        const parts =
          callbackData.split("_");

        const productId = parts[1];

        const quantity =
          Number(parts[2]);

        const product =
          products.find(p => p.id === productId);

        if (!product) {
          return res.json({ ok: true });
        }

        await telegram("sendMessage", {
          chat_id: chatId,
          text:
            "👤 እባክዎ ስምዎን ይላኩ።\n\n" +
            "ለምሳሌ፦ ሳሙኤል አበበ"
        });

        console.log({
          chatId,
          productId,
          quantity
        });

        return res.json({ ok: true });
      }

      if (callbackData === "cancel_order") {

        await telegram("sendMessage", {
          chat_id: chatId,
          text:
            "❌ ትዕዛዙ ተሰርዟል።"
        });

        return res.json({ ok: true });
      }

      // ----------------------------------------------
      // Catalog
      // ----------------------------------------------

      if (callbackData === "catalog") {

        for (const product of products) {

          const caption =
            `📦 ${product.name}\n\n` +
            `💰 ${product.sellPrice} ETB\n` +
            `📦 Stock: ${product.stock}`;

          await telegram("sendMessage", {
            chat_id: chatId,
            text: caption,
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "🛒 አሁን ይዘዙ",
                    url:
                      `https://t.me/${BOT_USERNAME}?start=product_${product.id}`
                  }
                ]
              ]
            }
          });

        }

        return res.json({ ok: true });
      }
    }

    return res.json({ ok: true });

  } catch (error) {

    console.error("❌ Telegram error:", error);

    return res.json({
      ok: false
    });
  }
});

// --------------------------------------------------
// Health check
// --------------------------------------------------

app.get("/health", (req, res) => {

  res.json({
    ok: true,
    service: "UNI MARKET Telegram Sales Manager",
    bot: BOT_USERNAME
  });

});

// --------------------------------------------------
// Products API
// --------------------------------------------------

app.get("/api/products", (req, res) => {

  res.json({
    ok: true,
    products
  });

});

// --------------------------------------------------
// Start server
// --------------------------------------------------

app.listen(PORT, () => {

  console.log(
    `🚀 UNI MARKET server running on port ${PORT}`
  );

});
