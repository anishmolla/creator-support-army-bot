/**
 * Time Engine for Creator Support Army Bot
 * ------------------------------------------------------------
 * - Telegram date → ISO time conversion
 * - Unix now function
 * - Countdown formatter
 * - Expiry checker
 */

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

// Convert Telegram timestamp (seconds) to ISO string
function tgToIso(tgSeconds) {
  return new Date(tgSeconds * 1000).toISOString();
}

// Format seconds (remaining timer)
function formatTimer(sec) {
  if (sec <= 0) return "0s";
  const m = Math.floor(sec / 60);
  const s = sec % 60;

  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

// Check if expired
function isExpired(expiresAtUnix) {
  return nowUnix() >= expiresAtUnix;
}

module.exports = {
  nowUnix,
  tgToIso,
  formatTimer,
  isExpired
};
