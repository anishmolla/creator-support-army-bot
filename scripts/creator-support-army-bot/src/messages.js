module.exports = {
  welcomeMessage: `
🎉 Welcome to Creator Support Army ❤️🔥
Idhar creators ek family ki tarah grow karte hain — free help, clean rules, aur mast vibe ke sath.

1) DEAL BANANA:
/deal @user details likh kar agreement start hota hai.

2) ACCEPT KARNA:
/accept sirf wohi kar sakta hai jisko tag kiya gaya ho.

3) NAME CONFIRM:
/confirm tab use hota hai jab name perfect match na ho.

4) CREDIT:
Help lene aur dene ke baad credit dena 100% compulsory.

5) PAISA:
CSA sirf free help + credit system hai. Deals me paisa allowed nahi.

6) CSA DONATION CHANNEL (FUTURE):
Abhi donation open nahi hai. 
Future me CSA Army strong hone par hi ek donation channel banega.
Donation sirf CSA creators ke liye hoga.
Donation 100% optional hoga.
Jo paisa aayega:
90% direct donation,
10% sirf mehnat (video/edit/management) ke liye.

CSA creators ko uthane ke liye bana hai… girane ke liye nahi.
Welcome to CSA ❤️🔥
`,

  dealWarning: `
⚠ DEAL ACCEPTED – AB DHYAAN SE SUN

1) Ab deal lock ho chuka hai. Bot tumhari sab activity timestamp ke sath record karta hai.
2) Credit khana sabse bada paap hai. Credit doge to izzat milegi.
3) Hidden paisa doge ya loge to Army tumhare liye stand nahi legi.
4) Repeat rule-break par system khud tumhe background me uninstall kar deta hai.
5) Agar oversmart banne ka plan hai to pehle ek baar… phir 100 baar soch lena.

Sudharne wale ko Army phir se utha deti hai.
Maaf karna hum jaante hain… par hum Bhagwan nahi.
`
};
,
  nameMatchFail: `
❌ Is group me aisa exact naam match nahi mila.
Kripya sahi reply karo ya perfect spelling use karo.
  `,

  nameConfirmNeeded: `
⚠ Naam perfect match nahi tha.
Agar tum sahi creator ho, kripya type karo:
/confirm
  `,

  nameConfirmed: `
✅ Identity confirmed.
Deal safely accept kiya ja sakta hai.
  `,

  wrongAcceptor: `
❌ Yeh deal tumhare naam pe nahi tha.
Sirf jisko tag kiya gaya hai wahi accept kar sakta hai.
  `,

  groupRestriction: `
❌ Yeh command sirf CSA Agreement Group me use hoti hai.
  `,

  dealStartError: `
❌ Error: Deal start karne ke liye @mention ya reply zaroori hai.
  `,

  dealInQueue: `
⏳ Board busy hai.
Tumhara deal waiting queue me daal diya gaya hai.
Jaise hi current deal khatam hoga, tumhara auto-start ho jayega.
  `
}
,
  welcomeReply: `
CSA Bot Active.
Rules simple hain:
1) /deal se agreement start hota hai.
2) Sirf tagged user /accept karega.
3) Name match na ho to /confirm karna.
4) Credit dena compulsory.
  `,

  acceptSuccess: `
✅ Agreement Accepted.
Deal lock ho chuka hai.
  `,

  noActiveDeal: `
ℹ️ Abhi koi active deal pending nahi hai.
  `,

  confirmInstruction: `
Agar tum sahi creator ho to type karo:
/confirm
  `
}
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const {
  welcomeMessage,
  dealWarning,
  nameMatchFail,
  nameConfirmNeeded,
  nameConfirmed,
  wrongAcceptor,
  groupRestriction,
  dealStartError,
  dealInQueue,
  welcomeReply,
  acceptSuccess,
  noActiveDeal,
  confirmInstruction
} = require('./messages');

const TOKEN = process.env.BOT_TOKEN;
const GROUP_ID = process.env.AGREEMENT_GROUP_ID ? Number(process.env.AGREEMENT_GROUP_ID) : null;

const bot = new TelegramBot(TOKEN, { polling: true });

let activeDeal = null;
let waitingQueue = [];
let pendingConfirmUser = null;
let confirmTimer = null;

function getDisplayName(user) {
  if (!user) return "";
  if (user.username) return `@${user.username}`;
  if (user.first_name || user.last_name) {
    return `${user.first_name || ""} ${user.last_name || ""}`.trim();
  }
  return `${user.id}`;
}

function fuzzyMatch(name1, name2) {
  if (!name1 || !name2) return false;
  name1 = name1.toLowerCase();
  name2 = name2.toLowerCase();
  let matchCount = 0;
  const len = Math.min(name1.length, name2.length);
  for (let i = 0; i < len; i++) {
    if (name1[i] === name2[i]) matchCount++;
  }
  const score = (matchCount / len) * 100;
  return score >= 80;
}
bot.onText(/^\/deal\b/i, (msg) => {
  const chatId = msg.chat.id;

  if (GROUP_ID && chatId !== GROUP_ID) {
    return bot.sendMessage(chatId, groupRestriction);
  }

  let partner = null;
  if (msg.reply_to_message) {
    partner = msg.reply_to_message.from;
  } else if (msg.entities) {
    const mention = msg.entities.find(e => e.type === "mention" || e.type === "text_mention");
    if (mention) {
      if (mention.type === "text_mention") partner = mention.user;
      else {
        const username = msg.text.slice(mention.offset + 1, mention.offset + mention.length);
        partner = { username };
      }
    }
  }

  if (!partner) {
    return bot.sendMessage(chatId, dealStartError);
  }

  const initiator = msg.from;
  const details = msg.text.replace(/^\/deal\s*@?[^\s]+\s*/i, "").trim() || "(no details provided)";

  const newDeal = {
    initiator,
    partner,
    details,
    startTime: Date.now(),
    id: Date.now()
  };

  if (activeDeal) {
    waitingQueue.push(newDeal);
    return bot.sendMessage(chatId, dealInQueue);
  }

  activeDeal = newDeal;
  pendingConfirmUser = partner;

  const dealMsg = `
📝 *New Deal Started (ID: ${newDeal.id})*

👤 From: ${getDisplayName(initiator)}
🎯 To: ${getDisplayName(partner)}
📄 Details: ${details}

⏳ Sirf tagged user 3 minutes ke andar /accept kare.
  `;

  bot.sendMessage(chatId, dealMsg, { parse_mode: "Markdown" });

  newDeal.timer = setTimeout(() => {
    if (activeDeal && activeDeal.id === newDeal.id) {
      bot.sendMessage(chatId, "⏰ Deal expired (no /accept).");
      activeDeal = null;
      startNextDeal(chatId);
    }
  }, 3 * 60 * 1000);
});

