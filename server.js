/* UPDATED SERVER.JS — Telegram Sales Manager / UNI MARKET */
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

const SUPABASE_URL = String(
  process.env.SUPABASE_URL || ""
).trim();

const SUPABASE_SERVICE_ROLE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();

const BOT_TOKEN = String(
  process.env.TELEGRAM_BOT_TOKEN || ""
).trim();

const BOT_USERNAME = String(
  process.env.TELEGRAM_BOT_USERNAME ||
    "uni_market_shop_bot"
)
  .replace(/^@/, "")
  .trim();

const ADMIN_CHAT_ID = String(
  process.env.ADMIN_CHAT_ID || ""
).trim();

const AUTH_SECRET = String(
  process.env.AUTH_SECRET ||
    "uni_market_static_secret_key_2026"
).trim();

const MASTER_ADMIN_USERNAME = String(
  process.env.MASTER_ADMIN_USERNAME ||
    "admin"
).trim();

const MASTER_ADMIN_PASSWORD = String(
  process.env.MASTER_ADMIN_PASS ||
    process.env.MASTER_ADMIN_PASSWORD ||
    process.env.WEB_PASSWORD ||
    "123456"
).trim();

const STORAGE_BUCKET = String(
  process.env.SUPABASE_STORAGE_BUCKET ||
    "product-images"
).trim();

/*
 * Telegram Webhook
 *
 * WEBHOOK_URL example:
 * https://your-render-service.onrender.com/api/telegram/webhook
 */
const WEBHOOK_URL = String(
  process.env.WEBHOOK_URL || ""
).trim();

const TELEGRAM_WEBHOOK_SECRET = String(
  process.env.TELEGRAM_WEBHOOK_SECRET ||
    crypto
      .createHash("sha256")
      .update(
        `${AUTH_SECRET}:${BOT_USERNAME}`
      )
      .digest("hex")
      .slice(0, 40)
).trim();

/* =========================
SUPABASE
========================= */

let supabase = null;

try {
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

    console.log(
      "Supabase initialized."
    );
  } else {
    console.warn(
      "Supabase environment variables are missing."
    );
  }
} catch (error) {
  console.error(
    "Supabase init error:",
    error
  );
}

/* =========================
UPLOAD
========================= */

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 8 * 1024 * 1024
  },

  fileFilter: (
    req,
    file,
    cb
  ) => {
    if (
      !file.mimetype ||
      !file.mimetype.startsWith(
        "image/"
      )
    ) {
      return cb(
        new Error(
          "Only image files are allowed"
        )
      );
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
  return value === undefined ||
    value === null
    ? ""
    : String(value).trim();
}

function firstDefined(...values) {
  for (
    const value of values
  ) {
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

function numberValue(
  value,
  fallback = 0
) {
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

/* =========================
AUTH
========================= */

function createAuthToken(
  payload
) {
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
        .update(
          encodedPayload
        )
        .digest()
    );

  return `${encodedPayload}.${signature}`;
}

function verifyAuthToken(
  token
) {
  if (
    !token ||
    typeof token !== "string"
  ) {
    return null;
  }

  const parts =
    token.split(".");

  if (
    parts.length !== 2
  ) {
    return null;
  }

  const [
    encodedPayload,
    signature
  ] = parts;

  const expected =
    base64url(
      crypto
        .createHmac(
          "sha256",
          AUTH_SECRET
        )
        .update(
          encodedPayload
        )
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
        Buffer.from(
          signature
        ),
        Buffer.from(
          expected
        )
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
      Date.now() >
        payload.exp
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function hashPassword(
  password
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const salt =
        crypto
          .randomBytes(16)
          .toString("hex");

      crypto.scrypt(
        String(password),
        salt,
        64,
        (
          err,
          derivedKey
        ) => {
          if (err) {
            return reject(err);
          }

          resolve(
            `scrypt:${salt}:${derivedKey.toString(
              "hex"
            )}`
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
        !stored.startsWith(
          "scrypt:"
        )
      ) {
        return resolve(false);
      }

      const parts =
        stored.split(":");

      if (
        parts.length !== 3
      ) {
        return resolve(false);
      }

      const salt =
        parts[1];

      const storedHash =
        Buffer.from(
          parts[2],
          "hex"
        );

      crypto.scrypt(
        String(password),
        salt,
        storedHash.length,
        (
          err,
          derivedKey
        ) => {
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

function getAuth(req) {
  const header =
    req.headers.authorization ||
    "";

  if (
    header.startsWith(
      "Bearer "
    )
  ) {
    const token =
      verifyAuthToken(
        header
          .slice(
            "Bearer ".length
          )
          .trim()
      );

    if (token) {
      return token;
    }
  }

  const cookieHeader =
    req.headers.cookie ||
    "";

  const match =
    cookieHeader.match(
      /(?:^|;\s*)auth_token=([^;]*)/
    );

  if (match) {
    try {
      return verifyAuthToken(
        decodeURIComponent(
          match[1]
        )
      );
    } catch {
      return null;
    }
  }

  return null;
}

function requireAuth(
  req,
  res,
  next
) {
  const auth =
    getAuth(req);

  if (!auth) {
    return res.status(401).json({
      ok: false,
      error:
        "Unauthorized"
    });
  }

  req.auth = auth;

  next();
}

/* =========================
TELEGRAM HTTP
========================= */

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

        body:
          JSON.stringify(body)
      }
    );

  const data =
    await response.json();

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

/* =========================================================
PRODUCT CATEGORIES
========================================================= */

const PRODUCT_CATEGORIES = [
  {
    id: "clothing",
    name: "👕 አልባሳት"
  },
  {
    id: "electronics",
    name: "📱 ኤሌክትሮኒክስ"
  },
  {
    id: "kids",
    name: "🧒 የህፃናት"
  },
  {
    id: "women",
    name: "👩 የሴቶች"
  },
  {
    id: "home",
    name: "🏠 የቤት እቃዎች"
  },
  {
    id: "other",
    name: "🛍️ ሌሎች"
  }
];

function productCategoriesKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text:
            "👕 አልባሳት",
          callback_data:
            "category_clothing"
        },
        {
          text:
            "📱 ኤሌክትሮኒክስ",
          callback_data:
            "category_electronics"
        }
      ],
      [
        {
          text:
            "🧒 የህፃናት",
          callback_data:
            "category_kids"
        },
        {
          text:
            "👩 የሴቶች",
          callback_data:
            "category_women"
        }
      ],
      [
        {
          text:
            "🏠 የቤት እቃዎች",
          callback_data:
            "category_home"
        },
        {
          text:
            "🛍️ ሌሎች",
          callback_data:
            "category_other"
        }
      ]
    ]
  };
}

function categoryAliases(
  category
) {
  const value =
    safeString(category)
      .toLowerCase();

  const map = {
    clothing: [
      "clothing",
      "clothes"
    ],

    clothes: [
      "clothing",
      "clothes"
    ],

    electronics: [
      "electronics"
    ],

    kids: [
      "kids",
      "children"
    ],

    children: [
      "kids",
      "children"
    ],

    women: [
      "women"
    ],

    home: [
      "home",
      "furniture"
    ],

    furniture: [
      "home",
      "furniture"
    ],

    other: [
      "other",
      "others"
    ],

    others: [
      "other",
      "others"
    ]
  };

  return (
    map[value] ||
    [value]
  );
}

async function getBotProducts(
  category = null
) {
  if (!supabase) {
    return [];
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
    console.error(
      "Bot products error:",
      error
    );

    return [];
  }

  let products =
    Array.isArray(data)
      ? data
      : [];

  products =
    products.filter(
      (product) =>
        numberValue(
          product.stock,
          0
        ) > 0
    );

  if (!category) {
    return products;
  }

  const aliases =
    categoryAliases(
      category
    );

  return products.filter(
    (product) =>
      aliases.includes(
        safeString(
          product.category
        ).toLowerCase()
      )
  );
}

function productListKeyboard(
  products
) {
  const rows = [];

  for (
    const product of products
  ) {
    rows.push([
      {
        text:
          `🛍️ ${
            safeString(
              product.name
            ) || "ምርት"
          } — ${
            numberValue(
              product.sell_price,
              0
            )
          } ብር`,

        callback_data:
          `product_${product.id}`
      }
    ]);
  }

  rows.push([
    {
      text:
        "⬅️ ወደ ምድቦች",

      callback_data:
        "product_categories"
    }
  ]);

  return {
    inline_keyboard:
      rows
  };
}

/* =========================================================
TELEGRAM BOT
FAST WEBHOOK + POLLING FALLBACK
========================================================= */

let telegramPollingRunning =
  false;

let telegramUpdateOffset =
  0;

let telegramWebhookActive =
  false;

/*
 * Telegram webhook request verification.
 *
 * Telegram sends the secret in:
 * X-Telegram-Bot-Api-Secret-Token
 */
function isValidTelegramWebhook(
  req
) {
  if (
    !TELEGRAM_WEBHOOK_SECRET
  ) {
    return true;
  }

  const received =
    safeString(
      req.headers[
        "x-telegram-bot-api-secret-token"
      ]
    );

  return (
    received ===
    TELEGRAM_WEBHOOK_SECRET
  );
}

async function sendBotWelcome(
  chatId,
  name = ""
) {
  const greetingName =
    safeString(name)
      ? ` ${safeString(name)}`
      : "";

  await sendMessage(
    chatId,

    `👋 እንኳን ወደ UNI MARKET${greetingName} በደህና መጡ!\n\n🛍️ የሚፈልጉትን ምርት ይምረጡ።\n\n👇 ከታች ያለውን የምርቶች ቁልፍ ይጫኑ።`,

    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                "🛍️ ምርቶች",

              callback_data:
                "catalog"
            }
          ]
        ]
      }
    }
  );
}

