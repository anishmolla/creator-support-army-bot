/**
 * CSA AI Judge – Grok Integration Brain
 * Handles: reasoning, summary, formatting, scam-check
 */

const axios = require("axios");
const GROK_API = "https://api.x.ai/v1/chat/completions";

async function aiJudge(prompt) {
  try {
    const res = await axios.post(
      GROK_API,
      {
        model: "grok-beta",
        messages: [
          { role: "system", content: "You are CSA_AI_JUDGE. Speak short, clear, structured." },
          { role: "user", content: prompt }
        ]
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.GROK_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return res.data.choices[0].message.content;
  } catch (err) {
    console.error("AI ERROR:", err?.response?.data || err);
    return "AI_JUDGE_ERROR";
  }
}

module.exports = { aiJudge };
