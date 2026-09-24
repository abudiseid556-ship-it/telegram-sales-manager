const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const PORT = process.env.PORT || 10000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_BOT_USERNAME =
  process.env.TELEGRAM_BOT_USERNAME || "uni_market_shop_bot";

const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const ADMIN_CHAT_ID =
  process.env.ADMIN_CHAT_ID || process.env.ADMIN_CHAT_id || "";

const MASTER_ADMIN_USERNAME =
  process.env.MASTER_ADMIN_USERNAME || "master";

const MASTER_ADMIN_PASSWORD =
  process.env.MASTER_ADMIN_PASSWORD ||
  process.env.MASTER_ADMIN_PASS ||
  Object.keys(process.env)
    .filter((k) => k.startsWith("MASTER_ADMIN_PASS"))
    .map((k) => process.env[k])
    .find(Boolean) ||
  process.env.WEB_PASSWORD ||
  "";

const AUTH_SECRET =
  process.env.AUTH_SECRET ||
  crypto
    .createHash("sha256")
    .update(
      String(
        MASTER_ADMIN_PASSWORD ||
          TELEGRAM_BOT_TOKEN ||
          SUPABASE_SERVICE_ROLE_KEY ||
          "telegram-sales-manager-secret"
      )
    )
    .digest("hex");

const STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET || "product-photos";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
}

if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN missing");
}

const supabase = createClient(
  SUPABASE_URL || "",
  SUPABASE_SERVICE_ROLE_KEY || "",
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

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
  "reports",
];

/* =========================================================
   HELPERS
========================================================= */

function now() {
  return new Date().toISOString();
}

function clean(v) {
  return v === undefined || v === null ? "" : String(v).trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRole(role) {
  return String(role || "").toLowerCase() === "master"
    ? "master"
    : "employee";
}

function hasPermission(user, permission) {
  if (!user) return false;

  if (normalizeRole(user.role) === "master") {
    return true;
  }

  return Array.isArray(user.permissions)
    ? user.permissions.includes(permission)
    : false;
}

function tokenSign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");

  const signature = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(body)
    .digest("base64url");

  return `${body}.${signature}`;
}

function tokenVerify(token) {
  try {
    if (!token || typeof token !== "string") return null;

    const parts = token.split(".");

    if (parts.length !== 2) return null;

    const [body, signature] = parts;

    if (!body || !signature) return null;

    const expected = crypto
      .createHmac("sha256", AUTH_SECRET)
      .update(body)
      .digest("base64url");

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);

    if (a.length !== b.length) return null;

    if (!crypto.timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    );

    if (!payload.exp || payload.exp < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function authUser(req) {
  const header = clean(req.headers.authorization);

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return tokenVerify(header.slice(7));
}

function requireAuth(req, res, next) {
  const user = authUser(req);

  if (!user) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
    });
  }

  req.user = user;
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    const user = authUser(req);

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized",
      });
    }

    if (!hasPermission(user, permission)) {
      return res.status(403).json({
        ok: false,
        error: "Permission denied",
        permission,
      });
    }

    req.user = user;
    next();
  };
}

async function telegram(method, body) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN missing");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body || {}),
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.description || "Telegram API error");
  }

  return data.result;
}

async function telegramSendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...extra,
  });
}

async function telegramAnswerCallback(callbackQueryId, text = "") {
  try {
    return await telegram("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
    });
  } catch (e) {
    console.error("answerCallbackQuery:", e.message);
  }
}

async function getProduct(id) {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  return data;
}

async function getOrder(id) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  return data;
}

async function getEmployee(id) {
  const { data, error } = await supabase
    .from("employees")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  return data;
}

