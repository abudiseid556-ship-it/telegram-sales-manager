const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const TelegramBot = require("node-telegram-bot-api");
const multer = require("multer");
const path = require("path");

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ======================================================
// ENV
// ======================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const PORT = process.env.PORT || 10000;

if (!SUPABASE_URL) {
  console.error("❌ SUPABASE_URL is missing");
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY is missing");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// ======================================================
// TELEGRAM
// ======================================================

let bot = null;

if (TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
    polling: true
  });

  console.log("🤖 Telegram Bot started");
}

// ======================================================
// HEALTH
// ======================================================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Telegram Sales Manager API is running ✅",
    supabase: true
  });
});

// ======================================================
// IMAGE UPLOAD
// ======================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("የፎቶ ፋይል ብቻ ይፈቀዳል።"));
    }

    cb(null, true);
  }
});

app.post(
  "/api/upload",
  (req, res, next) => {
    upload.single("photo")(req, res, err => {
      if (err) {
        return res.status(400).json({
          error: err.message || "Upload failed"
        });
      }

      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "ፎቶ አልተገኘም።"
        });
      }

      let ext =
        path.extname(req.file.originalname).toLowerCase();

      if (![".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) {
        ext = ".jpg";
      }

      const fileName =
        `products/prod_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 9)}${ext}`;

      const { error } =
        await supabase.storage
          .from("product-photos")
          .upload(
            fileName,
            req.file.buffer,
            {
              contentType: req.file.mimetype,
              cacheControl: "3600",
              upsert: false
            }
          );

      if (error) {
        throw error;
      }

      const { data } =
        supabase.storage
          .from("product-photos")
          .getPublicUrl(fileName);

      res.json({
        success: true,
        url: data.publicUrl,
        path: fileName
      });

    } catch (err) {
      console.error("UPLOAD ERROR:", err);

      res.status(500).json({
        error: err.message || "Photo upload failed"
      });
    }
  }
);

// ======================================================
// PRODUCTS — GET
// ======================================================

app.get("/api/products", async (req, res) => {
  try {
    const { data, error } =
      await supabase
        .from("products")
        .select("*")
        .order("id", { ascending: false });

    if (error) throw error;

    res.json(data || []);

  } catch (err) {
    console.error("GET PRODUCTS:", err);

    res.status(500).json({
      error: err.message
    });
  }
});

// ======================================================
// PRODUCTS — CREATE
// ======================================================

app.post("/api/products", async (req, res) => {
  try {

    const {
      name,
      buyPrice,
      sellPrice,
      stock,
      photoUrl
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        error: "የምርት ስም ያስፈልጋል።"
      });
    }

    const buy = Number(buyPrice);
    const sell = Number(sellPrice);
    const stockNumber = Number(stock);

    if (
      !Number.isFinite(buy) ||
      !Number.isFinite(sell) ||
      !Number.isFinite(stockNumber) ||
      buy < 0 ||
      sell < 0 ||
      stockNumber < 0
    ) {
      return res.status(400).json({
        error: "ዋጋ እና Stock ትክክለኛ ቁጥር ይሁን።"
      });
    }

    const { data, error } =
      await supabase
        .from("products")
        .insert([{
          name: String(name).trim(),
          buy_price: buy,
          sell_price: sell,
          stock: stockNumber,
          photo_url: photoUrl || null
        }])
        .select()
        .single();

    if (error) throw error;

    res.json({
      success: true,
      product: data
    });

  } catch (err) {
    console.error("CREATE PRODUCT:", err);

    res.status(500).json({
      error: err.message
    });
  }
});

// ======================================================
// PRODUCTS — EDIT
// ======================================================

app.patch("/api/products/:id", async (req, res) => {
  try {

    const id = req.params.id;

    const {
      name,
      buyPrice,
      sellPrice,
      stock,
      photoUrl
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        error: "የምርት ስም ያስፈልጋል።"
      });
    }

    const buy = Number(buyPrice);
    const sell = Number(sellPrice);
    const stockNumber = Number(stock);

    if (
      !Number.isFinite(buy) ||
      !Number.isFinite(sell) ||
      !Number.isFinite(stockNumber) ||
      buy < 0 ||
      sell < 0 ||
      stockNumber < 0
    ) {
      return res.status(400).json({
        error: "ዋጋ እና Stock ትክክለኛ አይደሉም።"
      });
    }

    const { data, error } =
      await supabase
        .from("products")
        .update({
          name: String(name).trim(),
          buy_price: buy,
          sell_price: sell,
          stock: stockNumber,
          photo_url: photoUrl || null
        })
        .eq("id", id)
        .select()
        .single();

    if (error) throw error;

    res.json({
      success: true,
      product: data
    });

  } catch (err) {
    console.error("EDIT PRODUCT:", err);

    res.status(500).json({
      error: err.message
    });
  }
});

// ======================================================
// PRODUCTS — DELETE
// ======================================================

app.delete("/api/products/:id", async (req, res) => {
  try {

    const id = req.params.id;

    const { error } =
      await supabase
        .from("products")
        .delete()
        .eq("id", id);

    if (error) throw error;

    res.json({
      success: true
    });

  } catch (err) {
    console.error("DELETE PRODUCT:", err);

    res.status(500).json({
      error: err.message
    });
  }
});

// ======================================================
// ORDERS — GET
// ======================================================

app.get("/api/orders", async (req, res) => {
  try {

    const { data, error } =
      await supabase
        .from("orders")
        .select("*")
        .order("created_at", {
          ascending: false
        });

    if (error) throw error;

    res.json(data || []);

  } catch (err) {

    console.error("GET ORDERS:", err);

    res.status(500).json({
      error: err.message
    });
  }
});

// ======================================================
// ORDER STATUS
// ======================================================

app.patch("/api/orders/:id", async (req, res) => {
  try {

    const id = req.params.id;
    const { status } = req.body;

    const allowed = [
      "NEW",
      "PENDING",
      "RECEIPT_PENDING",
      "VERIFYING",
      "CONFIRMED",
      "REJECTED"
    ];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        error: "Invalid order status"
      });
    }

    const {
      data: order,
      error: orderError
    } = await supabase
      .from("orders")
      .select("*")
      .eq("id", id)
      .single();

    if (orderError || !order) {
      return res.status(404).json({
        error: "Order not found"
      });
    }

    // Confirm → decrease stock
    if (
      status === "CONFIRMED" &&
      order.status !== "CONFIRMED"
    ) {

      const productName =
        order.product_name ||
        order.productName;

      const quantity =
        Number(order.quantity || 1);

      const {
        data: product
      } = await supabase
        .from("products")
        .select("*")
        .eq("name", productName)
        .maybeSingle();

      if (product) {

        const stock =
          Number(product.stock || 0);

        if (stock < quantity) {
          return res.status(400).json({
            error:
              `Stock አይበቃም። ያለው Stock: ${stock}`
          });
        }

        const { error: stockError } =
          await supabase
            .from("products")
            .update({
              stock: stock - quantity
            })
            .eq("id", product.id);

        if (stockError) throw stockError;
      }
    }

    const { error } =
      await supabase
        .from("orders")
        .update({
          status
        })
        .eq("id", id);

    if (error) throw error;

    res.json({
      success: true,
      status
    });

  } catch (err) {

    console.error("ORDER STATUS:", err);

    res.status(500).json({
      error: err.message
    });
  }
});

// ======================================================
// SERVER
// ======================================================

app.listen(PORT, () => {
  console.log(
    `🚀 Telegram Sales Manager running on port ${PORT}`
  );
});
