/* =========================================================
   UNI MARKET / TELEGRAM SALES MANAGER
   COMPLETE SERVER.JS
   ========================================================= */

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const app = express();

const PORT = process.env.PORT || 10000;
const PUBLIC_DIR = path.join(__dirname, "public");

/* =========================================================
   ENV
   ========================================================= */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

const BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME ||
  "uni_market_shop_bot";

const ADMIN_CHAT_ID =
  process.env.ADMIN_CHAT_ID || "";

const AUTH_SECRET =
  process.env.AUTH_SECRET ||
  "uni_market_static_secret_key_2026";

const MASTER_ADMIN_USERNAME =
  process.env.MASTER_ADMIN_USERNAME ||
  "admin";

const MASTER_ADMIN_PASSWORD =
  process.env.MASTER_ADMIN_PASSWORD ||
  process.env.MASTER_ADMIN_PASS ||
  process.env.WEB_PASSWORD ||
  "123456";

const STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET ||
  "product-images";

const WEBHOOK_URL =
  process.env.WEBHOOK_URL ||
  "";

const TELEGRAM_WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET ||
  crypto
    .createHash("sha256")
    .update(AUTH_SECRET + BOT_USERNAME)
    .digest("hex");

/* =========================================================
   BASIC MIDDLEWARE
   ========================================================= */

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({
  extended: true,
  limit: "15mb"
}));

/* =========================================================
   SUPABASE
   ========================================================= */

let supabase = null;

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
  console.warn("Supabase environment variables are missing.");
}

/* =========================================================
   MULTER
   ========================================================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed."));
    }

    cb(null, true);
  }
});

/* =========================================================
   HELPERS
   ========================================================= */

function nowISO() {
  return new Date().toISOString();
}

function safeString(value) {
  return String(value ?? "").trim();
}

function numberValue(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomId() {
  return crypto.randomUUID();
}

/* =========================================================
   AUTH
   ========================================================= */

function createAuthToken(payload) {
  const data = {
    ...payload,
    iat: Date.now(),
    exp:
      Date.now() +
      (payload.role === "MASTER_ADMIN"
        ? 7 * 24 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000)
  };

  const encoded = base64url(
    JSON.stringify(data)
  );

  const signature = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(encoded)
    .digest("hex");

  return `${encoded}.${signature}`;
}

function verifyAuthToken(token) {
  try {
    if (!token) return null;

    const parts = token.split(".");

    if (parts.length !== 2) {
      return null;
    }

    const [encoded, signature] = parts;

    const expected = crypto
      .createHmac("sha256", AUTH_SECRET)
      .update(encoded)
      .digest("hex");

    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      )
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(
        encoded.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString("utf8")
    );

    if (!payload.exp || Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function getAuth(req) {
  const header = req.headers.authorization || "";

  if (header.startsWith("Bearer ")) {
    return verifyAuthToken(
      header.slice(7).trim()
    );
  }

  const cookie = req.headers.cookie || "";

  const match = cookie.match(
    /(?:^|;\s*)auth_token=([^;]+)/
  );

  if (match) {
    return verifyAuthToken(
      decodeURIComponent(match[1])
    );
  }

  return null;
}

function requireAuth(req, res, next) {
  const auth = getAuth(req);

  if (!auth) {
    return res.status(401).json({
      ok: false,
      error: "Authentication required"
    });
  }

  req.auth = auth;
  next();
}

function requireMaster(req, res, next) {
  const auth = getAuth(req);

  if (!auth) {
    return res.status(401).json({
      ok: false,
      error: "Authentication required"
    });
  }

  if (auth.role !== "MASTER_ADMIN") {
    return res.status(403).json({
      ok: false,
      error: "Master Admin permission required"
    });
  }

  req.auth = auth;
  next();
}

/* =========================================================
   TELEGRAM
   ========================================================= */

async function telegram(method, body = {}) {
  if (!BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing.");
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

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      data.description ||
      `Telegram API error: ${method}`
    );
  }

  return data.result;
}

async function sendMessage(
  chatId,
  text,
  extra = {}
) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra
  });
}

/* =========================================================
   PRODUCT CATEGORIES
   ========================================================= */

