const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.set("trust proxy", 1);

app.use(cors());

app.use(express.json({
  limit: "10mb"
}));

app.use(express.urlencoded({
  extended: true,
  limit: "10mb"
}));

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

const PORT = Number(
  process.env.PORT || 10000
);

/* =========================================================
   ENVIRONMENT VARIABLES
========================================================= */

const SUPABASE_URL =
  process.env.SUPABASE_URL || "";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

const BOT_USERNAME =
  (
    process.env.TELEGRAM_BOT_USERNAME ||
    "uni_market_shop_bot"
  ).replace("@", "");

const WEBHOOK_URL =
  (
    process.env.WEBHOOK_URL || ""
  ).replace(/\/$/, "");

const ADMIN_CHAT_ID =
  process.env.ADMIN_CHAT_ID ||
  process.env.ADMIN_CHAT_id ||
  "";

const MASTER_USERNAME =
  process.env.MASTER_ADMIN_USERNAME ||
  "admin";

/*
  Supports:
  MASTER_ADMIN_PASS
  MASTER_ADMIN_PASSWORD
  or any environment variable beginning with
  MASTER_ADMIN_PASS
*/
const masterPassKey =
  Object.keys(process.env).find(
    (key) =>
      key.toUpperCase().startsWith(
        "MASTER_ADMIN_PASS"
      )
  );

const MASTER_PASSWORD =
  masterPassKey
    ? String(
        process.env[masterPassKey] || ""
      )
    : String(
        process.env.WEB_PASSWORD || ""
      );

const AUTH_SECRET =
  String(
    process.env.AUTH_SECRET ||
    SUPABASE_SERVICE_ROLE_KEY ||
    "telegram-sales-manager-secret"
  );

const STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET ||
  "product-photos";

if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY
) {
  console.error(
    "❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  );
}

/* =========================================================
   SUPABASE
========================================================= */

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

/* =========================================================
   UPLOAD
========================================================= */

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 8 * 1024 * 1024
  }
});

/* =========================================================
   MEMORY SESSIONS
========================================================= */

const sessions = new Map();

/* =========================================================
   EMPLOYEE PERMISSIONS
========================================================= */

const PERMISSIONS = [
  "view_orders",
  "verify_payment",
  "confirm_order",
  "products",
  "delete_product",
  "advertising",
  "payment_settings",
  "telegram_settings",
  "employees",
  "reports"
];

/* =========================================================
   HELPERS
========================================================= */

function b64(value) {
  return Buffer
    .from(String(value))
    .toString("base64url");
}

function tokenSign(payload) {
  const body =
    b64(JSON.stringify(payload));

  const signature =
    crypto
      .createHmac(
        "sha256",
        AUTH_SECRET
      )
      .update(body)
      .digest("base64url");

  return `${body}.${signature}`;
}

function tokenVerify(token) {
  try {
    const parts =
      String(token || "").split(".");

    if (parts.length !== 2) {
      return null;
    }

    const [body, signature] =
      parts;

    if (!body || !signature) {
      return null;
    }

    const expected =
      crypto
        .createHmac(
          "sha256",
          AUTH_SECRET
        )
        .update(body)
        .digest("base64url");

    const a =
      Buffer.from(signature);

    const b =
      Buffer.from(expected);

    if (a.length !== b.length) {
      return null;
    }

    if (
      !crypto.timingSafeEqual(a, b)
    ) {
      return null;
    }

    const payload =
      JSON.parse(
        Buffer
          .from(body, "base64url")
          .toString()
      );

    if (
      !payload.exp ||
      Date.now() > Number(payload.exp)
    ) {
      return null;
    }

    return payload;

  } catch {
    return null;
  }
}

function auth(req) {
  const header =
    req.headers.authorization || "";

  const token =
    header.startsWith("Bearer ")
      ? header.slice(7)
      : "";

  return tokenVerify(token);
}

function requireAuth(
  req,
  res,
  next
) {
  const a = auth(req);

  if (!a) {
    return res.status(401).json({
      error:
        "የመግቢያ ፍቃድ የለም።"
    });
  }

  req.auth = a;

  next();
}

function requireMaster(
  req,
  res,
  next
) {
  const a = auth(req);

  if (
    !a ||
    a.role !== "master"
  ) {
    return res.status(403).json({
      error:
        "Master Admin ብቻ የሚፈቀድ ነው።"
    });
  }

  req.auth = a;

  next();
}

function requirePermission(
  permission
) {
  return async (
    req,
    res,
    next
  ) => {
    try {
      const a = auth(req);

      if (!a) {
        return res.status(401).json({
          error:
            "Login ያስፈልጋል።"
        });
      }

      if (a.role === "master") {
        req.auth = a;
        return next();
      }

      if (!a.employeeId) {
        return res.status(403).json({
          error:
            "Permission የለህም።"
        });
      }

      const {
        data,
        error
      } = await supabase
        .from("employee_permissions")
        .select("enabled")
        .eq(
          "employee_id",
          a.employeeId
        )
        .eq(
          "permission",
          permission
        )
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          error: error.message
        });
      }

      if (!data?.enabled) {
        return res.status(403).json({
          error:
            "ይህን ስራ ለመስራት Permission የለህም።"
        });
      }

      req.auth = a;

      next();

    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  };
}

function hashPassword(password) {
  const salt =
    crypto
      .randomBytes(16)
      .toString("hex");

  const hash =
    crypto
      .scryptSync(
        String(password),
        salt,
        64
      )
      .toString("hex");

  return `${salt}:${hash}`;
}

function verifyPassword(
  password,
  stored
) {
  try {
    const [
      salt,
      hash
    ] = String(
      stored || ""
    ).split(":");

    if (!salt || !hash) {
      return false;
    }

    const check =
      crypto
        .scryptSync(
          String(password),
          salt,
          64
        )
        .toString("hex");

    const a =
      Buffer.from(hash, "hex");

    const b =
      Buffer.from(check, "hex");

    if (a.length !== b.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      a,
      b
    );

  } catch {
    return false;
  }
}

/* =========================================================
   TELEGRAM
========================================================= */

async function telegram(
  method,
  data = {}
) {
  if (!BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN የለም።"
    );
  }

  const response =
    await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json"
        },

        body:
          JSON.stringify(data)
      }
    );

  return response.json();
}

