/* UPDATED SERVER.JS — Telegram Sales Manager / UNI MARKET (Fixed Syntax) */
"use strict";

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = Number(process.env.PORT || 10000);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

/* =========================
ENVIRONMENT
========================= */

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const BOT_USERNAME = String(process.env.TELEGRAM_BOT_USERNAME || "uni_market_shop_bot").replace(/^@/, "").trim();
const ADMIN_CHAT_ID = String(process.env.ADMIN_CHAT_ID || "").trim();
const AUTH_SECRET = String(process.env.AUTH_SECRET || "uni_market_static_secret_key_2026").trim();

const MASTER_ADMIN_USERNAME = String(process.env.MASTER_ADMIN_USERNAME || "admin").trim();
const MASTER_ADMIN_PASSWORD = String(process.env.MASTER_ADMIN_PASS || process.env.MASTER_ADMIN_PASSWORD || process.env.WEB_PASSWORD || "123456").trim();
const STORAGE_BUCKET = String(process.env.SUPABASE_STORAGE_BUCKET || "product-images").trim();
const WEBHOOK_URL = String(process.env.WEBHOOK_URL || "").trim();

const TELEGRAM_WEBHOOK_SECRET = String(
  process.env.TELEGRAM_WEBHOOK_SECRET ||
    crypto.createHash("sha256").update(`${AUTH_SECRET}:${BOT_USERNAME}`).digest("hex").slice(0, 40)
).trim();

/* =========================
SUPABASE
========================= */

let supabase = null;

try {
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    console.log("Supabase initialized.");
  } else {
    console.warn("Supabase environment variables are missing.");
  }
} catch (error) {
  console.error("Supabase init error:", error);
}

/* =========================
UPLOAD
========================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  }
});

/* =========================
HELPERS
========================= */

function nowISO() {
  return new Date().toISOString();
}

function safeString(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function numberValue(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/* =========================
AUTH
========================= */

function createAuthToken(payload) {
  const encodedPayload = base64url(Buffer.from(JSON.stringify(payload)));
  const signature = base64url(crypto.createHmac("sha256", AUTH_SECRET).update(encodedPayload).digest());
  return `${encodedPayload}.${signature}`;
}

function verifyAuthToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  const expected = base64url(crypto.createHmac("sha256", AUTH_SECRET).update(encodedPayload).digest());
  if (signature.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(String(password), salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt:${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve) => {
    if (!stored || !stored.startsWith("scrypt:")) return resolve(false);
    const parts = stored.split(":");
    if (parts.length !== 3) return resolve(false);
    const salt = parts[1];
    const storedHash = Buffer.from(parts[2], "hex");
    crypto.scrypt(String(password), salt, storedHash.length, (err, derivedKey) => {
      if (err) return resolve(false);
      try {
        resolve(crypto.timingSafeEqual(storedHash, derivedKey));
      } catch {
        resolve(false);
      }
    });
  });
}

function getAuth(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    const token = verifyAuthToken(header.slice("Bearer ".length).trim());
    if (token) return token;
  }
  const cookieHeader = req.headers.cookie || "";
  const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]*)/);
  if (match) {
    try {
      return verifyAuthToken(decodeURIComponent(match[1]));
    } catch {
      return null;
    }
  }
  return null;
}

function requireAuth(req, res, next) {
  const auth = getAuth(req);
  if (!auth) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  req.auth = auth;
  next();
}

/* =========================
TELEGRAM HTTP
========================= */