function employeePublic(row) {
  if (!row) return null;

  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: "employee",
    active: row.active !== false,
    permissions: Array.isArray(row.permissions)
      ? row.permissions
      : [],
    created_at: row.created_at,
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  const hash = crypto
    .scryptSync(String(password), salt, 64)
    .toString("hex");

  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored || "").split(":");

    if (parts.length !== 3 || parts[0] !== "scrypt") {
      return false;
    }

    const [, salt, storedHash] = parts;

    const calculated = crypto
      .scryptSync(String(password), salt, 64)
      .toString("hex");

    const a = Buffer.from(calculated);
    const b = Buffer.from(storedHash);

    if (a.length !== b.length) return false;

    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function getEmployeePermissions(employeeId) {
  try {
    const { data, error } = await supabase
      .from("employee_permissions")
      .select("permission")
      .eq("employee_id", employeeId);

    if (error) {
      console.error("permissions:", error.message);
      return [];
    }

    return (data || [])
      .map((x) => x.permission)
      .filter((x) => PERMISSIONS.includes(x));
  } catch {
    return [];
  }
}

async function buildEmployeeUser(employee) {
  return {
    id: employee.id,
    username: employee.username,
    name: employee.name,
    role: "employee",
    permissions: await getEmployeePermissions(employee.id),
  };
}

function orderPermission(req, action) {
  if (action === "view") return "view_orders";
  if (action === "confirm") return "confirm_order";
  if (action === "reject") return "verify_payment";

  return "view_orders";
}

async function changeOrderStatus(id, status) {
  const order = await getOrder(id);

  if (!order) {
    throw new Error("Order not found");
  }

  const patch = {
    status,
    updated_at: now(),
  };

  if (status === "CONFIRMED") {
    patch.confirmed_at = now();
  }

  const { data, error } = await supabase
    .from("orders")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  return {
    oldOrder: order,
    order: data,
  };
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "Telegram Sales Manager",
    time: now(),
  });
});

/* =========================================================
   AUTH
========================================================= */

app.post("/api/auth", async (req, res) => {
  try {
    const username = clean(req.body.username);
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({
        ok: false,
        error: "Username and password required",
      });
    }

    /* MASTER ADMIN */

    if (
      username === MASTER_ADMIN_USERNAME &&
      MASTER_ADMIN_PASSWORD &&
      password === MASTER_ADMIN_PASSWORD
    ) {
      const user = {
        id: "master",
        username,
        name: "Master Admin",
        role: "master",
        permissions: PERMISSIONS,
      };

      const token = tokenSign({
        ...user,
        exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
      });

      return res.json({
        ok: true,
        token,
        user,
      });
    }

    /* EMPLOYEE */

    const { data: employee, error } = await supabase
      .from("employees")
      .select("*")
      .eq("username", username)
      .maybeSingle();

    if (error) throw error;

    if (!employee || employee.active === false) {
      return res.status(401).json({
        ok: false,
        error: "Invalid login",
      });
    }

    if (!verifyPassword(password, employee.password_hash)) {
      return res.status(401).json({
        ok: false,
        error: "Invalid login",
      });
    }

    const user = await buildEmployeeUser(employee);

    const token = tokenSign({
      ...user,
      exp: Date.now() + 1000 * 60 * 60 * 24,
    });

    return res.json({
      ok: true,
      token,
      user,
    });
  } catch (e) {
    console.error("AUTH:", e);

    res.status(500).json({
      ok: false,
      error: e.message,
    });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    if (req.user.role === "master") {
      return res.json({
        ok: true,
        user: {
          ...req.user,
          permissions: PERMISSIONS,
        },
      });
    }

    const employee = await getEmployee(req.user.id);

    if (!employee || employee.active === false) {
      return res.status(401).json({
        ok: false,
        error: "Employee account disabled",
      });
    }

    const user = await buildEmployeeUser(employee);

    res.json({
      ok: true,
      user,
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message,
    });
  }
});

/* =========================================================
   PRODUCTS
========================================================= */

app.get("/api/products", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      ok: true,
      products: data || [],
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message,
    });
  }
});

