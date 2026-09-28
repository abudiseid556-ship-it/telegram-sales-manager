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

/* =========================================================
   ENVIRONMENT
   ========================================================= */

const SUPABASE_URL =
  (process.env.SUPABASE_URL || "").trim();

const SUPABASE_SERVICE_ROLE_KEY =
  (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const BOT_TOKEN =
  (process.env.TELEGRAM_BOT_TOKEN || "").trim();

const BOT_USERNAME =
  (
    process.env.TELEGRAM_BOT_USERNAME ||
    "uni_market_shop_bot"
  )
    .replace(/^@/, "")
    .trim();

const ADMIN_CHAT_ID =
  String(process.env.ADMIN_CHAT_ID || "").trim();

const TELEGRAM_WEBHOOK_URL =
  (process.env.WEBHOOK_URL || "").trim();

const AUTH_SECRET =
  process.env.AUTH_SECRET ||
  crypto.randomBytes(32).toString("hex");

const MASTER_ADMIN_USERNAME =
  process.env.MASTER_ADMIN_USERNAME || "admin";

const MASTER_ADMIN_PASSWORD =
  process.env.MASTER_ADMIN_PASS ||
  process.env.MASTER_ADMIN_PASSWORD ||
  "123456";

const STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET ||
  "product-images";

let supabase = null;

if (
  SUPABASE_URL &&
  SUPABASE_SERVICE_ROLE_KEY
) {
  supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );
}

/* =========================================================
   UPLOAD
   ========================================================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (
      !file.mimetype ||
      !file.mimetype.startsWith("image/")
    ) {
      return cb(
        new Error("Only image files are allowed")
      );
    }

    cb(null, true);
  }
});

/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function nowISO() {
  return new Date().toISOString();
}

function safeString(value) {
  return value === undefined ||
    value === null
    ? ""
    : String(value).trim();
}

function firstDefined(...values) {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return null;
}

function numberValue(value, fallback = 0) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function escapeHtml(value) {
  return safeString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isSchemaColumnError(error) {
  return /column|schema cache|schema|does not exist/i.test(
    safeString(error?.message)
  );
}

/* =========================================================
   AUTH
   ========================================================= */

function createAuthToken(payload) {
  const encodedPayload =
    base64url(
      Buffer.from(
        JSON.stringify(payload)
      )
    );

  const signature =
    base64url(
      crypto
        .createHmac(
          "sha256",
          AUTH_SECRET
        )
        .update(encodedPayload)
        .digest()
    );

  return (
    encodedPayload +
    "." +
    signature
  );
}

function verifyAuthToken(token) {
  if (
    !token ||
    typeof token !== "string"
  ) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const encodedPayload = parts[0];
  const signature = parts[1];

  const expected =
    base64url(
      crypto
        .createHmac(
          "sha256",
          AUTH_SECRET
        )
        .update(encodedPayload)
        .digest()
    );

  if (
    signature.length !==
    expected.length
  ) {
    return null;
  }

  try {
    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      )
    ) {
      return null;
    }

    const payload =
      JSON.parse(
        Buffer.from(
          encodedPayload,
          "base64url"
        ).toString("utf8")
      );

    if (
      payload.exp &&
      Date.now() > payload.exp
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function getAuth(req, res, next) {
  const header =
    req.headers.authorization || "";

  if (
    !header.startsWith("Bearer ")
  ) {
    req.auth = null;
    return next();
  }

  const token =
    header
      .slice(7)
      .trim();

  req.auth =
    verifyAuthToken(token);

  next();
}

/* =========================================================
   PASSWORD
   ========================================================= */

function hashPassword(password) {
  return new Promise(
    (resolve, reject) => {
      const salt =
        crypto
          .randomBytes(16)
          .toString("hex");

      crypto.scrypt(
        String(password),
        salt,
        64,
        (err, derivedKey) => {
          if (err) {
            return reject(err);
          }

          resolve(
            "scrypt:" +
            salt +
            ":" +
            derivedKey.toString("hex")
          );
        }
      );
    }
  );
}

function verifyPassword(
  password,
  stored
) {
  return new Promise(
    (resolve) => {
      if (
        !stored ||
        !stored.startsWith("scrypt:")
      ) {
        return resolve(false);
      }

      const parts =
        stored.split(":");

      if (parts.length !== 3) {
        return resolve(false);
      }

      const salt = parts[1];

      const storedHash =
        Buffer.from(
          parts[2],
          "hex"
        );

      crypto.scrypt(
        String(password),
        salt,
        storedHash.length,
        (err, derivedKey) => {
          if (err) {
            return resolve(false);
          }

          try {
            resolve(
              crypto.timingSafeEqual(
                storedHash,
                derivedKey
              )
            );
          } catch {
            resolve(false);
          }
        }
      );
    }
  );
}

/* =========================================================
   TELEGRAM
   ========================================================= */

async function telegram(
  method,
  body = {}
) {
  if (!BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is missing"
    );
  }

  const response =
    await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify(body)
      }
    );

  let data;

  try {
    data =
      await response.json();
  } catch {
    throw new Error(
      `Telegram ${method}: Invalid response`
    );
  }

  if (!data.ok) {
    throw new Error(
      `Telegram ${method}: ${
        data.description ||
        "API error"
      }`
    );
  }

  return data.result;
}

async function sendMessage(
  chatId,
  text,
  extra = {}
) {
  return telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text,
      ...extra
    }
  );
}

/*
 * Verify that Telegram can resolve the target chat.
 * This catches "chat not found" before Publish tries
 * to send the advertisement.
 */
async function verifyTelegramChat(chatId) {
  const id =
    safeString(chatId);

  if (!id) {
    throw new Error(
      "Telegram Chat ID missing"
    );
  }

  try {
    return await telegram(
      "getChat",
      {
        chat_id: id
      }
    );
  } catch (err) {
    throw new Error(
      `Telegram Chat ID "${id}" አልተገኘም። ` +
      `Bot ወደ Group/Channel መጨመሩን እና Chat ID ትክክል መሆኑን ያረጋግጡ። ` +
      `Original: ${err.message}`
    );
  }
}

/* =========================================================
   DATABASE HELPERS
   ========================================================= */

async function getProduct(
  productId
) {
  if (!supabase) {
    return null;
  }

  const {
    data,
    error
  } =
    await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .maybeSingle();

  if (error) {
    console.error(
      "GET PRODUCT ERROR:",
      error.message
    );
    return null;
  }

  return data || null;
}

async function getOrderById(
  orderId
) {
  if (!supabase) {
    return null;
  }

  const {
    data,
    error
  } =
    await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();

  if (error) {
    console.error(
      "GET ORDER ERROR:",
      error.message
    );
    return null;
  }

  return data || null;
}

async function getPaymentSettings() {
  if (!supabase) {
    return {};
  }

  try {
    const {
      data,
      error
    } =
      await supabase
        .from("payment_settings")
        .select("*")
        .limit(1)
        .maybeSingle();

    if (error) {
      return {};
    }

    return data || {};
  } catch {
    return {};
  }
}

async function getTelegramSettings() {
  if (!supabase) {
    return {};
  }

  try {
    const {
      data,
      error
    } =
      await supabase
        .from("telegram_settings")
        .select("*")
        .limit(1)
        .maybeSingle();

    if (error) {
      return {};
    }

    return data || {};
  } catch {
    return {};
  }
}

/* =========================================================
   PRODUCT HELPERS
   ========================================================= */

function productName(product) {
  return firstDefined(
    product?.name,
    product?.product_name,
    product?.title,
    "Product"
  );
}

function productBuyPrice(product) {
  return numberValue(
    firstDefined(
      product?.buy_price,
      product?.buyPrice
    ),
    0
  );
}

function productSellPrice(product) {
  return numberValue(
    firstDefined(
      product?.sell_price,
      product?.sellPrice,
      product?.price
    ),
    0
  );
}

function productStock(product) {
  return numberValue(
    firstDefined(
      product?.stock,
      product?.quantity
    ),
    0
  );
}

