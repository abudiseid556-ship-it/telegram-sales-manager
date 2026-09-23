const express=require("express");
const {createClient}=require("@supabase/supabase-js");
const TelegramBot=require("node-telegram-bot-api");
const multer=require("multer");
const path=require("path");

const app=express();
const PORT=process.env.PORT||10000;

const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELEGRAM_BOT_TOKEN=process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL=process.env.WEBHOOK_URL||"https://telegram-sales-manager-ga96.onrender.com/telegram/webhook";
const ADMIN_CHAT_ID=process.env.ADMIN_CHAT_ID;

if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY){
 console.error("❌ Supabase ENV missing");
 process.exit(1);
}

if(!TELEGRAM_BOT_TOKEN){
 console.warn("⚠️ TELEGRAM_BOT_TOKEN missing");
}

const supabase=createClient(
 SUPABASE_URL,
 SUPABASE_SERVICE_ROLE_KEY,
 {
  auth:{
   autoRefreshToken:false,
   persistSession:false
  }
 }
);

app.use(express.json({limit:"10mb"}));
app.use(express.urlencoded({extended:true}));
app.use(express.static("public"));

app.get("/",(req,res)=>{
 res.sendFile(path.join(__dirname,"public","admin.html"));
});

/* =========================
TELEGRAM
========================= */

let bot=null;

if(TELEGRAM_BOT_TOKEN){
 bot=new TelegramBot(
  TELEGRAM_BOT_TOKEN,
  {polling:false}
 );

 app.post("/telegram/webhook",(req,res)=>{
  try{
   bot.processUpdate(req.body);
   res.sendStatus(200);
  }catch(err){
   console.error("Webhook:",err);
   res.sendStatus(500);
  }
 });

 app.get("/api/telegram/webhook-info",async(req,res)=>{
  try{
   const info=await bot.getWebHookInfo();
   res.json({
    success:true,
    webhook:info
   });
  }catch(err){
   res.status(500).json({
    success:false,
    error:err.message
   });
  }
 });
}

/* =========================
HEALTH
========================= */

app.get("/api/health",(req,res)=>{
 res.json({
  success:true,
  message:"Telegram Sales Manager API is running ✅",
  telegram:!!bot
 });
});

/* =========================
UPLOAD
========================= */

const upload=multer({
 storage:multer.memoryStorage(),
 limits:{
  fileSize:5*1024*1024
 },
 fileFilter:(req,file,cb)=>{
  if(!file.mimetype?.startsWith("image/")){
   return cb(new Error("የፎቶ ፋይል ብቻ ይፈቀዳል።"));
  }
  cb(null,true);
 }
});

app.post(
 "/api/upload",
 (req,res,next)=>{
  upload.single("photo")(req,res,err=>{
   if(err){
    return res.status(400).json({
     error:err.message
    });
   }
   next();
  });
 },
 async(req,res)=>{
  try{
   if(!req.file){
    return res.status(400).json({
     error:"ፎቶ አልተገኘም።"
    });
   }

   let ext=path.extname(req.file.originalname).toLowerCase();

   if(![".jpg",".jpeg",".png",".webp",".gif"].includes(ext)){
    ext=".jpg";
   }

   const fileName=
    `products/prod_${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`;

   const {error}=await supabase.storage
    .from("product-photos")
    .upload(
     fileName,
     req.file.buffer,
     {
      contentType:req.file.mimetype,
      cacheControl:"3600",
      upsert:false
     }
    );

   if(error)throw error;

   const {data}=supabase.storage
    .from("product-photos")
    .getPublicUrl(fileName);

   res.json({
    success:true,
    url:data.publicUrl,
    path:fileName
   });

  }catch(err){
   console.error("UPLOAD:",err);
   res.status(500).json({
    error:err.message
   });
  }
 }
);

/* =========================
PRODUCTS
========================= */

app.get("/api/products",async(req,res)=>{
 try{
  const {data,error}=await supabase
   .from("products")
   .select("*")
   .order("id",{ascending:false});

  if(error)throw error;

  res.json(data||[]);
 }catch(err){
  res.status(500).json({
   error:err.message
  });
 }
});

