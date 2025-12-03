require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.BOT_TOKEN;
const AGREEMENT_GROUP_ID = process.env.AGREEMENT_GROUP_ID
  ? Number(process.env.AGREEMENT_GROUP_ID)
  : null;

if (!TOKEN) {
  console.error('ERROR: BOT_TOKEN not set in .env file.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

/**
 * In-memory state:
 * chats[chatId] = {
 *   activeAgreement: { ... },
 *   waitingQueue:    [ ... ],
 *   lastAgreementId: number
 * }
 */
const chats = {};

function getChatState(chatId) {
  if (!chats[chatId]) {
    chats[chatId] = {
      activeAgreement: null,
      waitingQueue: [],
      lastAgreementId: 0,
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
  if (user.username) return `@${user.username}`;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return name || String(user.id);
}

/**
 * Normalise string for fuzzy name matching:
 * - lowercase
 * - remove all non a-z 0-9
 */
function normalizeName(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Fuzzy match between partnerUsername (from /deal text)
 * and real Telegram display name (first_name + last_name).
 * Example:
 *   partnerUsername: "AnishMolla"
 *   user name:       "Anish Molla"
 * → both become "anishmolla" → match.
 */
function approxNameMatch(partnerUsername, user) {
  if (!partnerUsername || !user) return false;

  const candidate = normalizeName(partnerUsername);
  const fullName = normalizeName(
    `${user.first_name || ''}${user.last_name || ''}`
  );

  if (!candidate || !fullName) return false;

  if (candidate === fullName) return true;

  // Thoda loose rule: agar ek dusre ko contain kare
  if (
    candidate.length >= 4 &&
    (candidate.includes(fullName) || fullName.includes(candidate))
  ) {
    return true;
  }

  return false;
}

function activateAgreement(chatId, agreement) {
  const chatState = getChatState(chatId);
  chatState.activeAgreement = agreement;

  const { initiator, partnerUsername, partnerId, details, id, createdAt } =
    agreement;

  const partnerTag = partnerUsername
    ? `@${partnerUsername}`
    : partnerId
    ? `[user id: ${partnerId}]`
    : 'tagged user';

  const createdAtStr = new Date(createdAt).toLocaleTimeString();

  const text =
    `📝 *Agreement Started* (ID: ${id})\n\n` +
    `👤 *From:* ${userDisplay(initiator)}\n` +
    `🎯 *To:* ${partnerTag}\n` +
    `📄 *Details:* ${details}\n\n` +
    `⏳ *Rule:* Sirf ${partnerTag} hi *3 minutes* ke andar /accept kar sakta hai.\n` +
    `🕒 Started at: ${createdAtStr}`;

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

  // 3 minute ke baad expire
  agreement.timer = setTimeout(() => {
    const st = getChatState(chatId);
    if (!st.activeAgreement) return;

    if (
      st.activeAgreement.id === agreement.id &&
      st.activeAgreement.status === 'pending'
    ) {
      st.activeAgreement.status = 'expired';
      st.activeAgreement = null;

      const msg =
        `⏰ *Agreement Expired* (ID: ${agreement.id})\n` +
        `3 minutes ke andar /accept nahi aaya.\n\n` +
        `Deal ab *canceled* hai. Naya /deal create kar sakte ho.`;

      bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });

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
 * Parse /deal message:
 * - partner via reply, text_mention, or @username mention
 * - remaining text = details
 */
function parseDealMessage(msg) {
  const text = msg.text || '';
  const entities = msg.entities || [];

  let partnerUsername = null;
  let partnerId = null;

  // 1) reply target (sabse strong proof)
  if (msg.reply_to_message && msg.reply_to_message.from) {
    partnerId = msg.reply_to_message.from.id;
    partnerUsername = msg.reply_to_message.from.username || null;
  } else {
    // 2) entity based mention
    const textMentionEntity = entities.find(
      (e) => e.type === 'text_mention' && e.user
    );
    const mentionEntity = entities.find((e) => e.type === 'mention');

    if (textMentionEntity && textMentionEntity.user) {
      partnerId = textMentionEntity.user.id;
      partnerUsername = textMentionEntity.user.username || null;
    } else if (mentionEntity) {
      const mentionText = text.slice(
        mentionEntity.offset,
        mentionEntity.offset + mentionEntity.length
      );
      if (mentionText.startsWith('@')) {
        partnerUsername = mentionText.slice(1);
      }
    }
  }

  // details = /deal + optional @ + baaki text
  let details = text.replace(/^\/deal(@\w+)?\s*/i, '');
  if (partnerUsername) {
    const re = new RegExp('@' + partnerUsername + '\\b', 'i');
    details = details.replace(re, '');
  }
  details = details.trim();
  if (!details) details = '(no extra details provided)';

  return { partnerUsername, partnerId, details };
}

// ----------------- COMMAND HANDLERS -----------------

bot.onText(/^\/start(?:@\w+)?/, (msg) => {
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';

  if (isPrivate) {
    const text =
      'Namaste! Main *CSA Agreement Court* bot hoon. 🤝\n\n' +
      'Group mein creators /deal command se apne agreements lock kar sakte hai.\n\n' +
      '*Example:*\n' +
      '`/deal @username 3 thumbnails ke badle 1 music track`\n\n' +
      'Reply-based deal bhi kar sakte ho:\n' +
      '1. Unke message par reply karo\n' +
      '2. Type karo: `/deal full details yahan...`';
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } else {
    const text =
      '*CSA Agreement Court Active.* ⚖️\n\n' +
      'Use: `/deal @user details...`\n' +
      'Sirf tagged user 3 minutes ke andar `/accept` kar sakta hai.\n' +
      'Cancel: `/cancel`';
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }
});

// /deal
bot.onText(/^\/deal(?:@\w+)?\b/i, (msg) => {
  const chatId = msg.chat.id;

  if (AGREEMENT_GROUP_ID && chatId !== AGREEMENT_GROUP_ID) {
    // restricted to one group
    return;
  }

  if (msg.chat.type === 'private') {
    const text =
      '❌ Agreements sirf *group* mein create ho sakte hain.\n' +
      'Mujhe apne *Creator Support Army* group mein add karo.';
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    return;
  }

  const chatState = getChatState(chatId);
  const { partnerUsername, partnerId, details } = parseDealMessage(msg);

  if (!partnerUsername && !partnerId) {
    const text =
      '❌ *Error:* Aapko jis creator ke saath deal karni hai, usko tag ya reply karna zaroori hai.\n\n' +
      '*Do options:*\n' +
      '1️⃣ Unke message par reply karo aur likho:\n' +
      '`/deal 3 thumbnails ke badle 1 music track`\n\n' +
      '2️⃣ Ya agar unka @username hai to:\n' +
      '`/deal @username 3 thumbnails ke badle 1 music track`';
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    return;
  }

  const initiator = msg.from;
  const newId = nextAgreementId(chatState);
  const now = Date.now();

  const agreement = {
    id: newId,
    chatId,
    initiator,
    initiatorId: initiator.id,
    partnerId: partnerId || null,
    partnerUsername: partnerUsername || null,
    details,
    createdAt: now,
    status: 'pending',
    timer: null,
  };

  if (chatState.activeAgreement && chatState.activeAgreement.status === 'pending') {
    chatState.waitingQueue.push(agreement);
    const text =
      '⏳ *Board Busy:* Ek aur agreement pending hai.\n\n' +
      `Aapka deal (ID: ${newId}) ab *waiting queue* mein hai.\n` +
      'Jaise hi current deal khatam hoga, aapka deal auto-start ho jaega.';
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    return;
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
    bot.sendMessage(chatId, 'ℹ️ Abhi koi active pending agreement nahi hai.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  const user = msg.from;

  const isPartnerById =
    active.partnerId && user.id === active.partnerId;

  const isPartnerByUsername =
    active.partnerUsername &&
    user.username &&
    user.username.toLowerCase() === active.partnerUsername.toLowerCase();

  const isPartnerByNameApprox = approxNameMatch(
    active.partnerUsername,
    user
  );

  if (!isPartnerById && !isPartnerByUsername && !isPartnerByNameApprox) {
    const text =
      '❌ *Only the tagged user may* `/accept`.\n\n' +
      'Agar aap hi partner ho lekin @username set nahi hai, to best hai:\n' +
      '1️⃣ Deal reply-based karo (unke message par reply karke `/deal ...`)\n' +
      '2️⃣ Ya apna Telegram @username set kar lo.';
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    return;
  }

  const now = Date.now();
  const elapsedMs = now - active.createdAt;

  if (elapsedMs > 3 * 60 * 1000) {
    active.status = 'expired';
    if (active.timer) clearTimeout(active.timer);
    chatState.activeAgreement = null;

    bot.sendMessage(
      chatId,
      '⏰ *Too Late:* 3 minutes se zyada ho gaye. Agreement auto-expire ho chuka hai.',
      { parse_mode: 'Markdown' }
    );
    activateNextFromQueue(chatId);
    return;
  }

  active.status = 'accepted';
  if (active.timer) clearTimeout(active.timer);
  chatState.activeAgreement = null;

  const via =
    isPartnerById || isPartnerByUsername
      ? ''
      : '\n\n⚠️ Accepted via *name match* (username nahi tha). Future deals ke liye reply-based ya @username use karna better hai.';

  const text =
    `✅ *Agreement Approved* (ID: ${active.id})\n\n` +
    `👤 *From:* ${userDisplay(active.initiator)}\n` +
    `🎯 *To:* ${userDisplay(user)}\n` +
    `📄 *Details:* ${active.details}\n\n` +
    `⏱ Accepted within 3 minutes. Deal ab *locked & recorded* hai.${via}`;

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

  activateNextFromQueue(chatId);
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
    bot.sendMessage(
      chatId,
      'ℹ️ Abhi koi pending active agreement nahi hai jise /cancel kiya ja sake.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const user = msg.from;

  const isInitiator = user.id === active.initiatorId;
  const isPartnerById = active.partnerId && user.id === active.partnerId;
  const isPartnerByUsername =
    active.partnerUsername &&
    user.username &&
    user.username.toLowerCase() === active.partnerUsername.toLowerCase();

  if (!isInitiator && !isPartnerById && !isPartnerByUsername) {
    bot.sendMessage(
      chatId,
      '❌ Sirf initiator ya tagged partner hi `/cancel` kar sakta hai.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  active.status = 'canceled';
  if (active.timer) clearTimeout(active.timer);
  chatState.activeAgreement = null;

  const text =
    `⚠️ *Agreement Canceled* (ID: ${active.id})\n\n` +
    `Canceled by: ${userDisplay(user)}\n` +
    `Details the:\n${active.details}\n\n` +
    'Waiting queue (agar hai) se next deal ab start ho sakta hai.';

  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

  activateNextFromQueue(chatId);
});

// Error logging
bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message || err);
});

console.log('CSA Agreement Court System Running...');