function normalizeCategory(value) {
  return safeString(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\s+/g, "_");
}

function getProductCategory(
  product
) {
  return normalizeCategory(
    firstDefined(
      product?.category,
      product?.category_name,
      product?.product_category,
      product?.type,
      "others"
    )
  );
}

/* =========================================================
   BOT CATEGORIES
   ========================================================= */

const BOT_CATEGORIES = [
  {
    id: "clothes",
    name: "👕 አልባሳት"
  },
  {
    id: "electronics",
    name: "📱 ኤሌክትሮኒክስ"
  },
  {
    id: "children",
    name: "🧒 የህፃናት"
  },
  {
    id: "women",
    name: "👩 የሴቶች"
  },
  {
    id: "furniture",
    name: "🛋️ የቤት እቃዎች"
  },
  {
    id: "others",
    name: "📦 ሌሎች"
  }
];

function categoryKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "👕 አልባሳት",
          callback_data:
            "category_clothes"
        },
        {
          text: "📱 ኤሌክትሮኒክስ",
          callback_data:
            "category_electronics"
        }
      ],
      [
        {
          text: "🧒 የህፃናት",
          callback_data:
            "category_children"
        },
        {
          text: "👩 የሴቶች",
          callback_data:
            "category_women"
        }
      ],
      [
        {
          text: "🛋️ የቤት እቃዎች",
          callback_data:
            "category_furniture"
        },
        {
          text: "📦 ሌሎች",
          callback_data:
            "category_others"
        }
      ]
    ]
  };
}

async function sendCategoryDashboard(
  chatId
) {
  return sendMessage(
    chatId,
    `🛍️ <b>UNI MARKET</b>\n\n` +
    `የሚፈልጉትን የምርት ምድብ ይምረጡ፦`,
    {
      parse_mode: "HTML",
      reply_markup:
        categoryKeyboard()
    }
  );
}

/* =========================================================
   CATEGORY MATCHING
   ========================================================= */

function categoryMatches(
  product,
  category
) {
  const actual =
    getProductCategory(product);

  const wanted =
    normalizeCategory(category);

  if (wanted === "others") {
    return ![
      "clothes",
      "clothing",
      "cloth",
      "electronics",
      "electronic",
      "children",
      "childrens",
      "kids",
      "women",
      "womens",
      "woman",
      "furniture"
    ].includes(actual);
  }

  const aliases = {
    clothes: [
      "clothes",
      "clothing",
      "cloth"
    ],

    electronics: [
      "electronics",
      "electronic"
    ],

    children: [
      "children",
      "childrens",
      "kids",
      "children_products"
    ],

    women: [
      "women",
      "womens",
      "woman"
    ],

    furniture: [
      "furniture"
    ]
  };

  return (
    aliases[wanted] ||
    [wanted]
  ).includes(actual);
}

async function getBotProducts(
  category
) {
  if (!supabase) {
    return [];
  }

  try {
    const {
      data,
      error
    } =
      await supabase
        .from("products")
        .select("*")
        .order(
          "created_at",
          {
            ascending: false
          }
        );

    if (error) {
      console.error(
        "BOT PRODUCTS ERROR:",
        error.message
      );

      return [];
    }

    return (data || [])
      .filter(
        product =>
          categoryMatches(
            product,
            category
          )
      );

  } catch (err) {
    console.error(
      "BOT PRODUCTS ERROR:",
      err.message
    );

    return [];
  }
}

/* =========================================================
   BOT PRODUCT DISPLAY
   ========================================================= */

function productKeyboard(
  products
) {
  return {
    inline_keyboard:
      products.map(
        product => [
          {
            text:
              `🛍️ ${productName(product)}`,
            callback_data:
              `product_${product.id}`
          }
        ]
      )
  };
}

async function showCategoryProducts(
  chatId,
  category
) {
  const products =
    await getBotProducts(
      category
    );

  const categoryName =
    BOT_CATEGORIES.find(
      item =>
        item.id === category
    )?.name ||
    "📦 ምርቶች";

  if (!products.length) {
    return sendMessage(
      chatId,
      `${categoryName}\n\n` +
      `❌ በዚህ ዘርፍ ላይ አሁን ምንም ምርት የለም።\n\n` +
      `👇 ሌላ ዘርፍ ይምረጡ።`,
      {
        reply_markup:
          categoryKeyboard()
      }
    );
  }

  return sendMessage(
    chatId,
    `${categoryName}\n\n` +
    `🛍️ የሚገኙ ምርቶች፦`,
    {
      reply_markup:
        productKeyboard(products)
    }
  );
}

async function showBotProduct(
  chatId,
  productId
) {
  const product =
    await getProduct(productId);

  if (!product) {
    return sendMessage(
      chatId,
      "❌ ምርቱ አልተገኘም።"
    );
  }

  const name =
    productName(product);

  const price =
    productSellPrice(product);

  const stock =
    productStock(product);

  const photo =
    firstDefined(
      product.photo_url,
      product.photo,
      product.image_url
    );

  const text =
    `🛍️ <b>${escapeHtml(name)}</b>\n\n` +
    `💰 ዋጋ፦ <b>${price.toLocaleString()} ETB</b>\n` +
    `📦 Stock፦ <b>${stock}</b>\n\n` +
    (
      stock > 0
        ? "🟢 አለ"
        : "🔴 ከStock ውጭ"
    );

  const replyMarkup = {
    inline_keyboard: [
      ...(stock > 0
        ? [
            [
              {
                text:
                  "🛒 አሁን እዘዝ",
                callback_data:
                  `order_${product.id}`
              }
            ]
          ]
        : []),
      [
        {
          text:
            "⬅️ ምድቦች",
          callback_data:
            "show_categories"
        }
      ]
    ]
  };

  if (photo) {
    try {
      return await telegram(
        "sendPhoto",
        {
          chat_id: chatId,
          photo,
          caption: text,
          parse_mode: "HTML",
          reply_markup:
            replyMarkup
        }
      );
    } catch (err) {
      console.error(
        "SEND PRODUCT PHOTO ERROR:",
        err.message
      );
    }
  }

  return sendMessage(
    chatId,
    text,
    {
      parse_mode: "HTML",
      reply_markup:
        replyMarkup
    }
  );
}

/* =========================================================
   BOT ORDER SESSION
   ========================================================= */

const botOrderSessions =
  new Map();

function getBotSession(
  chatId
) {
  return botOrderSessions.get(
    String(chatId)
  );
}

function setBotSession(
  chatId,
  session
) {
  botOrderSessions.set(
    String(chatId),
    session
  );
}

function clearBotSession(
  chatId
) {
  botOrderSessions.delete(
    String(chatId)
  );
}

async function startBotOrder(
  chatId,
  productId
) {
  const product =
    await getProduct(productId);

  if (!product) {
    return sendMessage(
      chatId,
      "❌ ምርቱ አልተገኘም።"
    );
  }

  if (
    productStock(product) <= 0
  ) {
    return sendMessage(
      chatId,
      "❌ ይህ ምርት አሁን ከStock ውጭ ነው።"
    );
  }

  setBotSession(
    chatId,
    {
      step: "quantity",
      productId:
        product.id,
      productName:
        productName(product),
      unitPrice:
        productSellPrice(product),
      maxStock:
        productStock(product),
      quantity: 0,
      customerName: "",
      phone: "",
      address: ""
    }
  );

  return sendMessage(
    chatId,
    `🛒 <b>ኦርደር</b>\n\n` +
    `📦 ${escapeHtml(productName(product))}\n` +
    `💰 ${productSellPrice(product).toLocaleString()} ETB\n` +
    `📦 የሚገኘው Stock፦ ${productStock(product)}\n\n` +
    `🔢 እባክዎ የሚፈልጉትን ብዛት ያስገቡ።`,
    {
      parse_mode: "HTML"
    }
  );
}