app.post("/api/products",async(req,res)=>{
 try{
  const {
   name,
   buyPrice,
   sellPrice,
   stock,
   photoUrl
  }=req.body;

  const buy=Number(buyPrice);
  const sell=Number(sellPrice);
  const qty=Number(stock);

  if(!name?.trim()){
   return res.status(400).json({
    error:"የምርት ስም ያስፈልጋል።"
   });
  }

  if(
   ![buy,sell,qty].every(Number.isFinite)||
   buy<0||
   sell<0||
   qty<0
  ){
   return res.status(400).json({
    error:"ዋጋ እና Stock ትክክለኛ ይሁን።"
   });
  }

  const {data,error}=await supabase
   .from("products")
   .insert([{
    name:name.trim(),
    buy_price:buy,
    sell_price:sell,
    stock:qty,
    photo_url:photoUrl||null
   }])
   .select()
   .single();

  if(error)throw error;

  res.json({
   success:true,
   product:data
  });

 }catch(err){
  res.status(500).json({
   error:err.message
  });
 }
});

app.patch("/api/products/:id",async(req,res)=>{
 try{
  const {
   name,
   buyPrice,
   sellPrice,
   stock,
   photoUrl
  }=req.body;

  if(!name?.trim()){
   return res.status(400).json({
    error:"የምርት ስም ያስፈልጋል።"
   });
  }

  const buy=Number(buyPrice);
  const sell=Number(sellPrice);
  const qty=Number(stock);

  if(
   ![buy,sell,qty].every(Number.isFinite)||
   buy<0||
   sell<0||
   qty<0
  ){
   return res.status(400).json({
    error:"ዋጋ እና Stock ትክክለኛ ይሁን።"
   });
  }

  const {data,error}=await supabase
   .from("products")
   .update({
    name:name.trim(),
    buy_price:buy,
    sell_price:sell,
    stock:qty,
    photo_url:photoUrl||null
   })
   .eq("id",req.params.id)
   .select()
   .single();

  if(error)throw error;

  res.json({
   success:true,
   product:data
  });

 }catch(err){
  res.status(500).json({
   error:err.message
  });
 }
});

app.delete("/api/products/:id",async(req,res)=>{
 try{
  const {error}=await supabase
   .from("products")
   .delete()
   .eq("id",req.params.id);

  if(error)throw error;

  res.json({
   success:true
  });
 }catch(err){
  res.status(500).json({
   error:err.message
  });
 }
});

/* =========================
TELEGRAM SETTINGS
========================= */

app.get("/api/telegram-settings",async(req,res)=>{
 try{
  const {data,error}=await supabase
   .from("telegram_settings")
   .select("*")
   .order("id",{ascending:true})
   .limit(1)
   .maybeSingle();

  if(error)throw error;

  res.json(data||{
   id:null,
   ad_chat_id:"",
   bot_username:"uni_market_shop_bot"
  });

 }catch(err){
  console.error("TELEGRAM SETTINGS GET:",err);
  res.status(500).json({
   error:err.message
  });
 }
});

app.post("/api/telegram-settings",async(req,res)=>{
 try{
  let adChatId=(req.body.ad_chat_id||"").trim();

  let botUsername=
   (req.body.bot_username||"uni_market_shop_bot")
   .trim()
   .replace(/^@/,"");

  if(!adChatId){
   return res.status(400).json({
    error:"የTelegram Channel/Group ID ያስገቡ።"
   });
  }

  if(!botUsername){
   botUsername="uni_market_shop_bot";
  }

  const {data:old,error:oldError}=await supabase
   .from("telegram_settings")
   .select("id")
   .order("id",{ascending:true})
   .limit(1)
   .maybeSingle();

  if(oldError)throw oldError;

  let result;

  if(old?.id){
   result=await supabase
    .from("telegram_settings")
    .update({
     ad_chat_id:adChatId,
     bot_username:botUsername,
     updated_at:new Date().toISOString()
    })
    .eq("id",old.id)
    .select()
    .single();
  }else{
   result=await supabase
    .from("telegram_settings")
    .insert([{
     ad_chat_id:adChatId,
     bot_username:botUsername
    }])
    .select()
    .single();
  }

  if(result.error)throw result.error;

  res.json({
   success:true,
   settings:result.data
  });

 }catch(err){
  console.error("TELEGRAM SETTINGS SAVE:",err);
  res.status(500).json({
   error:err.message
  });
 }
});

/* =========================
ADVERTISEMENTS
========================= */

app.get("/api/advertisements",async(req,res)=>{
 try{
  const {data,error}=await supabase
   .from("advertisements")
   .select("*")
   .order("id",{ascending:false});

  if(error)throw error;

  res.json(data||[]);
 }catch(err){
  res.status(500).json({
   error:err.message
  });
 }
});

