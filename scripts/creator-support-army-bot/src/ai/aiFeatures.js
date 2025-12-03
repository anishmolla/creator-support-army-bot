/**
 * AI Features for CSA Court
 * Summaries, rule explanation, clarity improve
 */

const { callAI } = require("./aiClient");

async function summarizeDeal(details) {
  const sys = "You are CSA AI JUDGE. Always be short, clean and structured.";
  const usr = `Summarize this deal in clean Hindi: "${details}". Make it 1 paragraph.`;

  return await callAI(sys, usr);
}

async function explainRules() {
  const sys = "You are CSA AI JUDGE. Explain rules like a calm judge.";
  const usr = `
  Explain CSA Court rules in simple Hindi:
  - Deal Lock
  - 3-minute accept rule
  - Queue system
  - Cancel rules
  Short and clean.`;

  return await callAI(sys, usr);
}

async function detectScam(details) {
  const sys = "You are CSA AI JUDGE. Identify risks.";
  const usr = `
  Check this deal for scam or suspicious behaviour.
  Output: High risk / Medium risk / Low risk.
  Deal: "${details}"
  `;

  return await callAI(sys, usr);
}

module.exports = {
  summarizeDeal,
  explainRules,
  detectScam
};