async function sendBotCatalog(
  chatId
) {
  const products =
    await getBotProducts();

  if (
    products.length === 0
  ) {
    return sendMessage(
      chatId,

      "📦 በአሁኑ ጊዜ የሚገኝ ምርት የለም።",

      {
        reply_markup:
          productCategoriesKeyboard()
      }
    );
  }

  return sendMessage(
    chatId,

    "🛍️ <b>UNI MARKET</b>\n\n📂 እባክዎ የሚፈልጉትን የምርት ምድብ ይምረጡ።",

    {
      parse_mode:
        "HTML",

      reply_markup:
        productCategoriesKeyboard()
    }
  );
}

async function sendBotProduct(
  chatId,
  productId
) {
  if (!supabase) {
    return sendMessage(
      chatId,
      "⚠️ Supabase አልተገናኘም።"
    );
  }

  const {
    data: product,
    error
  } =
    await supabase
      .from("products")
      .select("*")
      .eq(
        "id",
        productId
      )
      .maybeSingle();

  if (error) {
    console.error(
      "Telegram product error:",
      error
    );

    return sendMessage(
      chatId,
      "⚠️ የምርቱን መረጃ ማግኘት አልተቻለም።"
    );
  }

  if (!product) {
    return sendMessage(
      chatId,
      "❌ ይህ ምርት አልተገኘም።"
    );
  }

  const stock =
    numberValue(
      product.stock,
      0
    );

  const price =
    numberValue(
      product.sell_price,
      0
    );

  const name =
    safeString(
      product.name
    ) || "ምርት";

  const description =
    safeString(
      product.description
    );

  const text =
    `🛍️ <b>${name}</b>\n\n` +
    `${
      description
        ? `${description}\n\n`
        : ""
    }` +
    `💰 ዋጋ: <b>${price} ብር</b>\n` +
    `📦 ያለው ብዛት: <b>${stock}</b>\n\n` +
    `👇 ለመመልከት ወይም ለማዘዝ ከታች ይጫኑ።`;

  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text:
            "🛒 ለማዘዝ",

          callback_data:
            `order_product_${product.id}`
        }
      ],
      [
        {
          text:
            "⬅️ ምርቶች",

          callback_data:
            "catalog"
        }
      ]
    ]
  };

  const photoUrl =
    firstDefined(
      product.photo_url,
      product.photoUrl,
      product.photo
    );

  if (photoUrl) {
    try {
      return await sendPhotoFromUrl(
        chatId,
        photoUrl,
        text,
        {
          reply_markup:
            replyMarkup
        }
      );
    } catch (photoError) {
      console.error(
        "Telegram product photo error:",
        photoError.message
      );
    }
  }

  return sendMessage(
    chatId,
    text,
    {
      parse_mode:
        "HTML",

      reply_markup:
        replyMarkup
    }
  );
}

