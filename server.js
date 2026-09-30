/* =========================================================
   TELEGRAM SALES MANAGER / UNI MARKET
   COMPLETE SERVER.JS
   PART 1 / 3
========================================================= */

"use strict";

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const app = express();

const PORT = Number(
  process.env.PORT || 10000
);

/* =========================================================
   BASIC MIDDLEWARE
========================================================= */

app.use(cors());

app.use(
  express.json({
    limit: "15mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "15mb"
  })
);

const PUBLIC_DIR = path.join(
  __dirname,
  "public"
);

app.use(
  express.static(PUBLIC_DIR)
);

/* =========================================================
   ENVIRONMENT
========================================================= */

const SUPABASE_URL = String(
  process.env.SUPABASE_URL || ""
).trim();

const SUPABASE_SERVICE_ROLE_KEY =
  String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      ""
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

const MASTER_ADMIN_USERNAME =
  String(
    process.env.MASTER_ADMIN_USERNAME ||
      "admin"
  ).trim();

const MASTER_ADMIN_PASSWORD =
  String(
    process.env.MASTER_ADMIN_PASS ||
      process.env.MASTER_ADMIN_PASSWORD ||
      process.env.WEB_PASSWORD ||
      "123456"
  ).trim();

const STORAGE_BUCKET =
  String(
    process.env.SUPABASE_STORAGE_BUCKET ||
      "product-images"
  ).trim();

const WEBHOOK_URL =
  String(
    process.env.WEBHOOK_URL || ""
  ).trim();

const TELEGRAM_WEBHOOK_SECRET =
  String(
    process.env.TELEGRAM_WEBHOOK_SECRET ||
      crypto
        .createHash("sha256")
        .update(
          `${AUTH_SECRET}:${BOT_USERNAME}`
        )
        .digest("hex")
        .slice(0, 40)
  ).trim();

/* =========================================================
   SUPABASE
========================================================= */

let supabase = null;

