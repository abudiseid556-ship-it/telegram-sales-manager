const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const path = require('path');

const app = express();

// ======================================================
// BASIC APP SETTINGS
// ======================================================

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ======================================================
// ROOT ROUTE
// ======================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ======================================================
// MULTER - IMAGE UPLOAD
// ======================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 5 * 1024 * 1024 // Maximum 5MB
  },

  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('የሚፈቀደው የፎቶ ፋይል ብቻ ነው።'));
    }

    cb(null, true);
  }
});

// ======================================================
// ENVIRONMENT VARIABLES
// ======================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const PORT = process.env.PORT || 10000;

// ======================================================
// ENVIRONMENT CHECK
// ======================================================

if (!SUPABASE_URL) {
  console.error('❌ SUPABASE_URL is missing');
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY is missing');
  process.exit(1);
}

if (!TELEGRAM_BOT_TOKEN) {
  console.error('⚠️ TELEGRAM_BOT_TOKEN is missing');
}

// ======================================================
// SUPABASE CLIENT
// ======================================================

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
// TELEGRAM BOT
// ======================================================

let bot = null;

if (TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
    polling: true
  });

  console.log('🤖 Telegram Bot started');
}

// ======================================================
// HEALTH CHECK
// ======================================================

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Telegram Sales Manager API is running ✅',
    supabase: !!SUPABASE_URL,
    storage: true
  });
});

// ======================================================
// GET PRODUCTS
// ======================================================

app.get('/api/products', async (req, res) => {
  try {

    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('id', { ascending: false });

    if (error) {
      console.error('❌ Get products error:', error);
      throw error;
    }

    res.json(data || []);

  } catch (err) {

    console.error('❌ /api/products:', err);

    res.status(500).json({
      error: err.message || 'Products could not be loaded'
    });
  }
});

// ======================================================
// ADD PRODUCT
// ======================================================

app.post('/api/products', async (req, res) => {
  try {

    const {
      name,
      buyPrice,
      sellPrice,
      stock,
      photoUrl
    } = req.body;

    if (!name || String(name).trim() === '') {
      return res.status(400).json({
        error: 'የምርት ስም ያስፈልጋል።'
      });
    }

    const buy = Number(buyPrice);
    const sell = Number(sellPrice);
    const stockNumber = Number(stock);

    if (
      !Number.isFinite(buy) ||
      !Number.isFinite(sell) ||
      !Number.isFinite(stockNumber)
    ) {
      return res.status(400).json({
        error: 'ዋጋ እና Stock ትክክለኛ ቁጥር መሆን አለባቸው።'
      });
    }

    const { data, error } = await supabase
      .from('products')
      .insert([
        {
          name: String(name).trim(),
          buy_price: buy,
          sell_price: sell,
          stock: stockNumber,
          photo_url: photoUrl || null
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('❌ Add product error:', error);
      throw error;
    }

    res.json({
      success: true,
      product: data
    });

  } catch (err) {

    console.error('❌ /api/products POST:', err);

    res.status(500).json({
      error: err.message || 'Product could not be saved'
    });
  }
});

// ======================================================
// UPLOAD PRODUCT PHOTO
// ======================================================

app.post(
  '/api/upload',
  (req, res, next) => {

    upload.single('photo')(req, res, (err) => {

      if (err instanceof multer.MulterError) {

        console.error('❌ Multer error:', err);

        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'ፎቶው ከ5MB መብለጥ የለበትም።'
          });
        }

        return res.status(400).json({
          error: err.message
        });
      }

      if (err) {

        console.error('❌ Upload filter error:', err);

        return res.status(400).json({
          error: err.message || 'ፎቶው ሊጫን አልቻለም።'
        });
      }

      next();
    });

  },

  async (req, res) => {

    try {

      // ----------------------------------------------
      // Check file
      // ----------------------------------------------

      if (!req.file) {

        return res.status(400).json({
          error: 'ምንም ፎቶ አልተገኘም።'
        });
      }

      // ----------------------------------------------
      // Check MIME type
      // ----------------------------------------------

      if (!req.file.mimetype.startsWith('image/')) {

        return res.status(400).json({
          error: 'የሚፈቀደው የፎቶ ፋይል ብቻ ነው።'
        });
      }

      // ----------------------------------------------
      // File extension
      // ----------------------------------------------

      let extension =
        path.extname(req.file.originalname).toLowerCase();

      const allowedExtensions = [
        '.jpg',
        '.jpeg',
        '.png',
        '.webp',
        '.gif'
      ];

      if (!allowedExtensions.includes(extension)) {

        extension = '.jpg';
      }

      // ----------------------------------------------
      // Unique filename
      // ----------------------------------------------

      const fileName =
        `products/prod_${Date.now()}_${Math.random()
          .toString(36)
          .substring(2, 9)}${extension}`;

      console.log('📤 Uploading photo:', fileName);

      // ----------------------------------------------
      // Supabase Storage Upload
      // ----------------------------------------------

      const { error: uploadError } =
        await supabase.storage
          .from('product-photos')
          .upload(
            fileName,
            req.file.buffer,
            {
              contentType: req.file.mimetype,
              cacheControl: '3600',
              upsert: false
            }
          );

      if (uploadError) {

        console.error(
          '❌ Supabase Storage upload error:',
          uploadError
        );

        return res.status(500).json({
          error:
            uploadError.message ||
            uploadError.error_description ||
            'Supabase Storage upload failed'
        });
      }

      // ----------------------------------------------
      // Get Public URL
      // ----------------------------------------------

      const {
        data: publicUrlData
      } = supabase.storage
        .from('product-photos')
        .getPublicUrl(fileName);

      if (
        !publicUrlData ||
        !publicUrlData.publicUrl
      ) {

        console.error(
          '❌ Public URL could not be generated'
        );

        return res.status(500).json({
          error:
            'ፎቶው ተጭኗል፣ ግን Public URL ማመንጨት አልተቻለም።'
        });
      }

      console.log(
        '✅ Photo uploaded successfully:',
        publicUrlData.publicUrl
      );

      // ----------------------------------------------
      // Return URL to Dashboard
      // ----------------------------------------------

      res.json({
        success: true,
        url: publicUrlData.publicUrl,
        path: fileName
      });

    } catch (err) {

      console.error(
        '❌ /api/upload unexpected error:',
        err
      );

      res.status(500).json({
        error:
          err.message ||
          'ፎቶ ማስገባት አልተሳካም።'
      });
    }
  }
);