async function handleTelegramUpdate(
  update
) {
  try {
    /* =========================
    CALLBACK QUERY
    ========================= */

    if (
      update.callback_query
    ) {
      const callback =
        update.callback_query;

      const callbackData =
        safeString(
          callback.data
        );

      const chatId =
        callback.message?.chat?.id;

      const callbackQueryId =
        callback.id;

      /*
       * Answer immediately so Telegram
       * stops showing the loading spinner.
       */
      if (callbackQueryId) {
        try {
          await telegram(
            "answerCallbackQuery",
            {
              callback_query_id:
                callbackQueryId
            }
          );
        } catch {}
      }

      if (!chatId) {
        return;
      }

      /* PRODUCT CATEGORIES */

      if (
        callbackData ===
          "product_categories" ||
        callbackData ===
          "categories"
      ) {
        await sendMessage(
          chatId,

          "📂 <b>የምርት ምድቦች</b>\n\nእባክዎ የሚፈልጉትን ምድብ ይምረጡ።",

          {
            parse_mode:
              "HTML",

            reply_markup:
              productCategoriesKeyboard()
          }
        );

        return;
      }

      /* CATEGORY */

      if (
        callbackData.startsWith(
          "category_"
        )
      ) {
        const category =
          callbackData.slice(
            "category_".length
          );

        const products =
          await getBotProducts(
            category
          );

        const categoryInfo =
          PRODUCT_CATEGORIES.find(
            (item) =>
              item.id ===
              category
          );

        const categoryName =
          categoryInfo?.name ||
          "🛍️ ምርቶች";

        if (
          products.length === 0
        ) {
          await sendMessage(
            chatId,

            `${categoryName}\n\n📦 በዚህ ምድብ ውስጥ በአሁኑ ጊዜ የሚገኝ ምርት የለም።`,

            {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text:
                        "⬅️ ወደ ምድቦች",

                      callback_data:
                        "product_categories"
                    }
                  ]
                ]
              }
            }
          );

          return;
        }

        await sendMessage(
          chatId,

          `${categoryName}\n\n👇 ከታች ያለውን ምርት ይምረጡ።`,

          {
            reply_markup:
              productListKeyboard(
                products
              )
          }
        );

        return;
      }

      /* CATALOG */

      if (
        callbackData ===
        "catalog"
      ) {
        await sendBotCatalog(
          chatId
        );

        return;
      }

      /* PRODUCT */

      if (
        callbackData.startsWith(
          "product_"
        )
      ) {
        const productId =
          callbackData.slice(
            "product_".length
          );

        if (productId) {
          await sendBotProduct(
            chatId,
            productId
          );
        }

        return;
      }

      /* PRODUCT ORDER BUTTON */

      if (
        callbackData.startsWith(
          "order_product_"
        )
      ) {
        const productId =
          callbackData.slice(
            "order_product_".length
          );

        if (!productId) {
          return;
        }

        /*
         * Keep current order flow intact.
         * Full order-state workflow can be
         * added separately without touching
         * the fast Telegram transport.
         */
        await sendMessage(
          chatId,

          "🛒 <b>የማዘዣ ጥያቄ</b>\n\nይህን ምርት ለማዘዝ እባክዎ የሚያዙትን መጠን እና የመገናኛ መረጃ ያስገቡ።",

          {
            parse_mode:
              "HTML",

            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text:
                      "⬅️ ወደ ምርቶች",

                    callback_data:
                      "catalog"
                  }
                ]
              ]
            }
          }
        );

        return;
      }

      /* ORDER RECEIVED */

      if (
        callbackData.startsWith(
          "order_received_"
        )
      ) {
        const orderId =
          callbackData.slice(
            "order_received_".length
          );

        if (
          !orderId ||
          !supabase
        ) {
          return;
        }

        const order =
          await getOrderById(
            orderId
          );

        if (!order) {
          await sendMessage(
            chatId,
            "❌ የትዕዛዙ መረጃ አልተገኘም።"
          );

          return;
        }

        const orderChatId =
          safeString(
            firstDefined(
              order.telegram_chat_id,
              order.customer_id
            )
          );

        if (
          orderChatId &&
          String(
            orderChatId
          ) !==
            String(chatId)
        ) {
          await sendMessage(
            chatId,
            "⚠️ ይህን ትዕዛዝ ለመዝጋት ፈቃድ የለዎትም።"
          );

          return;
        }

        const {
          data,
          error
        } =
          await supabase
            .from("orders")
            .update({
              status:
                "DELIVERED",

              delivered_at:
                nowISO()
            })
            .eq(
              "id",
              orderId
            )
            .select("*")
            .single();

        if (error) {
          console.error(
            "Order received update error:",
            error
          );

          await sendMessage(
            chatId,
            "⚠️ ትዕዛዙን መዝጋት አልተቻለም።"
          );

          return;
        }

        await sendMessage(
          chatId,

          "✅ <b>ተረጋግጧል!</b>\n\n📦 ትዕዛዝዎ እንደደረሰ ተመዝግቧል።\n\n🙏 ስለገዙን እናመሰግናለን።",

          {
            parse_mode:
              "HTML"
          }
        );

        return;
      }

      return;
    }

    /* =========================
    MESSAGE
    ========================= */

    if (
      update.message
    ) {
      const message =
        update.message;

      const chatId =
        message.chat?.id;

      if (!chatId) {
        return;
      }

      const text =
        safeString(
          message.text
        );

      if (!text) {
        return;
      }

      /* /start */

      if (
        text === "/start" ||
        text.startsWith(
          "/start "
        )
      ) {
        const parameter =
          text
            .slice(
              "/start".length
            )
            .trim();

        const firstName =
          safeString(
            message.from?.first_name
          );

        await sendBotWelcome(
          chatId,
          firstName
        );

        if (parameter) {
          if (
            parameter ===
              "catalog" ||
            parameter.startsWith(
              "product_"
            )
          ) {
            if (
              parameter.startsWith(
                "product_"
              )
            ) {
              const productId =
                parameter.slice(
                  "product_".length
                );

              if (productId) {
                await sendBotProduct(
                  chatId,
                  productId
                );
              }
            } else {
              await sendBotCatalog(
                chatId
              );
            }
          }
        }

        return;
      }

      /* /catalog */

      if (
        text === "/catalog" ||
        text.toLowerCase() ===
          "catalog" ||
        text ===
          "🛍️ ምርቶች"
      ) {
        await sendBotCatalog(
          chatId
        );

        return;
      }

      /* Helpful fallback */

      if (
        text.includes(
          "ምርት"
        )
      ) {
        await sendBotCatalog(
          chatId
        );

        return;
      }
    }
  } catch (error) {
    console.error(
      "Telegram update handler error:",
      error
    );
  }
}

/* =========================================================
TELEGRAM WEBHOOK
========================================================= */