async function telegram(method, body = {}) {
  if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is missing");
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Telegram ${method}: ${data.description || "API error"}`);
  }
  return data.result;
}

async function sendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", { chat_id: chatId, text, ...extra });
}

/* =========================================================
PRODUCT CATEGORIES
========================================================= */

const PRODUCT_CATEGORIES = [
  { id: "clothing", name: "👕 አልባሳት" },
  { id: "electronics", name: "📱 ኤሌክትሮኒክስ" },
  { id: "kids", name: "🧒 የህፃናት" },
  { id: "women", name: "👩 የሴቶች" },
  { id: "home", name: "🏠 የቤት እቃዎች" },
  { id: "other", name: "🛍️ ሌሎች" }
];

function productCategoriesKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "👕 አልባሳት", callback_data: "category_clothing" }, { text: "📱 ኤሌክትሮኒክስ", callback_data: "category_electronics" }],
      [{ text: "🧒 የህፃናት", callback_data: "category_kids" }, { text: "👩 የሴቶች", callback_data: "category_women" }],
      [{ text: "🏠 የቤት እቃዎች", callback_data: "category_home" }, { text: "🛍️ ሌሎች", callback_data: "category_other" }]
    ]
  };
}

function categoryAliases(category) {
  const value = safeString(category).toLowerCase();
  const map = {
    clothing: ["clothing", "clothes"],
    clothes: ["clothing", "clothes"],
    electronics: ["electronics"],
    kids: ["kids", "children"],
    children: ["kids", "children"],
    women: ["women"],
    home: ["home", "furniture"],
    furniture: ["home", "furniture"],
    other: ["other", "others"],
    others: ["other", "others"]
  };
  return map[value] || [value];
}

async function getBotProducts(category = null) {
  if (!supabase) return [];
  const { data, error } = await supabase.from("products").select("*").order("created_at", { ascending: false });
  if (error) return [];
  let products = Array.isArray(data) ? data : [];
  products = products.filter((p) => numberValue(p.stock, 0) > 0);
  if (!category) return products;
  const aliases = categoryAliases(category);
  return products.filter((p) => aliases.includes(safeString(p.category).toLowerCase()));
}

function productListKeyboard(products) {
  const rows = [];
  for (const product of products) {
    rows.push([{ text: `🛍️ ${safeString(product.name) || "ምርት"} — ${numberValue(product.sell_price, 0)} ብር`, callback_data: `product_${product.id}` }]);
  }
  rows.push([{ text: "⬅️ ወደ ምድቦች", callback_data: "product_categories" }]);
  return { inline_keyboard: rows };
}

/* =========================================================
ORDER SESSIONS (MULTI-IN-ONE FAST FLOW)
========================================================= */
const orderSessions = new Map();

/* =========================================================
TELEGRAM BOT & WEBHOOK
========================================================= */

let telegramWebhookActive = false;

function isValidTelegramWebhook(req) {
  if (!TELEGRAM_WEBHOOK_SECRET) return true;
  const received = safeString(req.headers["x-telegram-bot-api-secret-token"]);
  return received === TELEGRAM_WEBHOOK_SECRET;
}

async function sendBotWelcome(chatId, name = "") {
  const greetingName = safeString(name) ? `, ${safeString(name)}` : "";
  await sendMessage(
    chatId,
    `👋 እንኳን ወደ UNI MARKET${greetingName} በደህና መጡ!\n\n🛍️ የሚፈልጉትን ምርት ይምረጡ።\n\n👇 ከታች ያለውን የምርቶች ቁልፍ ይጫኑ።`,
    { reply_markup: { inline_keyboard: [[{ text: "🛍️ ምርቶች", callback_data: "catalog" }]] } }
  );
}

async function sendBotCatalog(chatId) {
  const products = await getBotProducts();
  if (products.length === 0) {
    return sendMessage(chatId, "📦 በአሁኑ ጊዜ የሚገኝ ምርት የለም።", { reply_markup: productCategoriesKeyboard() });
  }
  return sendMessage(chatId, "🛍️ <b>UNI MARKET</b>\n\n📂 እባክዎ የሚፈልጉትን የምርት ምድብ ይምረጡ።", {
    parse_mode: "HTML",
    reply_markup: productCategoriesKeyboard()
  });
}

async function sendBotProduct(chatId, productId) {
  if (!supabase) return sendMessage(chatId, "⚠️ Supabase አልተገናኘም።");
  const { data: product, error } = await supabase.from("products").select("*").eq("id", productId).maybeSingle();
  if (error || !product) return sendMessage(chatId, "❌ ይህ ምርት አልተገኘም።");

  const stock = numberValue(product.stock, 0);
  const price = numberValue(product.sell_price, 0);
  const name = safeString(product.name) || "ምርት";
  const description = safeString(product.description);

  const text = `🛍️ <b>${name}</b>\n\n${description ? `${description}\n\n` : ""}💰 ዋጋ: <b>${price} ብር</b>\n📦 ያለው ብዛት: <b>${stock}</b>\n\n👇 ለማዘዝ ከታች ይጫኑ።`;
  const replyMarkup = {
    inline_keyboard: [
      [{ text: "🛒 ለማዘዝ", callback_data: `order_product_${product.id}` }],
      [{ text: "⬅️ ምርቶች", callback_data: "catalog" }]
    ]
  };

  const photoUrl = firstDefined(product.photo_url, product.photoUrl, product.photo);
  if (photoUrl) {
    try {
      return await sendPhotoFromUrl(chatId, photoUrl, text, { reply_markup: replyMarkup });
    } catch {}
  }
  return sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: replyMarkup });
}

async function handleTelegramUpdate(update) {
  try {
    if (update.callback_query) {
      const callback = update.callback_query;
      const callbackData = safeString(callback.data);
      const chatId = callback.message?.chat?.id;
      if (callback.id) {
        try { await telegram("answerCallbackQuery", { callback_query_id: callback.id }); } catch {}
      }
      if (!chatId) return;

      if (callbackData === "product_categories" || callbackData === "categories") {
        await sendMessage(chatId, "📂 <b>የምርት ምድቦች</b>\n\nእባክዎ የሚፈልጉትን ምድብ ይምረጡ።", {
          parse_mode: "HTML",
          reply_markup: productCategoriesKeyboard()
        });
        return;
      }

      if (callbackData.startsWith("category_")) {
        const category = callbackData.slice("category_".length);
        const products = await getBotProducts(category);
        const categoryInfo = PRODUCT_CATEGORIES.find((i) => i.id === category);
        const categoryName = categoryInfo?.name || "🛍️ ምርቶች";
        if (products.length === 0) {
          await sendMessage(chatId, `${categoryName}\n\n📦 በዚህ ምድብ ውስጥ በአሁኑ ጊዜ የሚገኝ ምርት የለም።`, {
            reply_markup: { inline_keyboard: [[{ text: "⬅️ ወደ ምድቦች", callback_data: "product_categories" }]] }
          });
          return;
        }
        await sendMessage(chatId, `${categoryName}\n\n👇 ከታች ያለውን ምርት ይምረጡ።`, {
          reply_markup: productListKeyboard(products)
        });
        return;
      }

      if (callbackData === "catalog") {
        await sendBotCatalog(chatId);
        return;
      }

      if (callbackData.startsWith("product_")) {
        const productId = callbackData.slice("product_".length);
        if (productId) await sendBotProduct(chatId, productId);
        return;
      }

      if (callbackData.startsWith("order_product_")) {
        const productId = callbackData.slice("order_product_".length);
        if (!productId) return;

        orderSessions.set(chatId, {
          step: "DETAILS",
          productId: productId
        });

        await sendMessage(
          chatId,
          "🛒 <b>ማዘዣ ቅጽ</b>\n\nእባክዎ የሚከተሉትን መረጃዎች <b>በአንድ መልእክት</b> በትክክል ጽፈው ይላኩልን፦\n\n1. ሙሉ ስም:\n2. ስልክ ቁጥር:\n3. አድራሻ (ከተማ/ቦታ):\n4. የሚፈልጉት ብዛት (Quantity):",
          { parse_mode: "HTML" }
        );
        return;
      }

      if (callbackData.startsWith("order_received_")) {
        const orderId = callbackData.slice("order_received_".length);
        if (!orderId || !supabase) return;
        
        await supabase.from("orders").update({ status: "DELIVERED", delivered_at: nowISO() }).eq("id", orderId);
        orderSessions.delete(chatId);

        await sendMessage(
          chatId,
          "✅ <b>ትዕዛዝዎ በተሳካ ሁኔታ ተጠናቋል!</b>\n\n🙏 ከእኛ ጋር ቤተሰብነት ስለመሰረቱ እናመሰግናለን! እንደገና እንድትጎበኙን በጉጉት እንጠብቃለን። 🛍️✨",
          { parse_mode: "HTML" }
        );
        return;
      }
      return;
    }

    if (update.message) {
      const message = update.message;
      const chatId = message.chat?.id;
      if (!chatId) return;

      const text = safeString(message.text);
      const photo = message.photo;

      if (orderSessions.has(chatId)) {
        const session = orderSessions.get(chatId);

        if (session.step === "DETAILS") {
          if (!text) {
            await sendMessage(chatId, "⚠️ እባክዎ መረጃውን በጽሁፍ ይላኩልን፦");
            return;
          }

          session.detailsText = text;
          session.step = "RECEIPT";
          orderSessions.set(chatId, session);

          const payment = await getPaymentSettings();
          const bankInfo = payment.bank_details || payment.account_number || "Telebirr / CBE Bank accounts available.";

          await sendMessage(
            chatId,
            `💳 <b>የክፍያ መረጃ</b>\n\nመረጃዎ ተመዝግቧል! እባክዎ ከታች ባለው አካውንት ክፍያውን ፈጽመው የመጨረሻውን <b>የክፍያ ደረሰኝ ፎቶ (Receipt Screenshot)</b> አሁን ይላኩልን።\n\n${bankInfo}`,
            { parse_mode: "HTML" }
          );
          return;
        }

        if (session.step === "RECEIPT") {
          let receiptUrl = "";
          if (photo && photo.length > 0) {
            const fileId = photo[photo.length - 1].file_id;
            try {
              const fileInfo = await telegram("getFile", { file_id: fileId });
              if (fileInfo?.file_path) {
                receiptUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
              }
            } catch {}
          }

          if (!receiptUrl && text) {
            receiptUrl = text;
          }

          if (!receiptUrl) {
            await sendMessage(chatId, "⚠️️ እባክዎ የክፍያውን <b>ደረሰኝ ፎቶ (Screenshot)</b> ይላኩ፦");
            return;
          }

          if (supabase) {
            try {
              const { data: product } = await supabase.from("products").select("*").eq("id", session.productId).maybeSingle();
              const unitPrice = numberValue(product?.sell_price, 0);
              
              const orderRow = {
                product_id: session.productId,
                product_name: product?.name || "ምርት",
                quantity: 1,
                unit_price: unitPrice,
                total: unitPrice,
                customer_name: session.detailsText.slice(0, 100),
                phone: "Telegram User",
                address: session.detailsText,
                telegram_chat_id: String(chatId),
                payment_receipt_url: receiptUrl,
                status: "PENDING",
                payment_status: "PENDING_VERIFICATION"
              };

              const { data: savedOrder, error: orderErr } = await supabase.from("orders").insert(orderRow).select("*").single();

              if (!orderErr && savedOrder) {
                await sendMessage(
                  chatId,
                  `✅ <b>ትዕዛዝዎ እና ደረሰኙ ተልከዋል!</b>\n\n🆔 የትዕዛዝ ቁጥር: #${savedOrder.id.slice(0, 8)}\n\nአድሚኖች ክፍያዎን አረጋግጠው እቃውን ወደ ማድረስ ሂደት ያስገቡታል። እናመሰግናለን! 🙏`,
                  { parse_mode: "HTML" }
                );

                if (ADMIN_CHAT_ID) {
                  try {
                    await sendMessage(
                      ADMIN_CHAT_ID,
                      `🔔 <b>አዲስ ትዕዛዝ እና ደረሰኝ መጥቷል!</b>\n\n📝 መረጃ: ${session.detailsText}\n🛒 እቃ: ${orderRow.product_name}\n\n🔗 Dashboard ላይ በመግባት ያረጋግጡ።`,
                      { parse_mode: "HTML" }
                    );
                  } catch {}
                }
              } else {
                await sendMessage(chatId, "⚠️ ትዕዛዝዎን ማስቀመጥ ላይ ችግር ተፈጥሯል። እባክዎ ቆይተው እንደገና ይሞክሩ።");
              }
            } catch (err) {
              console.error("Order save error:", err);
            }
          }

          orderSessions.delete(chatId);
          return;
        }
      }

      if (text === "/start" || text.startsWith("/start ")) {
        const firstName = safeString(message.from?.first_name);
        await sendBotWelcome(chatId, firstName);
        return;
      }

      if (text === "/catalog" || text.toLowerCase() === "catalog" || text === "🛍️ ምርቶች") {
        await sendBotCatalog(chatId);
        return;
      }
    }
  } catch (error) {
    console.error("Telegram update handler error:", error);
  }
}