try {
  if (
    SUPABASE_URL &&
    SUPABASE_SERVICE_ROLE_KEY
  ) {
    supabase =
      createClient(
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
    "Supabase initialization error:",
    error
  );
}

/* =========================================================
   UPLOAD
========================================================= */

const upload = multer({
  storage:
    multer.memoryStorage(),

  limits: {
    fileSize:
      8 * 1024 * 1024
  },

  fileFilter:
    (
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

/* =========================================================
   GENERAL HELPERS
========================================================= */

function nowISO() {
  return new Date().toISOString();
}

function safeString(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value).trim();
}

function firstDefined(
  ...values
) {
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

function base64url(
  buffer
) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizeStatus(
  status
) {
  return safeString(
    status
  ).toUpperCase();
}

function makeOrderNumber() {
  const date =
    new Date();

  const y =
    date.getFullYear();

  const m =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const d =
    String(
      date.getDate()
    ).padStart(2, "0");

  const random =
    Math.floor(
      1000 +
        Math.random() *
          9000
    );

  return `UNI-${y}${m}${d}-${random}`;
}

/* =========================================================
   AUTH TOKEN
========================================================= */

function createAuthToken(
  payload
) {
  const encodedPayload =
    base64url(
      Buffer.from(
        JSON.stringify(
          payload
        )
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

  return (
    `${encodedPayload}.${signature}`
  );
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
        ).toString(
          "utf8"
        )
      );

    if (
      payload.exp &&
      Date.now() >
        Number(payload.exp)
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
          error,
          derivedKey
        ) => {
          if (error) {
            return reject(
              error
            );
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
        !String(
          stored
        ).startsWith(
          "scrypt:"
        )
      ) {
        return resolve(
          false
        );
      }

      const parts =
        String(
          stored
        ).split(":");

      if (
        parts.length !== 3
      ) {
        return resolve(
          false
        );
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
          error,
          derivedKey
        ) => {
          if (error) {
            return resolve(
              false
            );
          }

          try {
            resolve(
              crypto.timingSafeEqual(
                storedHash,
                derivedKey
              )
            );
          } catch {
            resolve(
              false
            );
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
            7
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

function requireMasterAdmin(
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

  if (
    auth.role !==
    "MASTER_ADMIN"
  ) {
    return res.status(403).json({
      ok: false,
      error:
        "Master Admin permission required"
    });
  }

  req.auth = auth;

  next();
}

const EMPLOYEE_PERMISSION_MAP = {
  products:
    "products",

  delete_product:
    "delete_product",

  view_orders:
    "view_orders",

  verify_payment:
    "verify_payment",

  confirm_order:
    "confirm_order",

  advertising:
    "advertising",

  payment_settings:
    "payment_settings",

  telegram_settings:
    "telegram_settings",

  employees:
    "employees",

  reports:
    "reports",

  delivery:
    "delivery"
};

function employeePermissions(
  employee
) {
  if (!employee) {
    return [];
  }

  const candidates = [
    employee.permissions,
    employee.employee_permissions,
    employee.permission_list
  ];

  for (
    const value of candidates
  ) {
    if (
      Array.isArray(value)
    ) {
      return value.map(
        (item) =>
          safeString(item)
      );
    }

    if (
      typeof value ===
      "string"
    ) {
      try {
        const parsed =
          JSON.parse(value);

        if (
          Array.isArray(
            parsed
          )
        ) {
          return parsed.map(
            (item) =>
              safeString(item)
          );
        }
      } catch {}

      return value
        .split(",")
        .map(
          (item) =>
            safeString(item)
        )
        .filter(Boolean);
    }

    if (
      value &&
      typeof value ===
        "object"
    ) {
      return Object.keys(
        value
      ).filter(
        (key) =>
          Boolean(
            value[key]
          )
      );
    }
  }

  return [];
}

function hasPermission(
  auth,
  permission
) {
  if (
    !auth
  ) {
    return false;
  }

  if (
    auth.role ===
    "MASTER_ADMIN"
  ) {
    return true;
  }

  const list =
    Array.isArray(
      auth.permissions
    )
      ? auth.permissions
      : [];

  return (
    list.includes(
      permission
    ) ||
    list.includes(
      EMPLOYEE_PERMISSION_MAP[
        permission
      ] || permission
    )
  );
}

function requirePermission(
  permission
) {
  return (
    req,
    res,
    next
  ) => {
    const auth =
      getAuth(req);

    if (!auth) {
      return res.status(401).json({
        ok: false,
        error:
          "Unauthorized"
      });
    }

    if (
      !hasPermission(
        auth,
        permission
      )
    ) {
      return res.status(403).json({
        ok: false,
        error:
          "Permission denied"
      });
    }

    req.auth = auth;

    next();
  };
}

/* =========================================================
   TELEGRAM HTTP
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
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(
            body
          )
      }
    );

  let data;

  try {
    data =
      await response.json();
  } catch {
    throw new Error(
      `Telegram ${method}: invalid response`
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
      chat_id:
        chatId,

      text:
        String(
          text || ""
        ),

      ...extra
    }
  );
}

async function editMessageText(
  chatId,
  messageId,
  text,
  extra = {}
) {
  return telegram(
    "editMessageText",
    {
      chat_id:
        chatId,

      message_id:
        messageId,

      text:
        String(
          text || ""
        ),

      ...extra
    }
  );
}

async function deleteTelegramMessage(
  chatId,
  messageId
) {
  try {
    return await telegram(
      "deleteMessage",
      {
        chat_id:
          chatId,

        message_id:
          messageId
      }
    );
  } catch (
    error
  ) {
    console.error(
      "Telegram deleteMessage error:",
      error.message
    );

    return null;
  }
}

async function answerCallback(
  callbackQueryId
) {
  if (!callbackQueryId) {
    return;
  }

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

/* =========================================================
   PRODUCT CATEGORIES
========================================================= */

const PRODUCT_CATEGORIES = [
  {
    id:
      "clothing",

    name:
      "👕 አልባሳት"
  },

  {
    id:
      "electronics",

    name:
      "📱 ኤሌክትሮኒክስ"
  },

  {
    id:
      "kids",

    name:
      "🧒 የህፃናት"
  },

  {
    id:
      "women",

    name:
      "👩 የሴቶች"
  },

  {
    id:
      "home",

    name:
      "🏠 የቤት እቃዎች"
  },

  {
    id:
      "other",

    name:
      "🛍️ ሌሎች"
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
    safeString(
      category
    ).toLowerCase();

  const map = {
    clothing: [
      "clothing",
      "clothes",
      "አልባሳት"
    ],

    clothes: [
      "clothing",
      "clothes",
      "አልባሳት"
    ],

    electronics: [
      "electronics",
      "electronic",
      "ኤሌክትሮኒክስ",
      "ኤሌክትሮኒክ"
    ],

    kids: [
      "kids",
      "children",
      "የህፃናት"
    ],

    children: [
      "kids",
      "children",
      "የህፃናት"
    ],

    women: [
      "women",
      "የሴቶች"
    ],

    home: [
      "home",
      "furniture",
      "የቤት እቃዎች"
    ],

    furniture: [
      "home",
      "furniture",
      "የቤት እቃዎች"
    ],

    other: [
      "other",
      "others",
      "ሌሎች"
    ],

    others: [
      "other",
      "others",
      "ሌሎች"
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
  } catch (
    error
  ) {
    console.error(
      "getBotProducts error:",
      error
    );

    return [];
  }
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
   TELEGRAM PRODUCT PHOTO
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
      "Photo URL missing"
    );
  }

  const imageResponse =
    await fetch(url);

  if (
    !imageResponse.ok
  ) {
    throw new Error(
      `Could not download image: HTTP ${imageResponse.status}`
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
      "URL did not return an image"
    );
  }

  const imageBuffer =
    Buffer.from(
      await imageResponse.arrayBuffer()
    );

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
    "parse_mode",
    "HTML"
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
    "product.jpg"
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
        method:
          "POST",

        body:
          form
      }
    );

  const data =
    await response.json();

  if (!data.ok) {
    throw new Error(
      data.description ||
        "Telegram sendPhoto error"
    );
  }

  return data.result;
}

/* =========================================================
   ORDER / BOT STATE
========================================================= */

/*
 * This in-memory state is used for the active
 * Telegram conversation.
 *
 * The final order itself is stored in Supabase.
 *
 * Render restart clears only an unfinished
 * conversation, not completed orders.
 */

const botSessions =
  new Map();

function getBotSession(
  chatId
) {
  const key =
    String(chatId);

  if (
    !botSessions.has(
      key
    )
  ) {
    botSessions.set(
      key,
      {
        chatId:
          key,

        step:
          "IDLE",

        cart:
          [],

        customerName:
          "",

        phone:
          "",

        deliveryName:
          "",

        paymentMethod:
          "",

        paymentAmount:
          0,

        paymentReference:
          "",

        receiptFileId:
          "",

        receiptFileUniqueId:
          "",

        receiptFileUrl:
          "",

        orderId:
          "",

        orderNumber:
          "",

        lastProductId:
          "",

        updatedAt:
          Date.now()
      }
    );
  }

  const session =
    botSessions.get(
      key
    );

  session.updatedAt =
    Date.now();

  return session;
}

function clearBotSession(
  chatId
) {
  botSessions.delete(
    String(chatId)
  );
}

function cartTotal(
  cart
) {
  return (
    Array.isArray(cart)
      ? cart
      : []
  ).reduce(
    (
      total,
      item
    ) =>
      total +
      numberValue(
        item.unit_price,
        0
      ) *
        numberValue(
          item.quantity,
          0
        ),
    0
  );
}

function cartQuantity(
  cart
) {
  return (
    Array.isArray(cart)
      ? cart
      : []
  ).reduce(
    (
      total,
      item
    ) =>
      total +
      numberValue(
        item.quantity,
        0
      ),
    0
  );
}

function formatMoney(
  value
) {
  return `${numberValue(
    value,
    0
  )} ብር`;
}

function formatCart(
  cart
) {
  if (
    !Array.isArray(cart) ||
    cart.length === 0
  ) {
    return "🛒 ቅርጫትዎ ባዶ ነው።";
  }

  let text =
    "🛒 <b>የእርስዎ ቅርጫት</b>\n\n";

  cart.forEach(
    (
      item,
      index
    ) => {
      const lineTotal =
        numberValue(
          item.unit_price,
          0
        ) *
        numberValue(
          item.quantity,
          0
        );

      text +=
        `${index + 1}. <b>${safeString(
          item.name
        )}</b>\n`;

      text +=
        `   🔢 ብዛት: ${item.quantity}\n`;

      text +=
        `   💰 አንዱ: ${formatMoney(
          item.unit_price
        )}\n`;

      text +=
        `   💵 ጠቅላላ: ${formatMoney(
          lineTotal
        )}\n\n`;
    }
  );

  text +=
    `📦 ጠቅላላ ብዛት: <b>${cartQuantity(
      cart
    )}</b>\n`;

  text +=
    `💳 ጠቅላላ ዋጋ: <b>${formatMoney(
      cartTotal(cart)
    )}</b>`;

  return text;
}

/* =========================================================
   QUANTITY KEYBOARD
========================================================= */

function quantityKeyboard(
  productId,
  stock
) {
  const available =
    Math.max(
      0,
      Number(stock) || 0
    );

  const rows = [];

  const firstRow = [];

  for (
    const qty of [
      1,
      2
    ]
  ) {
    if (
      qty <= available
    ) {
      firstRow.push({
        text:
          String(qty),

        callback_data:
          `qty_${productId}_${qty}`
      });
    }
  }

  if (
    firstRow.length
  ) {
    rows.push(
      firstRow
    );
  }

  const secondRow = [];

  for (
    const qty of [
      3,
      4
    ]
  ) {
    if (
      qty <= available
    ) {
      secondRow.push({
        text:
          String(qty),

        callback_data:
          `qty_${productId}_${qty}`
      });
    }
  }

  if (
    secondRow.length
  ) {
    rows.push(
      secondRow
    );
  }

  rows.push([
    {
      text:
        "✏️ ሌላ ብዛት",

      callback_data:
        `qty_custom_${productId}`
    }
  ]);

  rows.push([
    {
      text:
        "⬅️ ወደ ምርት",

      callback_data:
        `product_${productId}`
    }
  ]);

  return {
    inline_keyboard:
      rows
  };
}

/* =========================================================
   CART KEYBOARD
========================================================= */

function cartKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text:
            "➕ ሌላ ምርት",

          callback_data:
            "catalog"
        }
      ],

      [
        {
          text:
            "🧾 ትዕዛዙን ቀጥል",

          callback_data:
            "checkout"
        }
      ],

      [
        {
          text:
            "🗑️ ቅርጫቱን አጽዳ",

          callback_data:
            "cart_clear"
        }
      ]
    ]
  };
}

/* =========================================================
   PAYMENT KEYBOARD
========================================================= */

function paymentKeyboard(
  total
) {
  const amount =
    formatMoney(
      total
    );

  return {
    inline_keyboard: [
      [
        {
          text:
            `💳 ሙሉ ክፍያ — ${amount}`,

          callback_data:
            "pay_full"
        }
      ],

      [
        {
          text:
            "💰 ቅድሚያ",

          callback_data:
            "pay_advance"
        },

        {
          text:
            "💵 ቀብድ",

          callback_data:
            "pay_deposit"
        }
      ],

      [
        {
          text:
            "⬅️ ተመለስ",

          callback_data:
            "back_to_cart"
        }
      ]
    ]
  };
}

/* =========================================================
   DATABASE HELPERS
========================================================= */

async function getOrderById(
  orderId
) {
  if (!supabase) {
    return null;
  }

  try {
    const {
      data,
      error
    } =
      await supabase
        .from("orders")
        .select("*")
        .eq(
          "id",
          orderId
        )
        .maybeSingle();

    if (error) {
      console.error(
        "getOrderById error:",
        error
      );

      return null;
    }

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
   PRODUCT FETCH
========================================================= */

async function getProductById(
  productId
) {
  if (!supabase) {
    return null;
  }

  try {
    const {
      data,
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
        "getProductById error:",
        error
      );

      return null;
    }

    return data || null;
  } catch {
    return null;
  }
}

/* =========================================================
   CUSTOMER ORDER TABLE COMPATIBILITY
========================================================= */

function buildOrderRow(
  session,
  cart,
  paymentMethod,
  paymentAmount
) {
  const total =
    cartTotal(
      cart
    );

  const itemCount =
    cartQuantity(
      cart
    );

  const customerName =
    safeString(
      session.customerName
    );

  const phone =
    safeString(
      session.phone
    );

  const deliveryName =
    safeString(
      session.deliveryName
    ) ||
    customerName;

  return {
    order_number:
      makeOrderNumber(),

    telegram_chat_id:
      String(
        session.chatId
      ),

    telegram_user_id:
      String(
        session.chatId
      ),

    customer_id:
      String(
        session.chatId
      ),

    customer_name:
      customerName,

    name:
      customerName,

    phone:
      phone,

    customer_phone:
      phone,

    delivery_name:
      deliveryName,

    total:
      total,

    grand_total:
      total,

    item_count:
      itemCount,

    quantity:
      itemCount,

    status:
      "NEW",

    payment_status:
      "PENDING",

    payment_method:
      paymentMethod,

    payment_amount:
      numberValue(
        paymentAmount,
        0
      ),

    receipt_status:
      "PENDING",

    items:
      cart,

    order_items:
      cart,

    created_at:
      nowISO()
  };
}

/* =========================================================
   INSERT ORDER WITH COMPATIBILITY
========================================================= */

async function insertOrder(
  session,
  cart,
  paymentMethod,
  paymentAmount
) {
  if (!supabase) {
    throw new Error(
      "Supabase unavailable"
    );
  }

  const row =
    buildOrderRow(
      session,
      cart,
      paymentMethod,
      paymentAmount
    );

  /*
   * First attempt:
   * full modern row.
   */
  let result =
    await supabase
      .from("orders")
      .insert(row)
      .select("*")
      .single();

  if (
    !result.error
  ) {
    return result.data;
  }

  /*
   * Compatibility fallback for an older
   * orders table that does not contain
   * all optional columns.
   */
  console.error(
    "Full order insert failed:",
    result.error
  );

  const fallback = {
    telegram_chat_id:
      row.telegram_chat_id,

    customer_id:
      row.customer_id,

    customer_name:
      row.customer_name,

    phone:
      row.phone,

    total:
      row.total,

    status:
      "NEW"
  };

  result =
    await supabase
      .from("orders")
      .insert(
        fallback
      )
      .select("*")
      .single();

  if (
    result.error
  ) {
    throw result.error;
  }

  /*
   * Try to enrich the old row.
   * Failure here should not destroy the
   * already-created order.
   */
  try {
    const updateData = {
      payment_status:
        row.payment_status,

      payment_method:
        row.payment_method,

      payment_amount:
        row.payment_amount,

      receipt_status:
        row.receipt_status,

      delivery_name:
        row.delivery_name,

      order_number:
        row.order_number
    };

    await supabase
      .from("orders")
      .update(
        updateData
      )
      .eq(
        "id",
        result.data.id
      );
  } catch {}

  return {
    ...result.data,
    ...row,
    id:
      result.data.id
  };
}

/* =========================================================
   SAVE ORDER ITEMS
========================================================= */

async function saveOrderItems(
  orderId,
  cart
) {
  if (
    !supabase ||
    !orderId ||
    !Array.isArray(cart)
  ) {
    return;
  }

  /*
   * Preferred table:
   * order_items
   */
  const rows =
    cart.map(
      (item) => ({
        order_id:
          orderId,

        product_id:
          item.product_id,

        product_name:
          item.name,

        quantity:
          numberValue(
            item.quantity,
            0
          ),

        unit_price:
          numberValue(
            item.unit_price,
            0
          ),

        total:
          numberValue(
            item.unit_price,
            0
          ) *
          numberValue(
            item.quantity,
            0
          ),

        buy_price:
          numberValue(
            item.buy_price,
            0
          ),

        created_at:
          nowISO()
      })
    );

  try {
    const {
      error
    } =
      await supabase
        .from(
          "order_items"
        )
        .insert(
          rows
        );

    if (error) {
      console.warn(
        "order_items insert skipped:",
        error.message
      );
    }
  } catch (
    error
  ) {
    console.warn(
      "order_items table unavailable:",
      error.message
    );
  }
}

/* =========================================================
   UPDATE ORDER SAFELY
========================================================= */

async function updateOrderSafe(
  orderId,
  values
) {
  if (
    !supabase ||
    !orderId
  ) {
    return null;
  }

  try {
    const {
      data,
      error
    } =
      await supabase
        .from("orders")
        .update(
          values
        )
        .eq(
          "id",
          orderId
        )
        .select("*")
        .single();

    if (error) {
      console.error(
        "updateOrderSafe error:",
        error
      );

      return null;
    }

    return data;
  } catch (
    error
  ) {
    console.error(
      "updateOrderSafe exception:",
      error
    );

    return null;
  }
}

/* =========================================================
   STOCK CHECK
========================================================= */

async function verifyCartStock(
  cart
) {
  if (
    !Array.isArray(cart)
  ) {
    return {
      ok:
        false,

      error:
        "Cart is invalid"
    };
  }

  for (
    const item of cart
  ) {
    const product =
      await getProductById(
        item.product_id
      );

    if (!product) {
      return {
        ok:
          false,

        error:
          `ምርቱ "${item.name}" አልተገኘም።`
      };
    }

    const stock =
      numberValue(
        product.stock,
        0
      );

    const quantity =
      numberValue(
        item.quantity,
        0
      );

    if (
      quantity <= 0
    ) {
      return {
        ok:
          false,

        error:
          `የ"${item.name}" ብዛት ትክክል አይደለም።`
      };
    }

    if (
      quantity > stock
    ) {
      return {
        ok:
          false,

        error:
          `የ"${item.name}" በቂ ክምችት የለም። ያለው: ${stock}`
      };
    }
  }

  return {
    ok:
      true
  };
}

/* =========================================================
   STOCK DECREASE
========================================================= */

async function decreaseOrderStock(
  order
) {
  if (
    !supabase ||
    !order
  ) {
    return {
      ok:
        false,

      error:
        "Order/Supabase unavailable"
    };
  }

  let cart =
    order.items ||
    order.order_items ||
    [];

  if (
    typeof cart ===
    "string"
  ) {
    try {
      cart =
        JSON.parse(
          cart
        );
    } catch {
      cart = [];
    }
  }

  if (
    !Array.isArray(cart) ||
    cart.length === 0
  ) {
    /*
     * Legacy single-product order
     */
    const productId =
      firstDefined(
        order.product_id,
        order.productId
      );

    const quantity =
      numberValue(
        firstDefined(
          order.quantity,
          order.qty
        ),
        1
      );

    if (!productId) {
      return {
        ok:
          true,

        skipped:
          true
      };
    }

    cart = [
      {
        product_id:
          productId,

        quantity:
          quantity
      }
    ];
  }

  /*
   * Check all stock first.
   * This prevents partially reducing stock.
   */
  const stockCheck =
    await verifyCartStock(
      cart
    );

  if (
    !stockCheck.ok
  ) {
    return stockCheck;
  }

  for (
    const item of cart
  ) {
    const product =
      await getProductById(
        item.product_id
      );

    const oldStock =
      numberValue(
        product.stock,
        0
      );

    const qty =
      numberValue(
        item.quantity,
        0
      );

    const newStock =
      Math.max(
        0,
        oldStock - qty
      );

    const {
      error
    } =
      await supabase
        .from("products")
        .update({
          stock:
            newStock
        })
        .eq(
          "id",
          item.product_id
        );

    if (error) {
      throw error;
    }
  }

  return {
    ok:
      true
  };
}

/* =========================================================
   PROFIT CALCULATION
========================================================= */

function calculateOrderProfit(
  cart
) {
  if (
    !Array.isArray(cart)
  ) {
    return 0;
  }

  return cart.reduce(
    (
      profit,
      item
    ) => {
      const qty =
        numberValue(
          item.quantity,
          0
        );

      const sell =
        numberValue(
          item.unit_price,
          0
        );

      const buy =
        numberValue(
          item.buy_price,
          0
        );

      return (
        profit +
        (sell - buy) *
          qty
      );
    },
    0
  );
}

/* =========================================================
   PAYMENT SETTINGS TEXT
========================================================= */

function paymentSettingsText(
  settings,
  total
) {
  let text =
    "💳 <b>የክፍያ መረጃ</b>\n\n";

  text +=
    `💵 የትዕዛዝ ጠቅላላ: <b>${formatMoney(
      total
    )}</b>\n\n`;

  const fields = [
    [
      "🏦 ባንክ",
      settings.bank_name
    ],

    [
      "💳 የባንክ ሂሳብ",
      settings.bank_account
    ],

    [
      "📱 Telebirr",
      settings.telebirr
    ],

    [
      "📱 CBE Birr",
      settings.cbe_birr
    ],

    [
      "📱 M-Pesa",
      settings.mpesa
    ],

    [
      "📱 Awash",
      settings.awash
    ]
  ];

  let hasAny =
    false;

  for (
    const [
      label,
      value
    ] of fields
  ) {
    if (
      safeString(value)
    ) {
      text +=
        `${label}: <b>${safeString(
          value
        )}</b>\n`;

      hasAny =
        true;
    }
  }

  if (
    !hasAny
  ) {
    text +=
      "⚠️ የክፍያ መረጃ አስተዳዳሪው እስካሁን አላስገባም።\n";
  }

  text +=
    "\n📸 ክፍያውን ከፈጸሙ በኋላ ደረሰኙን እዚህ በፎቶ ይላኩ።";

  return text;
}

/* =========================================================
   BOT WELCOME
========================================================= */

async function sendBotWelcome(
  chatId,
  name = ""
) {
  const greetingName =
    safeString(name)
      ? ` ${safeString(
          name
        )}`
      : "";

  await sendMessage(
    chatId,

    `👋 እንኳን ወደ <b>UNI MARKET</b>${greetingName} በደህና መጡ!\n\n🛍️ የሚፈልጉትን ምርት ይምረጡ።\n\n👇 ከታች ያለውን የምርቶች ቁልፍ ይጫኑ።`,

    {
      parse_mode:
        "HTML",

      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                "🛍️ ምርቶች",

              callback_data:
                "catalog"
            }
          ],

          [
            {
              text:
                "🛒 ቅርጫት",

              callback_data:
                "show_cart"
            }
          ]
        ]
      }
    }
  );
}

