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
const WEBHOOK_URL=process.env.WEBHOOK_URL||"https://telegram-sales-manager-r26j.onrender.com/telegram/webhook";
const ADMIN_CHAT_ID=process.env.ADMIN_CHAT_ID;

if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY){
  console.error("❌ Supabase ENV missing");
  process.exit(1);
}

const supabase=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{
  auth:{autoRefreshToken:false,persistSession:false}
});

app.use(express.json({limit:"5mb"}));
app.use(express.urlencoded({extended:true}));
app.use(express.static("public"));

app.get("/",(req,res)=>{
  res.sendFile(path.join(__dirname,"public","admin.html"));
});

app.get("/api/health",(req,res)=>{
  res.json({
    success:true,
    message:"Telegram Sales Manager API is running ✅",
    telegram:!!bot
  });
});

// ==================== TELEGRAM ====================

let bot=null;

if(TELEGRAM_BOT_TOKEN){
  bot=new TelegramBot(TELEGRAM_BOT_TOKEN,{polling:false});

  app.post("/telegram/webhook",(req,res)=>{
    try{
      bot.processUpdate(req.body);
      res.sendStatus(200);
    }catch(err){
      console.error("Webhook error:",err.message);
      res.sendStatus(500);
    }
  });

  app.get("/api/telegram/webhook-info",async(req,res)=>{
    try{
      const info=await bot.getWebHookInfo();
      res.json({success:true,webhook:info});
    }catch(err){
      res.status(500).json({success:false,error:err.message});
    }
  });
}

// ==================== STORAGE ====================

const upload=multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:5*1024*1024},
  fileFilter:(req,file,cb)=>{
    if(!file.mimetype?.startsWith("image/")){
      return cb(new Error("የፎቶ ፋይል ብቻ ይፈቀዳል።"));
    }
    cb(null,true);
  }
});

app.post("/api/upload",(req,res,next)=>{
  upload.single("photo")(req,res,err=>{
    if(err)return res.status(400).json({error:err.message});
    next();
  });
},async(req,res)=>{
  try{
    if(!req.file)return res.status(400).json({error:"ፎቶ አልተገኘም።"});

    let ext=path.extname(req.file.originalname).toLowerCase();
    if(![".jpg",".jpeg",".png",".webp",".gif"].includes(ext))ext=".jpg";

    const fileName=`products/prod_${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`;

    const {error}=await supabase.storage
      .from("product-photos")
      .upload(fileName,req.file.buffer,{
        contentType:req.file.mimetype,
        cacheControl:"3600",
        upsert:false
      });

    if(error)throw error;

    const {data}=supabase.storage
      .from("product-photos")
      .getPublicUrl(fileName);

    res.json({success:true,url:data.publicUrl,path:fileName});
  }catch(err){
    console.error("UPLOAD:",err);
    res.status(500).json({error:err.message});
  }
});

// ==================== PRODUCTS ====================

app.get("/api/products",async(req,res)=>{
  try{
    const {data,error}=await supabase
      .from("products")
      .select("*")
      .order("id",{ascending:false});

    if(error)throw error;
    res.json(data||[]);
  }catch(err){
    res.status(500).json({error:err.message});
  }
});

