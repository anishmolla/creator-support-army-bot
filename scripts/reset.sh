#!/data/data/com.termux/files/usr/bin/bash

cd "$(dirname "$0")/.."

echo "⚠️  Resetting all deal data..."
rm -f data/deals.json

cat > data/deals.json << 'EOT'
{
  "lastCounter": 0,
  "deals": {}
}
EOT

echo "✅ All deals reset successfully."
