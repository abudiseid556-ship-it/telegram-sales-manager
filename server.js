const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Root Route: Opens Admin Dashboard by default
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Multer for handling file uploads temporarily
const upload = multer({ storage: multer.memoryStorage() });

// Environment Variables
const SUPABASE_URL = process.env.SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'YOUR_SUPABASE_KEY';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// --- API: Get Products ---
app.get('/api/products', async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').select('*').order('id', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API: Add Product ---
app.post('/api/products', async (req, res) => {
  try {
    const { name, buyPrice, sellPrice, stock, photoUrl } = req.body;
    const { data, error } = await supabase.from('products').insert([{
      name,
      buy_price: buyPrice,
      sell_price: sellPrice,
      stock,
      photo_url: photoUrl
    }]).select();

    if (error) throw error;
    res.json({ success: true, product: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API: Upload Image to Supabase Storage ---
app.post('/api/upload', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'ምንም ፋይል አልተገኘም' });
    
    const fileExt = path.extname(req.file.originalname);
    const fileName = `prod_${Date.now()}${fileExt}`;
    const { data, error } = await supabase.storage
      .from('product-photos') // የሱፓቤዝ Bucket ስም (product-photos መሆን አለበት)
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype });

    if (error) throw error;

    const { data: publicUrlData } = supabase.storage
      .from('product-photos')
      .getPublicUrl(fileName);

    res.json({ success: true, url: publicUrlData.publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API: Get Orders ---
app.get('/api/orders', async (req, res) => {
  try {
    const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- API: Update Order Status & Deduct Stock if Confirmed ---
app.patch('/api/orders/:id', async (req, res) => {
  try {
    const orderId = req.params.id;
    const { status } = req.body;

    // 1. የኦርደሩን ወቅታዊ መረጃ ማግኘት
    const { data: orderData, error: orderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderErr || !orderData) throw new Error('ኦርደሩ አልተገኘም');

    // 2. ኦርደሩ CONFIRMED ሲደረግ እና ቀደም ሲል Confirmed ያልነበረ ከሆነ ከስቶክ መቀነስ
    if (status === 'CONFIRMED' && orderData.status !== 'CONFIRMED') {
      const { data: prodData, error: prodErr } = await supabase
        .from('products')
        .select('*')
        .ilike('name', orderData.product_name)
        .single();

      if (prodData) {
        const newStock = Math.max(0, prodData.stock - (orderData.quantity || 1));
        await supabase
          .from('products')
          .update({ stock: newStock })
          .eq('id', prodData.id);
      }
    }

    // 3. የኦርደሩን ስተተስ ማስተካከል
    const { error: updateErr } = await supabase
      .from('orders')
      .update({ status: status })
      .eq('id', orderId);

    if (updateErr) throw updateErr;

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Telegram Sales Manager running on port ${PORT}`);
});

