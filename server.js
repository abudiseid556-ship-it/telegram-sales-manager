"use strict";

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const app = express();

const PORT = Number(process.env.PORT || 10000);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/* =========================================================
   PUBLIC
========================================================= */

const PUBLIC_DIR = path.join(__dirname, "public");

app.use(express.static(PUBLIC_DIR));

/* =========================================================
   ENV
========================================================= */

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY =
  (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const BOT_USERNAME =
  (process.env.TELEGRAM_BOT_USERNAME || "uni_market_shop_bot")
    .replace(/^@/, "")
    .trim();

const ADMIN_CHAT_ID = String(process.env.ADMIN_CHAT_ID || "").trim();

const WEBHOOK_URL = (process.env.WEBHOOK_URL || "").trim();

const AUTH_SECRET =
  process.env.AUTH_SECRET ||
  crypto.randomBytes(32).toString("hex");

const MASTER_ADMIN_USERNAME =
  process.env.MASTER_ADMIN_USERNAME || "admin";

const MASTER_ADMIN_PASSWORD =
  process.env.MASTER_ADMIN_PASS ||
  process.env.MASTER_ADMIN_PASSWORD ||
  "";

const STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET ||
  "product-images";

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
} else {
  console.error(
    "WARNING: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing."
  );
}

/* =========================================================
   MEMORY
========================================================= */

const sessions = new Map();
const userSessions = Object.create(null);

/* =========================================================
   MULTER
========================================================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }

    cb(null, true);
  }
});

/* =========================================================
   BASIC HELPERS
========================================================= */

function nowISO() {
  return new Date().toISOString();
}

function safeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
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
  return Number.isFinite(n) ? n : fallback;
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;

  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function randomId(prefix = "") {
  return (
    prefix +
    Date.now().toString(36) +
    crypto.randomBytes(5).toString("hex")
  );
}

/* =========================================================
   AUTH TOKEN
========================================================= */

function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createAuthToken(payload) {
  const encodedPayload = base64url(
    Buffer.from(JSON.stringify(payload))
  );

  const signature = base64url(
    crypto
      .createHmac("sha256", AUTH_SECRET)
      .update(encodedPayload)
      .digest()
  );

  return `${encodedPayload}.${signature}`;
}

function verifyAuthToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, signature] = parts;

  const expected = base64url(
    crypto
      .createHmac("sha256", AUTH_SECRET)
      .update(encodedPayload)
      .digest()
  );

  if (signature.length !== expected.length) {
    return null;
  }

  if (
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    )
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    );

    if (payload.exp && Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/* =========================================================
   PASSWORD HASH
========================================================= */

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");

    crypto.scrypt(
      String(password),
      salt,
      64,
      (err, derivedKey) => {
        if (err) return reject(err);

        resolve(
          `scrypt:${salt}:${derivedKey.toString("hex")}`
        );
      }
    );
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve) => {
    if (!stored || !stored.startsWith("scrypt:")) {
      return resolve(false);
    }

    const parts = stored.split(":");

    if (parts.length !== 3) {
      return resolve(false);
    }

    const salt = parts[1];
    const storedHash = Buffer.from(parts[2], "hex");

    crypto.scrypt(
      String(password),
      salt,
      storedHash.length,
      (err, derivedKey) => {
        if (err) return resolve(false);

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
  });
}

/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

function getAuth(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return verifyAuthToken(
    header.slice("Bearer ".length).trim()
  );
}

function requireAuth(req, res, next) {
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

function isMaster(req) {
  return req.auth?.role === "MASTER_ADMIN";
}

async function hasPermission(employeeId, permission) {
  if (!supabase || !employeeId) {
    return false;
  }

  const { data, error } = await supabase
    .from("employee_permissions")
    .select("permission")
    .eq("employee_id", employeeId)
    .eq("permission", permission)
    .maybeSingle();

  if (error) {
    console.error("permission error:", error.message);
    return false;
  }

  return !!data;
}

function requirePermission(permission) {
  return async (req, res, next) => {
    const auth = getAuth(req);

    if (!auth) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized"
      });
    }

    req.auth = auth;

    if (auth.role === "MASTER_ADMIN") {
      return next();
    }

    if (!auth.employeeId) {
      return res.status(403).json({
        ok: false,
        error: "Permission denied"
      });
    }

    const allowed = await hasPermission(
      auth.employeeId,
      permission
    );

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: `Permission denied: ${permission}`
      });
    }

    next();
  };
}

/* =========================================================
   TELEGRAM API
========================================================= */