app.post("/api/advertisements",async(req,res)=>{
 try{
  const {
   productId,
   title,
   text,
   photoUrl,
   buttonText,
   adType,
   discount,
   oldPrice,
   startAt,
   endAt,
   targetChatId
  }=req.body;

  const {data:settings}=await supabase
   .from("telegram_settings")
   .select("ad_chat_id")
   .order("id",{ascending:true})
   .limit(1)
   .maybeSingle();

  const chatId=
   (targetChatId||"").trim()||
   settings?.ad_chat_id||
   null;

  const {data,error}=await supabase
   .from("advertisements")
   .insert([{
    product_id:productId?String(productId):null,
    title:title||"",
    text:text||"",
    photo_url:photoUrl||null,
    button_text:buttonText||"🛒 በዚህ ይዘዙን",
    ad_type:adType||"PRODUCT",
    discount:Number(discount)||0,
    old_price:Number(oldPrice)||0,
    start_at:startAt||null,
    end_at:endAt||null,
    target_chat_id:chatId,
    status:"ACTIVE",
    publish_status:"DRAFT"
   }])
   .select()
   .single();

  if(error)throw error;

  res.json({
   success:true,
   advertisement:data
  });

 }catch(err){
  console.error("CREATE AD:",err);
  res.status(500).json({
   error:err.message
  });
 }
});

app.patch("/api/advertisements/:id",async(req,res)=>{
 try{
  const {
   productId,
   title,
   text,
   photoUrl,
   buttonText,
   adType,
   discount,
   oldPrice,
   startAt,
   endAt,
   targetChatId,
   status
  }=req.body;

  const {data:settings}=await supabase
   .from("telegram_settings")
   .select("ad_chat_id")
   .order("id",{ascending:true})
   .limit(1)
   .maybeSingle();

  const chatId=
   (targetChatId||"").trim()||
   settings?.ad_chat_id||
   null;

  const {data,error}=await supabase
   .from("advertisements")
   .update({
    product_id:productId?String(productId):null,
    title:title||"",
    text:text||"",
    photo_url:photoUrl||null,
    button_text:buttonText||"🛒 በዚህ ይዘዙን",
    ad_type:adType||"PRODUCT",
    discount:Number(discount)||0,
    old_price:Number(oldPrice)||0,
    start_at:startAt||null,
    end_at:endAt||null,
    target_chat_id:chatId,
    status:status||"ACTIVE"
   })
   .eq("id",req.params.id)
   .select()
   .single();

  if(error)throw error;

  res.json({
   success:true,
   advertisement:data
  });

 }catch(err){
  res.status(500).json({
   error:err.message
  });
 }
});

app.delete("/api/advertisements/:id",async(req,res)=>{
 try{
  const {error}=await supabase
   .from("advertisements")
   .delete()
   .eq("id",req.params.id);

  if(error)throw error;

  res.json({
   success:true
  });
 }catch(err){
  res.status(500).json({
   error:err.message
  });
 }
});

/* =========================
PUBLISH AD
========================= */

app.post("/api/advertisements/:id/publish",async(req,res)=>{
 try{
  if(!bot){
   return res.status(400).json({
    error:"Telegram Bot አልተገናኘም።"
   });
  }

  const {data:ad,error:adError}=await supabase
   .from("advertisements")
   .select("*")
   .eq("id",req.params.id)
   .single();

  if(adError||!ad){
   return res.status(404).json({
    error:"Advertisement አልተገኘም።"
   });
  }

  const {data:settings}=await supabase
   .from("telegram_settings")
   .select("*")
   .order("id",{ascending:true})
   .limit(1)
   .maybeSingle();

  const chatId=
   ad.target_chat_id||
   settings?.ad_chat_id;

  if(!chatId){
   return res.status(400).json({
    error:"Telegram Channel/Group ID አልተዘጋጀም። Dashboard → Telegram Settings ላይ ያስገቡ።"
   });
  }

  let product=null;

  if(ad.product_id){
   const {data,error}=await supabase
    .from("products")
    .select("*")
    .eq("id",String(ad.product_id))
    .maybeSingle();

   if(error)throw error;

   product=data||null;
  }

  let caption="";

  if(ad.title){
   caption+=`📢 ${ad.title}\n\n`;
  }

  if(ad.text){
   caption+=`${ad.text}\n\n`;
  }

  if(product){
   caption+=
    `🛍️