/* =========================================================
TELEGRAM WEBHOOK
========================================================= */

app.post("/api/telegram/webhook", async (req, res) => {
  if (!isValidTelegramWebhook(req)) return res.status(403).json({ ok: false });
  const update = req.body;
  res.status(200).json({ ok: true });
  setImmediate(() => {
    handleTelegramUpdate(update).catch((error) => console.error("Webhook processing error:", error));
  });
});

async function startTelegramBot() {
  if (!BOT_TOKEN) return;
  try {
    const bot = await telegram("getMe");
    console.log(`Telegram Bot connected: @${bot.username || BOT_USERNAME}`);
    if (WEBHOOK_URL) {
      let webhookUrl = WEBHOOK_URL.endsWith("/") ? WEBHOOK_URL.slice(0, -1) : WEBHOOK_URL;
      if (!webhookUrl.endsWith("/api/telegram/webhook")) webhookUrl = `${webhookUrl}/api/telegram/webhook`;
      await telegram("setWebhook", {
        url: webhookUrl,
        secret_token: TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: false
      });
      telegramWebhookActive = true;
      console.log(`Telegram Webhook enabled: ${webhookUrl}`);
    }
  } catch (error) {
    console.error("Telegram Bot startup error:", error.message);
  }
}

/* =========================================================
PHOTO UPLOAD & HELPERS
========================================================= */