async function telegram(method, body = {}) {
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

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Telegram ${method}: ${
        data.description || "Telegram API error"
      }`
    );
  }

  return data.result;
}

async function sendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...extra
  });
}

async function deleteTelegramMessage(chatId, messageId) {
  try {
    await telegram("deleteMessage", {
      chat_id: chatId,
      message_id: messageId
    });

    return true;
  } catch (err) {
    console.error(
      "deleteTelegramMessage:",
      err.message
    );

    return false;
  }
}

/* =========================================================
   ORDER TELEGRAM MESSAGE TRACKING
========================================================= */

async function getOrderById(orderId) {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    console.error(
      "getOrderById:",
      error.message
    );

    return null;
  }

  return data || null;
}

async function saveTrackedMessage(
  orderId,
  chatId,
  messageId
) {
  if (!supabase || !orderId || !messageId) {
    return;
  }

  const order = await getOrderById(orderId);

  if (!order) return;

  const current = jsonArray(
    firstDefined(
      order.telegram_message_ids,
      order.tracked_message_ids
    )
  );

  const item = {
    chat_id: String(chatId),
    message_id: Number(messageId)
  };

  const exists = current.some(
    (x) =>
      String(x.chat_id) === String(item.chat_id) &&
      Number(x.message_id) === Number(item.message_id)
  );

  if (!exists) {
    current.push(item);
  }

  const { error } = await supabase
    .from("orders")
    .update({
      telegram_message_ids: current
    })
    .eq("id", orderId);

  if (error) {
    console.error(
      "saveTrackedMessage:",
      error.message
    );
  }
}

async function trackTelegramMessage(
  orderId,
  chatId,
  result
) {
  if (!result?.message_id) return;

  await saveTrackedMessage(
    orderId,
    chatId,
    result.message_id
  );
}

async function deleteTrackedOrderMessages(
  orderId,
  customerChatId
) {
  const order = await getOrderById(orderId);

  if (!order) return;

  const tracked = jsonArray(
    firstDefined(
      order.telegram_message_ids,
      order.tracked_message_ids
    )
  );

  for (const item of tracked) {
    if (!item) continue;

    const chatId = item.chat_id || customerChatId;
    const messageId = item.message_id;

    if (!messageId) continue;

    await deleteTelegramMessage(
      chatId,
      messageId
    );
  }

  /* Also delete the customer's original order message
     when it was saved separately. */
  const originalMessageId = firstDefined(
    order.telegram_message_id,
    order.order_message_id
  );

  if (originalMessageId) {
    await deleteTelegramMessage(
      customerChatId,
      originalMessageId
    );
  }
}

/* =========================================================
   SETTINGS
========================================================= */

async function getTelegramSettings() {
  if (!supabase) {
    return {};
  }

  const { data, error } = await supabase
    .from("telegram_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    return {};
  }

  return data || {};
}

async function saveTelegramSettings(payload) {
  if (!supabase) {
    throw new Error("Supabase unavailable");
  }

  const existing = await getTelegramSettings();

  if (existing?.id) {
    const { data, error } = await supabase
      .from("telegram_settings")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) throw error;

    return data;
  }

  const { data, error } = await supabase
    .from("telegram_settings")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;

  return data;
}

async function getPaymentSettings() {
  if (!supabase) return {};

  const { data, error } = await supabase
    .from("payment_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) return {};

  return data || {};
}

async function savePaymentSettings(payload) {
  if (!supabase) {
    throw new Error("Supabase unavailable");
  }

  const existing = await getPaymentSettings();

  if (existing?.id) {
    const { data, error } = await supabase
      .from("payment_settings")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) throw error;

    return data;
  }

  const { data, error } = await supabase
    .from("payment_settings")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;

  return data;
}

/* =========================================================
   PRODUCTS
========================================================= */

async function getProduct(productId) {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .maybeSingle();

  if (error) {
    console.error(
      "getProduct:",
      error.message
    );

    return null;
  }

  return data || null;
}

function productName(product) {
  return firstDefined(
    product.name,
    product.product_name,
    product.title,
    "Product"
  );
}

function productBuyPrice(product) {
  return numberValue(
    firstDefined(
      product.buy_price,
      product.buyPrice,
      product.purchase_price
    ),
    0
  );
}

function productSellPrice(product) {
  return numberValue(
    firstDefined(
      product.sell_price,
      product.sellPrice,
      product.price
    ),
    0
  );
}

function productStock(product) {
  return numberValue(
    firstDefined(
      product.stock,
      product.quantity
    ),
    0
  );
}

function productPhoto(product) {
  return firstDefined(
    product.photo_url,
    product.photoUrl,
    product.photo
  );
}

/* =========================================================
   PRODUCTS API
========================================================= */

app.get(
  "/api/products",
  requirePermission("products"),
  async (req, res) => {
    if (!supabase) {
      return res.status(500).json({
        ok: false,
        error: "Supabase unavailable"
      });
    }

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", {
        ascending: false
      });

    if (error) {
      return res.status(500).json({
        ok: false,
        error: error.message
      });
    }

    res.json(data || []);
  }
);

app.post(
  "/api/products",
  requirePermission("products"),
  async (req, res) => {
    try {
      if (!supabase) {
        throw new Error("Supabase unavailable");
      }

      const body = req.body || {};

      const row = {
        name: firstDefined(
          body.name,
          body.productName,
          body.title
        ),
        buy_price: numberValue(
          firstDefined(
            body.buyPrice,
            body.buy_price
          ),
          0
        ),
        sell_price: numberValue(
          firstDefined(
            body.sellPrice,
            body.sell_price
          ),
          0
        ),
        stock: numberValue(body.stock, 0),
        photo_url: firstDefined(
          body.photoUrl,
          body.photo_url,
          body.photo
        ),
        description:
          body.description || null
      };

      const { data, error } = await supabase
        .from("products")
        .insert(row)
        .select("*")
        .single();

      if (error) throw error;

      res.json({
        ok: true,
        product: data
      });
    } catch (err) {
      console.error(
        "POST /api/products:",
        err
      );

      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.patch(
  "/api/products/:id",
  requirePermission("products"),
  async (req, res) => {
    try {
      if (!supabase) {
        throw new Error("Supabase unavailable");
      }

      const body = req.body || {};

      const row = {};

      if (
        body.name !== undefined ||
        body.productName !== undefined ||
        body.title !== undefined
      ) {
        row.name = firstDefined(
          body.name,
          body.productName,
          body.title
        );
      }

      if (
        body.buyPrice !== undefined ||
        body.buy_price !== undefined
      ) {
        row.buy_price = numberValue(
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
        row.sell_price = numberValue(
          firstDefined(
            body.sellPrice,
            body.sell_price
          ),
          0
        );
      }

      if (body.stock !== undefined) {
        row.stock = numberValue(body.stock, 0);
      }

      if (
        body.photoUrl !== undefined ||
        body.photo_url !== undefined ||
        body.photo !== undefined
      ) {
        row.photo_url = firstDefined(
          body.photoUrl,
          body.photo_url,
          body.photo
        );
      }

      if (body.description !== undefined) {
        row.description =
          body.description || null;
      }

      const { data, error } = await supabase
        .from("products")
        .update(row)
        .eq("id", req.params.id)
        .select("*")
        .single();

      if (error) throw error;

      res.json({
        ok: true,
        product: data
      });
    } catch (err) {
      console.error(
        "PATCH /api/products:",
        err
      );

      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.delete(
  "/api/products/:id",
  requirePermission("delete_product"),
  async (req, res) => {
    try {
      if (!supabase) {
        throw new Error("Supabase unavailable");
      }

      const { error } = await supabase
        .from("products")
        .delete()
        .eq("id", req.params.id);

      if (error) throw error;

      res.json({
        ok: true
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   STORAGE UPLOAD
========================================================= */

app.post(
  "/api/upload",
  requireAuth,
  upload.single("photo"),
  async (req, res) => {
    try {
      if (!supabase) {
        throw new Error("Supabase unavailable");
      }

      if (!req.file) {
        return res.status(400).json({
          ok: false,
          error: "No photo selected"
        });
      }

      const context =
        req.body?.context === "ad"
          ? "ads"
          : "products";

      if (context === "products") {
        if (
          req.auth.role !== "MASTER_ADMIN" &&
          !(await hasPermission(
            req.auth.employeeId,
            "products"
          ))
        ) {
          return res.status(403).json({
            ok: false,
            error: "Products permission required"
          });
        }
      }

      if (context === "ads") {
        if (
          req.auth.role !== "MASTER_ADMIN" &&
          !(await hasPermission(
            req.auth.employeeId,
            "advertising"
          ))
        ) {
          return res.status(403).json({
            ok: false,
            error: "Advertising permission required"
          });
        }
      }

      const ext =
        path.extname(req.file.originalname || "")
          .toLowerCase() ||
        ".jpg";

      const cleanExt =
        /^[.][a-z0-9]{1,8}$/.test(ext)
          ? ext
          : ".jpg";

      const filePath =
        `${context}/` +
        `${Date.now()}-${crypto.randomBytes(8).toString("hex")}` +
        cleanExt;

      const { data, error } =
        await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(
            filePath,
            req.file.buffer,
            {
              contentType:
                req.file.mimetype ||
                "image/jpeg",
              upsert: false
            }
          );

      if (error) {
        console.error(
          "SUPABASE STORAGE ERROR:",
          error
        );

        const message = String(
          error.message || error
        );

        if (
          /Invalid compact JWS/i.test(message)
        ) {
          return res.status(500).json({
            ok: false,
            error:
              "Supabase Storage authentication failed. Check SUPABASE_SERVICE_ROLE_KEY in Render."
          });
        }

        return res.status(500).json({
          ok: false,
          error: message
        });
      }

      const publicUrl =
        supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(filePath)
          ?.data?.publicUrl || null;

      res.json({
        ok: true,
        url: publicUrl,
        path: data?.path || filePath
      });
    } catch (err) {
      console.error(
        "POST /api/upload:",
        err
      );

      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   ORDERS
========================================================= */

app.get(
  "/api/orders",
  requirePermission("view_orders"),
  async (req, res) => {
    try {
      if (!supabase) {
        throw new Error("Supabase unavailable");
      }

      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", {
          ascending: false
        });

      if (error) throw error;

      res.json(data || []);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   ATOMIC STOCK DECREMENT
========================================================= */

async function decrementStock(
  productId,
  quantity
) {
  const product = await getProduct(productId);

  if (!product) {
    throw new Error("Product not found");
  }

  const currentStock = productStock(product);

  if (currentStock < quantity) {
    throw new Error("Not enough stock");
  }

  const newStock =
    currentStock - quantity;

  const { data, error } = await supabase
    .from("products")
    .update({
      stock: newStock
    })
    .eq("id", productId)
    .gte("stock", quantity)
    .select("*");

  if (error) throw error;

  if (!data || data.length === 0) {
    throw new Error(
      "Stock changed by another order. Please try again."
    );
  }

  return data[0];
}

/* =========================================================
   CHANGE ORDER STATUS
========================================================= */

async function changeOrderStatus(
  orderId,
  newStatus,
  actor = {}
) {
  if (!supabase) {
    throw new Error("Supabase unavailable");
  }

  const order = await getOrderById(orderId);

  if (!order) {
    throw new Error("Order not found");
  }

  const oldStatus =
    safeString(order.status).toUpperCase();

  newStatus =
    safeString(newStatus).toUpperCase();

  /* -----------------------------------------
     CONFIRM PAYMENT
  ----------------------------------------- */

  if (newStatus === "CONFIRMED") {
    if (
      ![
        "RECEIPT_PENDING",
        "PAYMENT_PENDING"
      ].includes(oldStatus)
    ) {
      throw new Error(
        "Only pending payment orders can be confirmed"
      );
    }

    const quantity = Math.max(
      1,
      numberValue(order.quantity, 1)
    );

    const productId = firstDefined(
      order.product_id,
      order.productId
    );

    if (!productId) {
      throw new Error(
        "Order has no product_id"
      );
    }

    /*
      First atomically reserve/decrease stock.
      This prevents two confirmations from
      blindly using the same stock.
    */
    await decrementStock(
      productId,
      quantity
    );

    const { data, error } = await supabase
      .from("orders")
      .update({
        status: "DELIVERY_PENDING",
        delivery_status: "PENDING",
        confirmed_at: nowISO(),
        confirmed_by:
          actor.username ||
          actor.name ||
          null
      })
      .eq("id", orderId)
      .in("status", [
        "RECEIPT_PENDING",
        "PAYMENT_PENDING"
      ])
      .select("*")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      /*
        The order was already changed by another
        confirmation. We cannot safely restore
        automatically without knowing whether the
        competing transaction also changed stock.
      */
      throw new Error(
        "Order was already processed"
      );
    }

    await sendDeliveryPendingMessage(data);

    return data;
  }

  /* -----------------------------------------
     REJECT PAYMENT
  ----------------------------------------- */

  if (newStatus === "REJECTED") {
    if (
      ![
        "RECEIPT_PENDING",
        "PAYMENT_PENDING"
      ].includes(oldStatus)
    ) {
      throw new Error(
        "This order cannot be rejected now"
      );
    }

    const { data, error } = await supabase
      .from("orders")
      .update({
        status: "REJECTED",
        payment_status: "REJECTED",
        rejected_at: nowISO(),
        rejected_by:
          actor.username ||
          actor.name ||
          null
      })
      .eq("id", orderId)
      .in("status", [
        "RECEIPT_PENDING",
        "PAYMENT_PENDING"
      ])
      .select("*")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      throw new Error(
        "Order was already processed"
      );
    }

    const customerChatId =
      firstDefined(
        data.telegram_chat_id,
        data.customer_id,
        data.chat_id
      );

    if (customerChatId) {
      await sendMessage(
        customerChatId,
        "❌ የክፍያ ደረሰኝዎ አልተረጋገጠም።\n\nእባክዎ ትክክለኛ ደረሰኝ እንደገና ይላኩ።"
      );
    }

    return data;
  }

  /* -----------------------------------------
     DELIVERED / CLOSED
  ----------------------------------------- */

  if (
    newStatus === "DELIVERED" ||
    newStatus === "CLOSED"
  ) {
    if (
      ![
        "DELIVERY_PENDING",
        "DELIVERED"
      ].includes(oldStatus)
    ) {
      throw new Error(
        "Order is not ready to be closed"
      );
    }

    const { data, error } = await supabase
      .from("orders")
      .update({
        status: "DELIVERED",
        delivery_status: "DELIVERED",
        delivered_at: nowISO(),
        closed_at: nowISO()
      })
      .eq("id", orderId)
      .eq("status", "DELIVERY_PENDING")
      .select("*")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return getOrderById(orderId);
    }

    const customerChatId =
      firstDefined(
        data.telegram_chat_id,
        data.customer_id,
        data.chat_id
      );

    if (customerChatId) {
      await deleteTrackedOrderMessages(
        orderId,
        customerChatId
      );

      if (userSessions[customerChatId]) {
        delete userSessions[customerChatId];
      }
    }

    return data;
  }

  /* -----------------------------------------
     OTHER STATUS
  ----------------------------------------- */

  const { data, error } = await supabase
    .from("orders")
    .update({
      status: newStatus
    })
    .eq("id", orderId)
    .select("*")
    .single();

  if (error) throw error;

  return data;
}

/* =========================================================
   ORDER STATUS PERMISSION
========================================================= */

function checkOrderPermission(req) {
  if (isMaster(req)) {
    return true;
  }

  const auth = req.auth;

  if (
    auth.permission === "verify_payment"
  ) {
    return true;
  }

  return false;
}

async function handleOrderStatus(
  req,
  res
) {
  try {
    req.auth = getAuth(req);

    if (!req.auth) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized"
      });
    }

    const status =
      req.body?.status ||
      req.body?.newStatus;

    if (
      [
        "CONFIRMED",
        "REJECTED"
      ].includes(
        safeString(status).toUpperCase()
      )
    ) {
      if (
        !isMaster(req) &&
        !(await hasPermission(
          req.auth.employeeId,
          "verify_payment"
        ))
      ) {
        return res.status(403).json({
          ok: false,
          error: "Payment verification permission required"
        });
      }
    }

    if (
      [
        "DELIVERED",
        "CLOSED"
      ].includes(
        safeString(status).toUpperCase()
      )
    ) {
      if (
        !isMaster(req) &&
        !(await hasPermission(
          req.auth.employeeId,
          "confirm_order"
        ))
      ) {
        return res.status(403).json({
          ok: false,
          error: "Confirm order permission required"
        });
      }
    }

    const order = await changeOrderStatus(
      req.params.id,
      status,
      req.auth
    );

    res.json({
      ok: true,
      order
    });
  } catch (err) {
    console.error(
      "ORDER STATUS ERROR:",
      err
    );

    res.status(400).json({
      ok: false,
      error: err.message
    });
  }
}

app.patch(
  "/api/orders/:id/status",
  requireAuth,
  handleOrderStatus
);

app.patch(
  "/api/orders/:id",
  requireAuth,
  handleOrderStatus
);

/* =========================================================
   RECEIPT PROXY
========================================================= */

app.get(
  "/api/orders/:id/receipt",
  requirePermission("view_orders"),
  async (req, res) => {
    try {
      if (!BOT_TOKEN) {
        return res.status(500).send(
          "Telegram bot token is missing"
        );
      }

      const order = await getOrderById(
        req.params.id
      );

      if (!order) {
        return res.status(404).send(
          "Order not found"
        );
      }

      const fileId =
        firstDefined(
          order.receipt_file_id,
          order.receiptFileId
        );

      if (!fileId) {
        return res.status(404).send(
          "Receipt not found"
        );
      }

      const fileInfo = await telegram(
        "getFile",
        {
          file_id: fileId
        }
      );

      const filePath = fileInfo?.file_path;

      if (!filePath) {
        return res.status(404).send(
          "Telegram file not found"
        );
      }

      const imageResponse =
        await fetch(
          `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`
        );

      if (!imageResponse.ok) {
        return res.status(500).send(
          "Could not download receipt"
        );
      }

      const contentType =
        imageResponse.headers.get(
          "content-type"
        ) ||
        "image/jpeg";

      const buffer = Buffer.from(
        await imageResponse.arrayBuffer()
      );

      res.setHeader(
        "Content-Type",
        contentType
      );

      res.setHeader(
        "Cache-Control",
        "private, max-age=300"
      );

      res.send(buffer);
    } catch (err) {
      console.error(
        "RECEIPT ERROR:",
        err
      );

      res.status(500).send(
        "Could not load receipt"
      );
    }
  }
);

/* =========================================================
   PAYMENT SETTINGS
========================================================= */

app.get(
  "/api/payment-settings",
  requirePermission("payment_settings"),
  async (req, res) => {
    res.json(
      await getPaymentSettings()
    );
  }
);

app.post(
  "/api/payment-settings",
  requirePermission("payment_settings"),
  async (req, res) => {
    try {
      const data =
        await savePaymentSettings(
          req.body || {}
        );

      res.json({
        ok: true,
        settings: data
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   TELEGRAM SETTINGS
========================================================= */

app.get(
  "/api/telegram-settings",
  requirePermission("telegram_settings"),
  async (req, res) => {
    const settings =
      await getTelegramSettings();

    res.json(settings);
  }
);

app.post(
  "/api/telegram-settings",
  requirePermission("telegram_settings"),
  async (req, res) => {
    try {
      const data =
        await saveTelegramSettings(
          req.body || {}
        );

      res.json({
        ok: true,
        settings: data
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   ADVERTISEMENTS
========================================================= */

app.get(
  "/api/advertisements",
  requirePermission("advertising"),
  async (req, res) => {
    try {
      const { data, error } =
        await supabase
          .from("advertisements")
          .select("*")
          .order("created_at", {
            ascending: false
          });

      if (error) throw error;

      res.json(data || []);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.post(
  "/api/advertisements",
  requirePermission("advertising"),
  async (req, res) => {
    try {
      const body = req.body || {};

      const row = {
        product_id:
          body.productId ||
          body.product_id ||
          null,
        title:
          body.title || null,
        text:
          body.text || null,
        photo_url:
          firstDefined(
            body.photoUrl,
            body.photo_url,
            body.photo
          ),
        discount:
          body.discount || null,
        old_price:
          body.oldPrice ||
          body.old_price ||
          null,
        button_text:
          body.buttonText ||
          body.button_text ||
          "Order Now",
        telegram_chat_id:
          body.telegramChatId ||
          body.telegram_chat_id ||
          null,
        status:
          body.status || "DRAFT"
      };

      const { data, error } =
        await supabase
          .from("advertisements")
          .insert(row)
          .select("*")
          .single();

      if (error) throw error;

      res.json({
        ok: true,
        advertisement: data
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.patch(
  "/api/advertisements/:id",
  requirePermission("advertising"),
  async (req, res) => {
    try {
      const body = req.body || {};

      const row = {
        ...body
      };

      if (body.productId !== undefined) {
        row.product_id = body.productId;
        delete row.productId;
      }

      if (body.photoUrl !== undefined) {
        row.photo_url = body.photoUrl;
        delete row.photoUrl;
      }

      if (body.buttonText !== undefined) {
        row.button_text = body.buttonText;
        delete row.buttonText;
      }

      if (
        body.telegramChatId !== undefined
      ) {
        row.telegram_chat_id =
          body.telegramChatId;

        delete row.telegramChatId;
      }

      const { data, error } =
        await supabase
          .from("advertisements")
          .update(row)
          .eq("id", req.params.id)
          .select("*")
          .single();

      if (error) throw error;

      res.json({
        ok: true,
        advertisement: data
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.delete(
  "/api/advertisements/:id",
  requirePermission("advertising"),
  async (req, res) => {
    try {
      const { error } =
        await supabase
          .from("advertisements")
          .delete()
          .eq("id", req.params.id);

      if (error) throw error;

      res.json({
        ok: true
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   PUBLISH AD
========================================================= */

app.post(
  "/api/advertisements/:id/publish",
  requirePermission("advertising"),
  async (req, res) => {
    try {
      const { data: ad, error } =
        await supabase
          .from("advertisements")
          .select("*")
          .eq("id", req.params.id)
          .single();

      if (error) throw error;

      const settings =
        await getTelegramSettings();

      const chatId =
        firstDefined(
          ad.telegram_chat_id,
          settings.channel_chat_id,
          settings.chat_id,
          ADMIN_CHAT_ID
        );

      if (!chatId) {
        throw new Error(
          "Telegram target chat ID is missing"
        );
      }

      const productId =
        firstDefined(
          ad.product_id,
          ad.productId
        );

      let caption =
        ad.text ||
        ad.title ||
        "New Product";

      if (ad.old_price) {
        caption +=
          `\nOld price: ${ad.old_price}`;
      }

      if (ad.discount) {
        caption +=
          `\nDiscount: ${ad.discount}`;
      }

      let buttonUrl = null;

      if (productId) {
        buttonUrl =
          `https://t.me/${BOT_USERNAME}` +
          `?start=product_${productId}`;
      }

      const replyMarkup =
        buttonUrl
          ? {
              inline_keyboard: [
                [
                  {
                    text:
                      ad.button_text ||
                      "Order Now",
                    url: buttonUrl
                  }
                ]
              ]
            }
          : undefined;

      let result;

      if (ad.photo_url) {
        result = await telegram(
          "sendPhoto",
          {
            chat_id: chatId,
            photo: ad.photo_url,
            caption,
            reply_markup:
              replyMarkup
          }
        );
      } else {
        result = await sendMessage(
          chatId,
          caption,
          replyMarkup
            ? {
                reply_markup:
                  replyMarkup
              }
            : {}
        );
      }

      const { data: updated, error: updateError } =
        await supabase
          .from("advertisements")
          .update({
            status: "PUBLISHED",
            published_at: nowISO(),
            telegram_message_id:
              result?.message_id || null
          })
          .eq("id", ad.id)
          .select("*")
          .single();

      if (updateError) throw updateError;

      res.json({
        ok: true,
        advertisement: updated
      });
    } catch (err) {
      console.error(
        "PUBLISH AD:",
        err
      );

      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   EMPLOYEE CODE
========================================================= */

async function generateEmployeeCode() {
  if (!supabase) {
    throw new Error("Supabase unavailable");
  }

  const { data } = await supabase
    .from("employees")
    .select("employee_code")
    .like("employee_code", "EMP-%")
    .order("created_at", {
      ascending: false
    })
    .limit(100);

  let max = 0;

  for (const row of data || []) {
    const match =
      /^EMP-(\d+)$/i.exec(
        safeString(row.employee_code)
      );

    if (match) {
      max = Math.max(
        max,
        Number(match[1])
      );
    }
  }

  return `EMP-${String(max + 1).padStart(3, "0")}`;
}

/* =========================================================
   EMPLOYEES
========================================================= */

app.get(
  "/api/employees",
  requirePermission("employees"),
  async (req, res) => {
    try {
      const { data, error } =
        await supabase
          .from("employees")
          .select(`
            id,
            employee_code,
            name,
            username,
            role,
            active,
            created_at,
            last_login_at
          `)
          .order("created_at", {
            ascending: false
          });

      if (error) throw error;

      res.json(data || []);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.post(
  "/api/employees",
  requirePermission("employees"),
  async (req, res) => {
    try {
      const body = req.body || {};

      const name =
        safeString(body.name);

      const username =
        safeString(body.username);

      const password =
        safeString(body.password);

      if (!name) {
        return res.status(400).json({
          ok: false,
          error: "Employee name is required"
        });
      }

      if (!username) {
        return res.status(400).json({
          ok: false,
          error: "Username is required"
        });
      }

      if (!password) {
        return res.status(400).json({
          ok: false,
          error: "Password is required"
        });
      }

      const employeeCode =
        await generateEmployeeCode();

      const passwordHash =
        await hashPassword(password);

      const { data, error } =
        await supabase
          .from("employees")
          .insert({
            employee_code:
              employeeCode,
            name,
            username,
            password_hash:
              passwordHash,
            role:
              body.role ||
              "EMPLOYEE",
            active:
              body.active !== false
          })
          .select(`
            id,
            employee_code,
            name,
            username,
            role,
            active,
            created_at
          `)
          .single();

      if (error) throw error;

      const permissions =
        Array.isArray(body.permissions)
          ? body.permissions
          : [];

      if (permissions.length) {
        await supabase
          .from("employee_permissions")
          .insert(
            permissions.map(
              (permission) => ({
                employee_id: data.id,
                permission
              })
            )
          );
      }

      res.json({
        ok: true,
        employee: data
      });
    } catch (err) {
      console.error(
        "CREATE EMPLOYEE:",
        err
      );

      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.patch(
  "/api/employees/:id",
  requirePermission("employees"),
  async (req, res) => {
    try {
      const body = req.body || {};
      const row = {};

      if (body.name !== undefined) {
        row.name =
          safeString(body.name);
      }

      if (
        body.username !== undefined
      ) {
        row.username =
          safeString(body.username);
      }

      if (
        body.role !== undefined
      ) {
        row.role =
          safeString(body.role);
      }

      if (
        body.active !== undefined
      ) {
        row.active =
          Boolean(body.active);
      }

      if (
        body.password !== undefined &&
        safeString(body.password)
      ) {
        row.password_hash =
          await hashPassword(
            body.password
          );
      }

      const { data, error } =
        await supabase
          .from("employees")
          .update(row)
          .eq("id", req.params.id)
          .select(`
            id,
            employee_code,
            name,
            username,
            role,
            active,
            created_at,
            last_login_at
          `)
          .single();

      if (error) throw error;

      res.json({
        ok: true,
        employee: data
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.get(
  "/api/employees/:id/permissions",
  requirePermission("employees"),
  async (req, res) => {
    try {
      const { data, error } =
        await supabase
          .from("employee_permissions")
          .select("permission")
          .eq(
            "employee_id",
            req.params.id
          );

      if (error) throw error;

      res.json(
        (data || []).map(
          (x) => x.permission
        )
      );
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.post(
  "/api/employees/:id/permissions",
  requirePermission("employees"),
  async (req, res) => {
    try {
      const permissions =
        Array.isArray(
          req.body?.permissions
        )
          ? req.body.permissions
          : [];

      await supabase
        .from("employee_permissions")
        .delete()
        .eq(
          "employee_id",
          req.params.id
        );

      if (permissions.length) {
        const rows =
          permissions.map(
            (permission) => ({
              employee_id:
                req.params.id,
              permission
            })
          );

        const { error } =
          await supabase
            .from(
              "employee_permissions"
            )
            .insert(rows);

        if (error) throw error;
      }

      res.json({
        ok: true,
        permissions
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.delete(
  "/api/employees/:id",
  requirePermission("employees"),
  async (req, res) => {
    try {
      await supabase
        .from("employee_permissions")
        .delete()
        .eq(
          "employee_id",
          req.params.id
        );

      const { error } =
        await supabase
          .from("employees")
          .delete()
          .eq(
            "id",
            req.params.id
          );

      if (error) throw error;

      res.json({
        ok: true
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* =========================================================
   AUTH LOGIN
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

      if (!username || !password) {
        return res.status(400).json({
          ok: false,
          error:
            "Username and password are required"
        });
      }

      /* MASTER ADMIN */

      if (
        username ===
          MASTER_ADMIN_USERNAME &&
        MASTER_ADMIN_PASSWORD &&
        password ===
          MASTER_ADMIN_PASSWORD
      ) {
        const token =
          createAuthToken({
            role: "MASTER_ADMIN",
            username,
            name: "Master Admin",
            exp:
              Date.now() +
              1000 * 60 * 60 * 24 * 7
          });

        return res.json({
          ok: true,
          token,
          user: {
            role: "MASTER_ADMIN",
            username,
            name: "Master Admin"
          }
        });
      }

      if (!supabase) {
        return res.status(500).json({
          ok: false,
          error: "Supabase unavailable"
        });
      }

      /* EMPLOYEE */

      const { data: employee, error } =
        await supabase
          .from("employees")
          .select("*")
          .eq("username", username)
          .maybeSingle();

      if (error) {
        return res.status(500).json({
          ok: false,
          error: error.message
        });
      }

      if (!employee) {
        return res.status(401).json({
          ok: false,
          error:
            "Invalid username or password"
        });
      }

      if (employee.active === false) {
        return res.status(403).json({
          ok: false,
          error:
            "Employee account is inactive"
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
            "Invalid username or password"
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
          role: "EMPLOYEE",
          employeeId:
            employee.id,
          username:
            employee.username,
          name:
            employee.name,
          employeeCode:
            employee.employee_code,
          exp:
            Date.now() +
            1000 * 60 * 60 * 24
        });

      res.json({
        ok: true,
        token,
        user: {
          role: "EMPLOYEE",
          employeeId:
            employee.id,
          employeeCode:
            employee.employee_code,
          username:
            employee.username,
          name:
            employee.name
        }
      });
    } catch (err) {
      console.error(
        "LOGIN ERROR:",
        err
      );

      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

app.get(
  "/api/auth/me",
  requireAuth,
  async (req, res) => {
    const user = {
      role: req.auth.role,
      username:
        req.auth.username,
      name:
        req.auth.name
    };

    if (
      req.auth.role ===
      "EMPLOYEE"
    ) {
      user.employeeId =
        req.auth.employeeId;

      user.employeeCode =
        req.auth.employeeCode;

      const { data } =
        await supabase
          .from(
            "employee_permissions"
          )
          .select("permission")
          .eq(
            "employee_id",
            req.auth.employeeId
          );

      user.permissions =
        (data || []).map(
