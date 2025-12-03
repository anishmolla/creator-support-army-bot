# Creator Support Army – Agreement Board Bot

This bot runs the official **Agreement Board** system for the Creator Support Army.

It controls:
- /deal  → Deal request start  
- 3-minute lock → Only tagged user can accept  
- Waiting queue system  
- /accept → Approve deal  
- /cancel → Cancel deal  
- One deal active at a time  
- Queue auto-rotation  

This version contains **Agreement System only**.  
Proof board, serial numbers, strike system, punishment logic  
→ will be added later as separate modules.

---

## 🔧 Tech
- Node.js
- node-telegram-bot-api
- dotenv
- Termux supported  
- Long polling mode (no webhook needed)

---

## 📦 Install

cd creator-support-army-bot npm install

---

## 🚀 Run

chmod +x scripts/start.sh ./scripts/start.sh

---

## ⚙️ .env (create yourself later)

BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN AGREEMENT_GROUP_ID=-1001234567890

`AGREEMENT_GROUP_ID` optional hai:  
- set → bot only works in that group  
- unset → bot any group me kaam karega

---

## 🧩 Commands

### ✔ Start a deal

/deal @username details...

### ✔ Accept a deal  
Only tagged user can accept

/accept

### ✔ Cancel a deal  
Initiator or partner can cancel

/cancel

---

## 📂 Project Structure

creator-support-army-bot/ ├─ README.md ├─ package.json ├─ scripts/ │    └─ start.sh └─ src/ └─ bot.js

---

## 🔮 Future Modules (COMING SOON)

- Proof Board  
- Serial Number system  
- Pre-upload proof video  
- Strike system (90 days)  
- Auto punishment logic  
- Channel sanction triggers  
- Full logging system