async function sendPhotoFromUrl(chatId, photoUrl, caption, extra = {}) {
  const url = safeString(photoUrl);
  if (!url) throw new Error("Photo URL missing");
  const imageResponse = await fetch(url);
  if (!imageResponse.ok) throw new Error(`Could not download image: HTTP ${imageResponse.status}`);
  const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", String(caption || ""));
  form.append("photo", new Blob([imageBuffer], { type: contentType }), "image.jpg");
  if (extra.reply_markup) form.append("reply_markup", JSON.stringify(extra.reply_markup));

  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: "POST", body: form });
  const data = await response.json();
  if (!data.ok) throw new Error(`Telegram sendPhoto: ${data.description || "API error"}`);
  return data.result;
}

async function verifyTelegramChat(chatId) {
  const id = safeString(chatId);
  if (!id) throw new Error("Telegram Chat ID missing");
  return telegram("getChat", { chat_id: id });
}

async function getPaymentSettings() {
  if (!supabase) return {};
  try {
    const { data } = await supabase.from("payment_settings").select("*").limit(1).maybeSingle();
    return data || {};
  } catch {
    return {};
  }
}

async function getTelegramSettings() {
  if (!supabase) return {};
  try {
    const { data } = await supabase.from("telegram_settings").select("*").limit(1).maybeSingle();
    return data || {};
  } catch {
    return {};
  }
}

