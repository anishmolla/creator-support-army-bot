function getDisplayName(user) {
  if (user.username)
    return '@' + user.username;

  let name = user.first_name || '';
  if (user.last_name) name += ' ' + user.last_name;

  return name.trim() || 'Unknown User';
}

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

let fetch = null;
try {
  fetch = require('node-fetch');
} catch (e) {
  console.log('AI Judge: node-fetch not found, AI judge disabled.');
}

// Environment
const TOKEN = process.env.BOT_TOKEN;
const AGREEMENT_GROUP_ID = process.env.AGREEMENT_GROUP_ID
  ? Number(process.env.AGREEMENT_GROUP_ID)
  : null;

const GROK_KEY = process.env.GROK_KEY || null;
const GROK_API_URL = process.env.GROK_API_URL || 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = process.env.GROK_MODEL || 'grok-beta';

if (!TOKEN) {
  console.error('ERROR: BOT_TOKEN not set in .env');
  process.exit(1);
}

// Bot init
const bot = new TelegramBot(TOKEN, { polling: true });

/**
 * State structure:
 * chats[chatId] = {
 *   activeAgreement,
 *   waitingQueue: [],
 *   lastAgreementId: number
 * }
 *
 * pendingNameConfirms[chatId] = {
 *   agreementId,
 *   userId,
 *   expiresAt
 * }
 */
const chats = {};
const pendingNameConfirms = {};

function getChatState(chatId) {
  if (!chats[chatId]) {
    chats[chatId] = {
      activeAgreement: null,
      waitingQueue: [],
      lastAgreementId: 0
    };
  }
  return chats[chatId];
}

function nextAgreementId(chatState) {
  chatState.lastAgreementId += 1;
  return chatState.lastAgreementId;
}

function userDisplay(user) {
  if (!user) return 'Unknown';
  if (user.username) return '@' + user.username;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  if (name.trim()) return name.trim();
  return String(user.id);
}