/* =========================================================
   BOT CATALOG
========================================================= */

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

/* =========================================================
   BOT PRODUCT
========================================================= */

async function sendBotProduct(
  chatId,
  productId
) {
  const product =
    await getProductById(
      productId
    );

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
    ) ||
    "ምርት";

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
    `💰 ዋጋ: <b>${formatMoney(
      price
    )}</b>\n` +
    `📦 ያለው ብዛት: <b>${stock}</b>\n\n` +
    `👇 ለማዘዝ የማዘዣ ቁልፉን ይጫኑ።`;

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
            "🛒 ቅርጫት",

          callback_data:
            "show_cart"
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

  if (
    photoUrl
  ) {
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
    } catch (
      error
    ) {
      console.error(
        "Product photo send failed:",
        error.message
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

/* =========================================================
   ORDER PRODUCT
========================================================= */

async function startProductOrder(
  chatId,
  productId
) {
  const product =
    await getProductById(
      productId
    );

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

  if (
    stock <= 0
  ) {
    return sendMessage(
      chatId,

      "❌ ይህ ምርት አሁን ከክምችት ውጭ ነው።",

      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  "⬅️ ምርቶች",

                callback_data:
                  "catalog"
              }
            ]
          ]
        }
      }
    );
  }

  const session =
    getBotSession(
      chatId
    );

  session.lastProductId =
    String(
      product.id
    );

  session.step =
    "WAITING_QUANTITY";

  await sendMessage(
    chatId,

    `🛒 <b>${safeString(
      product.name
    )}</b>\n\n` +
      `💰 ዋጋ: <b>${formatMoney(
        product.sell_price
      )}</b>\n` +
      `📦 ያለው: <b>${stock}</b>\n\n` +
      `🔢 እባክዎ የሚፈልጉትን ብዛት ይምረጡ።`,

    {
      parse_mode:
        "HTML",

      reply_markup:
        quantityKeyboard(
          product.id,
          stock
        )
    }
  );
}

/* =========================================================
   ADD PRODUCT TO CART
========================================================= */

async function addProductToCart(
  chatId,
  productId,
  quantity
) {
  const product =
    await getProductById(
      productId
    );

  if (!product) {
    return sendMessage(
      chatId,
      "❌ ምርቱ አልተገኘም።"
    );
  }

  const stock =
    numberValue(
      product.stock,
      0
    );

  const qty =
    Number(
      quantity
    );

  if (
    !Number.isInteger(
      qty
    ) ||
    qty <= 0
  ) {
    return sendMessage(
      chatId,
      "⚠️ የምርት ብዛት ትክክል አይደለም።"
    );
  }

  const session =
    getBotSession(
      chatId
    );

  const existingIndex =
    session.cart.findIndex(
      (item) =>
        String(
          item.product_id
        ) ===
        String(
          product.id
        )
    );

  const existingQty =
    existingIndex >= 0
      ? numberValue(
          session.cart[
            existingIndex
          ].quantity,
          0
        )
      : 0;

  const requestedTotal =
    existingQty +
    qty;

  if (
    requestedTotal >
    stock
  ) {
    return sendMessage(
      chatId,

      `⚠️ የ"${safeString(
        product.name
      )}" ያለው ክምችት ${stock} ብቻ ነው።`
    );
  }

  const cartItem = {
    product_id:
      product.id,

    name:
      safeString(
        product.name
      ),

    quantity:
      qty,

    unit_price:
      numberValue(
        product.sell_price,
        0
      ),

    buy_price:
      numberValue(
        product.buy_price,
        0
      ),

    photo_url:
      firstDefined(
        product.photo_url,
        product.photoUrl
      )
  };

  if (
    existingIndex >= 0
  ) {
    session.cart[
      existingIndex
    ].quantity =
      requestedTotal;
  } else {
    session.cart.push(
      cartItem
    );
  }

  session.lastProductId =
    String(
      product.id
    );

  session.step =
    "CART";

  await sendMessage(
    chatId,

    `✅ <b>${safeString(
      product.name
    )}</b> ወደ ቅርጫትዎ ተጨምሯል።\n\n${formatCart(
      session.cart
    )}`,

    {
      parse_mode:
        "HTML",

      reply_markup:
        cartKeyboard()
    }
  );
}

/* =========================================================
   SHOW CART
========================================================= */

async function showCart(
  chatId
) {
  const session =
    getBotSession(
      chatId
    );

  if (
    !session.cart.length
  ) {
    session.step =
      "IDLE";

    return sendMessage(
      chatId,

      "🛒 ቅርጫትዎ ባዶ ነው።",

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

  session.step =
    "CART";

  return sendMessage(
    chatId,

    formatCart(
      session.cart
    ),

    {
      parse_mode:
        "HTML",

      reply_markup:
        cartKeyboard()
    }
  );
}

/* =========================================================
   CLEAR CART
========================================================= */

async function clearCart(
  chatId
) {
  const session =
    getBotSession(
      chatId
    );

  session.cart =
    [];

  session.step =
    "IDLE";

  await sendMessage(
    chatId,

    "🗑️ ቅርጫትዎ ተጽድቷል።",

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

/* =========================================================
   START CHECKOUT
========================================================= */

async function startCheckout(
  chatId
) {
  const session =
    getBotSession(
      chatId
    );

  if (
    !session.cart.length
  ) {
    return showCart(
      chatId
    );
  }

  const stockCheck =
    await verifyCartStock(
      session.cart
    );

  if (
    !stockCheck.ok
  ) {
    return sendMessage(
      chatId,
      `⚠️ ${stockCheck.error}`
    );
  }

  /*
   * If customer information is missing,
   * request name + phone in ONE message.
   */
  if (
    !session.customerName ||
    !session.phone
  ) {
    session.step =
      "WAITING_CUSTOMER_INFO";

    return sendMessage(
      chatId,

      "👤 <b>የደንበኛ መረጃ</b>\n\n" +
        "እባክዎ <b>ስምዎን እና ስልክ ቁጥርዎን</b> በአንድ መልዕክት ይላኩ።\n\n" +
        "ለምሳሌ:\n" +
        "ካሚላ 0912345678",

      {
        parse_mode:
          "HTML"
      }
    );
  }

  session.step =
    "WAITING_DELIVERY_NAME";

  return sendMessage(
    chatId,

    "📦 <b>የማድረሻ ስም</b>\n\n" +
      "እቃው ሲደርስ የሚጠራበትን ስም ይላኩ።\n\n" +
      `የደንበኛ ስምዎ: ${session.customerName}`,

    {
      parse_mode:
        "HTML"
    }
  );
}

/* =========================================================
   PAYMENT SELECTION
========================================================= */

async function showPaymentOptions(
  chatId
) {
  const session =
    getBotSession(
      chatId
    );

  const total =
    cartTotal(
      session.cart
    );

  session.step =
    "WAITING_PAYMENT_METHOD";

  const settings =
    await getPaymentSettings();

  const text =
    paymentSettingsText(
      settings,
      total
    ) +
    "\n\n👇 የክፍያ አይነት ይምረጡ።";

  return sendMessage(
    chatId,
    text,
    {
      parse_mode:
        "HTML",

      reply_markup:
        paymentKeyboard(
          total
        )
    }
  );
}

/* =========================================================
   PAYMENT AMOUNT
========================================================= */

async function setPaymentMethod(
  chatId,
  method
) {
  const session =
    getBotSession(
      chatId
    );

  const total =
    cartTotal(
      session.cart
    );

  session.paymentMethod =
    method;

  if (
    method ===
    "FULL"
  ) {
    session.paymentAmount =
      total;

    return requestReceipt(
      chatId
    );
  }

  /*
   * Advance/deposit:
   * ask customer to enter amount.
   */
  session.step =
    "WAITING_PAYMENT_AMOUNT";

  const label =
    method ===
    "ADVANCE"
      ? "ቅድሚያ"
      : "ቀብድ";

  return sendMessage(
    chatId,

    `💰 <b>${label}</b>\n\n` +
      `የትዕዛዝ ጠቅላላ: <b>${formatMoney(
        total
      )}</b>\n\n` +
      `እባክዎ የሚከፍሉትን መጠን በብር ይጻፉ።`,

    {
      parse_mode:
        "HTML",

      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                "⬅️ ወደ ክፍያ",

              callback_data:
                "back_to_payment"
            }
          ]
        ]
      }
    }
  );
}

/* =========================================================
   RECEIPT REQUEST
========================================================= */

async function requestReceipt(
  chatId
) {
  const session =
    getBotSession(
      chatId
    );

  const total =
    cartTotal(
      session.cart
    );

  session.step =
    "WAITING_RECEIPT";

  return sendMessage(
    chatId,

    "📸 <b>ደረሰኝ ይላኩ</b>\n\n" +
      `🧾 የትዕዛዝ ጠቅላላ: <b>${formatMoney(
        total
      )}</b>\n` +
      `💳 የከፈሉት: <b>${formatMoney(
        session.paymentAmount
      )}</b>\n\n` +
      "እባክዎ የክፍያ ደረሰኙን <b>በፎቶ</b> ይላኩ።\n\n" +
      "⚠️ አንድ ትዕዛዝ = አንድ የክፍያ ደረሰኝ።",

    {
      parse_mode:
        "HTML"
    }
  );
}

/* =========================================================
   PAYMENT AMOUNT VALIDATION
========================================================= */

async function handlePaymentAmount(
  chatId,
  text
) {
  const session =
    getBotSession(
      chatId
    );

  const amount =
    Number(
      String(
        text
      )
        .replace(
          /,/g,
          ""
        )
        .replace(
          /ብር/g,
          ""
        )
        .trim()
    );

  const total =
    cartTotal(
      session.cart
    );

  if (
    !Number.isFinite(
      amount
    ) ||
    amount <= 0
  ) {
    return sendMessage(
      chatId,
      "⚠️ እባክዎ ትክክለኛ የክፍያ መጠን ያስገቡ።"
    );
  }

  if (
    amount > total
  ) {
    return sendMessage(
      chatId,

      `⚠️ የክፍያ መጠኑ ከትዕዛዙ ጠቅላላ ${formatMoney(
        total
      )} መብለጥ አይችልም።`
    );
  }

  session.paymentAmount =
    amount;

  return requestReceipt(
    chatId
  );
}

/* =========================================================
   CUSTOMER INFO PARSER
========================================================= */