/* =========================================================
API ROUTES (AUTH, PRODUCTS, ORDERS, ETC.)
========================================================= */

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = safeString(req.body?.username);
    const password = String(req.body?.password || "");
    if (!username || !password) return res.status(400).json({ ok: false, error: "Username and password required" });
    if (username === MASTER_ADMIN_USERNAME && password === MASTER_ADMIN_PASSWORD) {
      const token = createAuthToken({ role: "MASTER_ADMIN", username: MASTER_ADMIN_USERNAME, name: "Master Admin", exp: Date.now() + 1000 * 60 * 60 * 24 * 7 });
      return res.json({ ok: true, token, user: { role: "MASTER_ADMIN", username: MASTER_ADMIN_USERNAME, name: "Master Admin" } });
    }
    if (!supabase) return res.status(500).json({ ok: false, error: "Supabase unavailable" });
    const { data: employee } = await supabase.from("employees").select("*").eq("username", username).maybeSingle();
    if (!employee || employee.active === false) return res.status(401).json({ ok: false, error: "Invalid credentials" });
    const valid = await verifyPassword(password, employee.password_hash);
    if (!valid) return res.status(401).json({ ok: false, error: "Invalid credentials" });
    const token = createAuthToken({ role: "EMPLOYEE", employeeId: employee.id, username: employee.username, name: employee.name, exp: Date.now() + 1000 * 60 * 60 * 24 });
    return res.json({ ok: true, token, user: { role: "EMPLOYEE", employeeId: employee.id, username: employee.username, name: employee.name } });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ ok: true, user: req.auth });
});

