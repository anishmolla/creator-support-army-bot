/**
 * AI–powered deal analyzer
 * Converts user deal into structured RESULT
 */

const { aiJudge } = require("./engine");
const { cleanDealText } = require("./formatter");

async function analyzeDeal(raw) {
  const cleaned = cleanDealText(raw);

  const query = `
  Analyze the following Creator Support Army deal text.
  Output must be in strict JSON only.
  {
    "summary": "",
    "risk": "",
    "clarity": "",
    "flags": []
  }

  Deal: "${cleaned}"
  `;

  const result = await aiJudge(query);

  try {
    return JSON.parse(result);
  } catch {
    return {
      summary: cleaned,
      risk: "unknown",
      clarity: "unknown",
      flags: ["parse_error"]
    };
  }
}

module.exports = { analyzeDeal };
