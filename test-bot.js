import dotenv from "dotenv";
dotenv.config();

async function testTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  console.log("Testing Telegram with Chat ID:", chatId);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "🚨 DevRadar Test: Telegram connection is working!",
    }),
  });

  const data = await res.json();
  if (data.ok) {
    console.log("✅ Success! Check your Telegram app right now.");
  } else {
    console.error("❌ Telegram rejected the message:", data.description);
  }
}

testTelegram();