function startNextDeal(chatId) {
  if (waitingQueue.length === 0) return;
  const next = waitingQueue.shift();
  activeDeal = next;
  pendingConfirmUser = next.partner;

  const nextMsg = `
📝 *Next Deal Auto-Started (ID: ${next.id})*

👤 From: ${getDisplayName(next.initiator)}
🎯 To: ${getDisplayName(next.partner)}
📄 Details: ${next.details}

⏳ 3 minutes ka accept window shuru.
  `;

  bot.sendMessage(chatId, nextMsg, { parse_mode: "Markdown" });

  next.timer = setTimeout(() => {
    if (activeDeal && activeDeal.id === next.id) {
      bot.sendMessage(chatId, "⏰ Deal expired (no /accept).");
      activeDeal = null;
      startNextDeal(chatId);
    }
  }, 3 * 60 * 1000);
}
bot.onText(/^\/confirm\b/i, (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;

  if (!activeDeal) {
    return bot.sendMessage(chatId, noActiveDeal);
  }

  if (!pendingConfirmUser) {
    return bot.sendMessage(chatId, "ℹ️ Confirmation required nahi hai.");
  }

  // Agar exact ID match mil gaya
  if (pendingConfirmUser.id && user.id === pendingConfirmUser.id) {
    pendingConfirmUser = null;
    return bot.sendMessage(chatId, nameConfirmed);
  }

  // Agar username match ho gaya
  if (
    pendingConfirmUser.username &&
    user.username &&
    pendingConfirmUser.username.toLowerCase() === user.username.toLowerCase()
  ) {
    pendingConfirmUser = null;
    return bot.sendMessage(chatId, nameConfirmed);
  }

  // Agar fuzzy name match 80%+ ho
  const realName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
  const targetName = `${pendingConfirmUser.first_name || ""} ${pendingConfirmUser.last_name || ""}`.trim();

  if (fuzzyMatch(realName, targetName)) {
    pendingConfirmUser = null;
    return bot.sendMessage(chatId, nameConfirmed);
  }

  // Sab fail
  bot.sendMessage(chatId, nameMatchFail);
});
bot.onText(/^\/accept\b/i, (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;

  if (!activeDeal) {
    return bot.sendMessage(chatId, noActiveDeal);
  }

  const partner = activeDeal.partner;

  // 1. Exact ID match
  if (partner.id && user.id === partner.id) {
    return finalizeAccept(chatId, user);
  }

  // 2. Exact username match
  if (
    partner.username &&
    user.username &&
    partner.username.toLowerCase() === user.username.toLowerCase()
  ) {
    return finalizeAccept(chatId, user);
  }

  // 3. Fuzzy match names
  const userName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
  const partnerName = `${partner.first_name || ""} ${partner.last_name || ""}`.trim();

  if (fuzzyMatch(userName, partnerName)) {
    pendingConfirmUser = partner;
    return bot.sendMessage(chatId, nameConfirmNeeded);
  }

  // 4. Perfect match nahi → confirm required
  pendingConfirmUser = partner;
  return bot.sendMessage(chatId, confirmInstruction);
});

function finalizeAccept(chatId, user) {
  if (pendingConfirmUser) {
    // Identity not yet confirmed
    return bot.sendMessage(chatId, nameConfirmNeeded);
  }

  const msg = `
${acceptSuccess}

${dealWarning}

📌 *Deal ID:* ${activeDeal.id}
📄 *Details:* ${activeDeal.details}

👤 From: ${getDisplayName(activeDeal.initiator)}
🎯 To: ${getDisplayName(user)}
  `;

  bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });

  clearTimeout(activeDeal.timer);
  activeDeal = null;
  startNextDeal(chatId);
}
bot.onText(/^\/cancel\b/i, (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;

  if (!activeDeal) {
    return bot.sendMessage(chatId, noActiveDeal);
  }

  const isInitiator = user.id === activeDeal.initiator.id;
  const isPartner = activeDeal.partner.id && user.id === activeDeal.partner.id;

  if (!isInitiator && !isPartner) {
    return bot.sendMessage(chatId, wrongAcceptor);
  }

  clearTimeout(activeDeal.timer);

  const cancelMsg = `
⚠️ *Deal Canceled*  
👤 By: ${getDisplayName(user)}
📄 Details: ${activeDeal.details}
  `;

  bot.sendMessage(chatId, cancelMsg, { parse_mode: "Markdown" });

  activeDeal = null;
  pendingConfirmUser = null;

  startNextDeal(chatId);
});

// /start greeting
bot.onText(/^\/start\b/i, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, welcomeReply, {
    parse_mode: "Markdown"
  });
});

// Bot running log
console.log("CSA AI Judge Bot Running...");
