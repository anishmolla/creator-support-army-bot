/**
 * AI Client for Grok / LLM API
 * Very small wrapper — safe, reusable, minimal.
 */

const axios = require("axios");

async function callAI(systemPrompt, userPrompt) {
  try {
    const res = await axios.post(
      process.env.GROK_API_URL,
      {
        model: process.env.GROK_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.GROK_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return res.data.choices[0].message.content.trim();
  } catch (err) {
    console.error("AI Error:", err?.response?.data || err);
    return "AI_ERROR";
  }
}

module.exports = { callAI };