function parseCustomerInfo(
  text
) {
  const value =
    safeString(
      text
    );

  /*
   * Supports:
   * Name 0912345678
   * Name - 0912345678
   * Name, 0912345678
   */
  const phoneMatch =
    value.match(
      /(?:\+251|251|0)?9\d{8}/
    );

  if (
    !phoneMatch
  ) {
    return null;
  }

  const rawPhone =
    phoneMatch[0];

  let phone =
    rawPhone;

  if (
    phone.startsWith(
      "+251"
    )
  ) {
    phone =
      "0" +
      phone.slice(4);
  } else if (
    phone.startsWith(
      "251"
    )
  ) {
    phone =
      "0" +
      phone.slice(3);
  } else if (
    phone.length ===
    9
  ) {
    phone =
      "0" +
      phone;
  }

  const name =
    value
      .replace(
        rawPhone,
        ""
      )
      .replace(
        /[-,:;|]/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  if (
    !name
  ) {
    return null;
  }

  return {
    name,
    phone
  };
}

/* =========================================================
   PART 1 ENDS HERE
   CONTINUE DIRECTLY WITH PART 2
========================================================*/
/* =========================================================
   TELEGRAM RECEIPT FILE
========================================================= */

async function getTelegramFileUrl(
  fileId
) {
  if (!BOT_TOKEN) {
    throw new Error(
      "Telegram token missing"
    );
  }

  const file =
    await telegram(
      "getFile",
      {
        file_id:
          fileId
      }
    );

  if (
    !file ||
    !file.file_path
  ) {
    throw new Error(
      "Telegram file path missing"
    );
  }

  return (
    `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
  );
}

/* =========================================================
   CREATE ORDER AFTER RECEIPT
========================================================= */

async function createOrderFromSession(
  chatId
) {
  const session =
    getBotSession(
      chatId
    );

  if (
    !session.cart.length
  ) {
    throw new Error(
      "Cart is empty"
    );
  }

  if (
    !session.customerName ||
    !session.phone
  ) {
    throw new Error(
      "Customer information missing"
    );
  }

  const stockCheck =
    await verifyCartStock(
      session.cart
    );

  if (
    !stockCheck.ok
  ) {
    throw new Error(
      stockCheck.error
    );
  }

  const order =
    await insertOrder(
      session,
      session.cart,
      session.paymentMethod,
      session.paymentAmount
    );

  if (!order) {
    throw new Error(
      "Order could not be created"
    );
  }

  session.orderId =
    String(
      order.id
    );

  session.orderNumber =
    safeString(
      order.order_number
    ) ||
    makeOrderNumber();

  /*
   * Save items if order_items table exists.
   */
  await saveOrderItems(
    order.id,
    session.cart
  );

  /*
   * Store profit calculation if the
   * column exists.
   */
  const profit =
    calculateOrderProfit(
      session.cart
    );

  await updateOrderSafe(
    order.id,
    {
      profit:
        profit,

      items:
        session.cart,

      order_items:
        session.cart,

      receipt_status:
        "PENDING",

      payment_status:
        "PENDING"
    }
  );

  return order;
}

/* =========================================================
   SAVE RECEIPT
========================================================= */

async function saveReceiptForOrder(
  orderId,
  receiptData
) {
  if (
    !supabase ||
    !orderId
  ) {
    return null;
  }

  /*
   * First update orders table.
   */
  const orderUpdate =
    {
      receipt_status:
        "PENDING",

      receipt_file_id:
        receiptData.file_id,

      receipt_file_unique_id:
        receiptData.file_unique_id,

      receipt_url:
        receiptData.file_url,

      payment_amount:
        receiptData.amount,

      payment_method:
        receiptData.payment_method,

      payment_status:
        "PENDING",

      receipt_submitted_at:
        nowISO()
    };

  const updated =
    await updateOrderSafe(
      orderId,
      orderUpdate
    );

  /*
   * Optional receipts table.
   */
  try {
    const {
      error
    } =
      await supabase
        .from("receipts")
        .insert({
          order_id:
            orderId,

          file_id:
            receiptData.file_id,

          file_unique_id:
            receiptData.file_unique_id,

          file_url:
            receiptData.file_url,

          amount:
            receiptData.amount,

          payment_method:
            receiptData.payment_method,

          status:
            "PENDING",

          created_at:
            nowISO()
        });

    if (error) {
      console.warn(
        "receipts table insert skipped:",
        error.message
      );
    }
  } catch (
    error
  ) {
    console.warn(
      "receipts table unavailable:",
      error.message
    );
  }

  return updated;
}

/* =========================================================
   ADMIN NOTIFICATION
========================================================= */

async function getAdminChatId() {
  if (
    ADMIN_CHAT_ID
  ) {
    return ADMIN_CHAT_ID;
  }

  const settings =
    await getTelegramSettings();

  return safeString(
    firstDefined(
      settings.admin_chat_id,
      settings.telegram_chat_id,
      settings.group_id,
      settings.channel_id
    )
  );
}

function orderItemsText(
  cart
) {
  if (
    !Array.isArray(cart)
  ) {
    return "";
  }

  let text = "";

  cart.forEach(
    (
      item,
      index
    ) => {
      const qty =
        numberValue(
          item.quantity,
          0
        );

      const price =
        numberValue(
          item.unit_price,
          0
        );

      text +=
        `${index + 1}. ${safeString(
          item.name
        )}\n`;

      text +=
        `   ${qty} × ${formatMoney(
          price
        )} = ${formatMoney(
          qty * price
        )}\n`;
    }
  );

  return text;
}

async function notifyAdminNewOrder(
  order,
  session
) {
  const adminChatId =
    await getAdminChatId();

  if (
    !adminChatId
  ) {
    console.warn(
      "ADMIN_CHAT_ID not configured; order notification skipped."
    );

    return;
  }

  const text =
    "🛒 <b>አዲስ ትዕዛዝ!</b>\n\n" +
    `🧾 ትዕዛዝ: <b>${safeString(
      order.order_number
    )}</b>\n` +
    `👤 ስም: <b>${safeString(
      session.customerName
    )}</b>\n` +
    `📱 ስልክ: <b>${safeString(
      session.phone
    )}</b>\n` +
    `📦 ማድረሻ ስም: <b>${safeString(
      session.deliveryName
    )}</b>\n\n` +
    `🛍️ <b>ምርቶች:</b>\n${orderItemsText(
      session.cart
    )}\n` +
    `💵 ጠቅላላ: <b>${formatMoney(
      cartTotal(
        session.cart
      )
    )}</b>\n` +
    `💳 የክፍያ አይነት: <b>${safeString(
      session.paymentMethod
    )}</b>\n` +
    `💰 የተከፈለ: <b>${formatMoney(
      session.paymentAmount
    )}</b>\n\n` +
    "📸 ደረሰኝ: እየተጠበቀ ነው።";

  await sendMessage(
    adminChatId,
    text,
    {
      parse_mode:
        "HTML"
    }
  );
}

async function notifyAdminReceipt(
  order
) {
  const adminChatId =
    await getAdminChatId();

  if (
    !adminChatId
  ) {
    return;
  }

  let cart =
    order.items ||
    order.order_items ||
    [];

  if (
    typeof cart ===
    "string"
  ) {
    try {
      cart =
        JSON.parse(
          cart
        );
    } catch {
      cart = [];
    }
  }

  const text =
    "🧾 <b>አዲስ ደረሰኝ ቀርቧል!</b>\n\n" +
    `🧾 ትዕዛዝ: <b>${safeString(
      order.order_number
    )}</b>\n` +
    `👤 ደንበኛ: <b>${safeString(
      firstDefined(
        order.customer_name,
        order.name
      )
    )}</b>\n` +
    `📱 ስልክ: <b>${safeString(
      firstDefined(
        order.phone,
        order.customer_phone
      )
    )}</b>\n` +
    `💰 የተከፈለ: <b>${formatMoney(
      order.payment_amount
    )}</b>\n` +
    `💳 አይነት: <b>${safeString(
      order.payment_method
    )}</b>\n\n` +
    `🛍️ ${orderItemsText(
      cart
    )}`;

  await sendMessage(
    adminChatId,
    text,
    {
      parse_mode:
        "HTML",

      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                "✅ ክፍያ አረጋግጥ",

              callback_data:
                `admin_verify_payment_${order.id}`
            }
          ],

          [
            {
              text:
                "❌ ክፍያ አትቀበል",

              callback_data:
                `admin_reject_payment_${order.id}`
            }
          ]
        ]
      }
    }
  );

  /*
   * Also send receipt image if available.
   */
  if (
    order.receipt_file_id
  ) {
    try {
      await telegram(
        "sendPhoto",
        {
          chat_id:
            adminChatId,

          photo:
            order.receipt_file_id,

          caption:
            `🧾 ደረሰኝ — ${safeString(
              order.order_number
            )}`
        }
      );
    } catch (
      error
    ) {
      console.error(
        "Admin receipt photo notification error:",
        error.message
      );
    }
  }
}

/* =========================================================
   CUSTOMER ORDER CREATED MESSAGE
========================================================= */

async function sendOrderPendingMessage(
  chatId,
  order,
  session
) {
  const total =
    cartTotal(
      session.cart
    );

  await sendMessage(
    chatId,

    "✅ <b>ትዕዛዝዎ ተቀብሏል!</b>\n\n" +
      `🧾 ትዕዛዝ: <b>${safeString(
        order.order_number
      )}</b>\n` +
      `💵 ጠቅላላ: <b>${formatMoney(
        total
      )}</b>\n` +
      `💰 የተከፈለ: <b>${formatMoney(
        session.paymentAmount
      )}</b>\n\n` +
      "🧾 ደረሰኝዎ ለአስተዳደሩ ተልኳል።\n" +
      "⏳ ክፍያዎ እስኪረጋገጥ ድረስ እባክዎ ይጠብቁ።",

    {
      parse_mode:
        "HTML"
    }
  );
}

/* =========================================================
   RECEIPT MESSAGE HANDLER
========================================================= */

async function handleReceiptPhoto(
  message
) {
  const chatId =
    message.chat?.id;

  if (!chatId) {
    return;
  }

  const session =
    getBotSession(
      chatId
    );

  if (
    session.step !==
    "WAITING_RECEIPT"
  ) {
    return;
  }

  const photo =
    Array.isArray(
      message.photo
    )
      ? message.photo[
          message.photo.length -
            1
        ]
      : null;

  if (
    !photo?.file_id
  ) {
    return sendMessage(
      chatId,
      "⚠️ የደረሰኝ ፎቶ አልተገኘም። እባክዎ ደረሰኙን በፎቶ እንደገና ይላኩ።"
    );
  }

  try {
    /*
     * If order does not exist yet, create it now.
     */
    let order;

    if (
      session.orderId
    ) {
      order =
        await getOrderById(
          session.orderId
        );
    }

    if (!order) {
      order =
        await createOrderFromSession(
          chatId
        );
    }

    const fileUrl =
      await getTelegramFileUrl(
        photo.file_id
      );

    const receiptData = {
      file_id:
        photo.file_id,

      file_unique_id:
        photo.file_unique_id ||
        "",

      file_url:
        fileUrl,

      amount:
        session.paymentAmount,

      payment_method:
        session.paymentMethod
    };

    const updated =
      await saveReceiptForOrder(
        order.id,
        receiptData
      );

    const finalOrder =
      updated ||
      {
        ...order,

        ...receiptData
      };

    session.orderId =
      String(
        order.id
      );

    session.orderNumber =
      safeString(
        order.order_number
      );

    session.receiptFileId =
      photo.file_id;

    session.receiptFileUniqueId =
      photo.file_unique_id ||
      "";

    session.receiptFileUrl =
      fileUrl;

    session.step =
      "RECEIPT_PENDING";

    await notifyAdminReceipt(
      finalOrder
    );

    await sendOrderPendingMessage(
      chatId,
      finalOrder,
      session
    );

    /*
     * The active cart remains until the order
     * has been accepted. This protects against
     * accidental duplicate submission.
     */
  } catch (
    error
  ) {
    console.error(
      "Receipt handler error:",
      error
    );

    await sendMessage(
      chatId,

      "⚠️ ደረሰኙን ማስመዝገብ አልተቻለም።\n\nእባክዎ እንደገና ይሞክሩ።"
    );
  }
}

/* =========================================================
   FINAL CUSTOMER DELIVERY MESSAGE
========================================================= */

async function sendDeliveryMessage(
  order
) {
  const chatId =
    safeString(
      firstDefined(
        order.telegram_chat_id,
        order.customer_id
      )
    );

  if (!chatId) {
    return;
  }

  await sendMessage(
    chatId,

    "🚚 <b>ትዕዛዝዎ በማድረስ ሂደት ላይ ነው!</b>\n\n" +
      `🧾 ትዕዛዝ: <b>${safeString(
        order.order_number
      )}</b>\n\n` +
      "📦 እቃዎ ሲደርስ ከታች ያለውን <b>📦 ደርሶኛል</b> ቁልፍ ይጫኑ።",

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
                `order_received_${order.id}`
            }
          ]
        ]
      }
    }
  );
}

/* =========================================================
   FINAL THANK YOU
========================================================= */

async function sendFinalThankYou(
  chatId,
  order
) {
  await sendMessage(
    chatId,

    "🎉 <b>ትዕዛዝዎ ተሳክቶ ተጠናቋል!</b>\n\n" +
      `🧾 የትዕዛዝ ቁጥር: <b>${safeString(
        order.order_number
      )}</b>\n\n` +
      "ውድ የ<b>UNI MARKET</b> ቤተሰብ፣\n\n" +
      "ስለገዙን እና ስለተማመኑብን ከልብ እናመሰግናለን። ❤️\n\n" +
      "ከUNI MARKET ጋር የጀመሩትን ይህን ትስስር ወደ ዘላቂ ቤተሰባዊ ግንኙነት ለማሳደግ በየጊዜው በተሻለ አገልግሎት ከጎንዎ እንገኛለን።\n\n" +
      "🙏 እንኳን ወደ UNI MARKET ቤተሰብ በደህና መጡ!\n\n" +
      "🛍️ ሌላ ጊዜም እንጠብቅዎታለን።",

    {
      parse_mode:
        "HTML",

      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                "🛍️ ሌሎች ምርቶች",

              callback_data:
                "catalog"
            }
          ]
        ]
      }
    }
  );
}

/* =========================================================
   TELEGRAM CALLBACK HANDLER
========================================================= */

async function handleTelegramCallback(
  update
) {
  const callback =
    update.callback_query;

  if (!callback) {
    return;
  }

  const callbackData =
    safeString(
      callback.data
    );

  const chatId =
    callback.message?.chat?.id;

  await answerCallback(
    callback.id
  );

  if (!chatId) {
    return;
  }

  /* -----------------------------------------
     CATEGORY LIST
  ----------------------------------------- */

  if (
    callbackData ===
      "product_categories" ||
    callbackData ===
      "categories"
  ) {
    return sendMessage(
      chatId,

      "📂 <b>የምርት ምድቦች</b>\n\nእባክዎ የሚፈልጉትን ምድብ ይምረጡ።",

      {
        parse_mode:
          "HTML",

        reply_markup:
          productCategoriesKeyboard()
      }
    );
  }

  /* -----------------------------------------
     CATALOG
  ----------------------------------------- */

  if (
    callbackData ===
    "catalog"
  ) {
    return sendBotCatalog(
      chatId
    );
  }

  /* -----------------------------------------
     CATEGORY
  ----------------------------------------- */

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
        (
          item
        ) =>
          item.id ===
          category
      );

    const categoryName =
      categoryInfo?.name ||
      "🛍️ ምርቶች";

    if (
      products.length ===
      0
    ) {
      return sendMessage(
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
    }

    return sendMessage(
      chatId,

      `${categoryName}\n\n👇 ከታች ያለውን ምርት ይምረጡ።`,

      {
        reply_markup:
          productListKeyboard(
            products
          )
      }
    );
  }

  /* -----------------------------------------
     PRODUCT
  ----------------------------------------- */

  if (
    callbackData.startsWith(
      "product_"
    )
  ) {
    const productId =
      callbackData.slice(
        "product_".length
      );

    if (
      productId
    ) {
      return sendBotProduct(
        chatId,
        productId
      );
    }
  }

  /* -----------------------------------------
     ORDER PRODUCT
  ----------------------------------------- */

  if (
    callbackData.startsWith(
      "order_product_"
    )
  ) {
    const productId =
      callbackData.slice(
        "order_product_".length
      );

    return startProductOrder(
      chatId,
      productId
    );
  }

  /* -----------------------------------------
     QUANTITY
  ----------------------------------------- */

  if (
    callbackData.startsWith(
      "qty_custom_"
    )
  ) {
    const productId =
      callbackData.slice(
        "qty_custom_".length
      );

    const session =
      getBotSession(
        chatId
      );

    session.lastProductId =
      productId;

    session.step =
      "WAITING_CUSTOM_QUANTITY";

    return sendMessage(
      chatId,

      "✏️ <b>ሌላ ብዛት</b>\n\nእባክዎ የሚፈልጉትን ቁጥር ይጻፉ።",

      {
        parse_mode:
          "HTML"
      }
    );
  }

  if (
    callbackData.startsWith(
      "qty_"
    )
  ) {
    const parts =
      callbackData.split(
        "_"
      );

    /*
     * qty_PRODUCTID_NUMBER
     *
     * UUID product IDs contain hyphens,
     * therefore reconstruct everything between
     * qty_ and the final quantity.
     */
    if (
      parts.length >= 3
    ) {
      const quantity =
        Number(
          parts[
            parts.length - 1
          ]
        );

      const productId =
        parts
          .slice(
            1,
            -1
          )
          .join("_");

      if (
        productId &&
        Number.isInteger(
          quantity
        )
      ) {
        await addProductToCart(
          chatId,
          productId,
          quantity
        );

        return showCart(
          chatId
        );
      }
    }
  }

  /* -----------------------------------------
     SHOW CART
  ----------------------------------------- */

  if (
    callbackData ===
    "show_cart"
  ) {
    return showCart(
      chatId
    );
  }

  /* -----------------------------------------
     CLEAR CART
  ----------------------------------------- */

  if (
    callbackData ===
    "cart_clear"
  ) {
    return clearCart(
      chatId
    );
  }

  /* -----------------------------------------
     CHECKOUT
  ----------------------------------------- */

  if (
    callbackData ===
    "checkout"
  ) {
    return startCheckout(
      chatId
    );
  }

  /* -----------------------------------------
     BACK TO CART
  ----------------------------------------- */

  if (
    callbackData ===
      "back_to_cart"
  ) {
    return showCart(
      chatId
    );
  }

  /* -----------------------------------------
     PAYMENT
  ----------------------------------------- */

  if (
    callbackData ===
    "pay_full"
  ) {
    return setPaymentMethod(
      chatId,
      "FULL"
    );
  }

  if (
    callbackData ===
    "pay_advance"
  ) {
    return setPaymentMethod(
      chatId,
      "ADVANCE"
    );
  }

  if (
    callbackData ===
    "pay_deposit"
  ) {
    return setPaymentMethod(
      chatId,
      "DEPOSIT"
    );
  }

  if (
    callbackData ===
    "back_to_payment"
  ) {
    return showPaymentOptions(
      chatId
    );
  }

  /* -----------------------------------------
     ADMIN VERIFY PAYMENT
  ----------------------------------------- */

  if (
    callbackData.startsWith(
      "admin_verify_payment_"
    )
  ) {
    return handleAdminVerifyPayment(
      chatId,
      callbackData.slice(
        "admin_verify_payment_".length
      ),
      callback
    );
  }

  /* -----------------------------------------
     ADMIN REJECT PAYMENT
  ----------------------------------------- */

  if (
    callbackData.startsWith(
      "admin_reject_payment_"
    )
  ) {
    return handleAdminRejectPayment(
      chatId,
      callbackData.slice(
        "admin_reject_payment_".length
      ),
      callback
    );
  }

  /* -----------------------------------------
     CUSTOMER DELIVERY RECEIVED
  ----------------------------------------- */

  if (
    callbackData.startsWith(
      "order_received_"
    )
  ) {
    return handleOrderReceived(
      chatId,
      callbackData.slice(
        "order_received_".length
      )
    );
  }
}

/* =========================================================
   CUSTOMER DELIVERY RECEIVED
========================================================= */

async function handleOrderReceived(
  chatId,
  orderId
) {
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
    return sendMessage(
      chatId,
      "❌ የትዕዛዙ መረጃ አልተገኘም።"
    );
  }

  const ownerChatId =
    safeString(
      firstDefined(
        order.telegram_chat_id,
        order.customer_id
      )
    );

  if (
    ownerChatId &&
    String(
      ownerChatId
    ) !==
      String(chatId)
  ) {
    return sendMessage(
      chatId,
      "⚠️ ይህን ትዕዛዝ ለመዝጋት ፈቃድ የለዎትም።"
    );
  }

  const currentStatus =
    normalizeStatus(
      order.status
    );

  if (
    currentStatus ===
    "DELIVERED"
  ) {
    return sendMessage(
      chatId,

      "✅ ይህ ትዕዛዝ አስቀድሞ እንደደረሰ ተመዝግቧል።"
    );
  }

  const updated =
    await updateOrderSafe(
      orderId,
      {
        status:
          "DELIVERED",

        delivered_at:
          nowISO(),

        closed_at:
          nowISO()
      }
    );

  if (!updated) {
    return sendMessage(
      chatId,
      "⚠️ ትዕዛዙን መዝጋት አልተቻለም።"
    );
  }

  /*
   * Try to remove the old button.
   */
  if (
    order.telegram_message_id
  ) {
    try {
      await editMessageText(
        chatId,
        order.telegram_message_id,
        "✅ <b>ትዕዛዙ ደርሷል</b>\n\nይህ ትዕዛዝ በደንብ ተጠናቋል።",
        {
          parse_mode:
            "HTML"
        }
      );
    } catch {}
  }

  await sendFinalThankYou(
    chatId,
    updated
  );

  /*
   * Clear customer active session after
   * successful delivery.
   */
  clearBotSession(
    chatId
  );
}

/* =========================================================
   ADMIN VERIFY PAYMENT
========================================================= */

async function handleAdminVerifyPayment(
  adminChatId,
  orderId,
  callback
) {
  const order =
    await getOrderById(
      orderId
    );

  if (!order) {
    return sendMessage(
      adminChatId,
      "❌ ትዕዛዙ አልተገኘም።"
    );
  }

  const customerChatId =
    safeString(
      firstDefined(
        order.telegram_chat_id,
        order.customer_id
      )
    );

  /*
   * Prevent duplicate verification.
   */
  if (
    normalizeStatus(
      order.payment_status
    ) ===
      "CONFIRMED" ||
    normalizeStatus(
      order.receipt_status
    ) ===
      "VERIFIED"
  ) {
    return sendMessage(
      adminChatId,

      "ℹ️ ይህ ክፍያ አስቀድሞ ተረጋግጧል።"
    );
  }

  /*
   * First mark payment verified.
   */
  let updated =
    await updateOrderSafe(
      orderId,
      {
        payment_status:
          "CONFIRMED",

        receipt_status:
          "VERIFIED",

        receipt_verified_at:
          nowISO(),

        receipt_verified_by:
          "Admin"
      }
    );

  if (!updated) {
    return sendMessage(
      adminChatId,
      "❌ የክፍያ ማረጋገጫ ማስቀመጥ አልተቻለም።"
    );
  }

  /*
   * Decrease stock exactly once.
   */
  try {
    const alreadyDeducted =
      Boolean(
        order.stock_deducted_at
      );

    if (
      !alreadyDeducted
    ) {
      const stockResult =
        await decreaseOrderStock(
          order
        );

      if (
        !stockResult.ok
      ) {
        await updateOrderSafe(
          orderId,
          {
            payment_status:
              "PENDING",

            receipt_status:
              "PENDING"
          }
        );

        return sendMessage(
          adminChatId,

          `⚠️ ክፍያው አልተጠናቀቀም።\n\n${stockResult.error}`
        );
      }

      await updateOrderSafe(
        orderId,
        {
          stock_deducted_at:
            nowISO()
        }
      );
    }
  } catch (
    error
  ) {
    console.error(
      "Stock deduction error:",
      error
    );

    await updateOrderSafe(
      orderId,
      {
        payment_status:
          "PENDING",

        receipt_status:
          "PENDING"
      }
    );

    return sendMessage(
      adminChatId,
      "⚠️ ክምችት ማስተካከል አልተቻለም። እባክዎ ትዕዛዙን እንደገና ያረጋግጡ።"
    );
  }

  /*
   * Order now moves to delivery pending.
   */
  updated =
    await updateOrderSafe(
      orderId,
      {
        status:
          "DELIVERY_PENDING",

        confirmed_at:
          nowISO(),

        confirmed_by:
          "Admin"
      }
    );

  /*
   * Customer notification.
   */
  if (
    customerChatId
  ) {
    try {
      await sendMessage(
        customerChatId,

        "✅ <b>ክፍያዎ ተረጋግጧል!</b>\n\n" +
          `🧾 ትዕዛዝ: <b>${safeString(
            firstDefined(
              updated?.order_number,
              order.order_number
            )
          )}</b>\n\n` +
          "📦 እቃዎ በማድረስ ሂደት ላይ ነው።\n" +
          "🚚 እቃው ሲደርስ <b>📦 ደርሶኛል</b> ይጫኑ።",

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
                    `order_received_${orderId}`
                }
              ]
            ]
          }
        }
      );
    } catch (
      error
    ) {
      console.error(
        "Customer confirmation notification error:",
        error.message
      );
    }
  }

  return sendMessage(
    adminChatId,

    `✅ <b>ክፍያ ተረጋግጧል</b>\n\n🧾 ${safeString(
      firstDefined(
        updated?.order_number,
        order.order_number
      )
    )}\n\n📦 ክምችት ተቀንሷል።\n🚚 ትዕዛዙ ወደ ማድረስ ሂደት ገብቷል።`,

    {
      parse_mode:
        "HTML"
    }
  );
}

/* =========================================================
   ADMIN REJECT PAYMENT
========================================================= */

async function handleAdminRejectPayment(
  adminChatId,
  orderId
) {
  const order =
    await getOrderById(
      orderId
    );

  if (!order) {
    return sendMessage(
      adminChatId,
      "❌ ትዕዛዙ አልተገኘም።"
    );
  }

  const updated =
    await updateOrderSafe(
      orderId,
      {
        payment_status:
          "REJECTED",

        receipt_status:
          "REJECTED",

        status:
          "PAYMENT_REJECTED",

        rejected_at:
          nowISO(),

        rejected_by:
          "Admin"
      }
    );

  if (!updated) {
    return sendMessage(
      adminChatId,
      "❌ የክፍያ ውድቅ ማስቀመጥ አልተቻለም።"
    );
  }

  const customerChatId =
    safeString(
      firstDefined(
        order.telegram_chat_id,
        order.customer_id
      )
    );

  if (
    customerChatId
  ) {
    try {
      await sendMessage(
        customerChatId,

        "❌ <b>የክፍያ ደረሰኝዎ አልተረጋገጠም።</b>\n\n" +
          "እባክዎ ደረሰኙን እንደገና ያረጋግጡ እና ትክክለኛውን ደረሰኝ በፎቶ ይላኩ።",

        {
          parse_mode:
            "HTML"
        }
      );
    } catch (
      error
    ) {
      console.error(
        "Payment rejection notification error:",
        error.message
      );
    }
  }

  return sendMessage(
    adminChatId,

    "❌ የክፍያ ደረሰኝ ውድቅ ተደርጓል።"
  );
}

/* =========================================================
   TELEGRAM UPDATE HANDLER
========================================================= */

async function handleTelegramUpdate(
  update
) {
  try {
    if (
      update.callback_query
    ) {
      return handleTelegramCallback(
        update
      );
    }

    if (
      update.message
    ) {
      return handleTelegramMessage(
        update.message
      );
    }
  } catch (
    error
  ) {
    console.error(
      "Telegram update handler error:",
      error
    );
  }
}

/* =========================================================
   TELEGRAM MESSAGE HANDLER
========================================================= */

async function handleTelegramMessage(
  message
) {
  const chatId =
    message.chat?.id;

  if (!chatId) {
    return;
  }

  const session =
    getBotSession(
      chatId
    );

  /*
   * Receipt photo must be handled before
   * text processing.
   */
  if (
    Array.isArray(
      message.photo
    ) &&
    message.photo.length
  ) {
    if (
      session.step ===
      "WAITING_RECEIPT"
    ) {
      return handleReceiptPhoto(
        message
      );
    }
  }

  const text =
    safeString(
      message.text
    );

  if (!text) {
    return;
  }

  /* -----------------------------------------
     /start
  ----------------------------------------- */

  if (
    text === "/start" ||
    text.startsWith(
      "/start "
    )
  ) {
    const parameter =
      text
        .slice(
          6
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

    if (
      parameter ===
      "catalog"
    ) {
      return sendBotCatalog(
        chatId
      );
    }

    if (
      parameter.startsWith(
        "product_"
      )
    ) {
      return sendBotProduct(
        chatId,
        parameter.slice(
          8
        )
      );
    }

    return;
  }

  /* -----------------------------------------
     /catalog
  ----------------------------------------- */

  if (
    text === "/catalog" ||
    text.toLowerCase() ===
      "catalog" ||
    text ===
      "🛍️ ምርቶች"
  ) {
    return sendBotCatalog(
      chatId
    );
  }

  /* -----------------------------------------
     CUSTOMER INFO
  ----------------------------------------- */

  if (
    session.step ===
    "WAITING_CUSTOMER_INFO"
  ) {
    const parsed =
      parseCustomerInfo(
        text
      );

    if (!parsed) {
      return sendMessage(
        chatId,

        "⚠️ እባክዎ ስም + ስልክ በአንድ መልዕክት ይላኩ።\n\nለምሳሌ:\nካሚላ 0912345678"
      );
    }

    session.customerName =
      parsed.name;

    session.phone =
      parsed.phone;

    session.step =
      "WAITING_DELIVERY_NAME";

    return sendMessage(
      chatId,

      "✅ የደንበኛ መረጃ ተቀምጧል።\n\n" +
        "📦 አሁን የማድረሻ ስም ይላኩ።",

      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  `👤 ${session.customerName}`,

                callback_data:
                  "use_customer_name"
              }
            ]
          ]
        }
      }
    );
  }

  /* -----------------------------------------
     DELIVERY NAME
  ----------------------------------------- */

  if (
    session.step ===
    "WAITING_DELIVERY_NAME"
  ) {
    if (
      text.length <
      2
    ) {
      return sendMessage(
        chatId,
        "⚠️ እባክዎ ትክክለኛ የማድረሻ ስም ይላኩ።"
      );
    }

    session.deliveryName =
      text;

    return showPaymentOptions(
      chatId
    );
  }

  /* -----------------------------------------
     CUSTOM QUANTITY
  ----------------------------------------- */

  if (
    session.step ===
    "WAITING_CUSTOM_QUANTITY"
  ) {
    const quantity =
      Number(
        text
          .replace(
            /,/g,
            ""
          )
          .trim()
      );

    if (
      !Number.isInteger(
        quantity
      ) ||
      quantity <= 0
    ) {
      return sendMessage(
        chatId,
        "⚠️ እባክዎ ትክክለኛ ቁጥር ያስገቡ።"
      );
    }

    const productId =
      session.lastProductId;

    if (!productId) {
      session.step =
        "IDLE";

      return sendMessage(
        chatId,
        "⚠️ ምርቱ አልተለየም። እባክዎ ከምርቶች ይጀምሩ።"
      );
    }

    const product =
      await getProductById(
        productId
      );

    if (!product) {
      return sendMessage(
        chatId,
        "❌ ምርቱ አልተገኘም።"
      );
    }

    const stock =
      numberValue(
        product.stock,
        0
      );

    if (
      quantity >
      stock
    ) {
      return sendMessage(
        chatId,

        `⚠️ ያለው ክምችት ${stock} ብቻ ነው።`
      );
    }

    await addProductToCart(
      chatId,
      productId,
      quantity
    );

    return showCart(
      chatId
    );
  }

  /* -----------------------------------------
     PAYMENT AMOUNT
  ----------------------------------------- */

  if (
    session.step ===
    "WAITING_PAYMENT_AMOUNT"
  ) {
    return handlePaymentAmount(
      chatId,
      text
    );
  }

  /* -----------------------------------------
     WAITING RECEIPT
  ----------------------------------------- */

  if (
    session.step ===
    "WAITING_RECEIPT"
  ) {
    return sendMessage(
      chatId,

      "📸 እባክዎ የክፍያ ደረሰኙን <b>በፎቶ</b> ይላኩ።",

      {
        parse_mode:
          "HTML"
      }
    );
  }

  /* -----------------------------------------
     USE CUSTOMER NAME
  ----------------------------------------- */

  if (
    text ===
    "እንግዲህ"
  ) {
    return;
  }

  /* -----------------------------------------
     HELPFUL FALLBACK
  ----------------------------------------- */

  if (
    text.includes(
      "ምርት"
    ) ||
    text.includes(
      "ማዘዝ"
    )
  ) {
    return sendBotCatalog(
      chatId
    );
  }

  return sendMessage(
    chatId,

    "🤖 እባክዎ ከታች ያሉትን ቁልፎች ይጠቀሙ።",

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
          ],

          [
            {
              text:
                "🛒 ቅርጫት",

              callback_data:
                "show_cart"
            }
          ]
        ]
      }
    }
  );
}

/* =========================================================
   WEBHOOK
========================================================= */

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

app.post(
  "/api/telegram/webhook",
  async (
    req,
    res
  ) => {
    if (
      !isValidTelegramWebhook(
        req
      )
    ) {
      return res.status(403).json({
        ok:
          false
      });
    }

    const update =
      req.body;

    res.status(200).json({
      ok:
        true
    });

    setImmediate(
      () => {
        handleTelegramUpdate(
          update
        ).catch(
          (
            error
          ) => {
            console.error(
              "Webhook processing error:",
              error
            );
          }
        );
      }
    );
  }
);

/* =========================================================
   TELEGRAM POLLING
========================================================= */

let telegramPollingRunning =
  false;

let telegramUpdateOffset =
  0;

let telegramWebhookActive =
  false;

async function getTelegramUpdates() {
  return telegram(
    "getUpdates",
    {
      offset:
        telegramUpdateOffset,

      timeout:
        30,

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
  } catch (
    error
  ) {
    console.error(
      "Telegram initialization error:",
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
    } catch (
      error
    ) {
      console.error(
        "Telegram polling error:",
        error.message
      );

      await new Promise(
        (
          resolve
        ) =>
          setTimeout(
            resolve,
            5000
          )
      );
    }
  }
}

/* =========================================================
   TELEGRAM BOT START
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

    if (
      WEBHOOK_URL
    ) {
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

    console.log(
      "WEBHOOK_URL not configured. Using polling."
    );

    await startTelegramPolling();
  } catch (
    error
  ) {
    console.error(
      "Telegram Bot startup error:",
      error.message
    );

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
   AUTH LOGIN
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
          ok:
            false,

          error:
            "Username and password required"
        });
      }

      /*
       * MASTER ADMIN
       */
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

            permissions:
              [
                "products",
                "delete_product",
                "view_orders",
                "verify_payment",
                "confirm_order",
                "advertising",
                "payment_settings",
                "telegram_settings",
                "employees",
                "reports",
                "delivery"
              ],

            exp:
              Date.now() +
              1000 *
                60 *
                60 *
                24 *
                7
          });

        return res.json({
          ok:
            true,

          token,

          user: {
            role:
              "MASTER_ADMIN",

            username:
              MASTER_ADMIN_USERNAME,

            name:
              "Master Admin",

            permissions:
              [
                "products",
                "delete_product",
                "view_orders",
                "verify_payment",
                "confirm_order",
                "advertising",
                "payment_settings",
                "telegram_settings",
                "employees",
                "reports",
                "delivery"
              ]
          }
        });
      }

      if (!supabase) {
        return res.status(500).json({
          ok:
            false,

          error:
            "Supabase unavailable"
        });
      }

      const {
        data:
          employee,
        error:
          employeeError
      } =
        await supabase
          .from(
            "employees"
          )
          .select("*")
          .eq(
            "username",
            username
          )
          .maybeSingle();

      if (
        employeeError
      ) {
        console.error(
          "Employee login error:",
          employeeError
        );

        return res.status(500).json({
          ok:
            false,

          error:
            "Login service error"
        });
      }

      if (
        !employee ||
        employee.active ===
          false
      ) {
        return res.status(401).json({
          ok:
            false,

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
          ok:
            false,

          error:
            "Invalid credentials"
        });
      }

      const permissions =
        employeePermissions(
          employee
        );

      try {
        await supabase
          .from(
            "employees"
          )
          .update({
            last_login_at:
              nowISO()
          })
          .eq(
            "id",
            employee.id
          );
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

          permissions:
            permissions,

          exp:
            Date.now() +
            1000 *
              60 *
              60 *
              24
        });

      return res.json({
        ok:
          true,

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

          permissions:
            permissions
        }
      });
    } catch (
      error
    ) {
      console.error(
        "AUTH LOGIN ERROR:",
        error
      );

      return res.status(500).json({
        ok:
          false,

        error:
          "Login service error"
      });
    }
  }
);

app.get(
  "/api/auth/me",
  requireAuth,
  (
    req,
    res
  ) => {
    res.json({
      ok:
        true,

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
  requirePermission(
    "products"
  ),
  async (
    req,
    res
  ) => {
    try {
      if (!supabase) {
        return res.status(500).json({
          ok:
            false,

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
            "products"
          )
          .select("*")
          .order(
            "created_at",
            {
              ascending:
                false
            }
          );

      if (
        error
      ) {
        return res.status(500).json({
          ok:
            false,

          error:
            error.message
        });
      }

      return res.json(
        data || []
      );
    } catch (
      error
    ) {
      return res.status(500).json({
        ok:
          false,

        error:
          error.message
      });
    }
  }
);

app.post(
  "/api/products",
  requirePermission(
    "products"
  ),
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

      const name =
        safeString(
          firstDefined(
            body.name,
            body.productName,
            body.title
          )
        );

      if (!name) {
        return res.status(400).json({
          ok:
            false,

          error:
            "Product name is required"
        });
      }

      const row = {
        name:
          name,

        description:
          firstDefined(
            body.description,
            null
          ),

        category:
          firstDefined(
            body.category,
            body.productCategory,
            "other"
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

        created_at:
          nowISO()
      };

      const {
        data,
        error
      } =
        await supabase
          .from(
            "products"
          )
          .insert(
            row
          )
          .select("*")
          .single();

      if (
        error
      ) {
        throw error;
      }

      return res.json({
        ok:
          true,

        product:
          data
      });
    } catch (
      error
    ) {
      return res.status(500).json({
        ok:
          false,

        error:
          error.message
      });
    }
  }
);

app.patch(
  "/api/products/:id",
  requirePermission(
    "products"
  ),
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
          safeString(
            firstDefined(
              body.name,
              body.productName,
              body.title
            )
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

      const {
        data,
        error
      } =
        await supabase
          .from(
            "products"
          )
          .update(
            row
          )
          .eq(
            "id",
            req.params.id
          )
          .select("*")
          .single();

      if (
        error
      ) {
        throw error;
      }

      return res.json({
        ok:
          true,

        product:
          data
      });
    } catch (
      error
    ) {
      return res.status(500).json({
        ok:
          false,

        error:
          error.message
      });
    }
  }
);

app.delete(
  "/api/products/:id",
  requirePermission(
    "delete_product"
  ),
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
            "products"
          )
          .delete()
          .eq(
            "id",
            req.params.id
          );

      if (
        error
      ) {
        throw error;
      }

      return res.json({
        ok:
          true
      });
    } catch (
      error
    ) {
      return res.status(500).json({
        ok:
          false,

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
  requirePermission(
    "products"
  ),
  upload.single(
    "photo"
  ),
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
          ok:
            true,

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
          .toString(
            "hex"
          )}${ext}`;

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

      if (
        error
      ) {
        console.error(
          "Storage upload error:",
          error
        );

        return res.json({
          ok:
            true,

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
          )?.data
          ?.publicUrl ||
        fallback;

      return res.json({
        ok:
          true,

        url:
          publicUrl,

        path:
          filePath
      });
    } catch (
      error
    ) {
      console.error(
        "Upload error:",
        error
      );

      return res.json({
        ok:
          true,

        url:
          "https://images.unsplash.com/photo-1523275335684-37898b6baf30"
      });
    }
  }
);

/* =========================================================
   ORDERS API
========================================================= */

app.get(
  "/api/orders",
  requirePermission(
    "view_orders"
  ),
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
          .from(
            "orders"
          )
          .select("*")
          .order(
            "created_at",
            {
              ascending:
                false
            }
          );

      if (
        error
      ) {
        throw error;
      }

      return res.json(
        data || []
      );
    } catch (
      error
    ) {
      return res.status(500).json({
        ok:
          false,

        error:
          error.message
      });
    }
  }
);