function normalizeName(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function namesMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * Activate an agreement for a chat (start 3-minute timer)
 */
function activateAgreement(chatId, agreement) {
  const chatState = getChatState(chatId);

  // Clear any pending name confirmation for this chat
  delete pendingNameConfirms[chatId];

  chatState.activeAgreement = agreement;

  const { initiator, partnerUsername, partnerId, partnerNameText, details, id, createdAt } =
    agreement;

  let partnerTag = 'selected member';
  if (partnerUsername) {
    partnerTag = '@' + partnerUsername;
  } else if (partnerNameText) {
    partnerTag = partnerNameText;
  } else if (partnerId) {
    partnerTag = `[user id: ${partnerId}]`;
  }

  const createdAtStr = new Date(createdAt).toLocaleTimeString();

  bot.sendMessage(
    chatId,
    [
      `📝 *New Agreement Started* (ID: ${id})`,
      '',
      `👤 *From:* ${userDisplay(initiator)}`,
      `🎯 *To:* ${partnerTag}`,
      `📄 *Details:* ${details}`,
      '',
      `⏳ *Rule:* Sirf ${partnerTag} hi 3 minute ke andar /accept kar sakta hai.`,
      `🕒 Started at: ${createdAtStr}`
    ].join('\n'),
    { parse_mode: 'Markdown' }
  );

  // 3-minute expiry
  agreement.timer = setTimeout(() => {
    const st = getChatState(chatId);
    if (!st.activeAgreement) return;
    if (st.activeAgreement.id === agreement.id && st.activeAgreement.status === 'pending') {
      st.activeAgreement.status = 'expired';
      st.activeAgreement = null;
      delete pendingNameConfirms[chatId];

      bot.sendMessage(
        chatId,
        [
          `⏰ *Agreement Expired* (ID: ${agreement.id})`,
          '',
          `3 minute ke andar /accept nahi aaya.`,
          `Deal ab *canceled* hai. Naya /deal create kar sakte ho.`
        ].join('\n'),
        { parse_mode: 'Markdown' }
      );

      activateNextFromQueue(chatId);
    }
  }, 3 * 60 * 1000);
}

function activateNextFromQueue(chatId) {
  const chatState = getChatState(chatId);
  if (chatState.activeAgreement) return;
  const next = chatState.waitingQueue.shift();
  if (!next) return;
  activateAgreement(chatId, next);
}

/**
 * Parse target user of /deal:
 *  - Prefer reply_to_message → exact member in group
 *  - Or @username / text_mention
 *  - If nothing → return null (no such member)
 */
function parseDealTarget(msg) {
  const entities = msg.entities || [];
  let partnerId = null;
  let partnerUsername = null;
  let partnerNameText = null;

  // 1) Prefer reply_to_message (most accurate, no username needed)
  if (msg.reply_to_message && msg.reply_to_message.from) {
    const u = msg.reply_to_message.from;
    partnerId = u.id;
    partnerUsername = u.username || null;
    partnerNameText = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    if (!partnerNameText) {
      partnerNameText = partnerUsername || String(u.id);
    }
    return { partnerId, partnerUsername, partnerNameText };
  }

  // 2) text_mention (Telegram attaches real user to entity)
  const textMentionEntity = entities.find((e) => e.type === 'text_mention');
  if (textMentionEntity && textMentionEntity.user) {
    const u = textMentionEntity.user;
    partnerId = u.id;
    partnerUsername = u.username || null;
    partnerNameText = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    if (!partnerNameText) {
      partnerNameText = partnerUsername || String(u.id);
    }
    return { partnerId, partnerUsername, partnerNameText };
  }

  // 3) @username mention (we only know username; Telegram will route it correctly)
  const mentionEntity = entities.find((e) => e.type === 'mention');
  if (mentionEntity) {
    const text = msg.text || '';
    const mentionText = text.slice(
      mentionEntity.offset,
      mentionEntity.offset + mentionEntity.length
    );
    if (mentionText.startsWith('@')) {
      partnerUsername = mentionText.slice(1);
      partnerNameText = '@' + partnerUsername;
      return { partnerId: null, partnerUsername, partnerNameText };
    }
  }

  // 4) No proper target
  return null;
}

/**
 * Parse entire /deal message → { partner..., details }
 */
function parseDeal(msg) {
  const text = msg.text || '';
  const target = parseDealTarget(msg);
  if (!target) return null;

  // Remove "/deal" and optional bot username
  let details = text.replace(/^\/deal(@\w+)?\s*/i, '');

  if (target.partnerUsername) {
    const re = new RegExp('@' + target.partnerUsername + '\\b', 'i');
    details = details.replace(re, '');
  }

  details = details.trim();
  if (!details) {
    details = '(no extra details provided)';
  }

  return {
    partnerId: target.partnerId,
    partnerUsername: target.partnerUsername,
    partnerNameText: target.partnerNameText,
    details
  };
}

/**
 * AI Judge – call Grok (if configured)
 */
async function runAiJudge(chatId, agreement, acceptUser) {
  if (!fetch || !GROK_KEY) return;

  const initiatorName = userDisplay(agreement.initiator);
  const acceptName = userDisplay(acceptUser);
  const details = agreement.details;

  const prompt = [
    'Tum ek fair judge ho jo YouTube creators ke beech deal ko judge karta hai.',
    'Deal details:',
    `- From: ${initiatorName}`,
    `- To (accept): ${acceptName}`,
    `- Text: "${details}"`,
    '',
    'Ek hi line me short Hindi + thoda emoji me bolo:',
    '1) Deal roughly fair hai ya unfair?',
    '2) Agar koi dikkat ho sakti hai to 1 short hint do.'
  ].join('\n');

  try {
    const res = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROK_KEY}`
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [
          { role: 'system', content: 'You are a short, direct fairness judge for creator deals.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 120
      })
    });

    if (!res.ok) {
      console.error('AI Judge HTTP error:', res.status, await res.text().catch(() => ''));
      return;
    }

    const data = await res.json();
    const text =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      (data.choices[0].message.content || '').trim();

    if (text) {
      bot.sendMessage(
        chatId,
        `🤖 *AI Judge:* ${text}`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (err) {
    console.error('AI Judge error:', err.message || err);
  }
}

/**
 * Finalize accept
 */
function finalizeAccept(chatId, active, acceptUser) {
  const chatState = getChatState(chatId);

  active.status = 'accepted';
  if (active.timer) clearTimeout(active.timer);
  chatState.activeAgreement = null;
  delete pendingNameConfirms[chatId];

  bot.sendMessage(
    chatId,
    [
      `✅ *Agreement Approved* (ID: ${active.id})`,
      '',
      `👤 *From:* ${userDisplay(active.initiator)}`,
      `🎯 *To:* ${userDisplay(acceptUser)}`,
      `📄 *Details:* ${active.details}`,
      '',
      `🔒 Deal ab *lock* ho chuka hai.`,
      `AI Judge thodi der me opinion de sakta hai (agar enabled hai).`
    ].join('\n'),
    { parse_mode: 'Markdown' }
  );

  // Run AI judge (non-blocking)
  runAiJudge(chatId, active, acceptUser).catch(() => {});

  // Next in queue
  activateNextFromQueue(chatId);
}

// ----------------------
// Command handlers
// ----------------------

bot.onText(/^\/start(?:@\w+)?/, (msg) => {
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';

  if (isPrivate) {
    const text =
      'Namaste! Main *Creator Support Army – Agreement Court* system hoon.\n\n' +
      'Group me use:\n' +
      '1) Kisi message ko *reply* karke:\n' +
      '   `/deal 3 thumbnail ke badle 1 music track`\n\n' +
      '2) Ya @username ke saath:\n' +
      '   `/deal @username details...`\n\n' +
      'Sirf jisko tag kiya gaya hai, wahi 3 minute ke andar `/accept` kar sakta hai.';
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } else {
    const text =
      '*CSA Agreement Court* active hai.\n\n' +
      'Deal banane ke liye:\n' +
      '• Kisi creator ka message reply karo:\n' +
      '  `/deal 3 thumbnail ke badle 1 music track`\n' +
      '• Ya @username ke saath:\n' +
      '  `/deal @username details...`\n';
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }
});

// /deal
bot.onText(/^\/deal(?:@\w+)?\b/i, (msg) => {
  const chatId = msg.chat.id;

  if (AGREEMENT_GROUP_ID && chatId !== AGREEMENT_GROUP_ID) {
    // Restricted to one group
    return;
  }

  if (msg.chat.type === 'private') {
    return bot.sendMessage(
      chatId,
      '❌ Agreements sirf group me ban sakte hain.\n' +
        'Mujhe apne Creator Support Army agreement group me add karo.',
      { parse_mode: 'Markdown' }
    );
  }

  const chatState = getChatState(chatId);
  const parsed = parseDeal(msg);

  if (!parsed) {
    return bot.sendMessage(
      chatId,
      [
        '❌ *Error:* Jis naam se aap deal karna chahte ho, usko bot nahi dhoondh pa raha.',
        '',
        'Is group me aisa koi member dikh nahi raha *kyunki aapne sirf name likha*,',
        'reply ya proper @tag nahi kiya.',
        '',
        '✅ Sahi tareeka:',
        '1) Jis bande se deal karni hai, *uske message pe reply karo*:',
        '   `/deal 3 thumbnail ke badle 1 music track`',
        '',
        '2) Ya agar uska @username hai:',
        '   `/deal @username 3 thumbnail ke badle 1 music track`'
      ].join('\n'),
      { parse_mode: 'Markdown' }
    );
  }

  const initiator = msg.from;
  const newId = nextAgreementId(chatState);
  const now = Date.now();

  const agreement = {
    id: newId,
    chatId,
    initiator,
    initiatorId: initiator.id,
    partnerId: parsed.partnerId,
    partnerUsername: parsed.partnerUsername,
    partnerNameText: parsed.partnerNameText,
    details: parsed.details,
    createdAt: now,
    status: 'pending',
    timer: null
  };

  if (chatState.activeAgreement && chatState.activeAgreement.status === 'pending') {
    chatState.waitingQueue.push(agreement);
    return bot.sendMessage(
      chatId,
      [
        '⏳ Board Busy: Ek aur agreement already 3-minute window me wait kar raha hai.',
        '',
        `Aapka deal (ID: ${newId}) *waiting queue* me daal diya gaya hai.`,
        'Jaise hi current deal khatam hoga, aapka deal auto-start ho jaega.'
      ].join('\n'),
      { parse_mode: 'Markdown' }
    );
  }

  activateAgreement(chatId, agreement);
});

// /accept
bot.onText(/^\/accept(?:@\w+)?\b/i, (msg) => {
  const chatId = msg.chat.id;

  if (AGREEMENT_GROUP_ID && chatId !== AGREEMENT_GROUP_ID) {
    return;
  }

  const chatState = getChatState(chatId);
  const active = chatState.activeAgreement;

  if (!active || active.status !== 'pending') {
    return bot.sendMessage(
      chatId,
      'ℹ️ Abhi koi active pending agreement nahi hai jise /accept kiya ja sake.',
      { parse_mode: 'Markdown' }
    );
  }

  const user = msg.from;

  const strictById = active.partnerId && user.id === active.partnerId;
  const strictByUsername =
    active.partnerUsername &&
    user.username &&
    user.username.toLowerCase() === active.partnerUsername.toLowerCase();

  const userNameText =
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
    (user.username ? '@' + user.username : String(user.id));

  const fuzzyName =
    !strictById && !strictByUsername && namesMatch(active.partnerNameText, userNameText);

  if (!strictById && !strictByUsername && !fuzzyName) {
    return bot.sendMessage(
      chatId,
      '❌ Yeh deal kisi aur ke naam se create hua tha.\n' +
        'Sirf jisko tag / reply kiya gaya hai, *wahi* /accept kar sakta hai.',
      { parse_mode: 'Markdown' }
    );
  }

  // Strict match → direct accept
  if (strictById || strictByUsername) {
    return finalizeAccept(chatId, active, user);
  }

  // Fuzzy name match → need /confirm
  const now = Date.now();
  pendingNameConfirms[chatId] = {
    agreementId: active.id,
    userId: user.id,
    expiresAt: now + 60 * 1000
  };

  bot.sendMessage(
    chatId,
    [
      '⚠️ *Name Match Check*',
      '',
      `Deal me naam: *${active.partnerNameText || '(unknown)'}*`,
      `Tumhara naam: *${userNameText}*`,
      '',
      'Lagta hai dono naam milte-julte hain, par 100% sure hone ke liye:',
      '👉 Agar tum hi original creator ho, to *60 second ke andar* `/confirm` bhejo.',
      '',
      'Agar `/confirm` nahi aaya to yeh /accept ignore ho jaega.'
    ].join('\n'),
    { parse_mode: 'Markdown' }
  );
});

// /confirm – for fuzzy name cases
bot.onText(/^\/confirm\b/i, (msg) => {
  const chatId = msg.chat.id;

  const pending = pendingNameConfirms[chatId];
  if (!pending) {
    return bot.sendMessage(
      chatId,
      'ℹ️ Abhi koi pending name confirmation nahi hai.',
      { parse_mode: 'Markdown' }
    );
  }

  if (pending.userId !== msg.from.id) {
    return bot.sendMessage(
      chatId,
      '❌ Yeh `/confirm` kisi aur ke liye pending tha.',
      { parse_mode: 'Markdown' }
    );
  }

  const now = Date.now();
  if (now > pending.expiresAt) {
    delete pendingNameConfirms[chatId];
    return bot.sendMessage(
      chatId,
      '⏰ `/confirm` ka time (60 second) khatam ho chuka hai.',
      { parse_mode: 'Markdown' }
    );
  }

  const chatState = getChatState(chatId);
  const active = chatState.activeAgreement;

  if (!active || active.id !== pending.agreementId || active.status !== 'pending') {
    delete pendingNameConfirms[chatId];
    return bot.sendMessage(
      chatId,
      'ℹ️ Jis deal ke liye confirmation tha, woh ab active nahi hai.',
      { parse_mode: 'Markdown' }
    );
  }

  delete pendingNameConfirms[chatId];
  finalizeAccept(chatId, active, msg.from);
});

// /cancel
bot.onText(/^\/cancel(?:@\w+)?\b/i, (msg) => {
  const chatId = msg.chat.id;

  if (AGREEMENT_GROUP_ID && chatId !== AGREEMENT_GROUP_ID) {
    return;
  }

  const chatState = getChatState(chatId);
  const active = chatState.activeAgreement;

  if (!active || active.status !== 'pending') {
    return bot.sendMessage(
      chatId,
      'ℹ️ Abhi koi pending active agreement nahi hai jise cancel kiya ja sake.',
      { parse_mode: 'Markdown' }
    );
  }

  const user = msg.from;
  const isInitiator = user.id === active.initiatorId;
  const isPartnerById = active.partnerId && user.id === active.partnerId;
  const isPartnerByUsername =
    active.partnerUsername &&
    user.username &&
    user.username.toLowerCase() === active.partnerUsername.toLowerCase();

  if (!isInitiator && !isPartnerById && !isPartnerByUsername) {
    return bot.sendMessage(
      chatId,
      '❌ Sirf deal banane wala ya jisko tag kiya gaya hai, wahi /cancel kar sakta hai.',
      { parse_mode: 'Markdown' }
    );
  }

  active.status = 'canceled';
  if (active.timer) clearTimeout(active.timer);
  chatState.activeAgreement = null;
  delete pendingNameConfirms[chatId];

  bot.sendMessage(
    chatId,
    [
      `⚠️ *Agreement Canceled* (ID: ${active.id})`,
      '',
      `Canceled by: ${userDisplay(user)}`,
      '',
      'Details:',
      active.details,
      '',
      'Waiting queue (agar hai) se next deal ab start ho sakta hai.'
    ].join('\n'),
    { parse_mode: 'Markdown' }
  );

  activateNextFromQueue(chatId);
});

// Error log
bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message || err);
});

console.log('CSA AI Judge Agreement Court running...');

bot.onText(/^\/test_join\b/i, (msg) => {
  const chatId = msg.chat.id;

  const fakeUser = {
    id: msg.from.id,
    first_name: msg.from.first_name,
    last_name: msg.from.last_name || "",
    username: msg.from.username || null
  };

  const welcomeMsg = `
👋 *Welcome (Test Mode)*  
User: ${getDisplayName(fakeUser)}

${welcomeMessage}
  `;

  bot.sendMessage(chatId, welcomeMsg, { parse_mode: "Markdown" });
});

const welcomeMessage = `
👋 Welcome to Creator Support Army!

Yah ek creator-to-creator support system hai.
Yahan deal banane, confirm karne, aur fair work karne ke rules simple hain:

• Kisi message ko reply karke:
  /deal 3 thumbnail ke badle 1 music track

• Ya @username ke saath:
  /deal @username details...

• Sirf jisko tag kiya gaya hai, wahi 3 minute ke andar /accept kar sakta hai.

Rules:
- Cheating, paisa demand, ya deal todna allowed nahi.
- Agar kisi ne rule toda, pura group ek saath report karega.
- Hum sab growth ke liye aaye hain, fight ke liye nahi.

Donation Info:
Abhi donation OFF hai.
Future me ek charity channel banega jisme creators milkar logon ki help karenge.

Enjoy & grow together!
`;

const app = express();

app.get('/', (req, res) => {
  res.send('CSA Agreement Court bot is running ✅');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HTTP health server listening on port ${PORT}`);
});