async function showOrderSummary(
  chatId
) {
  const session =
    getBotSession(chatId);

  if (!session) {
    return sendCategoryDashboard(
      chatId
    );
  }

  const total =
    session.quantity *
    session.unitPrice;

  return sendMessage(
    chatId,
    `🧾 <b>የኦርደር ማጠቃለያ</b>\n\n` +
    `📦 ምርት፦ ${escapeHtml(session.productName)}\n` +
    `🔢 ብዛት፦ ${session.quantity}\n` +
    `💰 የአንዱ ዋጋ፦ ${session.unitPrice.toLocaleString()} ETB\n` +
    `💵 <b>ጠቅላላ፦ ${total.toLocaleString()} ETB</b>\n\n` +
    `👤 ስም፦ ${escapeHtml(session.customerName)}\n` +
    `📱 ስልክ፦ ${escapeHtml(session.phone)}\n` +
    `📍 አድራሻ፦ ${escapeHtml(session.address)}\n\n` +
    `ኦርደሩ ትክክል ከሆነ ከታች ያለውን ይምረጡ።`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                "✅ ኦርደሩን አረጋግጥ",
              callback_data:
                "order_confirm"
            }
          ],
          [
            {
              text:
                "✏️ መረጃ ቀይር",
              callback_data:
                "order_edit"
            },
            {
              text:
                "❌ ሰርዝ",
              callback_data:
                "order_cancel"
            }
          ]
        ]
      }
    }
  );
}

/* =========================================================
   CREATE ORDER
   IMPORTANT:
   Stock is NOT reduced here.
   Stock is reduced only when order becomes CONFIRMED.
   ========================================================= */

async function createBotOrder(
  chatId,
  session,
  message
) {
  if (!supabase) {
    throw new Error(
      "Supabase unavailable"
    );
  }

  const product =
    await getProduct(
      session.productId
    );

  if (!product) {
    throw new Error(
      "Product not found"
    );
  }

  const currentStock =
    productStock(product);

  if (
    session.quantity <= 0
  ) {
    throw new Error(
      "Invalid quantity"
    );
  }

  if (
    session.quantity >
    currentStock
  ) {
    throw new Error(
      `Stock በቂ አይደለም። የሚገኘው ${currentStock} ነው።`
    );
  }

  const unitPrice =
    productSellPrice(product);

  const total =
    session.quantity *
    unitPrice;

  const username =
    message?.from?.username
      ? "@" +
        message.from.username
      : "";

  const order = {
    id: crypto.randomUUID(),
    product_id:
      product.id,
    product_name:
      productName(product),
    quantity:
      session.quantity,
    unit_price:
      unitPrice,
    total:
      total,
    customer_name:
      session.customerName,
    phone:
      session.phone,
    address:
      session.address,
    telegram_chat_id:
      String(chatId),
    telegram_username:
      username,
    status:
      "NEW",
    payment_status:
      "PENDING"
  };

  let {
    data,
    error
  } =
    await supabase
      .from("orders")
      .insert(order)
      .select("*")
      .single();

  /*
   * Compatibility with an older orders table
   * where telegram_username does not yet exist.
   */
  if (
    error &&
    isSchemaColumnError(error) &&
    /telegram_username/i.test(
      error.message || ""
    )
  ) {
    const fallbackOrder = {
      ...order
    };

    delete fallbackOrder.telegram_username;

    ({
      data,
      error
    } =
      await supabase
        .from("orders")
        .insert(fallbackOrder)
        .select("*")
        .single());
  }

  if (error) {
    throw error;
  }

  /*
   * IMPORTANT:
   * Do NOT decrease product stock here.
   * Order is still NEW/PENDING.
   */
  return data;
}

/* =========================================================
   CALLBACK HANDLER
   ========================================================= */

async function handleBotCallback(
  callback
) {
  const callbackId =
    callback.id;

  const chatId =
    callback.message?.chat?.id;

  const data =
    safeString(callback.data);

  if (!chatId) {
    return;
  }

  try {
    await telegram(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackId
      }
    );
  } catch {}

  /* Categories */

  if (
    data ===
    "show_categories"
  ) {
    clearBotSession(chatId);

    return sendCategoryDashboard(
      chatId
    );
  }

  if (
    data.startsWith(
      "category_"
    )
  ) {
    clearBotSession(chatId);

    const category =
      data.replace(
        "category_",
        ""
      );

    return showCategoryProducts(
      chatId,
      category
    );
  }

  /* Product */

  if (
    data.startsWith(
      "product_"
    )
  ) {
    const productId =
      data.replace(
        "product_",
        ""
      );

    return showBotProduct(
      chatId,
      productId
    );
  }

  /* Start order */

  if (
    data.startsWith(
      "order_"
    ) &&
    ![
      "order_confirm",
      "order_cancel",
      "order_edit"
    ].includes(data)
  ) {
    const productId =
      data.replace(
        "order_",
        ""
      );

    return startBotOrder(
      chatId,
      productId
    );
  }

  /* Confirm */

  if (
    data ===
    "order_confirm"
  ) {
    const session =
      getBotSession(chatId);

    if (!session) {
      return sendMessage(
        chatId,
        "❌ የኦርደር መረጃው ጊዜው አልፎበታል። እባክዎ እንደገና ይምረጡ።"
      );
    }

    try {
      const order =
        await createBotOrder(
          chatId,
          session,
          callback.message
        );

      clearBotSession(chatId);

      const total =
        numberValue(
          order?.total,
          session.quantity *
            session.unitPrice
        );

      await sendMessage(
        chatId,
        `✅ <b>ኦርደርዎ ተመዝግቧል!</b>\n\n` +
        `🆔 Order ID፦ <code>${escapeHtml(order.id)}</code>\n` +
        `📦 ${escapeHtml(session.productName)}\n` +
        `🔢 ብዛት፦ ${session.quantity}\n` +
        `💰 ጠቅላላ፦ ${total.toLocaleString()} ETB\n\n` +
        `⏳ የክፍያ/ማረጋገጫ ሂደት በመቀጠል ይገለጽልዎታል።`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text:
                    "🛍️ ሌላ ምርት ይግዙ",
                  callback_data:
                    "show_categories"
                }
              ]
            ]
          }
        }
      );

      if (ADMIN_CHAT_ID) {
        try {
          await sendMessage(
            ADMIN_CHAT_ID,
            `🔔 <b>አዲስ ኦርደር</b>\n\n` +
            `🆔 ${escapeHtml(order.id)}\n` +
            `📦 ${escapeHtml(session.productName)}\n` +
            `🔢 ${session.quantity}\n` +
            `💰 ${total.toLocaleString()} ETB\n` +
            `👤 ${escapeHtml(session.customerName)}\n` +
            `📱 ${escapeHtml(session.phone)}\n` +
            `📍 ${escapeHtml(session.address)}\n` +
            `👤 Telegram፦ ${escapeHtml(order.telegram_username || "—")}`,
            {
              parse_mode: "HTML"
            }
          );
        } catch (adminErr) {
          console.error(
            "ADMIN TELEGRAM NOTIFICATION ERROR:",
            adminErr.message
          );
        }
      }

    } catch (err) {
      console.error(
        "CREATE BOT ORDER ERROR:",
        err.message
      );

      return sendMessage(
        chatId,
        `❌ ኦርደሩ ሊመዘገብ አልቻለም።\n\n${escapeHtml(err.message)}`,
        {
          parse_mode: "HTML"
        }
      );
    }

    return;
  }

  /* Edit */

  if (
    data ===
    "order_edit"
  ) {
    const session =
      getBotSession(chatId);

    if (!session) {
      return sendCategoryDashboard(
        chatId
      );
    }

    session.step =
      "name";

    setBotSession(
      chatId,
      session
    );

    return sendMessage(
      chatId,
      "✏️ እባክዎ ሙሉ ስምዎን እንደገና ይላኩ።"
    );
  }

  /* Cancel */

  if (
    data ===
    "order_cancel"
  ) {
    clearBotSession(chatId);

    return sendMessage(
      chatId,
      "❌ ኦርደሩ ተሰርዟል።",
      {
        reply_markup:
          categoryKeyboard()
      }
    );
  }
}