/* =========================================================
   CHANGE ORDER STATUS
========================================================= */

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

  const status =
    normalizeStatus(
      newStatus
    );

  if (
    status ===
    "CONFIRMED"
  ) {
    /*
     * Confirmation is tied to payment verification.
     */
    if (
      normalizeStatus(
        order.payment_status
      ) !==
      "CONFIRMED"
    ) {
      throw new Error(
        "Payment must be confirmed before confirming the order."
      );
    }

    /*
     * If stock was not deducted by payment
     * verification, deduct now.
     */
    if (
      !order.stock_deducted_at
    ) {
      const stockResult =
        await decreaseOrderStock(
          order
        );

      if (
        !stockResult.ok
      ) {
        throw new Error(
          stockResult.error
        );
      }

      await updateOrderSafe(
        orderId,
        {
          stock_deducted_at:
            nowISO()
        }
      );
    }

    const updated =
      await updateOrderSafe(
        orderId,
        {
          status:
            "DELIVERY_PENDING",

          confirmed_at:
            nowISO(),

          confirmed_by:
            actorName ||
            "Admin"
        }
      );

    if (
      updated
    ) {
      await sendDeliveryMessage(
        updated
      );
    }

    return updated;
  }

  const updated =
    await updateOrderSafe(
      orderId,
      {
        status:
          status
      }
    );

  return updated;
}