const PRODUCT_CATEGORIES = {
  clothing: "አልባሳት",
  electronics: "ኤሌክትሮኒክ",
  kids: "የህፃናት",
  women: "የሴቶች",
  home: "የቤት",
  other: "ሌሎች"
};

function categoryLabel(category) {
  return (
    PRODUCT_CATEGORIES[category] ||
    category ||
    "ሌሎች"
  );
}

/* =========================================================
   TELEGRAM CART
   ========================================================= */

/*
  Cart is kept per Telegram chat.

  Later, if we decide to persist carts in Supabase,
  this layer can be replaced without changing the
  Telegram flow.
*/

const carts = new Map();

function getCart(chatId) {
  const id = String(chatId);

  if (!carts.has(id)) {
    carts.set(id, {
      chat_id: id,
      customer_name: "",
      customer_phone: "",
      items: [],
      created_at: nowISO()
    });
  }

  return carts.get(id);
}

function clearCart(chatId) {
  carts.delete(String(chatId));
}

function cartTotal(cart) {
  return cart.items.reduce(
    (sum, item) =>
      sum +
      numberValue(item.sell_price) *
      numberValue(item.quantity),
    0
  );
}

function cartProfit(cart) {
  return cart.items.reduce(
    (sum, item) =>
      sum +
      (
        numberValue(item.sell_price) -
        numberValue(item.buy_price)
      ) *
      numberValue(item.quantity),
    0
  );
}

function addCartItem(
  chatId,
  product,
  quantity
) {
  const cart = getCart(chatId);

  const existing = cart.items.find(
    item =>
      String(item.product_id) ===
      String(product.id)
  );

  if (existing) {
    existing.quantity += quantity;
  } else {
    cart.items.push({
      product_id: product.id,
      name: product.name,
      buy_price: numberValue(product.buy_price),
      sell_price: numberValue(product.sell_price),
      quantity,
      photo_url: product.photo_url || "",
      category: product.category || "other"
    });
  }

  return cart;
}

/* =========================================================
   PRODUCTS
   ========================================================= */

async function getProductsFromDB(
  category = null
) {
  if (!supabase) {
    return [];
  }

  let query = supabase
    .from("products")
    .select("*")
    .order("created_at", {
      ascending: false
    });

  const { data, error } = await query;

  if (error) {
    console.error(
      "Products query error:",
      error.message
    );

    return [];
  }

  let products = data || [];

  products = products.filter(
    product =>
      numberValue(product.stock) > 0
  );

  if (category) {
    products = products.filter(
      product =>
        String(product.category || "other") ===
        String(category)
    );
  }

  return products;
}

/* =========================================================
   TELEGRAM CATALOG
   ========================================================= */

async function sendBotWelcome(chatId) {
  await sendMessage(
    chatId,
    `🛍️ <b>እንኳን ወደ UNI MARKET በደህና መጡ!</b>

የሚፈልጉትን ምርት ለማየት ከታች ያለውን ይጫኑ።`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🛍️ ምርቶችን ይመልከቱ",
              callback_data: "product_categories"
            }
          ]
        ]
      }
    }
  );
}