app.post("/api/products",async(req,res)=>{
  try{
    const {name,buyPrice,sellPrice,stock,photoUrl}=req.body;

    const buy=Number(buyPrice);
    const sell=Number(sellPrice);
    const qty=Number(stock);

    if(!name?.trim())return res.status(400).json({error:"የምርት ስም ያስፈልጋል።"});

    if(![buy,sell,qty].every(Number.isFinite)||buy<0||sell<0||qty<0){
      return res.status(400).json({error:"ዋጋ እና Stock ትክክለኛ ይሁን።"});
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
    res.json({success:true,product:data});
  }catch(err){
    res.status(500).json({error:err.message});
  }
});

app.patch("/api/products/:id",async(req,res)=>{
  try{
    const {name,buyPrice,sellPrice,stock,photoUrl}=req.body;

    const buy=Number(buyPrice);
    const sell=Number(sellPrice);
    const qty=Number(stock);

    if(!name?.trim())return res.status(400).json({error:"የምርት ስም ያስፈልጋል።"});

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
    res.json({success:true,product:data});
  }catch(err){
    res.status(500).json({error:err.message});
  }
});

app.delete("/api/products/:id",async(req,res)=>{
  try{
    const {error}=await supabase
      .from("products")
      .delete()
      .eq("id",req.params.id);

    if(error)throw error;
    res.json({success:true});
  }catch(err){
    res.status(500).json({error:err.message});
  }
});

// ==================== ADVERTISEMENTS ====================

app.get("/api/advertisements",async(req,res)=>{
  try{
    const {data,error}=await supabase
      .from("advertisements")
      .select("*")
      .order("id",{ascending:false});

    if(error)throw error;
    res.json(data||[]);
  }catch(err){
    res.status(500).json({error:err.message});
  }
});

app.post("/api/advertisements",async(req,res)=>{
  try{
    const {
      productId,
      title,
      text,
      photoUrl,
      buttonText
    }=req.body;

    const {data,error}=await supabase
      .from("advertisements")
      .insert([{
        product_id:productId||null,
        title:title||"",
        text:text||"",
        photo_url:photoUrl||null,
        button_text:buttonText||"🛒 በዚህ ይዘዙን"
      }])
      .select()
      .single();

    if(error)throw error;

    res.json({success:true,advertisement:data});
  }catch(err){
    res.status(500).json({error:err.message});
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
      status
    }=req.body;

    const {data,error}=await supabase
      .from("advertisements")
      .update({
        product_id:productId||null,
        title:title||"",
        text:text||"",
        photo_url:photoUrl||null,
        button_text:buttonText||"🛒 በዚህ ይዘዙን",
        status:status||"ACTIVE"
      })
      .eq("id",req.params.id)
      .select()
      .single();

    if(error)throw error;

    res.json({success:true,advertisement:data});
  }catch(err){
    res.status(500).json({error:err.message});
  }
});

app.delete("/api/advertisements/:id",async(req,res)=>{
  try{
    const {error}=await supabase
      .from("advertisements")
      .delete()
      .eq("id",req.params.id);

    if(error)throw error;
    res.json({success:true});
  }catch(err){
    res.status(500).json({error:err.message});
  }
});

// ==================== ORDERS ====================

app.get("/api/orders",async(req,res)=>{
  try{
    const {data,error}=await supabase
      .from("orders")
      .select("*")
      .order("created_at",{ascending:false});

    if(error)throw error;
    res.json(data||[]);
  }catch(err){
    res.status(500).json({error:err.message});
  }
});

app.patch("/api/orders/:id",async(req,res)=>{
  try{
    const status=req.body.status;

    const allowed=[
      "NEW",
      "PENDING",
      "RECEIPT_PENDING",
      "VERIFYING",
      "CONFIRMED",
      "REJECTED"
    ];

    if(!allowed.includes(status)){
      return res.status(400).json({error:"Invalid order status"});
    }

    const {data:order,error:orderError}=await supabase
      .from("orders")
      .select("*")
      .eq("id",req.params.id)
      .single();

    if(orderError||!order){
      return res.status(404).json({error:"Order not found"});
    }

    if(status==="CONFIRMED"&&order.status!=="CONFIRMED"){
      const productId=order.product_id;
      const quantity=Number(order.quantity||1);

      if(productId){
        const {data:product}=await supabase
          .from("products")
          .select("*")
          .eq("id",productId)
          .single();

        if(product){
          const stock=Number(product.stock||0);

          if(stock<quantity){
            return res.status(400).json({
              error:`Stock አይበቃም። ያለው Stock: ${stock}`
            });
          }

          const {error:stockError}=await supabase
            .from("products")
            .update({stock:stock-quantity})
            .eq("id",product.id);

          if(stockError)throw stockError;
        }
      }
    }

    const {error}=await supabase
      .from("orders")
      .update({status})
      .eq("id",req.params.id);

    if(error)throw error;

    if(bot&&order.customer_id){
      const message=
        status==="CONFIRMED"
        ?"✅ ትዕዛዝዎ ተረጋግጧል። እናመሰግናለን!"
        :status==="REJECTED"
        ?"❌ የክፍያ ማረጋገጫዎ አልተቀበለም። እባክዎ እንደገና ይላኩ።"
        :null;

      if(message){
        await bot.sendMessage(order.customer_id,message);
      }
    }

    res.json({success:true,status});
  }catch(err){
    console.error("ORDER STATUS:",err);
    res.status(500).json({error:err.message});
  }
});