app.patch(
  "/api/orders/:id/status",
  requirePermission(
    "confirm_order"
  ),
  async (
    req,
    res
  ) => {
    try {
      const status =
        firstDefined(
          req.body?.status,
          req.body?.newStatus
        );

      if (!status) {
        return res.status(400).json({
          ok:
            false,

          error:
            "Order status is required"
        });
      }

      const order =
        await changeOrderStatus(
          req.params.id,
          status,
          req.auth?.name ||
            "Admin"
        );

      return res.json({
        ok:
          true,

        order:
          order
      });
    } catch (
      error
    ) {
      return res.status(400).json({
        ok:
          false,

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
  requirePermission(
    "payment_settings"
  ),
  async (
    req,
    res
  ) => {
    return res.json(
      await getPaymentSettings()
    );
  }
);

app.post(
  "/api/payment-settings",
  requirePermission(
    "payment_settings"
  ),
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

      let result;

      if (
        existing?.id
      ) {
        result =
          await supabase
            .from(
              "payment_settings"
            )
            .update(
              req.body ||
                {}
            )
            .eq(
              "id",
              existing.id
            )
            .select("*")
            .single();
      } else {
        result =
          await supabase
            .from(
              "payment_settings"
            )
            .insert(
              req.body ||
                {}
            )
            .select("*")
            .single();
      }

      if (
        result.error
      ) {
        throw result.error;
      }

      return res.json({
        ok:
          true,

        settings:
          result.data
      });
    } catch (
      error
    ) {
      return res.status(500).json({
        ok:
          false,

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
  requirePermission(
    "telegram_settings"
  ),
  async (
    req,
    res
  ) => {
    return res.json(
      await getTelegramSettings()
    );
  }
);

app.post(
  "/api/telegram-settings",
  requirePermission(
    "telegram_settings"
  ),
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

      let result;

      if (
        existing?.id
      ) {
        result =
          await supabase
            .from(
              "telegram_settings"
            )
            .update(
              req.body ||
                {}
            )
            .eq(
              "id",
              existing.id
            )
            .select("*")
            .single();
      } else {
        result =
          await supabase
            .from(
              "telegram_settings"
            )
            .insert(
              req.body ||
                {}
            )
            .select("*")
            .single();
      }

      if (
        result.error
      ) {
        throw result.error;
      }

      return res.json({
        ok:
          true,

        settings:
          result.data
      });
    } catch (
      error
    ) {
      return res.status(500).json({
        ok:
          false,

        error:
          error.message
      });
    }
  }
);

/* =========================================================
   TELEGRAM CHAT CHECK
========================================================= */

async function verifyTelegramChat(
  chatId
) {
  const id =
    safeString(
      chatId
    );

  if (!id) {
    throw new Error(
      "Telegram Chat ID missing"
    );
  }

  try {
    return await telegram(
      "getChat",
      {
        chat_id:
          id
      }
    );
  } catch (
    error
  ) {
    throw new Error(
      `Telegram Chat ID "${id}" አልተገኘም። Bot ወደ Group/Channel መጨመሩን እና Chat ID ትክክል መሆኑን ያረጋግጡ። Original: ${error.message}`
    );
  }
}

app.get(
  "/api/telegram/check-chat",
  requirePermission(
    "telegram_settings"
  ),
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
          ok:
            false,

          valid:
            false,

          error:
            "Telegram Chat ID missing"
        });
      }

      const chat =
        await verifyTelegramChat(
          chatId
        );

      return res.json({
        ok:
          true,

        valid:
          true,

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
    } catch (
      error
    ) {
      return res.status(400).json({
        ok:
          false,

        valid:
          false,

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
  requirePermission(
    "telegram_settings"
  ),
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

      if (
        error
      ) {
        throw error;
      }

      return res.json({
        ok:
          true,

        channels:
          data || []
      });
    } catch (
      error
    ) {
      return res.status(500).json({
        ok:
          false,

        error:
          error.message
      });
    }
  }
);

app.post(
  "/api/telegram-channels",
  requirePermission(
    "telegram_settings"
  ),
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
        req.body ||
        {};

      const chatId =
        safeString(
          firstDefined(
            body.chat_id,
            body.chatId,
            body.telegram_chat_id,
            body.telegramChatId
          )
        );

      if (!chatId) {
        return res.status(400).json({
          ok:
            false,

          error:
            "Telegram Chat ID missing"
        });
      }

      const chat =
        await verifyTelegramChat(
          chatId
        );

      const row = {
        name:
          safeString(
            firstDefined(
              body.name,
              body.title
            )
          ) ||
          chat.title ||
          (
            chat.username
              ? `@${chat.username}`
              : `Telegram ${chat.id}`
          ),

        chat_id:
          String(
            chat.id
          ),

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
            : true,

        created_at:
          nowISO()
      };

      const {
        data,
        error
      } =
        await supabase
          .from(
            "telegram_channels"
          )
          .insert(
            row
          )
          .select("*")
          .single();

      if (
        error
      ) {
        throw error;
      }

      return res.json({
        ok:
          true,

        channel:
          data
      });
    } catch (
      error
    ) {
      return res.status(400).json({
        ok:
          false,

        error:
          error.message
      });
    }
  }
);

app.patch(
  "/api/telegram-channels/:id",
  requirePermission(
    "telegram_settings"
  ),
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
        req.body ||
        {};

      const row = {};

      if (
        body.name !==
          undefined ||
        body.title !==
          undefined
      ) {
        row.name =
          safeString(
            firstDefined(
              body.name,
              body.title
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

      if (
        newChatId
      ) {
        const chat =
          await verifyTelegramChat(
            newChatId
          );

        row.chat_id =
          String(
            chat.id
          );

        row.username =
          chat.username
            ? `@${chat.username}`
            : null;

        row.type =
          chat.type ||
          null;

        if (
          !row.name
        ) {
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
          .update(
            row
          )
          .eq(
            "id",
            req.params.id
          )
          .select("*")
          .single();

      if (
        error
      ) {
        throw error;
      }

      return res.json({
        ok:
          true,

        channel:
          data
      });
    } catch (
      error
    ) {
      return res.status(400).json({
        ok:
          false,

        error:
          error.message
      });
    }
  }
);

app.delete(
  "/api/telegram-channels/:id",
  requirePermission(
    "telegram_settings"
  ),
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

      if (
        error
      ) {
        throw error;
      }

      return res.json({
        ok:
          true
      });
    } catch (
      error
    ) {
      return res.status(500).json({
        ok:
          false,

        error:
          error.message
      });
    }
  }
);

/* =========================================================
   PART 2 ENDS HERE
   CONTINUE DIRECTLY WITH PART 3
=========================================================*/
/* =========================================================
   ADVERTISEMENTS
========================================================= */

app.get(
  "/api/advertisements",
  requirePermission(
    "advertising"
  ),
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

      if (
        error
      ) {
        throw error;
      }

      return res.json(
        data || []
      );
    } catch (
      error
    ) {
      return res.status(500).json({
        ok:
          false,

        error:
          error.message
      });
    }
  }
);

