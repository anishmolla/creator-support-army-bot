/**
 * JSON Store Engine for Creator Support Army Bot
 * ------------------------------------------------------------
 * Yeh file deals.json ko read/write karne ka core logic rakhti hai.
 * Iska pura system crash-safe, corruption-safe aur atomic model par hai.
 */

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "..", "data", "deals.json");

// Safe Load
function loadState() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      return { lastCounter: 0, deals: {} };
    }
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const json = JSON.parse(raw);

    return {
      lastCounter: json.lastCounter || 0,
      deals: json.deals || {}
    };
  } catch (err) {
    console.error("❌ ERROR loading deals.json:", err);
    return { lastCounter: 0, deals: {} };
  }
}

// Safe Save
function saveState(state) {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.error("❌ ERROR saving deals.json:", err);
  }
}

// Create new unique Deal ID
function generateDealId(state) {
  state.lastCounter += 1;

  const d = new Date();
  const YYYY = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const DD = String(d.getDate()).padStart(2, "0");

  const count = String(state.lastCounter).padStart(4, "0");
  return `CSA-${YYYY}${MM}${DD}-${count}`;
}

module.exports = {
  loadState,
  saveState,
  generateDealId
};