// ==================== BOT STATE ====================

const sessions=new Map();

function getSession(id){
  if(!sessions.has(id)){
    sessions.set(id,{
      step:"START",
      product:null,
      quantity:1,
      name:"",
      phone:"",
      address:"",
      orderId:null
    });
  }
  return sessions.get(id);
}

function clearSession(id){
  sessions.delete(id);
}

async function sendProducts(chatId){
  const {data,error}=await supabase
    .from("products")
    .select("*")
    .gt("stock",0)
    .order("id",{ascending:false});

  if(error||!data?.length){
    return bot.sendMessage(chatId,"😔 አሁን ምርት የለንም።");
  }

  const buttons=data.map(p=>[
    {
      text:`🛍️ ${p.name} — ${Number(p.sell_price).toLocaleString()} ETB`,
      callback_data:`product_${p.id}`
    }
  ]);

  return bot.sendMessage(chatId,"🛍️ ምርት ይምረጡ፦",{
    reply_markup:{inline_keyboard:buttons}
  });
}

// ==================== START ====================

if(bot){

  bot.setMyCommands([
    {
      command:"start",
      description:"🛍️ መግዛት ይጀምሩ"
    }
  ]).catch(()=>{});

  bot.onText(/^\/start(?:\s.*)?$/,(msg)=>{
    const chatId=msg.chat.id;
    clearSession(chatId);
    getSession(chatId);

    bot.sendMessage(
      chatId,
      "👋 እንኳን ወደ UNI MARKET በደህና መጡ!\n\n🛍️ ምርት ለመግዛት ከታች ያለውን ይጫኑ።",
      {
        reply_markup:{
          keyboard:[
            [{text:"🛍️ ምርቶች"}]
          ],
          resize_keyboard:true
        }
      }
    );
  });

  bot.on("message",async msg=>{
    try{
      const chatId=msg.chat.id;
      const text=msg.text||"";

      if(text.startsWith("/start"))return;

      const session=getSession(chatId);

      if(text==="🛍️ ምርቶች"){
        session.step="PRODUCTS";
        return sendProducts(chatId);
      }

      if(session.step==="QUANTITY"){
        const quantity=parseInt(text,10);

        if(!Number.isInteger(quantity)||quantity<1){
          return bot.sendMessage(chatId,"❌ እባክዎ ትክክለኛ ብዛት ያስገቡ።");
        }

        if(quantity>Number(session.product.stock)){
          return bot.sendMessage(
            chatId,
            `❌ በቂ Stock የለም። ያለው: ${session.product.stock}`
          );
        }

        session.quantity=quantity;
        session.step="NAME";

        return bot.sendMessage(chatId,"👤 ሙሉ ስምዎን ያስገቡ።");
      }

      if(session.step==="NAME"){
        if(text.trim().length<2){
          return bot.sendMessage(chatId,"❌ ሙሉ ስምዎን ያስገቡ።");
        }

        session.name=text.trim();
        session.step="PHONE";

        return bot.sendMessage(chatId,"📱 ስልክ ቁጥርዎን ያስገቡ።");
      }

      if(session.step==="PHONE"){
        if(text.trim().length<7){
          return bot.sendMessage(chatId,"❌ ትክክለኛ ስልክ ያስገቡ።");
        }

        session.phone=text.trim();
        session.step="ADDRESS";

        return bot.sendMessage(chatId,"📍 የመላኪያ አድራሻዎን ያስገቡ።");
      }

      if(session.step==="ADDRESS"){
        if(text.trim().length<3){
          return bot.sendMessage(chatId,"❌ አድራሻ ያስገቡ።");
        }

        session.address=text.trim();
        session.step="REVIEW";

        const p=session.product;
        const total=Number(p.sell_price)*session.quantity;

        return bot.sendMessage(
          chatId,
          `🧾 የትዕዛዝ ማረጋገጫ\n\n`+
          `🛍️ ምርት: ${p.name}\n`+
          `🔢 ብዛት: ${session.quantity}\n`+
          `💰 ዋጋ: ${Number(p.sell_price).toLocaleString()} ETB\n`+
          `💵 ጠቅላላ: ${total.toLocaleString()} ETB\n\n`+
          `👤 ስም: ${session.name}\n`+
          `📱 ስልክ: ${session.phone}\n`+
          `📍 አድራሻ: ${session.address}`,
          {
            reply_markup:{
              inline_keyboard:[
                [{text:"✅ ትዕዛዝ አረጋግጥ",callback_data:"confirm_order"}],
                [{text:"❌ ሰርዝ",callback_data:"cancel_order"}]
              ]
            }
          }
        );
      }

      if(session.step==="PAYMENT"){
        return bot.sendMessage(
          chatId,
          "💳 ክፍያ ካደረጉ በኋላ Receipt ፎቶ ይላኩ።"
        );
      }

    }catch(err){
      console.error("BOT MESSAGE:",err);
    }
  });

  bot.on("callback_query",async query=>{
    try{
      const chatId=query.message.chat.id;
      const data=query.data;
      const session=getSession(chatId);

      await bot.answerCallbackQuery(query.id);

      if(data==="cancel_order"){
        clearSession(chatId);
        return bot.sendMessage(chatId,"❌ ትዕዛዙ ተሰርዟል።");
      }

      if(data.startsWith("product_")){
        const id=data.replace("product_","");

        const {data:product,error}=await supabase
          .from("products")
          .select("*")
          .eq("id",id)
          .single();

        if(error||!product){
          return bot.sendMessage(chatId,"❌ ምርቱ አልተገኘም።");
        }

        if(Number(product.stock)<=0){
          return bot.sendMessage(chatId,"❌ ይህ ምርት ከStock ወጥቷል።");
        }

        session.product=product;
        session.quantity=1;
        session.step="QUANTITY";

        return bot.sendMessage(
          chatId,
          `🛍️ ${product.name}\n\n💰 ${Number(product.sell_price).toLocaleString()} ETB\n📦 Stock: ${product.stock}\n\n🔢 ስንት ይፈልጋሉ?`
        );
      }

      if(data==="confirm_order"){
        const p=session.product;

        if(!p){
          return bot.sendMessage(chatId,"❌ የትዕዛዝ መረጃ ጠፍቷል።");
        }

        const total=Number(p.sell_price)*session.quantity;
        const profit=(Number(p.sell_price)-Number(p.buy_price))*session.quantity;

        const {data:order,error}=await supabase
          .from("orders")
          .insert([{
            product_id:p.id,
            product_name:p.name,
            buy_price:Number(p.buy_price),
            sell_price:Number(p.sell_price),
            quantity:session.quantity,
            total,
            profit,
            customer_id:String(chatId),
            customer_name:session.name,
            username:query.from.username?`@${query.from.username}`:"",
            phone:session.phone,
            address:session.address,
            status:"PENDING"
          }])
          .select()
          .single();

        if(error)throw error;

        session.orderId=order.id;
        session.step="PAYMENT";

        return bot.sendMessage(
          chatId,
          `✅ ትዕዛዝዎ ተመዝግቧል።\n\n`+
          `💳 የክፍያ መረጃ\n`+
          `CBE\n`+
          `UNI MARKET\n\n`+
          `💰 መክፈል ያለብዎት: ${total.toLocaleString()} ETB\n\n`+
          `📸 ክፍያ ካደረጉ በኋላ Receipt ፎቶ ይላኩ።`
        );
      }

    }catch(err){
      console.error("CALLBACK:",err);
      bot.sendMessage(
        query.message.chat.id,
        "❌ ችግር ተፈጥሯል። እባክዎ እንደገና ይሞክሩ።"
      );
    }
  });

  // ==================== RECEIPT ====================

  bot.on("photo",async msg=>{
    try{
      const chatId=msg.chat.id;
      const session=getSession(chatId);

      if(!session.orderId){
        return bot.sendMessage(
          chatId,
          "❌ መጀመሪያ ትዕዛዝ ያድርጉ።"
        );
      }

      const photo=msg.photo[msg.photo.length-1];
      const fileId=photo.file_id;

      const fileUrl=await bot.getFileLink(fileId);

      const {error}=await supabase
        .from("orders")
        .update({
          receipt_url:fileUrl,
          status:"VERIFYING"
        })
        .eq("id",session.orderId);

      if(error)throw error;

      await bot.sendMessage(
        chatId,
        "✅ Receipt ደርሶናል።\n\n⏳ Admin እየረጋገጠ ነው።"
      );

      if(ADMIN_CHAT_ID){
        await bot.sendPhoto(
          ADMIN_CHAT_ID,
          fileId,
          {
            caption:
              `🧾 አዲስ Receipt\n\n`+
              `Order: #${session.orderId}\n`+
              `👤 ${session.name}\n`+
              `📱 ${session.phone}\n`+
              `🛍️ ${session.product?.name||""}\n`+
              `🔢 ${session.quantity}`
          },
          {
            reply_markup:{
              inline_keyboard:[
                [
                  {
                    text:"✅ CONFIRM",
                    callback_data:`admin_confirm_${session.orderId}`
                  },
                  {
                    text:"❌ REJECT",
                    callback_data:`admin_reject_${session.orderId}`
                  }
                ]
              ]
            }
          }
        );
      }

    }catch(err){
      console.error("RECEIPT:",err);
      bot.sendMessage(
        msg.chat.id,
        "❌ Receipt ማስገባት አልተቻለም።"
      );
    }
  });

  // ==================== ADMIN RECEIPT ====================

  bot.on("callback_query",async query=>{
    try{
      const data=query.data||"";

      if(!data.startsWith("admin_"))return;

      const parts=data.split("_");
      const action=parts[1];
      const orderId=parts[2];

      const status=action==="confirm"?"CONFIRMED":"REJECTED";

      const {data:order,error}=await supabase
        .from("orders")
        .select("*")
        .eq("id",orderId)
        .single();

      if(error||!order){
        return bot.answerCallbackQuery(query.id,{
          text:"Order not found"
        });
      }

      if(status==="CONFIRMED"&&order.status!=="CONFIRMED"){
        const {data:product}=await supabase
          .from("products")
          .select("*")
          .eq("id",order.product_id)
          .single();

        if(product){
          const stock=Number(product.stock||0);
          const quantity=Number(order.quantity||1);

          if(stock<quantity){
            return bot.answerCallbackQuery(query.id,{
              text:"Stock አይበቃም"
            });
          }

          await supabase
            .from("products")
            .update({stock:stock-quantity})
            .eq("id",product.id);
        }
      }

      await supabase
        .from("orders")
        .update({status})
        .eq("id",orderId);

      await bot.answerCallbackQuery(query.id,{
        text:status==="CONFIRMED"?"Confirmed ✅":"Rejected ❌"
      });

      if(order.customer_id){
        await bot.sendMessage(
          order.customer_id,
          status==="CONFIRMED"
          ?"✅ ክፍያዎ ተረጋግጧል። ትዕዛዝዎ ተቀብሏል።"
          :"❌ የክፍያ Receipt ውድቅ ተደርጓል። እባክዎ ትክክለኛ Receipt ይላኩ።"
        );
      }

    }catch(err){
      console.error("ADMIN CALLBACK:",err);
    }
  });
}

// ==================== START SERVER ====================

app.listen(PORT,async()=>{
  console.log(`🚀 Server running on port ${PORT}`);

  if(bot){
    try{
      await bot.setWebHook(WEBHOOK_URL);
      console.log("✅ Webhook:",WEBHOOK_URL);
    }catch(err){
      console.error("❌ Webhook error:",err.message);
    }
  }
});