app.post(
  "/api/telegram/webhook",
  async (req, res) => {
    /*
     * Telegram needs a very fast HTTP response.
     * We acknowledge first, then process the
     * update asynchronously.
     */
    if (
      !isValidTelegramWebhook(req)
    ) {
      return res.status(403).json({
        ok: false
      });
    }

    const update =
      req.body;

    res.status(200).json({
      ok: true
    });

    /*
     * Do not wait for the bot processing
     * before returning HTTP 200.
     */
    setImmediate(() => {
      handleTelegramUpdate(
        update
      ).catch(
        (error) => {
          console.error(
            "Webhook update processing error:",
            error
          );
        }
      );
    });
  }
);

/* =========================================================
TELEGRAM POLLING FALLBACK
========================================================= */

async function getTelegramUpdates() {
  return telegram(
    "getUpdates",
    {
      offset:
        telegramUpdateOffset,

      timeout: 30,

      allowed_updates: [
        "message",
        "callback_query"
      ]
    }
  );
}

async function startTelegramPolling() {
  if (
    telegramPollingRunning ||
    !BOT_TOKEN
  ) {
    return;
  }

  telegramPollingRunning =
    true;

  telegramWebhookActive =
    false;

  console.log(
    "Telegram Bot polling starting..."
  );

  try {
    await telegram(
      "deleteWebhook",
      {
        drop_pending_updates:
          false
      }
    );

    const bot =
      await telegram(
        "getMe"
      );

    console.log(
      `Telegram Bot connected: @${bot.username || BOT_USERNAME}`
    );
  } catch (error) {
    console.error(
      "Telegram Bot initialization error:",
      error.message
    );

    telegramPollingRunning =
      false;

    setTimeout(
      () => {
        startTelegramPolling().catch(
          () => {}
        );
      },
      5000
    );

    return;
  }

  while (
    telegramPollingRunning
  ) {
    try {
      const updates =
        await getTelegramUpdates();

      if (
        !Array.isArray(
          updates
        )
      ) {
        continue;
      }

      for (
        const update of updates
      ) {
        if (
          update.update_id !==
          undefined
        ) {
          telegramUpdateOffset =
            Number(
              update.update_id
            ) + 1;
        }

        await handleTelegramUpdate(
          update
        );
      }
    } catch (error) {
      console.error(
        "Telegram polling error:",
        error.message
      );

      if (
        String(
          error.message || ""
        ).includes(
          "409"
        )
      ) {
        console.error(
          "Telegram polling conflict: another bot instance may be using getUpdates."
        );
      }

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            5000
          )
      );
    }
  }
}

/* =========================================================
SET TELEGRAM WEBHOOK
========================================================= */

async function startTelegramBot() {
  if (!BOT_TOKEN) {
    console.warn(
      "Telegram Bot NOT started: TELEGRAM_BOT_TOKEN is missing."
    );

    return;
  }

  try {
    const bot =
      await telegram(
        "getMe"
      );

    console.log(
      `Telegram Bot connected: @${bot.username || BOT_USERNAME}`
    );

    /*
     * If WEBHOOK_URL is configured,
     * webhook is preferred because it is
     * faster and avoids polling conflicts.
     */
    if (WEBHOOK_URL) {
      let webhookUrl =
        WEBHOOK_URL;

      if (
        webhookUrl.endsWith("/")
      ) {
        webhookUrl =
          webhookUrl.slice(
            0,
            -1
          );
      }

      if (
        !webhookUrl.endsWith(
          "/api/telegram/webhook"
        )
      ) {
        webhookUrl =
          `${webhookUrl}/api/telegram/webhook`;
      }

      await telegram(
        "setWebhook",
        {
          url:
            webhookUrl,

          secret_token:
            TELEGRAM_WEBHOOK_SECRET,

          allowed_updates: [
            "message",
            "callback_query"
          ],

          drop_pending_updates:
            false
        }
      );

      telegramWebhookActive =
        true;

      telegramPollingRunning =
        false;

      console.log(
        `Telegram Webhook enabled: ${webhookUrl}`
      );

      return;
    }

    /*
     * No WEBHOOK_URL:
     * retain the old polling behavior.
     */
    console.log(
      "WEBHOOK_URL is not configured. Using Telegram polling fallback."
    );

    await startTelegramPolling();
  } catch (error) {
    console.error(
      "Telegram Bot startup error:",
      error.message
    );

    /*
     * If webhook setup fails but no webhook
     * has been activated, try polling as a
     * fallback.
     */
    if (
      !telegramWebhookActive
    ) {
      setTimeout(
        () => {
          startTelegramBot().catch(
            () => {}
          );
        },
        5000
      );
    }
  }
}

/* =========================================================
ADVERTISEMENT PHOTO UPLOAD
========================================================= */

async function sendPhotoFromUrl(
  chatId,
  photoUrl,
  caption,
  extra = {}
) {
  const url =
    safeString(
      photoUrl
    );

  if (!url) {
    throw new Error(
      "Advertisement photo URL missing"
    );
  }

  const imageResponse =
    await fetch(url);

  if (!imageResponse.ok) {
    throw new Error(
      `Could not download advertisement image: HTTP ${imageResponse.status}`
    );
  }

  const contentType =
    imageResponse.headers.get(
      "content-type"
    ) ||
    "image/jpeg";

  if (
    !contentType.startsWith(
      "image/"
    )
  ) {
    throw new Error(
      `Advertisement URL did not return an image. Content-Type: ${contentType}`
    );
  }

  const imageBuffer =
    Buffer.from(
      await imageResponse.arrayBuffer()
    );

  if (
    !imageBuffer.length
  ) {
    throw new Error(
      "Advertisement image is empty"
    );
  }

  const form =
    new FormData();

  form.append(
    "chat_id",
    String(chatId)
  );

  form.append(
    "caption",
    String(
      caption || ""
    )
  );

  form.append(
    "photo",
    new Blob(
      [
        imageBuffer
      ],
      {
        type:
          contentType
      }
    ),
    "advertisement.jpg"
  );

  if (
    extra.reply_markup
  ) {
    form.append(
      "reply_markup",
      JSON.stringify(
        extra.reply_markup
      )
    );
  }

  const response =
    await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
      {
        method: "POST",
        body: form
      }
    );

  const data =
    await response.json();

  if (!data.ok) {
    throw new Error(
      `Telegram sendPhoto: ${
        data.description ||
        "API error"
      }`
    );
  }

  return data.result;
}

/* =========================
TELEGRAM CHAT VERIFICATION
========================= */

