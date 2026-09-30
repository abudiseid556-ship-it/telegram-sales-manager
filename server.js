      if (callbackData.startsWith("order_received_")) {
        const orderId = callbackData.slice("order_received_".length);
        if (!orderId || !supabase) return;
        
        // 1. Update order status in Supabase
        await supabase.from("orders").update({ status: "DELIVERED", delivered_at: nowISO() }).eq("id", orderId);
        
        // 2. Clear user session (close order flow)
        orderSessions.delete(chatId);

        // 3. Send thank you and family appreciation message
        await sendMessage(
          chatId,
          "✅ <b>ትዕዛዝዎ በተሳካ ሁኔታ ተጠናቋል!</b>\n\n🙏 ከእኛ ጋር ቤተሰብነት ስለመሰረቱ እናመሰግናለን! እንደገና እንድትጎበኙን በጉጉት እንጠብቃለን። 🛍️✨",
          { parse_mode: "HTML" }
        );
        return;
      }