app.post(
  "/api/products",
  requirePermission("products"),
  async (req, res) => {
    try {
      const name = clean(req.body.name || req.body.productName);
      const description = clean(req.body.description);
      const buyPrice = num(req.body.buyPrice ?? req.body.buy_price);
      const sellPrice = num(req.body.sellPrice ?? req.body.sell_price);
      const stock = Math.max(0, Math.floor(num(req.body.stock)));
      const photoUrl = clean(
        req.body.photoUrl ||
          req.body.photo_url ||
          req.body.photo
      );

      if (!name) {
        return res.status(400).json({
          ok: false,
          error: "Product name required",
        });
      }

      const product = {
        name,
        description,
        buy_price: buyPrice,
        sell_price: sellPrice,
        stock,
        photo_url: photoUrl || null,
        created_at: now(),
        updated_at: now(),
      };

      const { data, error } = await supabase
        .from("products")
        .insert(product)
        .select("*")
        .single();

      if (error) throw error;

      res.json({
        ok: true,
        product: data,
      });
    } catch (e) {
      console.error("CREATE PRODUCT:", e);

      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

app.patch(
  "/api/products/:id",
  requirePermission("products"),
  async (req, res) => {
    try {
      const id = req.params.id;

      const patch = {
        updated_at: now(),
      };

      if (
        req.body.name !== undefined ||
        req.body.productName !== undefined
      ) {
        patch.name = clean(
          req.body.name || req.body.productName
        );
      }

      if (req.body.description !== undefined) {
        patch.description = clean(req.body.description);
      }

      if (
        req.body.buyPrice !== undefined ||
        req.body.buy_price !== undefined
      ) {
        patch.buy_price = num(
          req.body.buyPrice ?? req.body.buy_price
        );
      }

      if (
        req.body.sellPrice !== undefined ||
        req.body.sell_price !== undefined
      ) {
        patch.sell_price = num(
          req.body.sellPrice ?? req.body.sell_price
        );
      }

      if (req.body.stock !== undefined) {
        patch.stock = Math.max(
          0,
          Math.floor(num(req.body.stock))
        );
      }

      if (
        req.body.photoUrl !== undefined ||
        req.body.photo_url !== undefined ||
        req.body.photo !== undefined
      ) {
        patch.photo_url = clean(
          req.body.photoUrl ||
            req.body.photo_url ||
            req.body.photo
        );
      }

      const { data, error } = await supabase
        .from("products")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw error;

      res.json({
        ok: true,
        product: data,
      });
    } catch (e) {
      console.error("UPDATE PRODUCT:", e);

      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

app.delete(
  "/api/products/:id",
  requirePermission("delete_product"),
  async (req, res) => {
    try {
      const { error } = await supabase
        .from("products")
        .delete()
        .eq("id", req.params.id);

      if (error) throw error;

      res.json({
        ok: true,
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

/* =========================================================
   PRODUCT PHOTO UPLOAD
========================================================= */

app.post(
  "/api/upload",
  requireAuth,
  upload.single("photo"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          error: "Photo file required",
        });
      }

      const ext =
        path
          .extname(req.file.originalname || "")
          .toLowerCase() || ".jpg";

      const safeExt = [
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".gif",
      ].includes(ext)
        ? ext
        : ".jpg";

      const folder =
        clean(req.body.context) === "ad"
          ? "ads"
          : "products";

      const filename =
        `${folder}/` +
        `${Date.now()}-${crypto.randomBytes(8).toString("hex")}` +
        safeExt;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filename, req.file.buffer, {
          contentType:
            req.file.mimetype || "image/jpeg",
          upsert: false,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(filename);

      res.json({
        ok: true,
        url: data.publicUrl,
        path: filename,
        bucket: STORAGE_BUCKET,
      });
    } catch (e) {
      console.error("UPLOAD:", e);

      res.status(500).json({
        ok: false,
        error: e.message,
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
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      res.json({
        ok: true,
        orders: data || [],
      });
    } catch (e) {
      console.error("ORDERS:", e);

      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

app.patch(
  "/api/orders/:id",
  requireAuth,
  async (req, res) => {
    try {
      const action = String(
        req.body.action || req.body.status || ""
      )
        .toUpperCase()
        .trim();

      if (!["CONFIRMED", "REJECTED"].includes(action)) {
        return res.status(400).json({
          ok: false,
          error: "Invalid order status",
        });
      }

      const permission = orderPermission(
        req,
        action === "CONFIRMED" ? "confirm" : "reject"
      );

      if (!hasPermission(req.user, permission)) {
        return res.status(403).json({
          ok: false,
          error: "Permission denied",
        });
      }

      const order = await getOrder(req.params.id);

      if (!order) {
        return res.status(404).json({
          ok: false,
          error: "Order not found",
        });
      }

      /* Receipt verification requirement */

      if (
        ["CONFIRMED", "REJECTED"].includes(action) &&
        order.status !== "RECEIPT_PENDING"
      ) {
        return res.status(409).json({
          ok: false,
          error:
            "This order must have a pending receipt before Admin verification.",
        });
      }

      if (action === "CONFIRMED") {
        const quantity = Math.max(
          1,
          Math.floor(num(order.quantity))
        );

        const productId =
          order.product_id || order.productId;

        if (productId) {
          const product = await getProduct(productId);

          if (!product) {
            return res.status(404).json({
              ok: false,
              error: "Product not found",
            });
          }

          const currentStock = Math.max(
            0,
            Math.floor(num(product.stock))
          );

          if (currentStock < quantity) {
            return res.status(409).json({
              ok: false,
              error: "Not enough stock",
            });
          }

          const { data: updatedProduct, error: stockError } =
            await supabase
              .from("products")
              .update({
                stock: currentStock - quantity,
                updated_at: now(),
              })
              .eq("id", product.id)
              .eq("stock", currentStock)
              .select("*")
              .maybeSingle();

          if (stockError) throw stockError;

          if (!updatedProduct) {
            return res.status(409).json({
              ok: false,
              error:
                "Stock changed by another order. Please refresh.",
            });
          }
        }
      }

      const result = await changeOrderStatus(
        req.params.id,
        action
      );

      res.json({
        ok: true,
        order: result.order,
      });
    } catch (e) {
      console.error("ORDER UPDATE:", e);

      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

/* Compatibility endpoint */

app.patch(
  "/api/orders/:id/status",
  requireAuth,
  async (req, res) => {
    req.body = {
      ...req.body,
      status: req.body.status || req.body.action,
    };

    return app._router.handle(req, res, () => {});
  }
);

/* =========================================================
   RECEIPT PROXY
   Telegram file_id stays private on the server.
========================================================= */

app.get(
  "/api/orders/:id/receipt",
  requirePermission("view_orders"),
  async (req, res) => {
    try {
      const order = await getOrder(req.params.id);

      if (!order) {
        return res.status(404).send("Order not found");
      }

      const fileId =
        order.receipt_file_id ||
        order.receiptFileId ||
        order.receipt_file_id;

      if (!fileId) {
        return res.status(404).send("Receipt not found");
      }

      const file = await telegram("getFile", {
        file_id: fileId,
      });

      if (!file || !file.file_path) {
        return res.status(404).send("Receipt file unavailable");
      }

      const fileResponse = await fetch(
        `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`
      );

      if (!fileResponse.ok) {
        return res.status(502).send("Unable to load receipt");
      }

      res.setHeader(
        "Content-Type",
        fileResponse.headers.get("content-type") ||
          "image/jpeg"
      );

      const buffer = Buffer.from(
        await fileResponse.arrayBuffer()
      );

      res.send(buffer);
    } catch (e) {
      console.error("RECEIPT:", e);

      res.status(500).send("Receipt error");
    }
  }
);

/* =========================================================
   PAYMENT SETTINGS
========================================================= */

app.get(
  "/api/payment-settings",
  requireAuth,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("payment_settings")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      res.json({
        ok: true,
        settings: data || {},
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

app.post(
  "/api/payment-settings",
  requirePermission("payment_settings"),
  async (req, res) => {
    try {
      const settings = {
        bank_name: clean(
          req.body.bank_name || req.body.bankName
        ),
        account_name: clean(
          req.body.account_name || req.body.accountName
        ),
        account_number: clean(
          req.body.account_number ||
            req.body.accountNumber
        ),
        phone: clean(req.body.phone),
        instructions: clean(req.body.instructions),
        updated_at: now(),
      };

      const { data: old } = await supabase
        .from("payment_settings")
        .select("id")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let data;
      let error;

      if (old?.id) {
        ({ data, error } = await supabase
          .from("payment_settings")
          .update(settings)
          .eq("id", old.id)
          .select("*")
          .single());
      } else {
        ({ data, error } = await supabase
          .from("payment_settings")
          .insert({
            ...settings,
            created_at: now(),
          })
          .select("*")
          .single());
      }

      if (error) throw error;

      res.json({
        ok: true,
        settings: data,
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

/* =========================================================
   TELEGRAM SETTINGS
========================================================= */

app.get(
  "/api/telegram-settings",
  requireAuth,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("telegram_settings")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      res.json({
        ok: true,
        settings: {
          ...(data || {}),
          bot_username:
            data?.bot_username || TELEGRAM_BOT_USERNAME,
          webhook_url:
            data?.webhook_url || WEBHOOK_URL,
        },
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

app.post(
  "/api/telegram-settings",
  requirePermission("telegram_settings"),
  async (req, res) => {
    try {
      const settings = {
        bot_username: clean(
          req.body.bot_username ||
            req.body.botUsername ||
            TELEGRAM_BOT_USERNAME
        ),
        webhook_url: clean(
          req.body.webhook_url ||
            req.body.webhookUrl ||
            WEBHOOK_URL
        ),
        admin_chat_id: clean(
          req.body.admin_chat_id ||
            req.body.adminChatId ||
            ADMIN_CHAT_ID
        ),
        updated_at: now(),
      };

      const { data: old } = await supabase
        .from("telegram_settings")
        .select("id")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let data;
      let error;

      if (old?.id) {
        ({ data, error } = await supabase
          .from("telegram_settings")
          .update(settings)
          .eq("id", old.id)
          .select("*")
          .single());
      } else {
        ({ data, error } = await supabase
          .from("telegram_settings")
          .insert({
            ...settings,
            created_at: now(),
          })
          .select("*")
          .single());
      }

      if (error) throw error;

      res.json({
        ok: true,
        settings: data,
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

/* =========================================================
   ADVERTISEMENTS
========================================================= */

app.get(
  "/api/advertisements",
  requireAuth,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("advertisements")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      res.json({
        ok: true,
        advertisements: data || [],
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

app.post(
  "/api/advertisements",
  requirePermission("advertising"),
  async (req, res) => {
    try {
      const ad = {
        title: clean(req.body.title),
        text: clean(req.body.text || req.body.description),
        photo_url: clean(
          req.body.photo_url ||
            req.body.photoUrl ||
            req.body.photo
        ),
        target_chat_id: clean(
          req.body.target_chat_id ||
            req.body.targetChatId
        ),
        active: req.body.active !== false,
        created_at: now(),
        updated_at: now(),
      };

      if (!ad.title && !ad.text) {
        return res.status(400).json({
          ok: false,
          error: "Advertisement title or text required",
        });
      }

      const { data, error } = await supabase
        .from("advertisements")
        .insert(ad)
        .select("*")
        .single();

      if (error) throw error;

      res.json({
        ok: true,
        advertisement: data,
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

app.patch(
  "/api/advertisements/:id",
  requirePermission("advertising"),
  async (req, res) => {
    try {
      const patch = {
        updated_at: now(),
      };

      if (req.body.title !== undefined) {
        patch.title = clean(req.body.title);
      }

      if (req.body.text !== undefined) {
        patch.text = clean(req.body.text);
      }

      if (req.body.description !== undefined) {
        patch.text = clean(req.body.description);
      }

      if (
        req.body.photo_url !== undefined ||
        req.body.photoUrl !== undefined
      ) {
        patch.photo_url = clean(
          req.body.photo_url || req.body.photoUrl
        );
      }

      if (
        req.body.target_chat_id !== undefined ||
        req.body.targetChatId !== undefined
      ) {
        patch.target_chat_id = clean(
          req.body.target_chat_id ||
            req.body.targetChatId
        );
      }

      if (req.body.active !== undefined) {
        patch.active = Boolean(req.body.active);
      }

      const { data, error } = await supabase
        .from("advertisements")
        .update(patch)
        .eq("id", req.params.id)
        .select("*")
        .single();

      if (error) throw error;

      res.json({
        ok: true,
        advertisement: data,
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

app.delete(
  "/api/advertisements/:id",
  requirePermission("advertising"),
  async (req, res) => {
    try {
      const { error } = await supabase
        .from("advertisements")
        .delete()
        .eq("id", req.params.id);

      if (error) throw error;

      res.json({
        ok: true,
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

app.post(
  "/api/advertisements/:id/publish",
  requirePermission("advertising"),
  async (req, res) => {
    try {
      const { data: ad, error } = await supabase
        .from("advertisements")
        .select("*")
        .eq("id", req.params.id)
        .single();

      if (error) throw error;

      if (!ad.target_chat_id) {
        return res.status(400).json({
          ok: false,
          error: "Target Telegram chat ID is required",
        });
      }

      let result;

      if (ad.photo_url) {
        result = await telegram("sendPhoto", {
          chat_id: ad.target_chat_id,
          photo: ad.photo_url,
          caption: ad.text || ad.title || "",
        });
      } else {
        result = await telegramSendMessage(
          ad.target_chat_id,
          ad.text || ad.title || ""
        );
      }

      await supabase
        .from("advertisements")
        .update({
          last_published_at: now(),
          updated_at: now(),
        })
        .eq("id", ad.id);

      res.json({
        ok: true,
        telegram: result,
      });
    } catch (e) {
      console.error("PUBLISH AD:", e);

      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

/* =========================================================
   EMPLOYEES
========================================================= */

app.get(
  "/api/employees",
  requirePermission("employees"),
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("employees")
        .select(
          "id,username,name,active,created_at,updated_at"
        )
        .order("created_at", { ascending: false });

      if (error) throw error;

      const employees = [];

      for (const employee of data || []) {
        employees.push({
          ...employee,
          role: "employee",
          permissions: await getEmployeePermissions(
            employee.id
          ),
        });
      }

      res.json({
        ok: true,
        employees,
      });
    } catch (e) {
      console.error("EMPLOYEES:", e);

      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

app.post(
  "/api/employees",
  requirePermission("employees"),
  async (req, res) => {
    try {
      const username = clean(req.body.username);
      const name = clean(req.body.name);
      const password = String(req.body.password || "");

      const permissions = Array.isArray(req.body.permissions)
        ? req.body.permissions.filter((p) =>
            PERMISSIONS.includes(p)
          )
        : [];

      if (!username || !password) {
        return res.status(400).json({
          ok: false,
          error: "Username and password required",
        });
      }

      const passwordHash = hashPassword(password);

      const { data: employee, error } = await supabase
        .from("employees")
        .insert({
          username,
          name,
          password_hash: passwordHash,
          active: true,
          created_at: now(),
          updated_at: now(),
        })
        .select(
          "id,username,name,active,created_at,updated_at"
        )
        .single();

      if (error) throw error;

      if (permissions.length) {
        const rows = permissions.map((permission) => ({
          employee_id: employee.id,
          permission,
        }));

        const { error: permissionError } = await supabase
          .from("employee_permissions")
          .upsert(rows, {
            onConflict: "employee_id,permission",
          });

        if (permissionError) throw permissionError;
      }

      res.json({
        ok: true,
        employee: {
          ...employee,
          role: "employee",
          permissions,
        },
      });
    } catch (e) {
      console.error("CREATE EMPLOYEE:", e);

      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

app.patch(
  "/api/employees/:id",
  requirePermission("employees"),
  async (req, res) => {
    try {
      const patch = {
        updated_at: now(),
      };

      if (req.body.username !== undefined) {
        patch.username = clean(req.body.username);
      }

      if (req.body.name !== undefined) {
        patch.name = clean(req.body.name);
      }

      if (req.body.active !== undefined) {
        patch.active = Boolean(req.body.active);
      }

      if (req.body.password) {
        patch.password_hash = hashPassword(
          String(req.body.password)
        );
      }

      const { data: employee, error } = await supabase
        .from("employees")
        .update(patch)
        .eq("id", req.params.id)
        .select(
          "id,username,name,active,created_at,updated_at"
        )
        .single();

      if (error) throw error;

      if (Array.isArray(req.body.permissions)) {
        const permissions = req.body.permissions.filter(
          (p) => PERMISSIONS.includes(p)
        );

        await supabase
          .from("employee_permissions")
          .delete()
          .eq("employee_id", req.params.id);

        if (permissions.length) {
          const rows = permissions.map((permission) => ({
            employee_id: req.params.id,
            permission,
          }));

          const { error: permissionError } =
            await supabase
              .from("employee_permissions")
              .insert(rows);

          if (permissionError) {
            throw permissionError;
          }
        }
      }

      res.json({
        ok: true,
        employee: {
          ...employee,
          role: "employee",
          permissions: await getEmployeePermissions(
            req.params.id
          ),
        },
      });
    } catch (e) {
      console.error("UPDATE EMPLOYEE:", e);

      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

/* Permission endpoint compatibility */

app.get(
  "/api/employees/:id/permissions",
  requirePermission("employees"),
  async (req, res) => {
    try {
      const permissions = await getEmployeePermissions(
        req.params.id
      );

      res.json({
        ok: true,
        permissions,
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

app.post(
  "/api/employees/:id/permissions",
  requirePermission("employees"),
  async (req, res) => {
    try {
      const permissions = Array.isArray(req.body.permissions)
        ? req.body.permissions.filter((p) =>
            PERMISSIONS.includes(p)
          )
        : [];

      await supabase
        .from("employee_permissions")
        .delete()
        .eq("employee_id", req.params.id);

      if (permissions.length) {
        const rows = permissions.map((permission) => ({
          employee_id: req.params.id,
          permission,
        }));

        const { error } = await supabase
          .from("employee_permissions")
          .insert(rows);

        if (error) throw error;
      }

      res.json({
        ok: true,
        permissions,
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message,
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
        .eq("employee_id", req.params.id);

      const { error } = await supabase
        .from("employees")
        .delete()
        .eq("id", req.params.id);

      if (error) throw error;

      res.json({
        ok: true,
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message,
      });
    }
  }
);

/* =========================================================
   TELEGRAM BOT
========================================================= */

const botSessions = new Map();

function sessionFor(chatId) {
  const key = String(chatId);

  if (!botSessions.has(key)) {
    botSessions.set(key, {
      step: "products",
    });
  }

  return botSessions.get(key);
}

async function getPaymentSettings() {
  const { data } = await supabase
    .from("payment_settings")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data || {};
}

async function botSendProducts(chatId) {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .gt("stock", 0)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const products = data || [];

  if (!products.length) {
    return telegramSendMessage(
      chatId,
      "📦 No products are currently available."
    );
  }

  const keyboard = products.map((product) => [
    {
      text: `${product.name} — ${num(
        product.sell_price
      )} ETB`,
      callback_data: `product_${product.id}`,
    },
  ]);

  return telegramSendMessage(
    chatId,
    "🛍️ Welcome to UNI MARKET!\n\nChoose a product:",
    {
      reply_markup: {
        inline_keyboard: keyboard,
      },
    }
  );
}

async function createTelegramOrder(chatId, session) {
  const product = await getProduct(session.productId);

  if (!product) {
    throw new Error("Product not found");
  }

  const quantity = Math.max(
    1,
    Math.floor(num(session.quantity))
  );

  if (num(product.stock) < quantity) {
    throw new Error("Not enough stock");
  }

  const sellPrice = num(product.sell_price);
  const buyPrice = num(product.buy_price);

  const total = sellPrice * quantity;
  const profit = (sellPrice - buyPrice) * quantity;

  const payload = {
    product_id: product.id,
    product_name: product.name,
    customer_name: session.customerName,
    phone: session.phone,
    address: session.address || "",
    username: session.username || "",
    telegram_chat_id: String(chatId),
    quantity,
    buy_price: buyPrice,
    sell_price: sellPrice,
    total,
    profit,
    status: "PAYMENT_PENDING",
    created_at: now(),
    updated_at: now(),
  };

  const { data, error } = await supabase
    .from("orders")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;

  return data;
}

async function sendPaymentInstructions(chatId, order) {
  const settings = await getPaymentSettings();

  const bank =
    settings.bank_name ||
    settings.bankName ||
    "Payment Account";

  const accountName =
    settings.account_name ||
    settings.accountName ||
    "";

  const accountNumber =
    settings.account_number ||
    settings.accountNumber ||
    "";

  const phone = settings.phone || "";

  const instructions =
    settings.instructions ||
    "After
