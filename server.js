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
  process.env.TELEGRAM_BOT_USERNAME || "uni_market_shop_bot"
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
  process.env.MASTER_ADMIN_USERNAME || "admin"
).trim();

const MASTER_ADMIN_PASSWORD = String(
  process.env.MASTER_ADMIN_PASS ||
    process.env.MASTER_ADMIN_PASSWORD ||
    process.env.WEB_PASSWORD ||
    "123456"
).trim();

const STORAGE_BUCKET = String(
  process.env.SUPABASE_STORAGE_BUCKET || "product-images"
).trim();

/* =========================
SUPABASE
========================= */

let supabase = null;

try {
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
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

    console.log("Supabase initialized.");
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

  fileFilter: (req, file, cb) => {
    if (
      !file.mimetype ||
      !file.mimetype.startsWith("image/")
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

  return `${encodedPayload}.${signature}`;
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

function getAuth(req) {
  const header =
    req.headers.authorization || "";

  if (
    header.startsWith("Bearer ")
  ) {
    const token =
      verifyAuthToken(
        header
          .slice("Bearer ".length)
          .trim()
      );

    if (token) {
      return token;
    }
  }

  const cookieHeader =
    req.headers.cookie || "";

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
  const auth = getAuth(req);

  if (!auth) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  req.auth = auth;

  next();
}

/* =========================
TELEGRAM
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
          text: "👕 አልባሳት",
          callback_data:
            "category_clothing"
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
            "category_kids"
        },
        {
          text: "👩 የሴቶች",
          callback_data:
            "category_women"
        }
      ],
      [
        {
          text: "🏠 የቤት እቃዎች",
          callback_data:
            "category_home"
        },
        {
          text: "🛍️ ሌሎች",
          callback_data:
            "category_other"
        }
      ]
    ]
  };
}

function categoryAliases(category) {
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
    map[value] || [value]
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
    categoryAliases(category);

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
TELEGRAM BOT POLLING
========================================================= */

let telegramPollingRunning =
  false;

let telegramUpdateOffset =
  0;

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

async function sendBotWelcome(
  chatId
) {
  const name =
    safeString(
      arguments[1]
    ) || "";

  const greetingName =
    name
      ? ` ${name}`
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
              item.id === category
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
          String(orderChatId) !==
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

async function startTelegramBotPolling() {
  if (
    telegramPollingRunning ||
    !BOT_TOKEN
  ) {
    return;
  }

  telegramPollingRunning =
    true;

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
        startTelegramBotPolling().catch(
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
    ) || "image/jpeg";

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

  if (!imageBuffer.length) {
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
    String(caption || "")
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
    const { data } =
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
    const { data } =
      await supabase
        .from("payment_settings")
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
    const { data } =
      await supabase
        .from("telegram_settings")
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
  async (req, res) => {
    try {
      const username =
        safeString(
          req.body?.username
        );

      const password =
        String(
          req.body?.password || ""
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
         