app.post(
  "/api/advertisements",
  requirePermission(
    "advertising"
  ),
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
        req.body ||
        {};

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
          "🛍️ ምርቶች",

        telegram_chat_id:
          firstDefined(
            body.telegramChatId,
            body.telegram_chat_id,
            body.target_chat_id
          ),

        photo_url:
          firstDefined(
            body.photoUrl,
            body.photo_url,
            body.photo
          ),

        status:
          "DRAFT",

        created_at:
          nowISO()
      };

      const {
        data,
        error
      } =
        await supabase
          .from(
            "advertisements"
          )
          .insert(
            row
          )
          .select("*")
          .single();

      if (
        error
      ) {
        throw error;
      }

      return res.json({
        ok:
          true,

        advertisement:
          data
      });
    } catch (
      error
    ) {
      return res.status(500).json({
        ok:
          false,

        error:
          error.message
      });
    }
  }
);

/* =========================================================
   PUBLISH ADVERTISEMENT
========================================================= */

app.post(
  "/api/advertisements/:id/publish",
  requirePermission(
    "advertising"
  ),
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

      if (
        adError
      ) {
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

      let chatId =
        "";

      /*
       * Direct numeric Telegram Chat ID.
       */
      if (
        /^-?\d+$/.test(
          target
        )
      ) {
        chatId =
          target;
      }

      /*
       * UUID from telegram_channels.
       */
      if (
        !chatId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          target
        )
      ) {
        const {
          data: channel,
          error
        } =
          await supabase
            .from(
              "telegram_channels"
            )
            .select("*")
            .eq(
              "id",
              target
            )
            .maybeSingle();

        if (
          error
        ) {
          throw error;
        }

        if (!channel) {
          throw new Error(
            "Telegram Channel not found"
          );
        }

        if (
          channel.is_active ===
          false
        ) {
          throw new Error(
            "Telegram Channel is inactive"
          );
        }

        chatId =
          safeString(
            channel.chat_id
          );
      }

      /*
       * Username such as @mychannel.
       */
      if (
        !chatId &&
        target
      ) {
        const wanted =
          target
            .replace(
              /^@/,
              ""
            )
            .toLowerCase();

        const {
          data: channels,
          error
        } =
          await supabase
            .from(
              "telegram_channels"
            )
            .select("*");

        if (
          error
        ) {
          throw error;
        }

        const found =
          (
            channels ||
            []
          ).find(
            (
              item
            ) =>
              safeString(
                item.username
              )
                .replace(
                  /^@/,
                  ""
                )
                .toLowerCase() ===
              wanted
          );

        if (
          found
        ) {
          if (
            found.is_active ===
            false
          ) {
            throw new Error(
              "Telegram Channel is inactive"
            );
          }

          chatId =
            safeString(
              found.chat_id
            );
        }
      }

      /*
       * Fallback to settings / ADMIN_CHAT_ID.
       */
      if (
        !chatId
      ) {
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

      const chat =
        await verifyTelegramChat(
          chatId
        );

      chatId =
        String(
          chat.id
        );

      const caption =
        `🔥 <b>${
          safeString(
            ad.title
          ) ||
          "UNI MARKET"
        }</b>\n\n${
          safeString(
            ad.text
          )
        }`;

      const buttonUrl =
        `https://t.me/${BOT_USERNAME}?start=catalog`;

      const replyMarkup = {
        inline_keyboard: [
          [
            {
              text:
                ad.button_text ||
                "🛍️ ምርቶች",

              url:
                buttonUrl
            }
          ]
        ]
      };

      let result;

      if (
        ad.photo_url
      ) {
        try {
          result =
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
          error
        ) {
          console.error(
            "sendPhotoFromUrl failed:",
            error.message
          );

          result =
            await telegram(
              "sendPhoto",
              {
                chat_id:
                  chatId,

                photo:
                  ad.photo_url,

                caption:
                  caption
                    .replace(
                      /<[^>]*>/g,
                      ""
                    ),

                reply_markup:
                  replyMarkup
              }
            );
        }
      } else {
        result =
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

      await supabase
        .from(
          "advertisements"
        )
        .update({
          status:
            "PUBLISHED",

          published_at:
            nowISO(),

          published_chat_id:
            chatId,

          telegram_message_id:
            result?.message_id ||
            null
        })
        .eq(
          "id",
          req.params.id
        );

      return res.json({
        ok:
          true,

        message:
          "Advertisement published successfully",

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
        },

        telegram_message_id:
          result?.message_id ||
          null
      });
    } catch (
      error
    ) {
      console.error(
        "ADVERTISEMENT PUBLISH ERROR:",
        error
      );

      return res.status(500).json({
        ok:
          false,

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
  requireMasterAdmin,
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
          .from(
            "employees"
          )
          .select(
            "id, employee_code, name, username, role, active, permissions, employee_permissions, created_at, last_login_at"
          )
          .order(
            "created_at",
            {
              ascending:
                false
            }
          );

      if (
        error
      ) {
        throw error;
      }

      return res.json(
        data || []
      );
    } catch (
      error
    ) {
      return res.status(500).json({
        ok:
          false,

        error:
          error.message
      });
    }
  }
);

app.post(
  "/api/employees",
  requireMasterAdmin,
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
        req.body ||
        {};

      const username =
        safeString(
          body.username
        );

      const password =
        String(
          body.password ||
            ""
        );

      const name =
        safeString(
          body.name
        );

      if (
        !username ||
        !password ||
        !name
      ) {
        return res.status(400).json({
          ok:
            false,

          error:
            "Name, username and password are required"
        });
      }

      const permissions =
        Array.isArray(
          body.permissions
        )
          ? body.permissions
          : [];

      const passwordHash =
        await hashPassword(
          password
        );

      const row = {
        employee_code:
          safeString(
            body.employee_code
          ) ||
          `EMP-${Math.floor(
            100 +
              Math.random() *
                900
          )}`,

        name:
          name,

        username:
          username,

        password_hash:
          passwordHash,

        role:
          "EMPLOYEE",

        active:
          body.active !==
          undefined
            ? Boolean(
                body.active
              )
            : true,

        permissions:
          permissions,

        employee_permissions:
          permissions,

        created_at:
          nowISO()
      };

      const {
        data,
        error
      } =
        await supabase
          .from(
            "employees"
          )
          .insert(
            row
          )
          .select("*")
          .single();

      if (
        error
      ) {
        throw error;
      }

      return res.json({
        ok:
          true,

        employee:
          data
      });
    } catch (
      error
    ) {
      return res.status(500).json({
        ok:
          false,

        error:
          error.message
      });
    }
  }
);