async function sendBotCatalog(
  chatId,
  category = null
) {
  const products =
    await getProductsFromDB(category);

  if (!products.length) {
    await sendMessage(
      chatId,
      "😔 በአሁኑ ጊዜ በዚህ ምድብ ውስጥ ምርት የለም።"
    );

    return;
  }

  const keyboard = products.map(product => [
    {
      text:
        `${product.name} — ${numberValue(
          product.sell_price
        ).toLocaleString()} ብር`,
      callback_data:
        `product_${product.id}`
    }
  ]);

  keyboard.push([
    {
      text: "🛒 የእኔ ትዕዛዝ",
      callback_data: "cart_view"
    }
  ]);

  await sendMessage(
    chatId,
    category
      ? `🛍️ <b>${categoryLabel(category)}</b>`
      : "🛍️ <b>የUNI MARKET ምርቶች</b>",
    {
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
  );
}

async function sendProduct(
  chatId,
  product
) {
  const text =
    `🛍️ <b>${product.name}</b>\n\n` +
    `${product.description || ""}\n\n` +
    `💰 ዋጋ: <b>${numberValue(
      product.sell_price
    ).toLocaleString()} ብር</b>\n` +
    `📦 ያለው: ${numberValue(
      product.stock
    )}`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "🛒 ይህን ምርት ይዘዙ",
          callback_data:
            `order_product_${product.id}`
        }
      ],
      [
        {
          text: "🛍️ ሌሎች ምርቶች",
          callback_data:
            "product_categories"
        }
      ]
    ]
  };

  if (product.photo_url) {
    try {
      await telegram("sendPhoto", {
        chat_id: chatId,
        photo: product.photo_url,
        caption: text,
        parse_mode: "HTML",
        reply_markup: keyboard
      });

      return;
    } catch (error) {
      console.error(
        "Product photo error:",
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

/* =========================================================
   QUANTITY UI
   ========================================================= */

async function sendQuantitySelector(
  chatId,
  productId
) {
  await sendMessage(
    chatId,
    `🔢 <b>የሚፈልጉትን ብዛት ይምረጡ</b>`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "1", callback_data: `qty_${productId}_1` },
            { text: "2", callback_data: `qty_${productId}_2` },
            { text: "3", callback_data: `qty_${productId}_3` },
            { text: "4", callback_data: `qty_${productId}_4` }
          ],
          [
            {
              text: "✏️ ሌላ ብዛት",
              callback_data:
                `qty_custom_${productId}`
            }
          ],
          [
            {
              text: "❌ ሰርዝ",
              callback_data: "cart_clear"
            }
          ]
        ]
      }
    }
  );
}

/* =========================================================
   CART VIEW
   ========================================================= */

async function sendCart(
  chatId
) {
  const cart = getCart(chatId);

  if (!cart.items.length) {
    await sendMessage(
      chatId,
      `🛒 <b>የእርስዎ ትዕዛዝ ባዶ ነው።</b>`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🛍️ ምርት ይምረጡ",
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

  let text =
    `🛒 <b>የእርስዎ ትዕዛዝ</b>\n\n`;

  cart.items.forEach(
    (item, index) => {
      const lineTotal =
        numberValue(item.sell_price) *
        numberValue(item.quantity);

      text +=
        `${index + 1}. <b>${item.name}</b>\n` +
        `   ብዛት: ${item.quantity}\n` +
        `   ዋጋ: ${lineTotal.toLocaleString()} ብር\n\n`;
    }
  );

  text +=
    `━━━━━━━━━━━━\n` +
    `💰 <b>ጠቅላላ: ${cartTotal(
      cart
    ).toLocaleString()} ብር</b>`;

  await sendMessage(
    chatId,
    text,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "➕ ሌላ ምርት ጨምር",
              callback_data:
                "product_categories"
            }
          ],
          [
            {
              text: "👤 ስም እና ስልክ አስገባ",
              callback_data:
                "customer_details"
            }
          ],
          [
            {
              text: "🗑️ ትዕዛዙን አጽዳ",
              callback_data:
                "cart_clear"
            }
          ]
        ]
      }
    }
  );
}

/* =========================================================
   CUSTOMER STATE
   ========================================================= */

const customerStates = new Map();

function setCustomerState(
  chatId,
  state
) {
  customerStates.set(
    String(chatId),
    state
  );
}

function getCustomerState(chatId) {
  return customerStates.get(
    String(chatId)
  );
}

function clearCustomerState(chatId) {
  customerStates.delete(
    String(chatId)
  );
}

/* =========================================================
   PAYMENT SETTINGS
   ========================================================= */