app.get("/api/products", async (req, res) => {
  if (!supabase) return res.json([]);
  const { data } = await supabase.from("products").select("*").order("created_at", { ascending: false });
  res.json(data || []);
});

app.post("/api/products", async (req, res) => {
  try {
    if (!supabase) throw new Error("Supabase unavailable");
    const body = req.body || {};
    const row = {
      name: firstDefined(body.name, body.productName, body.title),
      category: firstDefined(body.category, body.productCategory),
      buy_price: numberValue(firstDefined(body.buyPrice, body.buy_price), 0),
      sell_price: numberValue(firstDefined(body.sellPrice, body.sell_price), 0),
      stock: numberValue(body.stock, 0),
      photo_url: firstDefined(body.photoUrl, body.photo_url, body.photo)
    };
    if (body.description !== undefined) row.description = body.description || null;
    const { data, error } = await supabase.from("products").insert(row).select("*").single();
    if (error) throw error;
    res.json({ ok: true, product: data });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.patch("/api/products/:id", async (req, res) => {
  try {
    if (!supabase) throw new Error("Supabase unavailable");
    const body = req.body || {};
    const row = {};
    if (body.name !== undefined) row.name = firstDefined(body.name, body.productName, body.title);
    if (body.category !== undefined) row.category = firstDefined(body.category, body.productCategory);
    if (body.buyPrice !== undefined) row.buy_price = numberValue(firstDefined(body.buyPrice, body.buy_price), 0);
    if (body.sellPrice !== undefined) row.sell_price = numberValue(firstDefined(body.sellPrice, body.sell_price), 0);
    if (body.stock !== undefined) row.stock = numberValue(body.stock, 0);
    if (body.photoUrl !== undefined) row.photo_url = firstDefined(body.photoUrl, body.photo_url, body.photo);
    if (body.description !== undefined) row.description = body.description || null;
    const { data, error } = await supabase.from("products").update(row).eq("id", req.params.id).select("*").single();
    if (error) throw error;
    res.json({ ok: true, product: data });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/products/:id", async (req, res) => {
  if (supabase) await supabase.from("products").delete().eq("id", req.params.id);
  res.json({ ok: true });
});

app.post("/api/upload", upload.single("photo"), async (req, res) => {
  const fallback = "https://images.unsplash.com/photo-1523275335684-37898b6baf30";
  if (!supabase || !req.file) return res.json({ ok: true, url: fallback });
  const ext = path.extname(req.file.originalname || "").toLowerCase() || ".jpg";
  const filePath = `products/${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(filePath, req.file.buffer, {
    contentType: req.file.mimetype || "image/jpeg",
    upsert: false
  });
  if (error) return res.json({ ok: true, url: fallback });
  const publicUrl = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath)?.data?.publicUrl || fallback;
  res.json({ ok: true, url: publicUrl, path: filePath });
});

app.get("/api/orders", async (req, res) => {
  if (!supabase) return res.json([]);
  const { data } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
  res.json(data || []);
});

app.patch("/api/orders/:id/status", async (req, res) => {
  try {
    const status = safeString(req.body?.status || req.body?.newStatus).toUpperCase();
    if (!status) return res.status(400).json({ ok: false, error: "Status required" });

    const { data, error } = await supabase.from("orders").update({ status }).eq("id", req.params.id).select("*").single();
    if (error) throw error;

    const customerChatId = firstDefined(data.telegram_chat_id, data.customer_id);
    if (status === "CONFIRMED" && customerChatId) {
      try {
        await sendMessage(customerChatId, "✅ ክፍያዎ ተረጋግጧል!\n\n📦 እቃዎ በማድረስ ሂደት ላይ ነው።", {
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: [[{ text: "📦 ደርሶኛል", callback_data: `order_received_${data.id}` }]] }
        });
      } catch {}
    }

    res.json({ ok: true, order: data });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/payment-settings", async (req, res) => {
  res.json(await getPaymentSettings());
});

app.post("/api/payment-settings", async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase unavailable" });
  const existing = await getPaymentSettings();
  let data, error;
  if (existing?.id) {
    ({ data, error } = await supabase.from("payment_settings").update(req.body || {}).eq("id", existing.id).select("*").single());
  } else {
    ({ data, error } = await supabase.from("payment_settings").insert(req.body || {}).select("*").single());
  }
  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true, settings: data });
});

app.get("/api/telegram-settings", async (req, res) => {
  res.json(await getTelegramSettings());
});

app.post("/api/telegram-settings", async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, error: "Supabase unavailable" });
  const existing = await getTelegramSettings();
  let data, error;
  if (existing?.id) {
    ({ data, error } = await supabase.from("telegram_settings").update(req.body || {}).eq("id", existing.id).select("*").single());
  } else {
    ({ data, error } = await supabase.from("telegram_settings").insert(req.body || {}).select("*").single());
  }
  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true, settings: data });
});

app.get("/api/telegram-channels", async (req, res) => {
  if (!supabase) return res.json({ ok: true, channels: [] });
  const { data } = await supabase.from("telegram_channels").select("*").order("created_at", { ascending: false });
  res.json({ ok: true, channels: data || [] });
});

app.post("/api/telegram-channels", async (req, res) => {
  try {
    if (!supabase) throw new Error("Supabase unavailable");
    const body = req.body || {};
    const chatId = safeString(firstDefined(body.chat_id, body.chatId));
    const chat = await verifyTelegramChat(chatId);
    const row = {
      name: body.name || chat.title || `@${chat.username}`,
      chat_id: String(chat.id),
      username: chat.username ? `@${chat.username}` : null,
      type: chat.type || null,
      is_active: true
    };
    const { data, error } = await supabase.from("telegram_channels").insert(row).select("*").single();
    if (error) throw error;
    res.json({ ok: true, channel: data });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.delete("/api/telegram-channels/:id", async (req, res) => {
  if (supabase) await supabase.from("telegram_channels").delete().eq("id", req.params.id);
  res.json({ ok: true });
});

app.get("/api/advertisements", async (req, res) => {
  if (!supabase) return res.json([]);
  const { data } = await supabase.from("advertisements").select("*").order("created_at", { ascending: false });
  res.json(data || []);
});

app.post("/api/advertisements", async (req, res) => {
  if (!supabase) return res.json({ ok: true, advertisement: { id: Date.now() } });
  const body = req.body || {};
  const row = {
    title: body.title || null,
    text: body.text || body.advertisementText || null,
    button_text: body.buttonText || "Order Now",
    telegram_chat_id: body.telegramChatId || null,
    photo_url: firstDefined(body.photoUrl, body.photo),
    status: "DRAFT"
  };
  const { data } = await supabase.from("advertisements").insert(row).select("*").single();
  res.json({ ok: true, advertisement: data });
});

app.post("/api/advertisements/:id/publish", async (req, res) => {
  try {
    if (!supabase) throw new Error("Supabase unavailable");
    const { data: ad } = await supabase.from("advertisements").select("*").eq("id", req.params.id).maybeSingle();
    if (!ad) throw new Error("Ad not found");

    let chatId = safeString(ad.telegram_chat_id) || ADMIN_CHAT_ID;
    if (!chatId) throw new Error("Target Chat ID missing");

    const caption = `🔥 ${ad.title || "ማስታወቂያ"}\n\n${ad.text || ""}`;
    const replyMarkup = { inline_keyboard: [[{ text: ad.button_text || "Order Now", url: `https://t.me/${BOT_USERNAME}?start=catalog` }]] };

    if (ad.photo_url) {
      await sendPhotoFromUrl(chatId, ad.photo_url, caption, { reply_markup: replyMarkup });
    } else {
      await sendMessage(chatId, caption, { reply_markup: replyMarkup });
    }

    await supabase.from("advertisements").update({ status: "PUBLISHED" }).eq("id", req.params.id);
    res.json({ ok: true, message: "Published successfully" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/employees", async (req, res) => {
  if (!supabase) return res.json([]);
  const { data } = await supabase.from("employees").select("id, employee_code, name, username, role, active, created_at").order("created_at", { ascending: false });
  res.json(data || []);
});

app.post("/api/employees", async (req, res) => {
  try {
    if (!supabase) throw new Error("Supabase unavailable");
    const body = req.body || {};
    const passwordHash = await hashPassword(body.password || "123456");
    const { data, error } = await supabase.from("employees").insert({
      employee_code: body.employee_code || `EMP-${Math.floor(100 + Math.random() * 900)}`,
      name: body.name || "Worker",
      username: body.username || "worker",
      password_hash: passwordHash,
      role: body.role || "EMPLOYEE",
      active: true
    }).select("*").single();
    if (error) throw error;
    res.json({ ok: true, employee: data });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/employees/:id", async (req, res) => {
  if (supabase) await supabase.from("employees").delete().eq("id", req.params.id);
  res.json({ ok: true });
});

app.get("/api/reports", async (req, res) => {
  if (!supabase) return res.json({ ok: true, summary: {} });
  const { data: ordersData } = await supabase.from("orders").select("*");
  const ordersArr = Array.isArray(ordersData) ? ordersData : [];
  let totalSales = 0, totalProfit = 0, deliveredOrders = 0, pendingOrders = 0;
  ordersArr.forEach((o) => {
    const status = String(o.status || "").toUpperCase();
    if (status === "DELIVERED") {
      totalSales += Number(o.total || 0);
      totalProfit += Number(o.profit || 0);
      deliveredOrders++;
    } else if (status !== "REJECTED") {
      pendingOrders++;
    }
  });
  res.json({ ok: true, summary: { totalOrders: ordersArr.length, totalSales, totalProfit, deliveredOrders, pendingOrders } });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "Telegram Sales Manager", time: nowISO(), supabase: Boolean(supabase), telegram: Boolean(BOT_TOKEN) });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

/* =========================================================
START
========================================================= */

app.listen(PORT, () => {
  console.log(`Telegram Sales Manager running on port ${PORT}`);
  if (BOT_TOKEN) {
    startTelegramBot().catch((err) => console.error("Bot start error:", err));
  }
});