/* =========================================================
   BOT TEXT MESSAGES
   ========================================================= */

async function handleBotMessage(
  message
) {
  const chatId =
    message.chat?.id;

  if (!chatId) {
    return;
  }

  const text =
    safeString(message.text);

  /* /start + deep link */

  if (
    text === "/start" ||
    text.startsWith("/start ")
  ) {
    clearBotSession(chatId);

    const parts =
      text.split(/\s+/);

    const payload =
      parts[1] || "";

    /*
     * Advertisement deep-link:
     * https://t.me/BOT?start=product_PRODUCT_ID
     */
    if (
      payload.startsWith(
        "product_"
      )
    ) {
      const productId =
        payload.slice(
          "product_".length
        );

      return showBotProduct(
        chatId,
        productId
      );
    }

    if (
      payload === "catalog"
    ) {
      return sendCategoryDashboard(
        chatId
      );
    }

    return sendCategoryDashboard(
      chatId
    );
  }

  /* Menu */

  if (
    text === "/menu" ||
    text === "/categories" ||
    text === "Menu" ||
    text === "Categories"
  ) {
    clearBotSession(chatId);

    return sendCategoryDashboard(
      chatId
    );
  }

  /* Existing order session */

  const session =
    getBotSession(chatId);

  if (session) {

    if (
      session.step ===
      "quantity"
    ) {
      const quantity =
        Number(
          text.replace(
            /,/g,
            ""
          )
        );

      if (
        !Number.isInteger(
          quantity
        ) ||
        quantity <= 0
      ) {
        return sendMessage(
          chatId,
          "❌ እባክዎ ትክክለኛ ብዛት ያስገቡ። ለምሳሌ፦ 2"
        );
      }

      if (
        quantity >
        session.maxStock
      ) {
        return sendMessage(
          chatId,
          `❌ በቂ Stock የለም። የሚገኘው ${session.maxStock} ነው።`
        );
      }

      session.quantity =
        quantity;

      session.step =
        "name";

      setBotSession(
        chatId,
        session
      );

      return sendMessage(
        chatId,
        "👤 እባክዎ ሙሉ ስምዎን ይላኩ።"
      );
    }

    if (
      session.step ===
      "name"
    ) {
      if (
        text.length < 2
      ) {
        return sendMessage(
          chatId,
          "❌ እባክዎ ሙሉ ስምዎን ያስገቡ።"
        );
      }

      session.customerName =
        text;

      session.step =
        "phone";

      setBotSession(
        chatId,
        session
      );

      return sendMessage(
        chatId,
        "📱 እባክዎ ስልክ ቁጥርዎን ይላኩ።"
      );
    }

    if (
      session.step ===
      "phone"
    ) {
      if (
        text.length < 7
      ) {
        return sendMessage(
          chatId,
          "❌ እባክዎ ትክክለኛ ስልክ ቁጥር ያስገቡ።"
        );
      }

      session.phone =
        text;

      session.step =
        "address";

      setBotSession(
        chatId,
        session
      );

      return sendMessage(
        chatId,
        "📍 እባክዎ የመድረሻ አድራሻዎን ይላኩ።"
      );
    }

    if (
      session.step ===
      "address"
    ) {
      if (
        text.length < 2
      ) {
        return sendMessage(
          chatId,
          "❌ እባክዎ አድራሻ ያስገቡ።"
        );
      }

      session.address =
        text;

      session.step =
        "confirm";

      setBotSession(
        chatId,
        session
      );

      return showOrderSummary(
        chatId
      );
    }

    if (
      session.step ===
      "confirm"
    ) {
      return sendMessage(
        chatId,
        "👇 እባክዎ ከታች ያለውን የኦርደር ማረጋገጫ ይጠቀሙ።",
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text:
                    "✅ አረጋግጥ",
                  callback_data:
                    "order_confirm"
                }
              ],
              [
                {
                  text:
                    "✏️ ቀይር",
                  callback_data:
                    "order_edit"
                },
                {
                  text:
                    "❌ ሰርዝ",
                  callback_data:
                    "order_cancel"
                }
              ]
            ]
          }
        }
      );
    }
  }

  /* Normal message */

  return sendMessage(
    chatId,
    `🛍️ <b>UNI MARKET</b>\n\n` +
    `እባክዎ ከታች ያለውን የምርት ዘርፍ ይምረጡ።`,
    {
      parse_mode: "HTML",
      reply_markup:
        categoryKeyboard()
    }
  );
}

/* =========================================================
   TELEGRAM UPDATE
   ========================================================= */

async function processTelegramUpdate(
  update
) {
  try {
    if (
      update.callback_query
    ) {
      await handleBotCallback(
        update.callback_query
      );

      return;
    }

    if (
      update.message
    ) {
      await handleBotMessage(
        update.message
      );

      return;
    }
  } catch (err) {
    console.error(
      "TELEGRAM UPDATE ERROR:",
      err.message
    );
  }
}

/* =========================================================
   AUTH API
   ========================================================= */