// ======================================================
// GET ORDERS
// ======================================================

app.get('/api/orders', async (req, res) => {

  try {

    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', {
        ascending: false
      });

    if (error) {
      console.error('❌ Get orders error:', error);
      throw error;
    }

    res.json(data || []);

  } catch (err) {

    console.error('❌ /api/orders:', err);

    res.status(500).json({
      error: err.message ||
        'Orders could not be loaded'
    });
  }
});

// ======================================================
// UPDATE ORDER STATUS
// CONFIRM → DEDUCT STOCK
// ======================================================

app.patch('/api/orders/:id', async (req, res) => {

  try {

    const orderId = req.params.id;
    const { status } = req.body;

    const allowedStatuses = [
      'NEW',
      'PENDING',
      'RECEIPT_PENDING',
      'VERIFYING',
      'CONFIRMED',
      'REJECTED'
    ];

    if (!allowedStatuses.includes(status)) {

      return res.status(400).json({
        error: 'Invalid order status'
      });
    }

    // ----------------------------------------------
    // Get order
    // ----------------------------------------------

    const {
      data: orderData,
      error: orderErr
    } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderErr || !orderData) {

      return res.status(404).json({
        error: 'ኦርደሩ አልተገኘም።'
      });
    }

    // ----------------------------------------------
    // Confirmed → Deduct stock
    // ----------------------------------------------

    if (
      status === 'CONFIRMED' &&
      orderData.status !== 'CONFIRMED'
    ) {

      const productName =
        orderData.product_name ||
        orderData.productName;

      const quantity =
        Number(orderData.quantity || 1);

      const {
        data: prodData,
        error: prodErr
      } = await supabase
        .from('products')
        .select('*')
        .ilike('name', productName)
        .limit(1)
        .maybeSingle();

      if (prodErr) {
        console.error(
          '❌ Product lookup error:',
          prodErr
        );
      }

      if (prodData) {

        const currentStock =
          Number(prodData.stock || 0);

        const newStock =
          Math.max(
            0,
            currentStock - quantity
          );

        const {
          error: stockErr
        } = await supabase
          .from('products')
          .update({
            stock: newStock
          })
          .eq('id', prodData.id);

        if (stockErr) {

          console.error(
            '❌ Stock update error:',
            stockErr
          );

          throw stockErr;
        }
      }
    }

    // ----------------------------------------------
    // Update order status
    // ----------------------------------------------

    const {
      error: updateErr
    } = await supabase
      .from('orders')
      .update({
        status: status
      })
      .eq('id', orderId);

    if (updateErr) {
      throw updateErr;
    }

    res.json({
      success: true,
      status: status
    });

  } catch (err) {

    console.error(
      '❌ Update order error:',
      err
    );

    res.status(500).json({
      error:
        err.message ||
        'Order status could not be updated'
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

  console.log(
    `📦 Supabase URL configured: ${!!SUPABASE_URL}`
  );

  console.log(
    `🔐 Supabase Service Role Key configured: ${!!SUPABASE_SERVICE_ROLE_KEY}`
  );

  console.log(
    `🖼️ Product photo upload: /api/upload`
  );

});