async function sendMessage(
  chatId,
  text,
  extra = {}
) {
  if (
    !BOT_TOKEN ||
    !chatId
  ) {
    return null;
  }

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
   ORDER TELEGRAM MESSAGE TRACKING
========================================================= */

/*
  Saves every bot-sent message that belongs to an Order.
  These messages can later be deleted when the customer
  confirms that the Order has been received.
*/

async function trackTelegramMessage(
  orderId,
  messageId
) {
  if (
    !orderId ||
    !messageId
  ) {
    return;
  }

  try {
    const {
      data: order,
      error
    } = await supabase
      .from("orders")
      .select(
        "telegram_message_ids"
      )
      .eq(
        "id",
        orderId
      )
      .maybeSingle();

    if (error) {
      console.error(
        "Track Telegram message read:",
        error.message
      );
      return;
    }

    let ids =
      Array.isArray(
        order?.telegram_message_ids
      )
        ? order.telegram_message_ids
        : [];

    ids =
      ids
        .map(Number)
        .filter(
          Number.isFinite
        );

    const numericId =
      Number(messageId);

    if (
      !ids.includes(numericId)
    ) {
      ids.push(numericId);
    }

    await supabase
      .from("orders")
      .update({
        telegram_message_ids:
          ids
      })
      .eq(
        "id",
        orderId
      );

  } catch (error) {
    console.error(
      "Track Telegram message:",
      error.message
    );
  }
}

async function sendTrackedMessage(
  orderId,
  chatId,
  text,
  extra = {}
) {
  const result =
    await sendMessage(
      chatId,
      text,
      extra
    );

  if (
    result?.ok &&
    result?.result?.message_id &&
    orderId
  ) {
    await trackTelegramMessage(
      orderId,
      result.result.message_id
    );
  }

  return result;
}

/*
  The Bot API may reject deletion of a message for
  Telegram permission/restriction reasons.

  Therefore cleanup is BEST EFFORT.
  One failed deletion must never make DELIVERED fail.
*/

async function deleteTrackedOrderMessages(
  order
) {
  if (
    !order?.customer_id
  ) {
    return;
  }

  const ids =
    Array.isArray(
      order.telegram_message_ids
    )
      ? order.telegram_message_ids
      : [];

  for (
    const messageId
    of ids
  ) {
    try {
      await telegram(
        "deleteMessage",
        {
          chat_id:
            order.customer_id,

          message_id:
            Number(messageId)
        }
      );

    } catch (error) {
      console.warn(
        `Order ${order.id}: message ${messageId} could not be deleted:`,
        error.message
      );
    }
  }

  /*
    Do not delete the Order record.
    Only clear the list of Telegram message IDs.
  */

  try {
    await supabase
      .from("orders")
      .update({
        telegram_message_ids:
          []
      })
      .eq(
        "id",
        order.id
      );
  } catch (error) {
    console.warn(
      "Could not clear tracked Telegram messages:",
      error.message
    );
  }
}

/* =========================================================
   SETTINGS
========================================================= */

async function getTelegramSettings() {
  const {
    data,
    error
  } = await supabase
    .from("telegram_settings")
    .select("*")
    .order("id", {
      ascending: false
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || {};
}

async function saveTelegramSettings(
  values
) {
  const old =
    await getTelegramSettings();

  if (old?.id) {
    return supabase
      .from("telegram_settings")
      .update({
        ...values,
        updated_at:
          new Date().toISOString()
      })
      .eq("id", old.id)
      .select()
      .single();
  }

  return supabase
    .from("telegram_settings")
    .insert({
      ...values,
      bot_username:
        BOT_USERNAME
    })
    .select()
    .single();
}

async function getPaymentSettings() {
  const {
    data,
    error
  } = await supabase
    .from("payment_settings")
    .select("*")
    .order("id", {
      ascending: false
    });

  if (error) {
    throw error;
  }

  return data || [];
}

async function getProduct(id) {
  const {
    data,
    error
  } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function notifyOrder(
  order,
  text
) {
  if (!order?.customer_id) {
    return;
  }

  try {
    await sendMessage(
      order.customer_id,
      text
    );
  } catch (error) {
    console.error(
      "Customer notification:",
      error.message
    );
  }
}

/* =========================================================
   DELIVERY MESSAGE
========================================================= */

async function sendDeliveryPendingMessage(
  order
) {
  if (
    !order?.customer_id
  ) {
    return null;
  }

  const total =
    Number(
      order.total || 0
    ).toLocaleString();

  const text =
    `✅ ትዕዛዝዎ ተረጋግጧል።\n\n` +
    `🛍️ ${order.product_name || ""}\n` +
    `🔢 ብዛት: ${Number(order.quantity || 1)}\n` +
    `💰 Total: ${total} ETB\n\n` +
    `📦 ትዕዛዝዎ ለመላክ ተዘጋጅቷል።\n` +
    `እቃው ከደረሰዎ በኋላ ከታች ያለውን በተን ይጫኑ።`;

  return sendTrackedMessage(
    order.id,
    order.customer_id,
    text,
    {
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
   LOGIN
========================================================= */

app.get(
  "/login",
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

app.post(
  "/api/auth/login",
  async (req, res) => {
    try {
      const {
        username,
        password
      } = req.body || {};

      const u =
        String(
          username || ""
        ).trim();

      const p =
        String(password || "");

      /* MASTER ADMIN */

      if (
        u === MASTER_USERNAME &&
        MASTER_PASSWORD &&
        p === MASTER_PASSWORD
      ) {
        const token =
          tokenSign({
            role: "master",
            username:
              MASTER_USERNAME,
            exp:
              Date.now() +
              1000 * 60 * 60 * 12
          });

        return res.json({
          ok: true,
          token,

          user: {
            role: "master",
            username:
              MASTER_USERNAME,
            name:
              "Master Admin"
          },

          permissions: ["*"]
        });
      }

      /* EMPLOYEE */

      const {
        data: employee,
        error
      } = await supabase
        .from("employees")
        .select("*")
        .eq("username", u)
        .eq("is_active", true)
        .maybeSingle();

      if (error) {
        return res.status(500).json({
          error: error.message
        });
      }

      if (
        !employee ||
        !verifyPassword(
          p,
          employee.password_hash
        )
      ) {
        return res.status(401).json({
          error:
            "የተጠቃሚ ስም ወይም Password ተሳስቷል።"
        });
      }

      const {
        data: permissions,
        error: permissionError
      } = await supabase
        .from(
          "employee_permissions"
        )
        .select("permission")
        .eq(
          "employee_id",
          employee.id
        )
        .eq("enabled", true);

      if (permissionError) {
        return res.status(500).json({
          error:
            permissionError.message
        });
      }

      const token =
        tokenSign({
          role: "employee",
          employeeId:
            employee.id,
          username:
            employee.username,
          exp:
            Date.now() +
            1000 * 60 * 60 * 12
        });

      return res.json({
        ok: true,
        token,

        user: {
          role: "employee",
          id: employee.id,
          username:
            employee.username,
          name:
            employee.name
        },

        permissions:
          (permissions || [])
            .map(
              (x) =>
                x.permission
            )
      });

    } catch (error) {
      console.error(
        "Login:",
        error
      );

      res.status(500).json({
        error:
          "Login error"
      });
    }
  }
);

app.get(
  "/api/auth/me",
  requireAuth,
  async (req, res) => {
    try {
      if (
        req.auth.role === "master"
      ) {
        return res.json({
          user: {
            role: "master",
            username:
              req.auth.username,
            name:
              "Master Admin"
          },

          permissions: ["*"]
        });
      }

      const {
        data: employee
      } = await supabase
        .from("employees")
        .select(
          "id,name,username,phone,is_active"
        )
        .eq(
          "id",
          req.auth.employeeId
        )
        .maybeSingle();

      const {
        data: permissions
      } = await supabase
        .from(
          "employee_permissions"
        )
        .select("permission")
        .eq(
          "employee_id",
          req.auth.employeeId
        )
        .eq("enabled", true);

      res.json({
        user: {
          role: "employee",
          ...(employee || {})
        },

        permissions:
          (permissions || [])
            .map(
              (x) =>
                x.permission
            )
      });

    } catch (error) {
      res.status(500).json({
        error: error.message
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
      port: PORT
    });
  }
);

/* =========================================================
   PRODUCTS
========================================================= */

app.get(
  "/api/products",
  requirePermission("products"),
  async (req, res) => {
    try {
      const {
        data,
        error
      } = await supabase
        .from("products")
        .select("*")
        .order("created_at", {
          ascending: false
        });

      if (error) {
        throw error;
      }

      res.json(data || []);

    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.post(
  "/api/products",
  requirePermission("products"),
  async (req, res) => {
    try {
      const b =
        req.body || {};

      if (
        !String(
          b.name || ""
        ).trim()
      ) {
        return res.status(400).json({
          error:
            "Product Name ያስፈልጋል።"
        });
      }

      const row = {
        name:
          String(b.name).trim(),

        description:
          b.description ?? "",

        buy_price:
          Number(
            b.buyPrice ??
            b.buy_price ??
            0
          ),

        sell_price:
          Number(
            b.sellPrice ??
            b.sell_price ??
            0
          ),

        stock:
          Number(
            b.stock ?? 0
          ),

        photo_url:
          b.photoUrl ??
          b.photo_url ??
          b.photo ??
          null
      };

      const {
        data,
        error
      } = await supabase
        .from("products")
        .insert(row)
        .select()
        .single();

      if (error) {
        throw error;
      }

      res.json(data);

    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.patch(
  "/api/products/:id",
  requirePermission("products"),
  async (req, res) => {
    try {
      const b =
        req.body || {};

      const row = {};

      if (
        b.name !== undefined
      ) {
        row.name = b.name;
      }

      if (
        b.description !== undefined
      ) {
        row.description =
          b.description;
      }

      if (
        b.buyPrice !== undefined ||
        b.buy_price !== undefined
      ) {
        row.buy_price =
          Number(
            b.buyPrice ??
            b.buy_price
          );
      }

      if (
        b.sellPrice !== undefined ||
        b.sell_price !== undefined
      ) {
        row.sell_price =
          Number(
            b.sellPrice ??
            b.sell_price
          );
      }

      if (
        b.stock !== undefined
      ) {
        row.stock =
          Number(b.stock);
      }

      if (
        b.photoUrl !== undefined ||
        b.photo_url !== undefined
      ) {
        row.photo_url =
          b.photoUrl ??
          b.photo_url;
      }

      const {
        data,
        error
      } = await supabase
        .from("products")
        .update(row)
        .eq(
          "id",
          req.params.id
        )
        .select()
        .single();

      if (error) {
        throw error;
      }

      res.json(data);

    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

app.delete(
  "/api/products/:id",
  requirePermission(
    "delete_product"
  ),
  async (req, res) => {
    try {
      const {
        error
      } = await supabase
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

    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   UPLOAD PRODUCT / AD PHOTO
========================================================= */

app.post(
  "/api/upload",
  requirePermission("products"),
  upload.single("photo"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error:
            "Photo የለም።"
        });
      }

      const context =
        req.body?.context === "ad"
          ? "ads"
          : "products";

      const original =
        req.file.originalname ||
        "image.jpg";

      const ext =
        (
          original
            .split(".")
            .pop() ||
          "jpg"
        ).toLowerCase();

      const safeExt =
        /^[a-z0-9]+$/i.test(ext)
          ? ext
          : "jpg";

      const filePath =
        `${context}/${Date.now()}-${crypto
          .randomBytes(5)
          .toString("hex")}.${safeExt}`;

      const {
        error
      } = await supabase.storage
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
        throw error;
      }

      const {
        data
      } =
        supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(
            filePath
          );

      res.json({
        ok: true,
        url:
          data.publicUrl,
        path:
          filePath
      });

    } catch (error) {
      console.error(
        "Upload:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   ORDERS
========================================================= */

app.get(
  "/api/orders",
  requirePermission(
    "view_orders"
  ),
  async (req, res) => {
    try {
      const {
        data,
        error
      } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", {
          ascending: false
        });

      if (error) {
        throw error;
      }

      res.json(data || []);

    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   CHANGE ORDER STATUS
========================================================= */

async function changeOrderStatus(
  id,
  status,
  actor = {}
) {
  const {
    data: order,
    error
  } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!order) {
    throw new Error(
      "Order not found"
    );
  }

  const oldStatus =
    String(
      order.status || ""
    ).toUpperCase();

  const actionStatus =
    String(
      status || ""
    ).toUpperCase();

  /* =====================================================
     CONFIRM
  ===================================================== */

  if (
    actionStatus === "CONFIRMED"
  ) {
    /*
      Already confirmed / waiting delivery.
      Do NOT deduct stock again.
    */

    if (
      oldStatus ===
        "DELIVERY_PENDING"
    ) {
      return order;
    }

    /*
      Already delivered.
    */

    if (
      oldStatus === "DELIVERED"
    ) {
      return order;
    }

    /*
      Only Receipt Pending can be confirmed.
    */

    if (
      oldStatus !==
      "RECEIPT_PENDING"
    ) {
      throw new Error(
        "ይህ Order አሁን Receipt Pending ላይ አይደለም።"
      );
    }

    /* ===================================================
       STOCK
    =================================================== */

    const product =
      await getProduct(
        order.product_id
      );

    if (product) {
      const stock =
        Number(
          product.stock || 0
        );

      const quantity =
        Number(
          order.quantity || 1
        );

      if (
        stock < quantity
      ) {
        throw new Error(
          "Stock በቂ አይደለም።"
        );
      }

      const {
        error: stockError
      } = await supabase
        .from("products")
        .update({
          stock:
            stock - quantity
        })
        .eq(
          "id",
          order.product_id
        )
        .gte(
          "stock",
          quantity
        );

      if (stockError) {
        throw stockError;
      }
    }

    /*
      IMPORTANT:
      CONFIRMED is the admin action.
      Stored status becomes DELIVERY_PENDING.
    */

    const patch = {
      status:
        "DELIVERY_PENDING",

      delivery_status:
        "PENDING",

      confirmed_at:
        new Date().toISOString()
    };

    const {
      data: updated,
      error: updateError
    } = await supabase
      .from("orders")
      .update(patch)
      .eq("id", id)
      .eq(
        "status",
        "RECEIPT_PENDING"
      )
      .select()
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    /*
      Protection against two admins pressing
      Confirm almost simultaneously.

      If conditional update did not return a row,
      reload the current Order.
    */

    if (!updated) {
      const {
        data: currentOrder
      } = await supabase
        .from("orders")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (
        currentOrder &&
        [
          "DELIVERY_PENDING",
          "DELIVERED"
        ].includes(
          String(
            currentOrder.status || ""
          ).toUpperCase()
        )
      ) {
        return currentOrder;
      }

      throw new Error(
        "Order ሁኔታ በሌላ እርምጃ ተቀይሯል።"
      );
    }

    /*
      Send delivery notification with
      Received button.
    */

    await sendDeliveryPendingMessage(
      updated
    );

    return updated;
  }

  /* =====================================================
     REJECT
  ===================================================== */

  if (
    actionStatus === "REJECTED"
  ) {
    if (
      oldStatus === "REJECTED"
    ) {
      return order;
    }

    if (
      oldStatus !==
      "RECEIPT_PENDING"
    ) {
      throw new Error(
        "ይህ Order አሁን Receipt Pending ላይ አይደለም።"
      );
    }

    const patch = {
      status:
        "REJECTED",

      rejected_at:
        new Date().toISOString()
    };

    const {
      data: updated,
      error: updateError
    } = await supabase
      .from("orders")
      .update(patch)
      .eq("id", id)
      .eq(
        "status",
        "RECEIPT_PENDING"
      )
      .select()
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    if (!updated) {
      const {
        data: currentOrder
      } = await supabase
        .from("orders")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (
        String(
          currentOrder?.status || ""
        ).toUpperCase() ===
        "REJECTED"
      ) {
        return currentOrder;
      }

      throw new Error(
        "Order ሁኔታ ተቀይሯል።"
      );
    }

    await notifyOrder(
      updated,
      "❌ የክፍያ ደረሰኝዎ አልተፈቀደም። እባክዎ Admin ያነጋግሩ።"
    );

    return updated;
  }

  throw new Error(
    "Invalid order status"
  );
}

async function checkOrderPermission(
  a,
  status
) {
  if (
    a.role === "master"
  ) {
    return true;
  }

  const permission =
    status === "CONFIRMED"
      ? "confirm_order"
      : "verify_payment";

  const {
    data,
    error
  } = await supabase
    .from(
      "employee_permissions"
    )
    .select("enabled")
    .eq(
      "employee_id",
      a.employeeId
    )
    .eq(
      "permission",
      permission
    )
    .maybeSingle();

  if (error) {
    throw error;
  }

  return !!data?.enabled;
}

async function handleOrderStatus(
  req,
  res
) {
  try {
    const a = auth(req);

    if (!a) {
      return res.status(401).json({
        error:
          "Login ያስፈልጋል።"
      });
    }

    const status =
      String(
        req.body?.status ??
        req.body?.action ??
        ""
      ).toUpperCase();

    if (
      ![
        "CONFIRMED",
        "REJECTED"
      ].includes(status)
    ) {
      return res.status(400).json({
        error:
          "Invalid order status"
      });
    }

    const allowed =
      await checkOrderPermission(
        a,
        status
      );

    if (!allowed) {
      return res.status(403).json({
        error:
          status === "CONFIRMED"
            ? "Confirm Order Permission የለህም።"
            : "Verify Payment Permission የለህም።"
      });
    }

    const updated =
      await changeOrderStatus(
        req.params.id,
        status,
        a
      );

    res.json(updated);

  } catch (error) {
    console.error(
      "Order status:",
      error
    );

    res.status(500).json({
      error:
        error.message
    });
  }
}

app.patch(
  "/api/orders/:id",
  handleOrderStatus
);

app.patch(
  "/api/orders/:id/status",
  handleOrderStatus
);

/* =========================================================
   RECEIPT PROXY
========================================================= */

app.get(
  "/api/orders/:id/receipt",
  requirePermission(
    "view_orders"
  ),
  async (req, res) => {
    try {
      const {
        data: order,
        error
      } = await supabase
        .from("orders")
        .select(
          "receipt_file_id"
        )
        .eq(
          "id",
          req.params.id
        )
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (
        !order?.receipt_file_id
      ) {
        return res.status(404).send(
          "Receipt not found"
        );
      }

      const telegramResult =
        await telegram(
          "getFile",
          {
            file_id:
              order.receipt_file_id
          }
        );

      if (
        !telegramResult.ok
      ) {
        return res
          .status(500)
          .send(
            telegramResult.description ||
            "Telegram file error"
          );
      }

      const fileUrl =
        `https://api.telegram.org/file/bot${BOT_TOKEN}/${telegramResult.result.file_path}`;

      const image =
        await fetch(fileUrl);

      if (!image.ok) {
        return res
          .status(500)
          .send(
            "Receipt download failed"
          );
      }

      res.setHeader(
        "Content-Type",
        image.headers.get(
          "content-type"
        ) || "image/jpeg"
      );

      res.end(
        Buffer.from(
          await image.arrayBuffer()
        )
      );

    } catch (error) {
      console.error(
        "Receipt:",
        error
      );

      res.status(500).send(
        error.message
      );
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
  async (req, res) => {
    try {
      res.json(
        await getPaymentSettings()
      );
    } catch (error) {
      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

app.post(
  "/api/payment-settings",
  requirePermission(
    "payment_settings"
  ),
  async (req, res) => {
    try {
      const b =
        req.body || {};

      const {
        data,
        error
      } = await supabase
        .from("payment_settings")
        .insert({
          method:
            b.method,

          account_name:
            b.accountName ??
            b.account_name,

          account_number:
            b.accountNumber ??
            b.account_number,

          phone:
            b.phone,

          additional_info:
            b.additionalInfo ??
            b.additional_info,

          is_active:
            b.isActive ?? true
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      res.json(data);

    } catch (error) {
      res.status(500).json({
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
  async (req, res) => {
    try {
      res.json(
        await getTelegramSettings()
      );
    } catch (error) {
      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

app.post(
  "/api/telegram-settings",
  requirePermission(
    "telegram_settings"
  ),
  async (req, res) => {
    try {
      const b =
        req.body || {};

      const result =
        await saveTelegramSettings({
          ad_chat_id:
            b.adChatId ??
            b.ad_chat_id,

          ad_chat_title:
            b.adChatTitle ??
            b.ad_chat_title,

          bot_username:
            String(
              b.botUsername ||
              BOT_USERNAME
            ).replace(
              "@",
              ""
            )
        });

      if (result.error) {
        throw result.error;
      }

      res.json(
        result.data
      );

    } catch (error) {
      res.status(500).json({
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
  requirePermission(
    "advertising"
  ),
  async (req, res) => {
    try {
      const {
        data,
        error
      } = await supabase
        .from("advertisements")
        .select("*")
        .order("created_at", {
          ascending: false
        });

      if (error) {
        throw error;
      }

      res.json(data || []);

    } catch (error) {
      res.status(500).json({
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
  async (req, res) => {
    try {
      const b =
        req.body || {};

      const row = {
        product_id:
          b.productId ??
          b.product_id ??
          null,

        title:
          b.title || "",

        text:
          b.text || "",

        photo_url:
          b.photoUrl ??
          b.photo_url ??
          null,

        button_text:
          b.buttonText ??
          b.button_text ??
          null,

        status:
          b.status ||
          "ACTIVE",

        ad_type:
          b.adType ??
          b.ad_type ??
          "PRODUCT",

        discount:
          Number(
            b.discount ?? 0
          ),

        old_price:
          Number(
            b.oldPrice ??
            b.old_price ??
            0
          ),

        target_chat_id:
          b.targetChatId ??
          b.target_chat_id ??
          null,

        publish_status:
          "DRAFT"
      };

      const {
        data,
        error
      } = await supabase
        .from(
          "advertisements"
        )
        .insert(row)
        .select()
        .single();

      if (error) {
        throw error;
      }

      res.json(data);

    } catch (error) {
      console.error(
        "Advertisement create:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

app.patch(
  "/api/advertisements/:id",
  requirePermission(
    "advertising"
  ),
  async (req, res) => {
    try {
      const b =
        req.body || {};

      const row = {};

      if (
        b.title !== undefined
      ) {
        row.title =
          b.title;
      }

      if (
        b.text !== undefined
      ) {
        row.text =
          b.text;
      }

      if (
        b.photoUrl !== undefined ||
        b.photo_url !== undefined
      ) {
        row.photo_url =
          b.photoUrl ??
          b.photo_url;
      }

      if (
        b.buttonText !== undefined ||
        b.button_text !== undefined
      ) {
        row.button_text =
          b.buttonText ??
          b.button_text;
      }

      if (
        b.status !== undefined
      ) {
        row.status =
          b.status;
      }

      if (
        b.adType !== undefined ||
        b.ad_type !== undefined
      ) {
        row.ad_type =
          b.adType ??
          b.ad_type;
      }

      if (
        b.productId !== undefined ||
        b.product_id !== undefined
      ) {
        row.product_id =
          b.productId ??
          b.product_id;
      }

      if (
        b.discount !== undefined
      ) {
        row.discount =
          Number(
            b.discount
          );
      }

      if (
        b.oldPrice !== undefined ||
        b.old_price !== undefined
      ) {
        row.old_price =
          Number(
            b.oldPrice ??
            b.old_price
          );
      }

      if (
        b.targetChatId !== undefined ||
        b.target_chat_id !== undefined
      ) {
        row.target_chat_id =
          b.targetChatId ??
          b.target_chat_id;
      }

      const {
        data,
        error
      } = await supabase
        .from(
          "advertisements"
        )
        .update(row)
        .eq(
          "id",
          req.params.id
        )
        .select()
        .single();

      if (error) {
        throw error;
      }

      res.json(data);

    } catch (error) {
      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

app.delete(
  "/api/advertisements/:id",
  requirePermission(
    "advertising"
  ),
  async (req, res) => {
    try {
      const {
        error
      } = await supabase
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

      res.json({
        ok: true
      });

    } catch (error) {
      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

app.post(
  "/api/advertisements/:id/publish",
  requirePermission(
    "advertising"
  ),
  async (req, res) => {
    try {
      const {
        data: ad,
        error
      } = await supabase
        .from(
          "advertisements"
        )
        .select("*")
        .eq(
          "id",
          req.params.id
        )
        .single();

      if (error) {
        throw error;
      }

      const settings =
        await getTelegramSettings();

      const chatId =
        ad.target_chat_id ??
        settings.ad_chat_id ??
        process.env.TELEGRAM_AD_CHAT_ID ??
        "";

      if (!chatId) {
        throw new Error(
          "Telegram Channel/Group Chat ID አልተዘጋጀም።"
        );
      }

      const deep =
        `https://t.me/${BOT_USERNAME}?start=product_${encodeURIComponent(
          ad.product_id || ""
        )}`;

      const markup = {
        inline_keyboard: [
          [
            {
              text:
                ad.button_text ||
                "🛒 በዚህ ይዘዙን",

              url: deep
            }
          ]
        ]
      };

      let result;

      if (ad.photo_url) {
        result =
          await telegram(
            "sendPhoto",
            {
              chat_id:
                chatId,

              photo:
                ad.photo_url,

              caption:
                `${ad.title || ""}\n\n${ad.text || ""}`,

              reply_markup:
                markup
            }
          );
      } else {
        result =
          await telegram(
            "sendMessage",
            {
              chat_id:
                chatId,

              text:
                `${ad.title || ""}\n\n${ad.text || ""}`,

              reply_markup:
                markup
            }
          );
      }

      if (!result.ok) {
        throw new Error(
          result.description ||
          "Telegram publish failed"
        );
      }

      await supabase
        .from(
          "advertisements"
        )
        .update({
          publish_status:
            "PUBLISHED",

          published_at:
            new Date().toISOString()
        })
        .eq(
          "id",
          ad.id
        );

      res.json({
        ok: true,
        result
      });

    } catch (error) {
      res.status(500).json({
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
  requireMaster,
  async (req, res) => {
    try {
      const {
        data,
        error
      } = await supabase
        .from("employees")
        .select(
          "id,name,username,phone,is_active,created_at,updated_at"
        )
        .order("id", {
          ascending: false
        });

      if (error) {
        throw error;
      }

      const result = [];

      for (
        const employee
        of data || []
      ) {
        const {
          data: permissions
        } = await supabase
          .from(
            "employee_permissions"
          )
          .select(
            "permission,enabled"
          )
          .eq(
            "employee_id",
            employee.id
          );

        result.push({
          ...employee,
          permissions:
            permissions || []
        });
      }

      res.json(result);

    } catch (error) {
      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

app.post(
  "/api/employees",
  requireMaster,
  async (req, res) => {
    try {
      const b =
        req.body || {};

      if (
        !b.name ||
        !b.username ||
        !b.password
      ) {
        return res.status(400).json({
          error:
            "Name, Username እና Password ያስፈልጋሉ።"
        });
      }

      const {
        data: employee,
        error
      } = await supabase
        .from("employees")
        .insert({
          name:
            b.name,

          username:
            b.username,

          phone:
            b.phone || null,

          password_hash:
            hashPassword(
              b.password
            ),

          is_active:
            true
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      const permissions =
        Array.isArray(
          b.permissions
        )
          ? b.permissions
          : [];

      const rows =
        PERMISSIONS.map(
          (permission) => ({
            employee_id:
              employee.id,

            permission,

            enabled:
              permissions.includes(
                permission
              )
          })
        );

      if (rows.length) {
        const {
          error:
            permissionError
        } = await supabase
          .from(
            "employee_permissions"
          )
          .insert(rows);

        if (permissionError) {
          throw permissionError;
        }
      }

      res.json({
        ok: true,
        employee
      });

    } catch (error) {
      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

app.patch(
  "/api/employees/:id",
  requireMaster,
  async (req, res) => {
    try {
      const b =
        req.body || {};

      const row = {};

      if (
        b.name !== undefined
      ) {
        row.name =
          b.name;
      }

      if (
        b.username !== undefined
      ) {
        row.username =
          b.username;
      }

      if (
        b.phone !== undefined
      ) {
        row.phone =
          b.phone;
      }

      if (b.password) {
        row.password_hash =
          hashPassword(
            b.password
          );
      }

      if (
        b.isActive !== undefined
      ) {
        row.is_active =
          !!b.isActive;
      }

      const {
        data,
        error
      } = await supabase
        .from("employees")
        .update(row)
        .eq(
          "id",
          req.params.id
        )
        .select()
        .single();

      if (error) {
        throw error;
      }

      if (
        Array.isArray(
          b.permissions
        )
      ) {
        await supabase
          .from(
            "employee_permissions"
          )
          .delete()
          .eq(
            "employee_id",
            req.params.id
          );

        const rows =
          PERMISSIONS.map(
            (permission) => ({
              employee_id:
                Number(
                  req.params.id
                ),

              permission,

              enabled:
                b.permissions.includes(
                  permission
                )
            })
          );

        const {
          error:
            permissionError
        } = await supabase
          .from(
            "employee_permissions"
          )
          .insert(rows);

        if (permissionError) {
          throw permissionError;
        }
      }

      res.json({
        ok: true,
        employee: data
      });

    } catch (error) {
      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

app.get(
  "/api/employees/:id/permissions",
  requireMaster,
  async (req, res) => {
    try {
      const {
        data,
        error
      } = await supabase
        .from(
          "employee_permissions"
        )
        .select(
          "permission,enabled"
        )
        .eq(
          "employee_id",
          req.params.id
        );

      if (error) {
        throw error;
      }

      res.json(data || []);

    } catch (error) {
      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

app.post(
  "/api/employees/:id/permissions",
  requireMaster,
  async (req, res) => {
    try {
      const permissions =
        Array.isArray(
          req.body?.permissions
        )
          ? req.body.permissions
          : [];

      await supabase
        .from(
          "employee_permissions"
        )
        .delete()
        .eq(
          "employee_id",
          req.params.id
        );

      const rows =
        PERMISSIONS.map(
          (permission) => ({
            employee_id:
              Number(
                req.params.id
              ),

            permission,

            enabled:
              permissions.includes(
                permission
              )
          })
        );

      const {
        error
      } = await supabase
        .from(
          "employee_permissions"
        )
        .insert(rows);

      if (error) {
        throw error;
      }

      res.json({
        ok: true
      });

    } catch (error) {
      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

app.delete(
  "/api/employees/:id",
  requireMaster,
  async (req, res) => {
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

      const {
        error
      } = await supabase
        .from("employees")
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
      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   TELEGRAM BOT
========================================================= */

async function findPendingOrder(
  chatId
) {
  const {
    data
  } = await supabase
    .from("orders")
    .select("*")
    .eq(
      "customer_id",
      String(chatId)
    )
    .in(
      "status",
      [
        "PAYMENT_PENDING",
        "RECEIPT_PENDING",
        "NEW"
      ]
    )
    .order("created_at", {
      ascending: false
    })
    .limit(1)
    .maybeSingle();

  return data;
}

async function botSendProducts(
  chatId
) {
  const {
    data: products
  } = await supabase
    .from("products")
    .select("*")
    .gt(
      "stock",
      0
    )
    .order("created_at", {
      ascending: false
    });

  if (!products?.length) {
    return sendMessage(
      chatId,
      "📦 በአሁኑ ጊዜ ምርት የለም።"
    );
  }

  const keyboard =
    products.map(
      (product) => [
        {
          text:
            `🛍️ ${product.name} — ${Number(
              product.sell_price || 0
            ).toLocaleString()} ETB`,

          callback_data:
            `product_${product.id}`
        }
      ]
    );

  return sendMessage(
    chatId,
    "🛒 እባክዎ የሚፈልጉትን ምርት ይምረጡ።",
    {
      reply_markup: {
        inline_keyboard:
          keyboard
      }
    }
  );
}

async function telegramAdminAction(
  id,
  status
) {
  const order =
    await changeOrderStatus(
      id,
      status,
      {
        role: "master"
      }
    );

  if (ADMIN_CHAT_ID) {
    await sendMessage(
      ADMIN_CHAT_ID,
      status === "CONFIRMED"
        ? `✅ Order ${id} CONFIRMED — Delivery Pending`
        : `❌ Order ${id} REJECTED`
    );
  }

  return order;
}

/* =========================================================
   TELEGRAM PROCESSOR
========================================================= */

async function processTelegram(
  update
) {
  try {

    /* =====================================================
       CHANNEL POST DETECTION
    ===================================================== */

    if (update.channel_post) {
      const chat =
        update.channel_post.chat;

      if (chat?.id) {
        await saveTelegramSettings({
          detected_chat_id:
            String(chat.id),

          detected_chat_title:
            chat.title ||
            chat.username ||
            "Telegram Channel/Group"
        }).catch(() => {});
      }
    }

    /* =====================================================
       CALLBACK QUERY
    ===================================================== */

    if (update.callback_query) {
      const q =
        update.callback_query;

      const chatId =
        q.message?.chat?.id;

      const data =
        q.data || "";

      await telegram(
        "answerCallbackQuery",
        {
          callback_query_id:
            q.id
        }
      ).catch(() => {});

      /* ===================================================
         ADMIN CONFIRM
      =================================================== */

      if (
        data.startsWith(
          "admin_confirm_"
        )
      ) {
        const id =
          data.slice(
            "admin_confirm_".length
          );

        try {
          await telegramAdminAction(
            id,
            "CONFIRMED"
          );

          await sendMessage(
            chatId,
            `✅ Order ${id} ተረጋግጧል።\n📦 Delivery Pending`
          );

        } catch (error) {
          await sendMessage(
            chatId,
            `❌ Confirm failed: ${error.message}`
          );
        }

        return;
      }

      /* ===================================================
         ADMIN REJECT
      =================================================== */

      if (
        data.startsWith(
          "admin_reject_"
        )
      ) {
        const id =
          data.slice(
            "admin_reject_".length
          );

        try {
          await telegramAdminAction(
            id,
            "REJECTED"
          );

          await sendMessage(
            chatId,
            `❌ Order ${id} ተከልክሏል።`
          );

        } catch (error) {
          await sendMessage(
            chatId,
            `❌ Reject failed: ${error.message}`
          );
        }

        return;
      }

      /* ===================================================
         CUSTOMER RECEIVED
      =================================================== */

      if (
        data.startsWith(
          "order_received_"
        )
      ) {
        const orderId =
          data.slice(
            "order_received_".length
          );

        const {
          data: order,
          error
        } = await supabase
          .from("orders")
          .select("*")
          .eq(
            "id",
            orderId
          )
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (!order) {
          return sendMessage(
            chatId,
            "❌ Order አልተገኘም።"
          );
        }

        /*
          SECURITY:
          Customer can only complete
          their own Order.
        */

        if (
          String(
            order.customer_id
          ) !== String(chatId)
        ) {
          return sendMessage(
            chatId,
            "❌ ይህ Order የእርስዎ አይደለም።"
          );
        }

        const currentStatus =
          String(
            order.status || ""
          ).toUpperCase();

        if (
          currentStatus ===
          "DELIVERED"
        ) {
          return sendMessage(
            chatId,
            "ℹ️ ይህ Order አስቀድሞ ተጠናቋል።"
          );
        }

        if (
          currentStatus !==
          "DELIVERY_PENDING"
        ) {
          return sendMessage(
            chatId,
            "⏳ ይህ Order እስካሁን ለDelivery አልተዘጋጀም።"
          );
        }

        /*
          Conditional update prevents
          double completion.
        */

        const {
          data: updated,
          error: updateError
        } = await supabase
          .from("orders")
          .update({
            status:
              "DELIVERED",

            delivery_status:
              "DELIVERED",

            delivered_at:
              new Date().toISOString()
          })
          .eq(
            "id",
            orderId
          )
          .eq(
            "customer_id",
            String(chatId)
          )
          .eq(
            "status",
            "DELIVERY_PENDING"
          )
          .select()
          .maybeSingle();

        if (updateError) {
          throw updateError;
        }

        if (!updated) {
          const {
            data: current
          } = await supabase
            .from("orders")
            .select("*")
            .eq(
              "id",
              orderId
            )
            .maybeSingle();

          if (
            String(
              current?.status || ""
            ).toUpperCase() ===
            "DELIVERED"
          ) {
            return sendMessage(
              chatId,
              "ℹ️ ይህ Order አስቀድሞ ተጠናቋል።"
            );
          }

          return sendMessage(
            chatId,
            "❌ Order ማጠናቀቅ አልተቻለም።"
          );
        }

        /*
          Inform customer first.
          This message is intentionally NOT tracked,
          because it should remain as the final message
          before the new product menu.
        */

        await sendMessage(
          chatId,
          "✅ እናመሰግናለን።\n\n" +
          "📦 ትዕዛዝዎ እንደደረሰዎት ተመዝግቧል።\n" +
          "🛒 ለአዲስ Order ከታች ያለውን ምርት ይምረጡ።"
        );

        /*
          Delete old bot messages.
        */

        await deleteTrackedOrderMessages(
          order
        );

        /*
          Remove temporary customer session.
        */

        sessions.delete(
          String(chatId)
        );

        /*
          Notify Admin.
        */

        if (ADMIN_CHAT_ID) {
          await sendMessage(
            ADMIN_CHAT_ID,
            `📦 ORDER DELIVERED\n\n` +
            `Order: ${order.id}\n` +
            `Customer: ${order.customer_name || ""}\n` +
            `Phone: ${order.phone || ""}\n` +
            `Product: ${order.product_name || ""}\n` +
            `Total: ${Number(
              order.total || 0
            ).toLocaleString()} ETB`
          );
        }

        /*
          Start a clean new order menu.
        */

        return botSendProducts(
          chatId
        );
      }

      /* ===================================================
         PRODUCT
      =================================================== */

      if (
        data.startsWith(
          "product_"
        )
      ) {
        const productId =
          data.slice(8);

        const product =
          await getProduct(
            productId
          );

        if (!product) {
          return sendMessage(
            chatId,
            "❌ ምርቱ አልተገኘም።"
          );
        }

        if (
          Number(
            product.stock || 0
          ) <= 0
        ) {
          return sendMessage(
            chatId,
            "❌ ይህ ምርት አሁን Stock የለውም።"
          );
        }

        sessions.set(
          String(chatId),
          {
            step:
              "quantity",

            productId:
              String(
                product.id
              ),

            quantity: 1
          }
        );

        return sendMessage(
          chatId,
          `🛍️ ${product.name}\n\n` +
          `${product.description || ""}\n\n` +
          `💰 ${Number(
            product.sell_price || 0
          ).toLocaleString()} ETB\n` +
          `📦 Stock: ${product.stock}\n\n` +
          `የሚፈልጉትን ብዛት ይጻፉ።`
        );
      }

      /* ===================================================
         ORDER CONFIRM
      =================================================== */

      if (
        data ===
        "order_confirm"
      ) {
        const session =
          sessions.get(
            String(chatId)
          );

        if (
          !session?.productId ||
          !session?.name ||
          !session?.phone ||
          !session?.address
        ) {
          return sendMessage(
            chatId,
            "❌ Order session አልተገኘም።"
          );
        }

        const product =
          await getProduct(
            session.productId
          );

        if (!product) {
          return sendMessage(
            chatId,
            "❌ ምርቱ አልተገኘም።"
          );
        }

        const quantity =
          Number(
            session.quantity || 1
          );

        if (
          quantity < 1 ||
          quantity >
            Number(
              product.stock || 0
            )
        ) {
          return sendMessage(
            chatId,
            "❌ Stock አይበቃም።"
          );
        }

        const total =
          Number(
            product.sell_price || 0
          ) * quantity;

        const profit =
          (
            Number(
              product.sell_price || 0
            ) -
            Number(
              product.buy_price || 0
            )
          ) * quantity;

        const username =
          q.from?.username
            ? `@${q.from.username}`
            : "";

        /*
          Preserve the review message ID.
          This allows cleanup after delivery.
        */

        const reviewMessageId =
          session.reviewMessageId ||
          null;

        const {
          data: order,
          error
        } = await supabase
          .from("orders")
          .insert({
            product_id:
              String(
                product.id
              ),

            product_name:
              product.name,

            buy_price:
              Number(
                product.buy_price || 0
              ),

            sell_price:
              Number(
                product.sell_price || 0
              ),

            quantity,

            total,

            profit,

            customer_id:
              String(chatId),

            customer_name:
              session.name,

            username,

            phone:
              session.phone,

            address:
              session.address,

            status:
              "PAYMENT_PENDING",

            delivery_status:
              "NOT_READY",

            telegram_message_ids:
              reviewMessageId
                ? [
                    Number(
                      reviewMessageId
                    )
                  ]
                : []
          })
          .select()
          .single();

        if (error) {
          throw error;
        }

        sessions.set(
          String(chatId),
          {
            ...session,

            orderId:
              order.id,

            step:
              "payment"
          }
        );

        const payments =
          await getPaymentSettings();

        let info =
          "💳 የክፍያ መረጃ ከAdmin ጋር ይረጋገጣል።";

        if (payments.length) {
          info =
            payments
              .filter(
                (payment) =>
                  payment.is_active !==
                  false
              )
              .map(
                (payment) =>
                  `🏦 ${payment.method || ""}\n` +
                  `👤 ${payment.account_name || ""}\n` +
                  `🔢 ${payment.account_number || ""}\n` +
                  `📞 ${payment.phone || ""}\n` +
                  `${payment.additional_info || ""}`
              )
              .join(
                "\n\n"
              );
        }

        /*
          Payment message belongs to the Order.
        */

        return sendTrackedMessage(
          order.id,
          chatId,
          `✅ Order ተመዝግቧል።\n\n` +
          `🛍️ ${product.name}\n` +
          `🔢 ብዛት: ${quantity}\n` +
          `💰 Total: ${total.toLocaleString()} ETB\n\n` +
          `${info}\n\n` +
          `🧾 ከከፈሉ በኋላ የክፍያ ደረሰኝ Photo ይላኩ።`
        );
      }

      /* ===================================================
         ORDER CANCEL
      =================================================== */

      if (
        data ===
        "order_cancel"
      ) {
        sessions.delete(
          String(chatId)
        );

        return sendMessage(
          chatId,
          "❌ Order ተሰርዟል።"
        );
      }
    }

    /* =====================================================
       MESSAGE
    ===================================================== */

    if (update.message) {
      const message =
        update.message;

      const chatId =
        message.chat.id;

      const text =
        (
          message.text || ""
        ).trim();

      const key =
        String(chatId);

      /* ===================================================
         START
      =================================================== */

      if (
        text === "/start" ||
        text.startsWith(
          "/start "
        )
      ) {
        const payload =
          text.split(" ")[1] ||
          "";

        if (
          payload.startsWith(
            "product_"
          )
        ) {
          const product =
            await getProduct(
              payload.slice(8)
            );

          if (product) {
            sessions.set(
              key,
              {
                step:
                  "quantity",

                productId:
                  String(
                    product.id
                  ),

                quantity: 1
              }
            );

            return sendMessage(
              chatId,
              `🛍️ ${product.name}\n\n` +
              `${product.description || ""}\n\n` +
              `💰 ${Number(
                product.sell_price || 0
              ).toLocaleString()} ETB\n` +
              `📦 Stock: ${product.stock}\n\n` +
              `ብዛት ያስገቡ።`
            );
          }
        }

        return botSendProducts(
          chatId
        );
      }

      /* ===================================================
         RECEIPT
      =================================================== */

      if (
        message.photo?.length
      ) {
        const session =
          sessions.get(key);

        let pending = null;

        if (
          session?.orderId
        ) {
          const {
            data
          } = await supabase
            .from("orders")
            .select("*")
            .eq(
              "id",
              session.orderId
            )
            .maybeSingle();

          pending = data;
        }

        if (!pending) {
          pending =
            await findPendingOrder(
              chatId
            );
        }

        if (!pending) {
          return sendMessage(
            chatId,
            "❌ የሚጠበቅ Order አልተገኘም።"
          );
        }

        const photo =
          message.photo[
            message.photo.length - 1
          ];

        const {
          error
        } = await supabase
          .from("orders")
          .update({
            receipt_file_id:
              photo.file_id,

            status:
              "RECEIPT_PENDING"
          })
          .eq(
            "id",
            pending.id
          );

        if (error) {
          throw error;
        }

        /*
          Send receipt to Master Admin.
        */

        if (ADMIN_CHAT_ID) {
          await telegram(
            "sendPhoto",
            {
              chat_id:
                ADMIN_CHAT_ID,

              photo:
                photo.file_id,

              caption:
                `🧾 NEW RECEIPT\n\n` +
                `Order: ${pending.id}\n` +
                `Product: ${pending.product_name}\n` +
                `Customer: ${pending.customer_name || ""}\n` +
                `Phone: ${pending.phone || ""}\n` +
                `Total: ${Number(
                  pending.total || 0
                ).toLocaleString()} ETB`,

              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text:
                        "✅ Confirm",

                      callback_data:
                        `admin_confirm_${pending.id}`
                    },

                    {
                      text:
                        "❌ Reject",

                      callback_data:
                        `admin_reject_${pending.id}`
                    }
                  ]
                ]
              }
            }
          );
        }

        sessions.set(
          key,
          {
            ...(session || {}),

            step:
              "receipt_pending",

            orderId:
              pending.id
          }
        );

        /*
          This customer notification belongs to
          the Order and will be removed after delivery.
        */

        return sendTrackedMessage(
          pending.id,
          chatId,
          "⏳ ደረሰኝዎ ተቀብለናል።\n" +
          "Admin እየተገመገመ ነው።"
        );
      }

      const session =
        sessions.get(key);

      /* ===================================================
         QUANTITY
      =================================================== */

      if (
        session?.step ===
        "quantity"
      ) {
        const quantity =
          Number(text);

        const product =
          await getProduct(
            session.productId
          );

        if (
          !Number.isInteger(
            quantity
          ) ||
          quantity < 1
        ) {
          return sendMessage(
            chatId,
            "❌ ትክክለኛ ብዛት ያስገቡ።"
          );
        }

        if (
          !product ||
          quantity >
            Number(
              product.stock || 0
            )
        ) {
          return sendMessage(
            chatId,
            "❌ ያለው Stock አይበቃም።"
          );
        }

        sessions.set(
          key,
          {
            ...session,

            quantity,

            step:
              "name"
          }
        );

        return sendMessage(
          chatId,
          "👤 ሙሉ ስምዎን ያስገቡ።"
        );
      }

      /* ===================================================
         NAME
      =================================================== */

      if (
        session?.step ===
        "name"
      ) {
        if (
          text.length < 2
        ) {
          return sendMessage(
            chatId,
            "❌ ስምዎን በትክክል ያስገቡ።"
          );
        }

        sessions.set(
          key,
          {
            ...session,

            name:
              text,

            step:
              "phone"
          }
        );

        return sendMessage(
          chatId,
          "📞 ስልክ ቁጥርዎን ያስገቡ።"
        );
      }

      /* ===================================================
         PHONE
      =================================================== */

      if (
        session?.step ===
        "phone"
      ) {
        sessions.set(
          key,
          {
            ...session,

            phone:
              text,

            step:
              "address"
          }
        );

        return sendMessage(
          chatId,
          "📍 የመላኪያ አድራሻዎን ያስገቡ።"
        );
      }

      /* ===================================================
         ADDRESS
      =================================================== */

      if (
        session?.step ===
        "address"
      ) {
        const product =
          await getProduct(
            session.productId
          );

        if (!product) {
          return sendMessage(
            chatId,
            "❌ ምርቱ አልተገኘም።"
          );
        }

        const total =
          Number(
            product.sell_price || 0
          ) *
          Number(
            session.quantity || 1
          );

        /*
          Send review message first.
        */

        const review =
          await sendMessage(
            chatId,
            `📋 ORDER REVIEW\n\n` +
            `🛍️ ${product.name}\n` +
            `🔢 ብዛት: ${session.quantity}\n` +
            `👤 ${session.name}\n` +
            `📞 ${session.phone}\n` +
            `📍 ${text}\n` +
            `💰 ${total.toLocaleString()} ETB`,

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
                        "❌ ሰርዝ",

                      callback_data:
                        "order_cancel"
                    }
                  ]
                ]
              }
            }
          );

        /*
          Store review message ID so it becomes
          part of the Order cleanup list.
        */

        sessions.set(
          key,
          {
            ...session,

            address:
              text,

            step:
              "review",

            reviewMessageId:
              review?.result?.message_id ||
              null
          }
        );

        return review;
      }
    }

  } catch (error) {
    console.error(
      "Telegram update error:",
      error
    );
  }
}

/* =========================================================
   TELEGRAM WEBHOOK
========================================================= */

app.post(
  "/telegram/webhook",
  async (req, res) => {
    /*
      Respond immediately to Telegram.
    */

    res.sendStatus(200);

    processTelegram(
      req.body
    ).catch(
      (error) =>
        console.error(
          "Webhook:",
          error
        )
    );
  }
);

app.get(
  "/api/telegram/webhook-info",
  async (req, res) => {
    try {
      const result =
        await telegram(
          "getWebhookInfo",
          {}
        );

      res.json(result);

    } catch (error) {
      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   ADMIN TELEGRAM ACTION API
========================================================= */

app.post(
  "/api/admin/telegram-action",
  requireAuth,
  async (req, res) => {
    try {
      const {
        id,
        status
      } = req.body || {};

      const s =
        String(
          status || ""
        ).toUpperCase();

      if (
        ![
          "CONFIRMED",
          "REJECTED"
        ].includes(s)
      ) {
        return res.status(400).json({
          error:
            "Invalid status"
        });
      }

      const allowed =
        await checkOrderPermission(
          req.auth,
          s
        );

      if (!allowed) {
        return res.status(403).json({
          error:
            s === "CONFIRMED"
              ? "Confirm Order Permission የለህም።"
              : "Verify Payment Permission የለህም።"
        });
      }

      const updated =
        await changeOrderStatus(
          id,
          s,
          req.auth
        );

      res.json({
        ok: true,
        order: updated
      });

    } catch (error) {
      console.error(
        "Admin Telegram Action:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   REGISTER TELEGRAM WEBHOOK
========================================================= */

app.post(
  "/api/telegram/set-webhook",
  requireMaster,
  async (req, res) => {
    try {
      if (!WEBHOOK_URL) {
        return res.status(400).json({
          error:
            "WEBHOOK_URL በRender Environment Variables ውስጥ የለም።"
        });
      }

      const webhook =
        `${WEBHOOK_URL}/telegram/webhook`;

      const result =
        await telegram(
          "setWebhook",
          {
            url: webhook
          }
        );

      if (!result.ok) {
        return res.status(500).json({
          error:
            result.description ||
            "Webhook registration failed",
          result
        });
      }

      res.json({
        ok: true,
        webhook,
        result
      });

    } catch (error) {
      console.error(
        "Set webhook:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   WEBHOOK DELETE
========================================================= */

app.post(
  "/api/telegram/delete-webhook",
  requireMaster,
  async (req, res) => {
    try {
      const result =
        await telegram(
          "deleteWebhook",
          {
            drop_pending_updates:
              false
          }
        );

      res.json(result);

    } catch (error) {
      res.status(500).json({
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
  requirePermission("reports"),
  async (req, res) => {
    try {
      const {
        data: orders,
        error
      } = await supabase
        .from("orders")
        .select("*");

      if (error) {
        throw error;
      }

      const rows =
        orders || [];

      let sales = 0;
      let profit = 0;
      let confirmedOrders = 0;
      let deliveryPendingOrders = 0;
      let deliveredOrders = 0;
      let pendingOrders = 0;
      let rejectedOrders = 0;

      for (
        const order
        of rows
      ) {
        const status =
          String(
            order.status || ""
          ).toUpperCase();

        /*
          Confirmed sales include both:
          DELIVERY_PENDING
          and
          DELIVERED

          This preserves sales/profit history.
        */

        if (
          status ===
            "DELIVERY_PENDING" ||
          status ===
            "DELIVERED" ||
          status ===
            "CONFIRMED"
        ) {
          confirmedOrders++;

          sales += Number(
            order.total || 0
          );

          profit += Number(
            order.profit || 0
          );
        }

        if (
          status ===
          "DELIVERY_PENDING"
        ) {
          deliveryPendingOrders++;
        }

        if (
          status ===
          "DELIVERED"
        ) {
          deliveredOrders++;
        }

        if (
          status ===
            "PAYMENT_PENDING" ||
          status ===
            "RECEIPT_PENDING"
        ) {
          pendingOrders++;
        }

        if (
          status === "REJECTED"
        ) {
          rejectedOrders++;
        }
      }

      res.json({
        ok: true,

        summary: {
          totalOrders:
            rows.length,

          confirmedOrders,

          deliveryPendingOrders,

          deliveredOrders,

          pendingOrders,

          rejectedOrders,

          sales,

          profit
        }
      });

    } catch (error) {
      console.error(
        "Reports:",
        error
      );

      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

/* =========================================================
   FRONTEND FALLBACK
========================================================= */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "admin.html"
    ),
    (error) => {
      if (error) {
        console.error(
          "Admin HTML error:",
          error
        );

        res.status(404).send(
          "admin.html በ public folder ውስጥ አልተገኘም።"
        );
      }
    }
  );
});

/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `Telegram Sales Manager running on port ${PORT}`
    );

    console.log(
      `Bot: @${BOT_USERNAME}`
    );

    console.log(
      `Webhook URL: ${
        WEBHOOK_URL
          ? `${WEBHOOK_URL}/telegram/webhook`
          : "NOT SET"
      }`
    );
  }
);