app.post(
  "/api/auth/login",
  async (req, res) => {
    try {
      const username =
        safeString(
          req.body?.username
        );

      const password =
        safeString(
          req.body?.password
        );

      if (
        !username ||
        !password
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Username and password required"
        });
      }

      /* MASTER ADMIN */

      if (
        username ===
          MASTER_ADMIN_USERNAME &&
        password ===
          MASTER_ADMIN_PASSWORD
      ) {
        const token =
          createAuthToken({
            role:
              "MASTER_ADMIN",
            username,
            name:
              "Master Admin",
            permissions:
              ["*"],
            exp:
              Date.now() +
              1000 *
                60 *
                60 *
                24 *
                7
          });

        return res.json({
          ok: true,
          token,
          user: {
            role:
              "MASTER_ADMIN",
            username,
            name:
              "Master Admin",
            permissions:
              ["*"]
          }
        });
      }

      if (!supabase) {
        return res.status(500).json({
          ok: false,
          error:
            "Supabase unavailable"
        });
      }

      const {
        data: employee
      } =
        await supabase
          .from("employees")
          .select("*")
          .eq(
            "username",
            username
          )
          .maybeSingle();

      if (
        !employee ||
        employee.active === false ||
        employee.is_active === false
      ) {
        return res.status(401).json({
          ok: false,
          error:
            "Invalid credentials"
        });
      }

      const valid =
        await verifyPassword(
          password,
          employee.password_hash
        );

      if (!valid) {
        return res.status(401).json({
          ok: false,
          error:
            "Invalid credentials"
        });
      }

      try {
        await supabase
          .from("employees")
          .update({
            last_login_at:
              nowISO()
          })
          .eq(
            "id",
            employee.id
          );
      } catch {}

      let permissions = [];

      try {
        const {
          data: permissionRows
        } =
          await supabase
            .from(
              "employee_permissions"
            )
            .select("*")
            .eq(
              "employee_id",
              employee.id
            );

        permissions =
          (permissionRows || [])
            .filter(
              row =>
                row.enabled !== false
            )
            .map(
              row =>
                row.permission ||
                row.permission_name
            )
            .filter(Boolean);
      } catch {}

      const token =
        createAuthToken({
          role:
            "EMPLOYEE",
          employeeId:
            employee.id,
          username:
            employee.username,
          name:
            employee.name,
          permissions,
          exp:
            Date.now() +
            1000 *
              60 *
              60 *
              24
        });

      return res.json({
        ok: true,
        token,
        user: {
          role:
            "EMPLOYEE",
          employeeId:
            employee.id,
          username:
            employee.username,
          name:
            employee.name,
          permissions
        }
      });

    } catch (err) {
      return res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

app.get(
  "/api/auth/me",
  getAuth,
  async (req, res) => {
    if (!req.auth) {
      return res.status(401).json({
        ok: false,
        error:
          "Unauthorized"
      });
    }

    res.json({
      ok: true,
      user:
        req.auth
    });
  }
);

/* =========================================================
   PRODUCTS API
   ========================================================= */

app.get(
  "/api/products",
  async (req, res) => {
    if (!supabase) {
      return res.status(500).json({
        ok: false,
        error:
          "Supabase unavailable"
      });
    }

    const {
      data,
      error
    } =
      await supabase
        .from("products")
        .select("*")
        .order(
          "created_at",
          {
            ascending: false
          }
        );

    if (error) {
      return res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }

    res.json(
      data || []
    );
  }
);

app.post(
  "/api/products",
  async (req, res) => {
    try {
      if (!supabase) {
        return res.status(500).json({
          ok: false,
          error:
            "Supabase unavailable"
        });
      }

      const body =
        req.body || {};

      const row = {
        id:
          crypto.randomUUID(),

        name:
          firstDefined(
            body.name,
            body.productName,
            body.title
          ),

        buy_price:
          numberValue(
            firstDefined(
              body.buyPrice,
              body.buy_price
            ),
            0
          ),

        sell_price:
          numberValue(
            firstDefined(
              body.sellPrice,
              body.sell_price
            ),
            0
          ),

        stock:
          numberValue(
            body.stock,
            0
          ),

        photo_url:
          firstDefined(
            body.photoUrl,
            body.photo_url,
            body.photo
          ),

        category:
          firstDefined(
            body.category,
            body.category_name,
            "others"
          )
      };

      const {
        data,
        error
      } =
        await supabase
          .from("products")
          .insert(row)
          .select("*")
          .single();

      if (error) {
        console.error(
          "PRODUCT CREATE ERROR:",
          error.message
        );

        return res.status(500).json({
          ok: false,
          error:
            error.message
        });
      }

      res.json({
        ok: true,
        product:
          data
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

app.patch(
  "/api/products/:id",
  async (req, res) => {
    try {
      if (!supabase) {
        return res.status(500).json({
          ok: false,
          error:
            "Supabase unavailable"
        });
      }

      const body =
        req.body || {};

      const update = {};

      if (
        body.name !== undefined
      ) {
        update.name =
          body.name;
      }

      if (
        body.buyPrice !== undefined ||
        body.buy_price !== undefined
      ) {
        update.buy_price =
          numberValue(
            firstDefined(
              body.buyPrice,
              body.buy_price
            ),
            0
          );
      }

      if (
        body.sellPrice !== undefined ||
        body.sell_price !== undefined
      ) {
        update.sell_price =
          numberValue(
            firstDefined(
              body.sellPrice,
              body.sell_price
            ),
            0
          );
      }

      if (
        body.stock !== undefined
      ) {
        update.stock =
          numberValue(
            body.stock,
            0
          );
      }

      if (
        body.photoUrl !== undefined ||
        body.photo_url !== undefined
      ) {
        update.photo_url =
          firstDefined(
            body.photoUrl,
            body.photo_url
          );
      }

      if (
        body.category !== undefined
      ) {
        update.category =
          body.category;
      }

      const {
        data,
        error
      } =
        await supabase
          .from("products")
          .update(update)
          .eq(
            "id",
            req.params.id
          )
          .select("*")
          .single();

      if (error) {
        throw error;
      }

      res.json({
        ok: true,
        product:
          data
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

app.delete(
  "/api/products/:id",
  async (req, res) => {
    try {
      if (!supabase) {
        return res.status(500).json({
          ok: false,
          error:
            "Supabase unavailable"
        });
      }

      const {
        error
      } =
        await supabase
          .from("products")
          .delete()
          .eq(
            "id",
            req.params.id
          );

      if (error) {
        throw error;
      }

      res.json({
        ok: true
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

/* =========================================================
   SINGLE UPLOAD API
   ========================================================= */

app.post(
  "/api/upload",
  upload.single("photo"),
  async (req, res) => {
    try {
      if (!supabase) {
        return res.status(500).json({
          ok: false,
          error:
            "Supabase unavailable"
        });
      }

      if (!req.file) {
        return res.status(400).json({
          ok: false,
          error:
            "ፎቶ አልተመረጠም"
        });
      }

      const context =
        safeString(
          req.body?.context
        ) || "products";

      const folder =
        context === "ads"
          ? "ads"
          : "products";

      const ext =
        path.extname(
          req.file.originalname ||
            ""
        ).toLowerCase() ||
        ".jpg";

      const filePath =
        `${folder}/${Date.now()}-${crypto
          .randomBytes(8)
          .toString("hex")}${ext}`;

      const {
        error
      } =
        await supabase.storage
          .from(
            STORAGE_BUCKET
          )
          .upload(
            filePath,
            req.file.buffer,
            {
              contentType:
                req.file.mimetype ||
                "image/jpeg",
              upsert:
                false
            }
          );

      if (error) {
        return res.status(500).json({
          ok: false,
          error:
            "ፎቶው ወደ Storage መጫን አልተቻለም: " +
            error.message
        });
      }

      const publicUrl =
        supabase.storage
          .from(
            STORAGE_BUCKET
          )
          .getPublicUrl(
            filePath
          )?.data?.publicUrl;

      if (!publicUrl) {
        return res.status(500).json({
          ok: false,
          error:
            "የፎቶ URL መፍጠር አልተቻለም"
        });
      }

      res.json({
        ok: true,
        url:
          publicUrl
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

/* =========================================================
   PAYMENT SETTINGS
   ========================================================= */

app.get(
  "/api/payment-settings",
  async (req, res) => {
    res.json(
      await getPaymentSettings()
    );
  }
);

app.post(
  "/api/payment-settings",
  async (req, res) => {
    try {
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const existing =
        await getPaymentSettings();

      let data;
      let error;

      if (existing?.id) {
        ({
          data,
          error
        } =
          await supabase
            .from(
              "payment_settings"
            )
            .update(
              req.body || {}
            )
            .eq(
              "id",
              existing.id
            )
            .select("*")
            .single());
      } else {
        ({
          data,
          error
        } =
          await supabase
            .from(
              "payment_settings"
            )
            .insert(
              req.body || {}
            )
            .select("*")
            .single());
      }

      if (error) {
        throw error;
      }

      res.json({
        ok: true,
        settings:
          data
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

/* =========================================================
   TELEGRAM SETTINGS
   ========================================================= */

app.get(
  "/api/telegram-settings",
  async (req, res) => {
    res.json(
      await getTelegramSettings()
    );
  }
);

app.post(
  "/api/telegram-settings",
  async (req, res) => {
    try {
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const body =
        req.body || {};

      /*
       * Keep the existing frontend-compatible fields.
       * Unknown fields such as webhook_url are retried
       * without them if the current table does not have
       * the column.
       */
      const payload = {
        ...body
      };

      const existing =
        await getTelegramSettings();

      let data;
      let error;

      if (existing?.id) {
        ({
          data,
          error
        } =
          await supabase
            .from(
              "telegram_settings"
            )
            .update(payload)
            .eq(
              "id",
              existing.id
            )
            .select("*")
            .single());
      } else {
        ({
          data,
          error
        } =
          await supabase
            .from(
              "telegram_settings"
            )
            .insert(payload)
            .select("*")
            .single());
      }

      /*
       * Compatibility fallback for tables that do not
       * contain webhook_url or another newly added field.
       */
      if (
        error &&
        isSchemaColumnError(error)
      ) {
        const fallback =
          {
            ...payload
          };

        delete fallback.webhook_url;

        if (existing?.id) {
          ({
            data,
            error
          } =
            await supabase
              .from(
                "telegram_settings"
              )
              .update(fallback)
              .eq(
                "id",
                existing.id
              )
              .select("*")
              .single());
        } else {
          ({
            data,
            error
          } =
            await supabase
              .from(
                "telegram_settings"
              )
              .insert(fallback)
              .select("*")
              .single());
        }
      }

      if (error) {
        throw error;
      }

      res.json({
        ok: true,
        settings:
          data
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

/* =========================================================
   TELEGRAM CHAT CHECK
   ========================================================= */

app.get(
  "/api/telegram/check-chat",
  async (req, res) => {
    try {
      const chatId =
        safeString(
          req.query?.chat_id
        );

      if (!chatId) {
        return res.status(400).json({
          ok: false,
          error:
            "Telegram Chat ID missing"
        });
      }

      const chat =
        await verifyTelegramChat(
          chatId
        );

      res.json({
        ok: true,
        valid:
          true,
        chat: {
          id:
            chat.id,
          type:
            chat.type,
          title:
            chat.title ||
            null,
          username:
            chat.username
              ? "@" +
                chat.username
              : null
        }
      });

    } catch (err) {
      res.status(400).json({
        ok: false,
        valid:
          false,
        error:
          err.message
      });
    }
  }
);

/* =========================================================
   ADVERTISEMENTS
   ========================================================= */

app.get(
  "/api/advertisements",
  async (req, res) => {
    try {
      if (!supabase) {
        return res.json([]);
      }

      const {
        data,
        error
      } =
        await supabase
          .from(
            "advertisements"
          )
          .select("*")
          .order(
            "created_at",
            {
              ascending: false
            }
          );

      if (error) {
        console.error(
          "ADVERTISEMENT LIST ERROR:",
          error.message
        );

        return res.json([]);
      }

      res.json(
        data || []
      );

    } catch {
      res.json([]);
    }
  }
);

app.post(
  "/api/advertisements",
  async (req, res) => {
    try {
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const body =
        req.body || {};

      const row = {
        product_id:
          firstDefined(
            body.product_id,
            body.productId
          ),

        title:
          body.title ||
          null,

        text:
          body.text ||
          body.advertisementText ||
          null,

        button_text:
          body.button_text ||
          body.buttonText ||
          "Order Now",

        telegram_chat_id:
          firstDefined(
            body.telegram_chat_id,
            body.telegramChatId,
            body.target_chat_id,
            body.targetChatId
          ),

        photo_url:
          firstDefined(
            body.photo_url,
            body.photoUrl,
            body.photo
          ),

        ad_type:
          firstDefined(
            body.ad_type,
            body.adType,
            "normal"
          ),

        status:
          "DRAFT"
      };

      let {
        data,
        error
      } =
        await supabase
          .from(
            "advertisements"
          )
          .insert(row)
          .select("*")
          .single();

      /*
       * Compatibility fallback for older
       * advertisements table.
       */
      if (
        error &&
        isSchemaColumnError(error)
      ) {
        const oldRow = {
          title:
            row.title,
          text:
            row.text,
          button_text:
            row.button_text,
          photo_url:
            row.photo_url,
          status:
            "DRAFT"
        };

        ({
          data,
          error
        } =
          await supabase
            .from(
              "advertisements"
            )
            .insert(oldRow)
            .select("*")
            .single());
      }

      if (error) {
        throw error;
      }

      res.json({
        ok: true,
        advertisement:
          data
      });

    } catch (err) {
      console.error(
        "ADVERTISEMENT CREATE ERROR:",
        err.message
      );

      res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

/* =========================================================
   PUBLISH ADVERTISEMENT
   ========================================================= */

app.post(
  "/api/advertisements/:id/publish",
  async (req, res) => {
    try {
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const {
        data: ad,
        error
      } =
        await supabase
          .from(
            "advertisements"
          )
          .select("*")
          .eq(
            "id",
            req.params.id
          )
          .maybeSingle();

      if (error) {
        throw error;
      }

      if (!ad) {
        throw new Error(
          "Advertisement not found"
        );
      }

      const settings =
        await getTelegramSettings();

      const chatId =
        firstDefined(
          ad.telegram_chat_id,
          ad.target_chat_id,
          settings.telegram_chat_id,
          settings.ad_chat_id,
          settings.admin_chat_id,
          settings.channel_id,
          settings.group_id,
          ADMIN_CHAT_ID
        );

      if (!chatId) {
        throw new Error(
          "Telegram Chat ID missing. በAdvertisement ወይም Telegram Settings ውስጥ Chat ID ያስገቡ።"
        );
      }

      /*
       * IMPORTANT:
       * Check the target before trying to publish.
       * This prevents the confusing fallback error:
       * "sendMessage: chat not found".
       */
      const verifiedChat =
        await verifyTelegramChat(
          chatId
        );

      console.log(
        "PUBLISH TARGET:",
        {
          chatId:
            String(chatId),
          type:
            verifiedChat?.type,
          title:
            verifiedChat?.title ||
            null,
          username:
            verifiedChat?.username ||
            null
        }
      );

      let caption =
        `🔥 ${safeString(ad.title) || "ማስታወቂያ"}\n\n` +
        `${safeString(ad.text)}`;

      const adType =
        safeString(
          ad.ad_type
        );

      const typePrefix = {
        new_product:
          "🆕 አዲስ ምርት",
        special_offer:
          "🔥 ልዩ ቅናሽ",
        limited_stock:
          "⚡ ውስን Stock",
        discount:
          "💰 የዋጋ ቅናሽ",
        featured:
          "⭐ ተመራጭ",
        normal:
          "📢 ማስታወቂያ"
      }[adType];

      if (typePrefix) {
        caption =
          `${typePrefix}\n\n` +
          caption;
      }

      /*
       * Escape the final caption for Telegram HTML.
       */
      caption =
        escapeHtml(caption);

      const buttonText =
        escapeHtml(
          ad.button_text ||
          "Order Now"
        );

      let buttonUrl =
        `https://t.me/${BOT_USERNAME}?start=catalog`;

      if (
        ad.product_id
      ) {
        buttonUrl =
          `https://t.me/${BOT_USERNAME}?start=product_${ad.product_id}`;
      }

      const replyMarkup = {
        inline_keyboard: [
          [
            {
              text:
                buttonText,
              url:
                buttonUrl
            }
          ]
        ]
      };

      let sentMessage = null;

      if (ad.photo_url) {
        try {
          sentMessage =
            await telegram(
              "sendPhoto",
              {
                chat_id:
                  chatId,
                photo:
                  ad.photo_url,
                caption:
                  caption,
                parse_mode:
                  "HTML",
                reply_markup:
                  replyMarkup
              }
            );
        } catch (photoErr) {
          /*
           * If photo URL itself fails, fallback to text.
           * But if target/chat itself is invalid, do NOT
           * hide that error.
           */
          if (
            /chat not found|bot was blocked|not enough rights|forbidden/i.test(
              photoErr.message || ""
            )
          ) {
            throw photoErr;
          }

          console.error(
            "SEND AD PHOTO FAILED, FALLING BACK TO TEXT:",
            photoErr.message
          );

          sentMessage =
            await sendMessage(
              chatId,
              caption,
              {
                parse_mode:
                  "HTML",
                reply_markup:
                  replyMarkup
              }
            );
        }
      } else {
        sentMessage =
          await sendMessage(
            chatId,
            caption,
            {
              parse_mode:
                "HTML",
              reply_markup:
                replyMarkup
            }
          );
      }

      /*
       * Mark published only after Telegram accepted
       * the message.
       */
      try {
        const {
          error: updateError
        } =
          await supabase
            .from(
              "advertisements"
            )
            .update({
              status:
                "PUBLISHED",
              published_at:
                nowISO()
            })
            .eq(
              "id",
              req.params.id
            );

        if (
          updateError &&
          isSchemaColumnError(updateError)
        ) {
          await supabase
            .from(
              "advertisements"
            )
            .update({
              status:
                "PUBLISHED"
            })
            .eq(
              "id",
              req.params.id
            );
        }
      } catch (updateErr) {
        console.error(
          "ADVERTISEMENT STATUS UPDATE ERROR:",
          updateErr.message
        );
      }

      res.json({
        ok: true,
        chat: {
          id:
            verifiedChat?.id,
          type:
            verifiedChat?.type,
          title:
            verifiedChat?.title ||
            null,
          username:
            verifiedChat?.username ||
            null
        },
        telegram_message_id:
          sentMessage?.message_id ||
          null
      });

    } catch (err) {
      console.error(
        "ADVERTISEMENT PUBLISH ERROR:",
        err.message
      );

      res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

app.delete(
  "/api/advertisements/:id",
  async (req, res) => {
    try {
      if (supabase) {
        const {
          error
        } =
          await supabase
            .from(
              "advertisements"
            )
            .delete()
            .eq(
              "id",
              req.params.id
            );

        if (error) {
          throw error;
        }
      }

      res.json({
        ok: true
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

/* =========================================================
   ORDERS API
   ========================================================= */

app.get(
  "/api/orders",
  async (req, res) => {
    try {
      if (!supabase) {
        return res.status(500).json({
          ok: false,
          error:
            "Supabase unavailable"
        });
      }

      const {
        data,
        error
      } =
        await supabase
          .from("orders")
          .select("*")
          .order(
            "created_at",
            {
              ascending: false
            }
          );

      if (error) {
        throw error;
      }

      res.json(
        data || []
      );

    } catch (err) {
      res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

app.get(
  "/api/orders/:id",
  async (req, res) => {
    try {
      const order =
        await getOrderById(
          req.params.id
        );

      if (!order) {
        return res.status(404).json({
          ok: false,
          error:
            "Order not found"
        });
      }

      res.json({
        ok: true,
        order
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

/* =========================================================
   RECEIPT
   ========================================================= */

app.get(
  "/api/orders/:id/receipt",
  async (req, res) => {
    try {
      const order =
        await getOrderById(
          req.params.id
        );

      if (!order) {
        return res.status(404).json({
          ok: false,
          error:
            "Order not found"
        });
      }

      const receiptUrl =
        firstDefined(
          order.receipt_url,
          order.receipt_photo_url,
          order.payment_receipt_url,
          order.receipt,
          order.payment_receipt
        );

      if (!receiptUrl) {
        return res.status(404).json({
          ok: false,
          error:
            "Receipt not found"
        });
      }

      res.json({
        ok: true,
        receipt_url:
          receiptUrl
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

/* =========================================================
   ORDER STATUS PROCESSOR
   ========================================================= */

async function updateOrderStatus(
  orderId,
  requestedStatus,
  extraUpdate = {}
) {
  if (!supabase) {
    throw new Error(
      "Supabase unavailable"
    );
  }

  const newStatus =
    safeString(
      requestedStatus
    ).toUpperCase();

  if (!newStatus) {
    throw new Error(
      "Order status missing"
    );
  }

  const currentOrder =
    await getOrderById(
      orderId
    );

  if (!currentOrder) {
    throw new Error(
      "Order not found"
    );
  }

  const oldStatus =
    safeString(
      currentOrder.status
    ).toUpperCase();

  /*
   * Stock is reduced ONLY when the order enters
   * CONFIRMED from a non-confirmed state.
   *
   * If it is already CONFIRMED, stock is not reduced
   * again.
   */
  if (
    newStatus === "CONFIRMED" &&
    oldStatus !== "CONFIRMED"
  ) {
    const product =
      await getProduct(
        currentOrder.product_id
      );

    if (!product) {
      throw new Error(
        "የOrder ምርቱ አልተገኘም።"
      );
    }

    const currentStock =
      productStock(product);

    const quantity =
      numberValue(
        currentOrder.quantity,
        0
      );

    if (
      quantity <= 0
    ) {
      throw new Error(
        "የOrder quantity ትክክል አይደለም።"
      );
    }

    if (
      quantity >
      currentStock
    ) {
      throw new Error(
        `Stock በቂ አይደለም። የሚገኘው ${currentStock} ነው፣ Order quantity ${quantity} ነው።`
      );
    }

    const newStock =
      currentStock -
      quantity;

    const {
      error: stockError
    } =
      await supabase
        .from("products")
        .update({
          stock:
            newStock
        })
        .eq(
          "id",
          product.id
        );

    if (stockError) {
      throw stockError;
    }
  }

  const update = {
    ...extraUpdate,
    status:
      newStatus
  };

  /*
   * Try confirmed_at when available, but don't break
   * older schemas that don't have it.
   */
  if (
    newStatus ===
    "CONFIRMED"
  ) {
    update.confirmed_at =
      nowISO();
  }

  let {
    data,
    error
  } =
    await supabase
      .from("orders")
      .update(update)
      .eq(
        "id",
        orderId
      )
      .select("*")
      .single();

  /*
   * Older orders table may not have confirmed_at.
   */
  if (
    error &&
    isSchemaColumnError(error) &&
    /confirmed_at/i.test(
      error.message || ""
    )
  ) {
    delete update.confirmed_at;

    ({
      data,
      error
    } =
      await supabase
        .from("orders")
        .update(update)
        .eq(
          "id",
          orderId
        )
        .select("*")
        .single());
  }

  if (error) {
    throw error;
  }

  /*
   * Telegram notification.
   */
  const customerChatId =
    firstDefined(
      data.telegram_chat_id,
      currentOrder.telegram_chat_id
    );

  if (
    customerChatId &&
    (
      newStatus ===
        "CONFIRMED" ||
      newStatus ===
        "REJECTED"
    )
  ) {
    try {
      if (
        newStatus ===
        "CONFIRMED"
      ) {
        await sendMessage(
          customerChatId,
          `✅ <b>ኦርደርዎ ተረጋግጧል!</b>\n\n` +
          `🆔 <code>${escapeHtml(data.id)}</code>\n` +
          `📦 ${escapeHtml(data.product_name || "Product")}\n` +
          `🔢 ብዛት፦ ${numberValue(data.quantity, 0)}\n` +
          `💰 ${numberValue(data.total, 0).toLocaleString()} ETB\n\n` +
          `🙏 እናመሰግናለን።`,
          {
            parse_mode:
              "HTML"
          }
        );
      } else {
        await sendMessage(
          customerChatId,
          `❌ <b>ኦርደርዎ ተቀባይነት አላገኘም።</b>\n\n` +
          `🆔 <code>${escapeHtml(data.id)}</code>\n` +
          `📦 ${escapeHtml(data.product_name || "Product")}\n\n` +
          `እባክዎ ከUNI MARKET ጋር ያግኙን።`,
          {
            parse_mode:
              "HTML"
          }
        );
      }
    } catch (telegramErr) {
      console.error(
        "CUSTOMER ORDER NOTIFICATION ERROR:",
        telegramErr.message
      );
    }
  }

  return data;
}

/* =========================================================
   PATCH ORDER
   ========================================================= */

app.patch(
  "/api/orders/:id",
  async (req, res) => {
    try {
      const body =
        req.body || {};

      const requestedStatus =
        body.status !== undefined
          ? body.status
          : null;

      const extraUpdate = {};

      if (
        body.payment_status !==
        undefined
      ) {
        extraUpdate.payment_status =
          body.payment_status;
      }

      if (
        body.paymentStatus !==
        undefined
      ) {
        extraUpdate.payment_status =
          body.paymentStatus;
      }

      if (
        body.delivery_status !==
        undefined
      ) {
        extraUpdate.delivery_status =
          body.delivery_status;
      }

      if (
        body.deliveryStatus !==
        undefined
      ) {
        extraUpdate.delivery_status =
          body.deliveryStatus;
      }

      if (
        requestedStatus !==
        null
      ) {
        const order =
          await updateOrderStatus(
            req.params.id,
            requestedStatus,
            extraUpdate
          );

        return res.json({
          ok: true,
          order
        });
      }

      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const {
        data,
        error
      } =
        await supabase
          .from("orders")
          .update(
            extraUpdate
          )
          .eq(
            "id",
            req.params.id
          )
          .select("*")
          .single();

      if (error) {
        throw error;
      }

      res.json({
        ok: true,
        order:
          data
      });

    } catch (err) {
      console.error(
        "ORDER PATCH ERROR:",
        err.message
      );

      res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

/*
 * Compatibility route for the existing admin.html:
 * PATCH /api/orders/:id/status
 */
app.patch(
  "/api/orders/:id/status",
  async (req, res) => {
    try {
      const body =
        req.body || {};

      const requestedStatus =
        firstDefined(
          body.status,
          body.order_status
        );

      if (!requestedStatus) {
        return res.status(400).json({
          ok: false,
          error:
            "Order status missing"
        });
      }

      const extraUpdate = {};

      if (
        body.payment_status !==
        undefined
      ) {
        extraUpdate.payment_status =
          body.payment_status;
      }

      if (
        body.delivery_status !==
        undefined
      ) {
        extraUpdate.delivery_status =
          body.delivery_status;
      }

      const order =
        await updateOrderStatus(
          req.params.id,
          requestedStatus,
          extraUpdate
        );

      res.json({
        ok: true,
        order
      });

    } catch (err) {
      console.error(
        "ORDER STATUS ERROR:",
        err.message
      );

      res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

/* =========================================================
   EMPLOYEES
   ========================================================= */

app.get(
  "/api/employees",
  async (req, res) => {
    try {
      if (!supabase) {
        return res.json([]);
      }

      const {
        data,
        error
      } =
        await supabase
          .from("employees")
          .select(
            "id, employee_code, name, username, role, active, created_at, last_login_at"
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          );

      if (error) {
        throw error;
      }

      res.json(
        data || []
      );

    } catch {
      res.json([]);
    }
  }
);

app.post(
  "/api/employees",
  async (req, res) => {
    try {
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const body =
        req.body || {};

      const passwordHash =
        await hashPassword(
          body.password ||
            "123456"
        );

      const {
        data: newEmp,
        error
      } =
        await supabase
          .from("employees")
          .insert({
            employee_code:
              body.employee_code ||
              `EMP-${Math.floor(
                100 +
                Math.random() *
                  900
              )}`,

            name:
              body.name ||
              "Worker",

            username:
              body.username ||
              "worker",

            password_hash:
              passwordHash,

            role:
              body.role ||
              "EMPLOYEE",

            active:
              true
          })
          .select("*")
          .single();

      if (error) {
        throw error;
      }

      const permissions =
        Array.isArray(
          body.permissions
        )
          ? body.permissions
          : [];

      if (
        permissions.length
      ) {
        try {
          await supabase
            .from(
              "employee_permissions"
            )
            .insert(
              permissions.map(
                permission => ({
                  employee_id:
                    newEmp.id,
                  permission,
                  enabled:
                    true
                })
              )
            );
        } catch {}
      }

      res.json({
        ok: true,
        employee:
          newEmp
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

app.delete(
  "/api/employees/:id",
  async (req, res) => {
    try {
      if (supabase) {
        try {
          await supabase
            .from(
              "employee_permissions"
            )
            .delete()
            .eq(
              "employee_id",
              req.params.id
            );
        } catch {}

        await supabase
          .from("employees")
          .delete()
          .eq(
            "id",
            req.params.id
          );
      }

      res.json({
        ok: true
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

/* =========================================================
   REPORTS
   ========================================================= */

app.get(
  "/api/reports",
  async (req, res) => {
    try {
      if (!supabase) {
        return res.json({
          ok: true,
          sales: 0,
          profit: 0,
          orders: 0,
          stock: 0,
          summary: {
            sales: 0,
            profit: 0,
            orders: 0,
            stock: 0
          }
        });
      }

      const {
        data: products
      } =
        await supabase
          .from("products")
          .select("*");

      const {
        data: orders
      } =
        await supabase
          .from("orders")
          .select("*");

      let sales = 0;
      let profit = 0;

      for (
        const order of
        orders || []
      ) {
        const status =
          safeString(
            order.status
          ).toUpperCase();

        if (
          [
            "CONFIRMED",
            "COMPLETED",
            "DELIVERED"
          ].includes(status)
        ) {
          const quantity =
            numberValue(
              order.quantity,
              0
            );

          const sell =
            numberValue(
              order.unit_price ||
              order.sell_price ||
              order.price,
              0
            );

          sales +=
            numberValue(
              order.total,
              quantity *
                sell
            );

          const product =
            (products || [])
              .find(
                p =>
                  String(
                    p.id
                  ) ===
                  String(
                    order.product_id
                  )
              );

          const buy =
            product
              ? productBuyPrice(
                  product
                )
              : numberValue(
                  order.buy_price,
                  0
                );

          profit +=
            (sell - buy) *
            quantity;
        }
      }

      const stock =
        (products || [])
          .reduce(
            (sum, product) =>
              sum +
              productStock(
                product
              ),
            0
          );

      const orderCount =
        (orders || []).length;

      res.json({
        ok: true,
        sales,
        profit,
        orders:
          orderCount,
        stock,
        summary: {
          sales,
          profit,
          orders:
            orderCount,
          stock
        }
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        error:
          err.message
      });
    }
  }
);

/* =========================================================
   TELEGRAM WEBHOOK
   ========================================================= */

app.post(
  "/api/telegram/webhook",
  (req, res) => {
    const update =
      req.body;

    /*
     * Telegram gets an immediate 200 response.
     */
    res.sendStatus(200);

    setImmediate(
      () => {
        processTelegramUpdate(
          update
        ).catch(
          err =>
            console.error(
              "BOT PROCESS ERROR:",
              err.message
            )
        );
      }
    );
  }
);

/* =========================================================
   TELEGRAM WEBHOOK SETUP
   ========================================================= */

async function setupTelegramWebhook() {
  if (
    !BOT_TOKEN ||
    !TELEGRAM_WEBHOOK_URL
  ) {
    console.log(
      "Telegram webhook not configured: BOT_TOKEN or WEBHOOK_URL missing"
    );

    return;
  }

  const webhookUrl =
    `${TELEGRAM_WEBHOOK_URL.replace(
      /\/$/,
      ""
    )}/api/telegram/webhook`;

  try {
    await telegram(
      "setWebhook",
      {
        url:
          webhookUrl,
        allowed_updates: [
          "message",
          "callback_query"
        ],
        drop_pending_updates:
          false
      }
    );

    console.log(
      "Telegram webhook configured:",
      webhookUrl
    );

  } catch (err) {
    console.error(
      "Telegram webhook setup failed:",
      err.message
    );
  }
}

/* =========================================================
   TELEGRAM STATUS
   ========================================================= */

app.get(
  "/api/telegram/status",
  async (req, res) => {
    try {
      if (!BOT_TOKEN) {
        return res.status(500).json({
          ok: false,
          connected:
            false,
          error:
            "TELEGRAM_BOT_TOKEN is missing"
        });
      }

      const me =
        await telegram(
          "getMe"
        );

      res.json({
        ok: true,
        connected:
          true,
        bot:
          me
      });

    } catch (err) {
      res.status(500).json({
        ok: false,
        connected:
          false,
        error:
          err.message
      });
    }
  }
);

/* =========================================================
   HEALTH
   ========================================================= */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,
      service:
        "Telegram Sales Manager",
      time:
        nowISO()
    });
  }
);

/* =========================================================
   ADMIN PAGE
   ========================================================= */

app.get(
  "/",
  (req, res) => {
    res.sendFile(
      path.join(
        PUBLIC_DIR,
        "admin.html"
      )
    );
  }
);

/* =========================================================
   404
   ========================================================= */

app.use(
  (req, res) => {
    res.status(404).json({
      ok: false,
      error:
        "Not found"
    });
  }
);

/* =========================================================
   ERROR HANDLER
   ========================================================= */

app.use(
  (err, req, res, next) => {
    console.error(
      "SERVER ERROR:",
      err.message
    );

    if (
      res.headersSent
    ) {
      return next(err);
    }

    res.status(500).json({
      ok: false,
      error:
        err.message ||
        "Internal server error"
    });
  }
);

/* =========================================================
   START
   ========================================================= */

app.listen(
  PORT,
  async () => {
    console.log(
      `Telegram Sales Manager running on port ${PORT}`
    );

    await setupTelegramWebhook();
  }
);