app.patch(
  "/api/employees/:id",
  requireMasterAdmin,
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
        req.body ||
        {};

      const row = {};

      if (
        body.name !==
        undefined
      ) {
        row.name =
          safeString(
            body.name
          );
      }

      if (
        body.username !==
        undefined
      ) {
        row.username =
          safeString(
            body.username
          );
      }

      if (
        body.active !==
        undefined
      ) {
        row.active =
          Boolean(
            body.active
          );
      }

      if (
        body.permissions !==
        undefined &&
        Array.isArray(
          body.permissions
        )
      ) {
        row.permissions =
          body.permissions;

        row.employee_permissions =
          body.permissions;
      }

      if (
        body.password
      ) {
        row.password_hash =
          await hashPassword(
            body.password
          );
      }

      const {
        data,
        error
      } =
        await supabase
          .from(
            "employees"
          )
          .update(
            row
          )
          .eq(
            "id",
            req.params.id
          )
          .select("*")
          .single();

      if (
        error
      ) {
        throw error;
      }

      return res.json({
        ok:
          true,

        employee:
          data
      });
    } catch (
      error
    ) {
      return res.status(500).json({
        ok:
          false,

        error:
          error.message
      });
    }
  }
);

app.delete(
  "/api/employees/:id",
  requireMasterAdmin,
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
            "employees"
          )
          .delete()
          .eq(
            "id",
            req.params.id
          );

      if (
        error
      ) {
        throw error;
      }

      return res.json({
        ok:
          true
      });
    } catch (
      error
    ) {
      return res.status(500).json({
        ok:
          false,

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
  requirePermission(
    "reports"
  ),
  async (
    req,
    res
  ) => {
    try {
      if (!supabase) {
        return res.json({
          ok:
            true,

          summary: {}
        });
      }

      const {
        data: ordersData,
        error
      } =
        await supabase
          .from(
            "orders"
          )
          .select("*");

      if (
        error
      ) {
        throw error;
      }

      const orders =
        Array.isArray(
          ordersData
        )
          ? ordersData
          : [];

      let totalSales =
        0;

      let totalProfit =
        0;

      let deliveredOrders =
        0;

      let pendingOrders =
        0;

      let rejectedOrders =
        0;

      let todaySales =
        0;

      let todayProfit =
        0;

      const today =
        new Date()
          .toISOString()
          .slice(
            0,
            10
          );

      for (
        const order of orders
      ) {
        const status =
          normalizeStatus(
            order.status
          );

        const total =
          numberValue(
            firstDefined(
              order.total,
              order.grand_total
            ),
            0
          );

        const profit =
          numberValue(
            order.profit,
            0
          );

        if (
          status ===
            "DELIVERED" ||
          order.closed_at
        ) {
          totalSales +=
            total;

          totalProfit +=
            profit;

          deliveredOrders++;

          const created =
            safeString(
              order.created_at
            ).slice(
              0,
              10
            );

          if (
            created ===
            today
          ) {
            todaySales +=
              total;

            todayProfit +=
              profit;
          }
        } else if (
          status ===
            "REJECTED" ||
          status ===
            "PAYMENT_REJECTED"
        ) {
          rejectedOrders++;
        } else {
          pendingOrders++;
        }
      }

      return res.json({
        ok:
          true,

        summary: {
          totalOrders:
            orders.length,

          totalSales:
            totalSales,

          totalProfit:
            totalProfit,

          deliveredOrders:
            deliveredOrders,

          pendingOrders:
            pendingOrders,

          rejectedOrders:
            rejectedOrders,

          todaySales:
            todaySales,

          todayProfit:
            todayProfit
        }
      });
    } catch (
      error
    ) {
      return res.status(500).json({
        ok:
          false,

        error:
          error.message
      });
    }
  }
);

/* =========================================================
   DASHBOARD STATS
========================================================= */

app.get(
  "/api/dashboard",
  requireAuth,
  async (
    req,
    res
  ) => {
    try {
      if (!supabase) {
        return res.json({
          ok:
            true,

          stats: {
            todaySales:
              0,

            todayProfit:
              0,

            orders:
              0,

            stock:
              0
          }
        });
      }

      const [
        productsResult,
        ordersResult
      ] =
        await Promise.all([
          supabase
            .from(
              "products"
            )
            .select(
              "stock"
            ),

          supabase
            .from(
              "orders"
            )
            .select("*")
        ]);

      const products =
        productsResult.data ||
        [];

      const orders =
        ordersResult.data ||
        [];

      let stock =
        0;

      for (
        const product of products
      ) {
        stock +=
          numberValue(
            product.stock,
            0
          );
      }

      const today =
        new Date()
          .toISOString()
          .slice(
            0,
            10
          );

      let todaySales =
        0;

      let todayProfit =
        0;

      for (
        const order of orders
      ) {
        const status =
          normalizeStatus(
            order.status
          );

        if (
          status !==
            "DELIVERED" &&
          !order.closed_at
        ) {
          continue;
        }

        const date =
          safeString(
            order.created_at
          ).slice(
            0,
            10
          );

        if (
          date !==
          today
        ) {
          continue;
        }

        todaySales +=
          numberValue(
            firstDefined(
              order.total,
              order.grand_total
            ),
            0
          );

        todayProfit +=
          numberValue(
            order.profit,
            0
          );
      }

      return res.json({
        ok:
          true,

        stats: {
          todaySales:
            todaySales,

          todayProfit:
            todayProfit,

          orders:
            orders.length,

          stock:
            stock
        }
      });
    } catch (
      error
    ) {
      return res.status(500).json({
        ok:
          false,

        error:
          error.message
      });
    }
  }
);

/* =========================================================
   TELEGRAM STATUS
========================================================= */

app.get(
  "/api/telegram/status",
  requirePermission(
    "telegram_settings"
  ),
  async (
    req,
    res
  ) => {
    try {
      if (!BOT_TOKEN) {
        return res.json({
          ok:
            false,

          configured:
            false,

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

      return res.json({
        ok:
          true,

        configured:
          true,

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
    } catch (
      error
    ) {
      return res.status(400).json({
        ok:
          false,

        configured:
          true,

        error:
          error.message
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
    return res.json({
      ok:
        true,

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
        Boolean(
          WEBHOOK_URL
        )
    });
  }
);

/* =========================================================
   ADMIN PAGE
========================================================= */

app.get(
  "/login",
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
   UNKNOWN API
========================================================= */

app.use(
  "/api",
  (
    req,
    res
  ) => {
    res.status(404).json({
      ok:
        false,

      error:
        "API endpoint not found"
    });
  }
);

/* =========================================================
   GENERAL 404
========================================================= */

app.use(
  (
    req,
    res
  ) => {
    res.status(404).json({
      ok:
        false,

      error:
        "Not found"
    });
  }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "EXPRESS ERROR:",
      error
    );

    if (
      res.headersSent
    ) {
      return next(
        error
      );
    }

    res.status(500).json({
      ok:
        false,

      error:
        error.message ||
        "Internal server error"
    });
  }
);

/* =========================================================
   START SERVER — RENDER
========================================================= */

const server =
  app.listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        "================================================="
      );

      console.log(
        "🚀 Telegram Sales Manager SERVER STARTED"
      );

      console.log(
        `🌐 Port: ${PORT}`
      );

      console.log(
        "🌍 Host: 0.0.0.0"
      );

      console.log(
        `👤 Master Admin: ${MASTER_ADMIN_USERNAME}`
      );

      console.log(
        `🗄️ Supabase: ${
          supabase
            ? "connected"
            : "NOT CONFIGURED"
        }`
      );

      console.log(
        `🤖 Telegram Bot: ${
          BOT_TOKEN
            ? "configured"
            : "NOT CONFIGURED"
        }`
      );

      console.log(
        `🔗 Telegram Webhook: ${
          WEBHOOK_URL
            ? "configured"
            : "NOT CONFIGURED"
        }`
      );

      console.log(
        "📢 Telegram Channels API: enabled"
      );

      console.log(
        "🛒 Telegram Cart/Order Flow: enabled"
      );

      console.log(
        "💳 Payment/Receipt Flow: enabled"
      );

      console.log(
        "📦 Stock/Delivery Flow: enabled"
      );

      console.log(
        "👥 Employee Permissions: enabled"
      );

      console.log(
        "================================================="
      );

      /*
       * IMPORTANT:
       * HTTP server is already listening before
       * Telegram startup begins.
       */
      if (
        BOT_TOKEN
      ) {
        startTelegramBot().catch(
          (
            error
          ) => {
            console.error(
              "❌ Telegram Bot startup error:",
              error
            );
          }
        );
      } else {
        console.warn(
          "⚠️ Telegram Bot NOT started: TELEGRAM_BOT_TOKEN is missing."
        );
      }
    }
  );

/* =========================================================
   SERVER ERROR
========================================================= */

server.on(
  "error",
  (
    error
  ) => {
    console.error(
      "================================================="
    );

    console.error(
      "❌ SERVER LISTEN ERROR"
    );

    console.error(
      error
    );

    console.error(
      "================================================="
    );

    process.exit(
      1
    );
  }
);

/* =========================================================
   UNCAUGHT EXCEPTION
========================================================= */

process.on(
  "uncaughtException",
  (
    error
  ) => {
    console.error(
      "================================================="
    );

    console.error(
      "❌ UNCAUGHT EXCEPTION"
    );

    console.error(
      error
    );

    console.error(
      "================================================="
    );

    process.exit(
      1
    );
  }
);

/* =========================================================
   UNHANDLED REJECTION
========================================================= */

process.on(
  "unhandledRejection",
  (
    reason
  ) => {
    console.error(
      "================================================="
    );

    console.error(
      "❌ UNHANDLED PROMISE REJECTION"
    );

    console.error(
      reason
    );

    console.error(
      "================================================="
    );
  }
);