async function verifyTelegramChat(
  chatId
) {
  const id =
    safeString(chatId);

  if (!id) {
    throw new Error(
      "Telegram Chat ID missing"
    );
  }

  try {
    const chat =
      await telegram(
        "getChat",
        {
          chat_id: id
        }
      );

    return chat;
  } catch (error) {
    throw new Error(
      `Telegram Chat ID "${id}" አልተገኘም። Bot ወደ Group/Channel መጨመሩን እና Chat ID ትክክል መሆኑን ያረጋግጡ። Original: ${error.message}`
    );
  }
}

/* =========================
ORDER HELPERS
========================= */

async function getOrderById(
  orderId
) {
  if (!supabase) {
    return null;
  }

  try {
    const {
      data
    } =
      await supabase
        .from("orders")
        .select("*")
        .eq(
          "id",
          orderId
        )
        .maybeSingle();

    return data || null;
  } catch {
    return null;
  }
}

async function getPaymentSettings() {
  if (!supabase) {
    return {};
  }

  try {
    const {
      data
    } =
      await supabase
        .from(
          "payment_settings"
        )
        .select("*")
        .limit(1)
        .maybeSingle();

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
      data
    } =
      await supabase
        .from(
          "telegram_settings"
        )
        .select("*")
        .limit(1)
        .maybeSingle();

    return data || {};
  } catch {
    return {};
  }
}

/* =========================================================
AUTH
========================================================= */

app.post(
  "/api/auth/login",
  async (
    req,
    res
  ) => {
    try {
      const username =
        safeString(
          req.body?.username
        );

      const password =
        String(
          req.body?.password ||
            ""
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

            username:
              MASTER_ADMIN_USERNAME,

            name:
              "Master Admin",

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

            username:
              MASTER_ADMIN_USERNAME,

            name:
              "Master Admin"
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
        data: employee,
        error: employeeError
      } =
        await supabase
          .from("employees")
          .select("*")
          .eq(
            "username",
            username
          )
          .maybeSingle();

      if (employeeError) {
        console.error(
          "Employee login error:",
          employeeError
        );

        return res.status(500).json({
          ok: false,
          error:
            "Login service error"
        });
      }

      if (
        !employee ||
        employee.active === false
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
            employee.name
        }
      });
    } catch (error) {
      console.error(
        "AUTH LOGIN ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Login service error"
      });
    }
  }
);

app.get(
  "/api/auth/me",
  requireAuth,
  async (
    req,
    res
  ) => {
    res.json({
      ok: true,
      user:
        req.auth
    });
  }
);

/* =========================================================
PRODUCTS
========================================================= */

