/**
 * Simple text cleaning, formatting
 */

function cleanDealText(text) {
  return text
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { cleanDealText };