async function getPaymentSettings() {
  if (!supabase) {
    return null;
  }

  const { data, error } =
    await supabase
      .from("payment_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

  if (error) {
    console.error(
      "Payment settings:",
      error.message
    );

    return null;
  }

  return data;
}

async function sendPaymentOptions(
  chatId
) {
  const cart = getCart(chatId);

  if (!cart.items.length) {
    return sendCart(chatId);
  }

  const total = cartTotal(cart);

  const settings =
    await getPaymentSettings();

  const keyboard = [];

  if (
    settings?.full_payment_enabled !== false
  ) {
    keyboard.push([
      {
        text:
          `💳 ሙሉ ክፍያ — ${total.toLocaleString()} ብር`,
        callback_data:
          "payment_full"
      }
    ]);
  }

  if (
    settings?.advance_payment_enabled !== false
  ) {
    const percent =
      numberValue(
        settings?.advance_percent,
        50
      );

    const amount =
      Math.ceil(
        total * percent / 100
      );

    keyboard.push([
      {
        text:
          `💵 ቅድሚያ ${percent}% — ${amount.toLocaleString()} ብር`,
        callback_data:
          "payment_advance"
      }
    ]);
  }

  keyboard.push([
    {
      text: "❌ ተመለስ",
      callback_data: "cart_view"
    }
  ]);

  await sendMessage(
    chatId,
    `💳 <b>የክፍያ አማራጭ ይምረጡ</b>\n\n` +
    `🛒 የትዕዛዝ ጠቅላላ: <b>${total.toLocaleString()} ብር</b>`,
    {
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
  );
}

/* =========================================================
   ORDER CREATION
   ========================================================= */

async function createOrderFromCart(
  chatId,
  paymentType
) {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured."
    );
  }

  const cart = getCart(chatId);

  if (!cart.items.length) {
    throw new Error(
      "Cart is empty."
    );
  }

  const total = cartTotal(cart);
  const profit = cartProfit(cart);

  let paymentAmount = total;

  if (paymentType === "advance") {
    const settings =
      await getPaymentSettings();

    const percent =
      numberValue(
        settings?.advance_percent,
        50
      );

    paymentAmount =
      Math.ceil(
        total * percent / 100
      );
  }

  /*
    Legacy-compatible order object.
    After checking Supabase schema, we can add
    order_items / items persistence.
  */

  const firstItem =
    cart.items[0];

  const orderData = {
    customer_name:
      cart.customer_name || null,

    customer_phone:
      cart.customer_phone || null,

    telegram_chat_id:
      String(chatId),

    product_id:
      firstItem.product_id,

    product_name:
      cart.items.length === 1
        ? firstItem.name
        : `${firstItem.name} + ${cart.items.length - 1} ሌሎች`,

    quantity:
      cart.items.reduce(
        (sum, item) =>
          sum + numberValue(item.quantity),
        0
      ),

    total,
    profit,

    payment_status:
      "PENDING",

    payment_type:
      paymentType,

    payment_amount:
      paymentAmount,

    status:
      "NEW",

    created_at:
      nowISO()
  };

  const { data, error } =
    await supabase
      .from("orders")
      .insert(orderData)
      .select("*")
      .single();

  if (error) {
    console.error(
      "Order creation error:",
      error
    );

    throw new Error(
      error.message
    );
  }

  return {
    order: data,
    cart
  };
}

/* =========================================================
   TELEGRAM UPDATE HANDLER
   ========================================================= */