app.get(
  "/api/products",
  async (
    req,
    res
  ) => {
    if (!supabase) {
      return res.status(500).json({
        ok: false,
        error:
          "Supabase unavailable"
      });
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
              ascending:
                false
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
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

app.post(
  "/api/products",
  async (
    req,
    res
  ) => {
    try {
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const body =
        req.body || {};

      const row = {
        name:
          firstDefined(
            body.name,
            body.productName,
            body.title
          ),

        category:
          firstDefined(
            body.category,
            body.productCategory
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
          )
      };

      if (
        body.description !==
        undefined
      ) {
        row.description =
          body.description ||
          null;
      }

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
        throw error;
      }

      res.json({
        ok: true,
        product:
          data
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

app.patch(
  "/api/products/:id",
  async (
    req,
    res
  ) => {
    try {
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const body =
        req.body || {};

      const row = {};

      if (
        body.name !==
          undefined ||
        body.productName !==
          undefined ||
        body.title !==
          undefined
      ) {
        row.name =
          firstDefined(
            body.name,
            body.productName,
            body.title
          );
      }

      if (
        body.category !==
          undefined ||
        body.productCategory !==
          undefined
      ) {
        row.category =
          firstDefined(
            body.category,
            body.productCategory
          );
      }

      if (
        body.buyPrice !==
          undefined ||
        body.buy_price !==
          undefined
      ) {
        row.buy_price =
          numberValue(
            firstDefined(
              body.buyPrice,
              body.buy_price
            ),
            0
          );
      }

      if (
        body.sellPrice !==
          undefined ||
        body.sell_price !==
          undefined
      ) {
        row.sell_price =
          numberValue(
            firstDefined(
              body.sellPrice,
              body.sell_price
            ),
            0
          );
      }

      if (
        body.stock !==
        undefined
      ) {
        row.stock =
          numberValue(
            body.stock,
            0
          );
      }

      if (
        body.photoUrl !==
          undefined ||
        body.photo_url !==
          undefined ||
        body.photo !==
          undefined
      ) {
        row.photo_url =
          firstDefined(
            body.photoUrl,
            body.photo_url,
            body.photo
          );
      }

      if (
        body.description !==
        undefined
      ) {
        row.description =
          body.description ||
          null;
      }

      const {
        data,
        error
      } =
        await supabase
          .from("products")
          .update(row)
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
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

app.delete(
  "/api/products/:id",
  async (
    req,
    res
  ) => {
    try {
      if (supabase) {
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
      }

      res.json({
        ok: true
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
UPLOAD
========================================================= */

app.post(
  "/api/upload",
  upload.single("photo"),
  async (
    req,
    res
  ) => {
    try {
      const fallback =
        "https://images.unsplash.com/photo-1523275335684-37898b6baf30";

      if (
        !supabase ||
        !req.file
      ) {
        return res.json({
          ok: true,
          url:
            fallback
        });
      }

      const ext =
        path.extname(
          req.file.originalname ||
            ""
        ).toLowerCase() ||
        ".jpg";

      const filePath =
        `products/${Date.now()}-${crypto
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
        console.error(
          "Storage upload error:",
          error
        );

        return res.json({
          ok: true,
          url:
            fallback
        });
      }

      const publicUrl =
        supabase.storage
          .from(
            STORAGE_BUCKET
          )
          .getPublicUrl(
            filePath
          )?.data?.publicUrl ||
        fallback;

      res.json({
        ok: true,
        url:
          publicUrl,
        path:
          filePath
      });
    } catch (error) {
      console.error(
        "Upload error:",
        error
      );

      res.json({
        ok: true,
        url:
          "https://images.unsplash.com/photo-1523275335684-37898b6baf30"
      });
    }
  }
);

/* =========================================================
ORDERS
========================================================= */

app.get(
  "/api/orders",
  async (
    req,
    res
  ) => {
    try {
      if (!supabase) {
        return res.json([]);
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
              ascending:
                false
            }
          );

      if (error) {
        throw error;
      }

      res.json(
        data || []
      );
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

async function changeOrderStatus(
  orderId,
  newStatus,
  actorName
) {
  const order =
    await getOrderById(
      orderId
    );

  if (!order) {
    throw new Error(
      "Order not found"
    );
  }

  newStatus =
    safeString(
      newStatus
    ).toUpperCase();

  if (
    newStatus ===
    "CONFIRMED"
  ) {
    const {
      data,
      error
    } =
      await supabase
        .from("orders")
        .update({
          status:
            "DELIVERY_PENDING",

          payment_status:
            "CONFIRMED",

          confirmed_at:
            nowISO(),

          confirmed_by:
            actorName ||
            "Admin"
        })
        .eq(
          "id",
          orderId
        )
        .select("*")
        .single();

    if (error) {
      throw error;
    }

    const customerChatId =
      firstDefined(
        data.telegram_chat_id,
        data.customer_id
      );

    if (customerChatId) {
      try {
        await sendMessage(
          customerChatId,

          "✅ ክፍያዎ ተረጋግጧል!\n\n📦 እቃዎ በማድረስ ሂደት ላይ ነው።",

          {
            parse_mode:
              "HTML",

            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text:
                      "📦 ደርሶኛል",

                    callback_data:
                      `order_received_${data.id}`
                  }
                ]
              ]
            }
          }
        );
      } catch (error) {
        console.error(
          "Customer Telegram notification error:",
          error.message
        );
      }
    }

    return data;
  }

  const {
    data,
    error
  } =
    await supabase
      .from("orders")
      .update({
        status:
          newStatus
      })
      .eq(
        "id",
        orderId
      )
      .select("*")
      .single();

  if (error) {
    throw error;
  }

  return data;
}

app.patch(
  "/api/orders/:id/status",
  async (
    req,
    res
  ) => {
    try {
      const status =
        req.body?.status ||
        req.body?.newStatus;

      if (!status) {
        return res.status(400).json({
          ok: false,
          error:
            "Order status is required"
        });
      }

      const order =
        await changeOrderStatus(
          req.params.id,
          status,
          "Admin"
        );

      res.json({
        ok: true,
        order
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
PAYMENT SETTINGS
========================================================= */

app.get(
  "/api/payment-settings",
  async (
    req,
    res
  ) => {
    res.json(
      await getPaymentSettings()
    );
  }
);

app.post(
  "/api/payment-settings",
  async (
    req,
    res
  ) => {
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

      if (
        existing?.id
      ) {
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
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
TELEGRAM SETTINGS
========================================================= */

app.get(
  "/api/telegram-settings",
  async (
    req,
    res
  ) => {
    res.json(
      await getTelegramSettings()
    );
  }
);

app.post(
  "/api/telegram-settings",
  async (
    req,
    res
  ) => {
    try {
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const existing =
        await getTelegramSettings();

      let data;
      let error;

      if (
        existing?.id
      ) {
        ({
          data,
          error
        } =
          await supabase
            .from(
              "telegram_settings"
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
              "telegram_settings"
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
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
TELEGRAM CHAT CHECK
========================================================= */

app.get(
  "/api/telegram/check-chat",
  async (
    req,
    res
  ) => {
    try {
      const chatId =
        safeString(
          req.query?.chat_id
        );

      if (!chatId) {
        return res.status(400).json({
          ok: false,
          valid: false,
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
        valid: true,

        chat: {
          id:
            chat.id,

          type:
            chat.type ||
            null,

          title:
            chat.title ||
            null,

          username:
            chat.username
              ? `@${chat.username}`
              : null
        }
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        valid: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
TELEGRAM CHANNELS
========================================================= */

app.get(
  "/api/telegram-channels",
  async (
    req,
    res
  ) => {
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
          .from(
            "telegram_channels"
          )
          .select("*")
          .order(
            "created_at",
            {
              ascending:
                false
            }
          );

      if (error) {
        throw error;
      }

      res.json({
        ok: true,
        channels:
          data || []
      });
    } catch (error) {
      console.error(
        "GET telegram channels error:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

app.post(
  "/api/telegram-channels",
  async (
    req,
    res
  ) => {
    try {
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const body =
        req.body || {};

      const inputChatId =
        safeString(
          firstDefined(
            body.chat_id,
            body.chatId,
            body.telegram_chat_id,
            body.telegramChatId
          )
        );

      const inputName =
        safeString(
          firstDefined(
            body.name,
            body.title,
            body.channel_name,
            body.channelName
          )
        );

      if (!inputChatId) {
        return res.status(400).json({
          ok: false,
          error:
            "Telegram Chat ID missing"
        });
      }

      const chat =
        await verifyTelegramChat(
          inputChatId
        );

      const channelName =
        inputName ||
        chat.title ||
        (
          chat.username
            ? `@${chat.username}`
            : `Telegram ${chat.id}`
        );

      const row = {
        name:
          channelName,

        chat_id:
          String(chat.id),

        username:
          chat.username
            ? `@${chat.username}`
            : null,

        type:
          chat.type ||
          null,

        is_active:
          body.is_active !==
          undefined
            ? Boolean(
                body.is_active
              )
            : true
      };

      const {
        data,
        error
      } =
        await supabase
          .from(
            "telegram_channels"
          )
          .insert(row)
          .select("*")
          .single();

      if (error) {
        if (
          String(
            error.message ||
              ""
          )
            .toLowerCase()
            .includes(
              "duplicate"
            ) ||
          String(
            error.message ||
              ""
          )
            .toLowerCase()
            .includes(
              "unique"
            )
        ) {
          return res.status(409).json({
            ok: false,
            error:
              "ይህ Telegram Channel አስቀድሞ ተመዝግቧል።"
          });
        }

        throw error;
      }

      res.json({
        ok: true,
        channel:
          data
      });
    } catch (error) {
      console.error(
        "POST telegram channel error:",
        error
      );

      res.status(400).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

app.patch(
  "/api/telegram-channels/:id",
  async (
    req,
    res
  ) => {
    try {
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const body =
        req.body || {};

      const row = {};

      if (
        body.name !==
          undefined ||
        body.title !==
          undefined ||
        body.channel_name !==
          undefined ||
        body.channelName !==
          undefined
      ) {
        row.name =
          safeString(
            firstDefined(
              body.name,
              body.title,
              body.channel_name,
              body.channelName
            )
          );
      }

      if (
        body.is_active !==
        undefined
      ) {
        row.is_active =
          Boolean(
            body.is_active
          );
      }

      const newChatId =
        safeString(
          firstDefined(
            body.chat_id,
            body.chatId,
            body.telegram_chat_id,
            body.telegramChatId
          )
        );

      if (newChatId) {
        const chat =
          await verifyTelegramChat(
            newChatId
          );

        row.chat_id =
          String(chat.id);

        row.username =
          chat.username
            ? `@${chat.username}`
            : null;

        row.type =
          chat.type ||
          null;

        if (!row.name) {
          row.name =
            chat.title ||
            (
              chat.username
                ? `@${chat.username}`
                : `Telegram ${chat.id}`
            );
        }
      }

      const {
        data,
        error
      } =
        await supabase
          .from(
            "telegram_channels"
          )
          .update(row)
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
        channel:
          data
      });
    } catch (error) {
      console.error(
        "PATCH telegram channel error:",
        error
      );

      res.status(400).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

app.delete(
  "/api/telegram-channels/:id",
  async (
    req,
    res
  ) => {
    try {
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const {
        error
      } =
        await supabase
          .from(
            "telegram_channels"
          )
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
    } catch (error) {
      console.error(
        "DELETE telegram channel error:",
        error
      );

      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
ADVERTISEMENTS
========================================================= */

app.get(
  "/api/advertisements",
  async (
    req,
    res
  ) => {
    try {
      if (!supabase) {
        return res.json([]);
      }

      const {
        data
      } =
        await supabase
          .from(
            "advertisements"
          )
          .select("*")
          .order(
            "created_at",
            {
              ascending:
                false
            }
          );

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
  async (
    req,
    res
  ) => {
    try {
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const body =
        req.body || {};

      const row = {
        title:
          body.title ||
          null,

        text:
          body.text ||
          body.advertisementText ||
          null,

        button_text:
          body.buttonText ||
          body.button_text ||
          "Order Now",

        telegram_chat_id:
          body.telegramChatId ||
          body.telegram_chat_id ||
          null,

        photo_url:
          firstDefined(
            body.photoUrl,
            body.photo_url,
            body.photo
          ),

        status:
          "DRAFT"
      };

      let data;
      let error;

      try {
        ({
          data,
          error
        } =
          await supabase
            .from(
              "advertisements"
            )
            .insert(row)
            .select("*")
            .single());
      } catch {
        delete row.telegram_chat_id;

        ({
          data,
          error
        } =
          await supabase
            .from(
              "advertisements"
            )
            .insert(row)
            .select("*")
            .single());
      }

      if (error) {
        return res.json({
          ok: true,

          advertisement: {
            id:
              Date.now(),

            ...row
          }
        });
      }

      res.json({
        ok: true,
        advertisement:
          data
      });
    } catch (error) {
      res.json({
        ok: true,

        advertisement: {
          id:
            Date.now(),

          title:
            req.body?.title
        }
      });
    }
  }
);

/* =========================================================
ADVERTISEMENT PUBLISH
========================================================= */

app.post(
  "/api/advertisements/:id/publish",
  async (
    req,
    res
  ) => {
    try {
      if (!supabase) {
        throw new Error(
          "Supabase unavailable"
        );
      }

      const {
        data: ad,
        error: adError
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

      if (adError) {
        throw adError;
      }

      if (!ad) {
        throw new Error(
          "Advertisement not found"
        );
      }

      let target =
        safeString(
          firstDefined(
            ad.telegram_chat_id,
            ad.telegramChatId,
            ad.target_chat_id,
            ad.targetChatId
          )
        );

      let chatId = "";

      const isNumericTelegramId =
        /^-?\d+$/.test(
          target
        );

      const isUUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          target
        );

      const username =
        target
          .replace(
            /^@/,
            ""
          )
          .trim();

      if (
        target &&
        isNumericTelegramId
      ) {
        chatId =
          target;
      } else if (
        target &&
        isUUID
      ) {
        const {
          data: channel,
          error: channelError
        } =
          await supabase
            .from(
              "telegram_channels"
            )
            .select(
              "id, name, chat_id, username, type, is_active"
            )
            .eq(
              "id",
              target
            )
            .maybeSingle();

        if (channelError) {
          throw channelError;
        }

        if (!channel) {
          throw new Error(
            "የተመረጠው Telegram Channel አልተገኘም።"
          );
        }

        if (
          channel.is_active ===
          false
        ) {
          throw new Error(
            `Telegram Channel "${channel.name}" አይሰራም።`
          );
        }

        chatId =
          safeString(
            channel.chat_id
          );
      } else if (
        target &&
        username
      ) {
        let channel = null;

        let result =
          await supabase
            .from(
              "telegram_channels"
            )
            .select(
              "id, name, chat_id, username, type, is_active"
            )
            .eq(
              "username",
              username
            )
            .maybeSingle();

        if (
          result.error
        ) {
          throw result.error;
        }

        channel =
          result.data ||
          null;

        if (!channel) {
          result =
            await supabase
              .from(
                "telegram_channels"
              )
              .select(
                "id, name, chat_id, username, type, is_active"
              )
              .eq(
                "username",
                `@${username}`
              )
              .maybeSingle();

          if (
            result.error
          ) {
            throw result.error;
          }

          channel =
            result.data ||
            null;
        }

        if (!channel) {
          const {
            data: channels,
            error: channelsError
          } =
            await supabase
              .from(
                "telegram_channels"
              )
              .select(
                "id, name, chat_id, username, type, is_active"
              );

          if (channelsError) {
            throw channelsError;
          }

          const wanted =
            username
              .replace(
                /^@/,
                ""
              )
              .toLowerCase();

          channel =
            (
              channels || []
            ).find(
              (item) => {
                const stored =
                  safeString(
                    item.username
                  )
                    .replace(
                      /^@/,
                      ""
                    )
                    .toLowerCase();

                return (
                  stored ===
                  wanted
                );
              }
            ) || null;
        }

        if (!channel) {
          throw new Error(
            `Telegram username "${target}" በtelegram_channels ውስጥ አልተገኘም።`
          );
        }

        if (
          channel.is_active ===
          false
        ) {
          throw new Error(
            `Telegram Channel "${channel.name}" አይሰራም።`
          );
        }

        chatId =
          safeString(
            channel.chat_id
          );
      }

      if (!chatId) {
        const settings =
          await getTelegramSettings();

        chatId =
          safeString(
            firstDefined(
              settings.telegram_chat_id,
              settings.ad_chat_id,
              settings.admin_chat_id,
              settings.channel_id,
              settings.group_id,
              ADMIN_CHAT_ID
            )
          );
      }

      if (!chatId) {
        throw new Error(
          "Telegram Chat ID missing"
        );
      }

      const telegramChat =
        await verifyTelegramChat(
          chatId
        );

      chatId =
        String(
          telegramChat.id
        );

      const caption =
        `🔥 ${
          ad.title ||
          "ማስታወቂያ"
        }\n\n${
          ad.text || ""
        }`;

      const buttonText =
        ad.button_text ||
        "Order Now";

      const buttonUrl =
        `https://t.me/${BOT_USERNAME}?start=catalog`;

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

      let telegramResult;

      if (
        ad.photo_url
      ) {
        try {
          telegramResult =
            await sendPhotoFromUrl(
              chatId,
              ad.photo_url,
              caption,
              {
                reply_markup:
                  replyMarkup
              }
            );
        } catch (
          photoError
        ) {
          console.error(
            "Direct advertisement image upload failed:",
            photoError.message
          );

          try {
            telegramResult =
              await telegram(
                "sendPhoto",
                {
                  chat_id:
                    chatId,

                  photo:
                    ad.photo_url,

                  caption,

                  reply_markup:
                    replyMarkup
                }
              );
          } catch (
            telegramPhotoError
          ) {
            throw new Error(
              `Advertisement photo could not be sent. ${telegramPhotoError.message}`
            );
          }
        }
      } else {
        telegramResult =
          await sendMessage(
            chatId,
            caption,
            {
              reply_markup:
                replyMarkup
            }
          );
      }

      try {
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
      } catch (
        statusError
      ) {
        console.error(
          "Advertisement status update error:",
          statusError
        );
      }

      res.json({
        ok: true,

        message:
          "Advertisement published successfully",

        chat: {
          id:
            telegramChat.id,

          type:
            telegramChat.type ||
            null,

          title:
            telegramChat.title ||
            null,

          username:
            telegramChat.username
              ? `@${telegramChat.username}`
              : null
        },

        telegram_message_id:
          telegramResult?.message_id ||
          null
      });
    } catch (error) {
      console.error(
        "ADVERTISEMENT PUBLISH ERROR:",
        error
      );

      res.status(500).json({
        ok: false,

        error:
          error.message
      });
    }
  }
);

/* =========================================================
EMPLOYEES
========================================================= */

app.get(
  "/api/employees",
  async (
    req,
    res
  ) => {
    try {
      if (!supabase) {
        return res.json([]);
      }

      const {
        data
      } =
        await supabase
          .from("employees")
          .select(
            "id, employee_code, name, username, role, active, created_at"
          )
          .order(
            "created_at",
            {
              ascending:
                false
            }
          );

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
  async (
    req,
    res
  ) => {
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

      res.json({
        ok: true,
        employee:
          newEmp
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

app.delete(
  "/api/employees/:id",
  async (
    req,
    res
  ) => {
    try {
      if (supabase) {
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
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
REPORTS
========================================================= */

app.get(
  "/api/reports",
  async (
    req,
    res
  ) => {
    try {
      if (!supabase) {
        return res.json({
          ok: true,
          summary: {}
        });
      }

      const {
        data: ordersData
      } =
        await supabase
          .from("orders")
          .select("*");

      const ordersArr =
        Array.isArray(
          ordersData
        )
          ? ordersData
          : [];

      let totalSales = 0;
      let totalProfit = 0;
      let deliveredOrders = 0;
      let pendingOrders = 0;

      ordersArr.forEach(
        (order) => {
          const status =
            String(
              order.status ||
                ""
            ).toUpperCase();

          if (
            status ===
              "DELIVERED" ||
            order.closed_at
          ) {
            totalSales +=
              Number(
                order.total ||
                  0
              );

            totalProfit +=
              Number(
                order.profit ||
                  0
              );

            deliveredOrders++;
          } else if (
            status !==
            "REJECTED"
          ) {
            pendingOrders++;
          }
        }
      );

      res.json({
        ok: true,

        summary: {
          totalOrders:
            ordersArr.length,

          totalSales,

          totalProfit,

          deliveredOrders,

          pendingOrders
        }
      });
    } catch {
      res.json({
        ok: true,
        summary: {}
      });
    }
  }
);

/* =========================================================
HEALTH
========================================================= */

app.get(
  "/api/health",
  (
    req,
    res
  ) => {
    res.json({
      ok: true,

      service:
        "Telegram Sales Manager",

      time:
        nowISO(),

      supabase:
        Boolean(
          supabase
        ),

      telegram:
        Boolean(
          BOT_TOKEN
        ),

      telegram_webhook:
        telegramWebhookActive,

      webhook_url:
        WEBHOOK_URL
          ? true
          : false
    });
  }
);

/* =========================================================
TELEGRAM STATUS
========================================================= */

app.get(
  "/api/telegram/status",
  async (
    req,
    res
  ) => {
    try {
      if (!BOT_TOKEN) {
        return res.json({
          ok: false,
          configured: false,
          webhook:
            telegramWebhookActive,
          error:
            "TELEGRAM_BOT_TOKEN is missing"
        });
      }

      const bot =
        await telegram(
          "getMe"
        );

      let webhookInfo =
        null;

      try {
        webhookInfo =
          await telegram(
            "getWebhookInfo"
          );
      } catch {}

      res.json({
        ok: true,

        configured: true,

        webhook:
          telegramWebhookActive,

        webhook_url:
          webhookInfo?.url ||
          null,

        pending_updates:
          webhookInfo?.pending_update_count ||
          0,

        bot: {
          id:
            bot.id,

          username:
            bot.username
              ? `@${bot.username}`
              : null,

          first_name:
            bot.first_name ||
            null
        }
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        configured: true,
        error:
          error.message
      });
    }
  }
);

/* =========================================================
ADMIN PAGE
========================================================= */

app.get(
  "/",
  (
    req,
    res
  ) => {
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
  (
    req,
    res
  ) => {
    res.status(404).json({
      ok: false,
      error:
        "Not found"
    });
  }
);

/* =========================================================
START
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `Telegram Sales Manager running on port ${PORT}`
    );

    console.log(
      `Master Admin username: ${MASTER_ADMIN_USERNAME}`
    );

    console.log(
      `Supabase: ${
        supabase
          ? "connected"
          : "not configured"
      }`
    );

    console.log(
      `Telegram Bot: ${
        BOT_TOKEN
          ? "configured"
          : "not configured"
      }`
    );

    console.log(
      `Telegram Webhook: ${
        WEBHOOK_URL
          ? "configured"
          : "not configured"
      }`
    );

    console.log(
      "Telegram Channels API: enabled"
    );

    if (BOT_TOKEN) {
      startTelegramBot().catch(
        (error) => {
          console.error(
            "Telegram Bot startup error:",
            error
          );
        }
      );
    } else {
      console.warn(
        "Telegram Bot NOT started: TELEGRAM_BOT_TOKEN is missing."
      );
    }
  }
);