async function handleTelegramUpdate(
  update
) {
  try {
    /* ---------------- CALLBACK ---------------- */

    if (update.callback_query) {
      const callback =
        update.callback_query;

      const chatId =
        callback.message?.chat?.id;

      const data =
        callback.data || "";

      const messageId =
        callback.message?.message_id;

      if (!chatId) return;

      await telegram(
        "answerCallbackQuery",
        {
          callback_query_id:
            callback.id
        }
      ).catch(() => {});

      /* Categories */

      if (
        data === "product_categories" ||
        data === "categories"
      ) {
        await sendMessage(
          chatId,
          "🛍️ <b>የምርት ምድብ ይምረጡ</b>",
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "👕 አልባሳት",
                    callback_data:
                      "category_clothing"
                  }
                ],
                [
                  {
                    text: "📱 ኤሌክትሮኒክ",
                    callback_data:
                      "category_electronics"
                  }
                ],
                [
                  {
                    text: "🧒 የህፃናት",
                    callback_data:
                      "category_kids"
                  }
                ],
                [
                  {
                    text: "👩 የሴቶች",
                    callback_data:
                      "category_women"
                  }
                ],
                [
                  {
                    text: "🏠 የቤት",
                    callback_data:
                      "category_home"
                  },
                  {
                    text: "📦 ሌሎች",
                    callback_data:
                      "category_other"
                  }
                ]
              ]
            }
          }
        );

        return;
      }

      /* Category */

      if (
        data.startsWith("category_")
      ) {
        const category =
          data.replace(
            "category_",
            ""
          );

        await sendBotCatalog(
          chatId,
          category
        );

        return;
      }

      /* Product */

      if (
        data.startsWith("product_")
      ) {
        const productId =
          data.replace(
            "product_",
            ""
          );

        const { data: product } =
          await supabase
            .from("products")
            .select("*")
            .eq("id", productId)
            .maybeSingle();

        if (!product) {
          await sendMessage(
            chatId,
            "❌ ይህ ምርት አሁን አይገኝም።"
          );

          return;
        }

        await sendProduct(
          chatId,
          product
        );

        return;
      }

      /* Order product */

      if (
        data.startsWith(
          "order_product_"
        )
      ) {
        const productId =
          data.replace(
            "order_product_",
            ""
          );

        await sendQuantitySelector(
          chatId,
          productId
        );

        return;
      }

      /* Quantity */

      if (
        data.startsWith("qty_")
      ) {
        const parts =
          data.split("_");

        if (
          parts[1] === "custom"
        ) {
          const productId =
            parts[2];

          setCustomerState(
            chatId,
            {
              type:
                "CUSTOM_QUANTITY",
              productId
            }
          );

          await sendMessage(
            chatId,
            "✏️ እባክዎ የሚፈልጉትን ብዛት በቁጥር ይላኩ።"
          );

          return;
        }

        const productId =
          parts[1];

        const quantity =
          Number(parts[2]);

        const { data: product } =
          await supabase
            .from("products")
            .select("*")
            .eq("id", productId)
            .maybeSingle();

        if (!product) {
          await sendMessage(
            chatId,
            "❌ ምርቱ አልተገኘም።"
          );

          return;
        }

        if (
          quantity < 1 ||
          quantity >
            numberValue(product.stock)
        ) {
          await sendMessage(
            chatId,
            "❌ የጠየቁት ብዛት ከክምችቱ በላይ ነው።"
          );

          return;
        }

        addCartItem(
          chatId,
          product,
          quantity
        );

        await sendMessage(
          chatId,
          `✅ <b>${product.name}</b> ${quantity} ተጨምሯል።`
        );

        await sendCart(chatId);

        return;
      }

      /* Cart */

      if (
        data === "cart_view"
      ) {
        await sendCart(chatId);
        return;
      }

      if (
        data === "cart_clear"
      ) {
        clearCart(chatId);

        await sendMessage(
          chatId,
          "🗑️ ትዕዛዝዎ ተሰርዟል።"
        );

        await sendBotCatalog(chatId);
        return;
      }

      /* Customer details */

      if (
        data === "customer_details"
      ) {
        const cart =
          getCart(chatId);

        if (!cart.items.length) {
          await sendCart(chatId);
          return;
        }

        setCustomerState(
          chatId,
          {
            type:
              "CUSTOMER_DETAILS"
          }
        );

        await sendMessage(
          chatId,
          `👤 <b>የመገናኛ መረጃ</b>\n\n` +
          `እባክዎ ስም እና ስልክ ቁጥርዎን <b>በአንድ መልዕክት</b> ይላኩ።\n\n` +
          `ምሳሌ፦\n` +
          `ካሚላ 0912345678`
        );

        return;
      }

      /* Payment */

      if (
        data === "payment_options"
      ) {
        await sendPaymentOptions(
          chatId
        );

        return;
      }

      if (
        data === "payment_full" ||
        data === "payment_advance"
      ) {
        const paymentType =
          data === "payment_full"
            ? "full"
            : "advance";

        try {
          const result =
            await createOrderFromCart(
              chatId,
              paymentType
            );

          const order =
            result.order;

          const cart =
            result.cart;

          clearCustomerState(chatId);

          await sendMessage(
            chatId,
            `✅ <b>ትዕዛዝዎ ተመዝግቧል!</b>\n\n` +
            `🧾 Order ID: <b>${order.id}</b>\n` +
            `💰 ጠቅላላ: <b>${cartTotal(cart).toLocaleString()} ብር</b>\n` +
            `💳 የሚከፈለው: <b>${numberValue(order.payment_amount).toLocaleString()} ብር</b>\n\n` +
            `🧾 ክፍያዎን ካደረጉ በኋላ የreceipt ፎቶ ይላኩ።`
         
