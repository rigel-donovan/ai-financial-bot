# Telegram Bot - Menu Shortcuts & Interactive Guide

## Overview

Fitur **shortcut menu** dan **panduan interaktif** memudahkan user untuk menggunakan bot tanpa perlu mengingat format command. User bisa:

- ✅ Klik tombol untuk akses fitur cepat
- ✅ Lihat menu command saat mengetik `/`
- ✅ Gunakan template transaksi yang sudah tersedia
- ✅ Navigasi menu dengan tombol inline keyboard

---

## Features Implemented

### 1. Bot Commands Menu (/ Commands)

User dapat mengetik `/` di Telegram dan akan muncul list command:

| Command | Description | Action |
|---------|-------------|--------|
| `/start` | 🏠 Panduan awal & info bot | Welcome message + main menu |
| `/menu` | 📋 Menu utama fitur bot | Show main menu with buttons |
| `/catat` | ✏️ Catat pengeluaran cepat | Quick transaction templates |
| `/saldo` | 💰 Cek saldo & ringkasan | Get current balance |
| `/laporan` | 📊 Laporan keuangan bulan ini | Report options menu |
| `/langganan` | 📅 Kelola langganan bulanan | Subscription management menu |
| `/saran` | 💡 Saran financial AI | AI financial advisor |
| `/help` | ❓ Bantuan & contoh penggunaan | Full help guide |

### 2. Main Menu (Interactive Buttons)

User mendapat inline keyboard dengan tombol:

```
┌─────────────────────────────────────────┐
│ ✏️ Catat Pengeluaran │ 💰 Cek Saldo     │
├─────────────────────────────────────────┤
│ 📊 Laporan Bulan Ini │ 📅 Kelola        │
│                      │    Langganan     │
├─────────────────────────────────────────┤
│ 💡 Saran AI          │ 📷 Scan Struk    │
├─────────────────────────────────────────┤
│ ❓ Bantuan           │ 📝 Contoh Chat   │
└─────────────────────────────────────────┘
```

### 3. Quick Transaction Templates

Saat user klik "✏️ Catat Pengeluaran", muncul template:

```
┌─────────────────────────────────────────┐
│ ☕ Kopi 25k          │ 🍜 Makan 30k     │
├─────────────────────────────────────────┤
│ ⛽ Bensin 50k        │ 🚗 Parkir 5k     │
├─────────────────────────────────────────┤
│ 🛒 Belanja          │ 💊 Kesehatan     │
├─────────────────────────────────────────┤
│           🔙 Kembali ke Menu            │
└─────────────────────────────────────────┘
```

Sekali klik → transaksi langsung tercatat!

### 4. Report Options Menu

```
┌─────────────────────────────────────────┐
│ 📅 Bulan Ini        │ 📆 Bulan Lalu    │
├─────────────────────────────────────────┤
│ 📊 Per Kategori     │ 📈 Total Semua   │
├─────────────────────────────────────────┤
│           🔙 Kembali ke Menu            │
└─────────────────────────────────────────┘
```

### 5. Subscription Management Menu

```
┌─────────────────────────────────────────┐
│ 📋 List Langganan   │ ➕ Tambah Baru    │
├─────────────────────────────────────────┤
│ 🔔 Reminder Aktif   │ 💰 Total per     │
│                     │    Bulan         │
├─────────────────────────────────────────┤
│           🔙 Kembali ke Menu            │
└─────────────────────────────────────────┘
```

---

## User Experience Flow

### First Time User

1. User starts chat dengan bot: `/start`
2. Bot sends welcome message + **Main Menu buttons**
3. User bisa langsung klik tombol atau ketik manual
4. Semua navigasi menggunakan inline keyboard - **no typing needed**

### Daily Usage

**Scenario 1: Quick Transaction**
```
User → Click "✏️ Catat Pengeluaran"
Bot  → Shows quick templates
User → Click "☕ Kopi 25k"
Bot  → ✅ Tercatat! Pengeluaran kopi Rp 25.000
```

**Scenario 2: Check Balance**
```
User → Click "💰 Cek Saldo"
Bot  → 💰 Saldo: Rp 2.500.000
       📉 Pengeluaran bulan ini: Rp 1.200.000
       📈 Pemasukan bulan ini: Rp 3.700.000
```

**Scenario 3: Monthly Report**
```
User → Click "📊 Laporan Bulan Ini"
Bot  → Shows report options menu
User → Click "📊 Per Kategori"
Bot  → 📊 Pengeluaran Oktober 2026 per kategori:
       - Makanan & Minuman: Rp 450.000 (37.5%)
       - Transport: Rp 300.000 (25%)
       - dll...
```

---

## Technical Implementation

### Files Modified

1. **`lib/telegram.ts`**
   - Added TypeScript interfaces for reply markup
   - Added `replyMarkup` parameter to `sendTelegramTextMessage()`
   - Implemented `setTelegramBotCommands()` function
   - Created keyboard generator functions:
     - `getMainMenuKeyboard()`
     - `getQuickTransactionKeyboard()`
     - `getReportOptionsKeyboard()`
     - `getSubscriptionKeyboard()`

2. **`app/api/telegram/route.ts`**
   - Added callback query handling
   - Implemented command handlers:
     - `/start`, `/menu`, `/catat`, `/saldo`, `/laporan`, `/langganan`, `/saran`, `/help`
   - Created callback handlers:
     - `handleMenuCallback()` - Main menu navigation
     - `handleQuickTransaction()` - Quick transaction templates
     - `handleReportCallback()` - Report options
     - `handleSubscriptionCallback()` - Subscription management

3. **`app/api/telegram/setup-commands/route.ts`** (NEW)
   - Endpoint to initialize bot commands
   - Call once after deployment: `GET /api/telegram/setup-commands`

### Telegram Bot API Features Used

1. **Bot Commands** - `/setMyCommands`
   - Shows commands when user types `/` in chat
   - Auto-complete suggestions

2. **Inline Keyboard** - `inline_keyboard` reply markup
   - Buttons with callback_data
   - Non-intrusive (doesn't spam chat)
   - Can edit previous message

3. **Callback Query** - `callback_query` webhook
   - Handles button clicks
   - Sends `answerCallbackQuery` to remove loading state

---

## Setup Instructions

### 1. Initial Setup (One Time)

After deploying to Vercel, call this endpoint to initialize bot commands:

```bash
curl https://your-domain.vercel.app/api/telegram/setup-commands
```

Or open in browser:
```
https://your-domain.vercel.app/api/telegram/setup-commands
```

Response:
```json
{
  "success": true,
  "message": "Bot commands setup successfully!",
  "commands": [
    "/start - Panduan awal & info bot",
    "/menu - Menu utama fitur bot",
    ...
  ]
}
```

### 2. User Testing

1. Open your Telegram bot
2. Type `/` - you should see command list
3. Click `/start` - main menu appears with buttons
4. Click any button - navigate through menus
5. Try quick transactions - instant recording

### 3. Verify Webhook (if needed)

Check webhook status:
```bash
curl https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo
```

Should show:
```json
{
  "url": "https://your-domain.vercel.app/api/telegram",
  "has_custom_certificate": false,
  "pending_update_count": 0
}
```

---

## Menu Structure

```
Main Menu
├── ✏️ Catat Pengeluaran
│   ├── ☕ Kopi 25k
│   ├── 🍜 Makan 30k
│   ├── ⛽ Bensin 50k
│   ├── 🚗 Parkir 5k
│   ├── 🛒 Belanja (with guide)
│   └── 💊 Kesehatan (with guide)
├── 💰 Cek Saldo
│   └── Shows current balance
├── 📊 Laporan Bulan Ini
│   ├── 📅 Bulan Ini
│   ├── 📆 Bulan Lalu
│   ├── 📊 Per Kategori
│   └── 📈 Total Semua
├── 📅 Kelola Langganan
│   ├── 📋 List Langganan
│   ├── ➕ Tambah Baru (with guide)
│   ├── 🔔 Reminder Aktif
│   └── 💰 Total per Bulan
├── 💡 Saran AI
│   └── AI financial analysis
├── 📷 Scan Struk
│   └── Guide for photo upload
├── ❓ Bantuan
│   └── Full help documentation
└── 📝 Contoh Chat
    └── Example commands
```

---

## Callback Data Convention

Format: `{category}_{action}`

### Menu Navigation
- `menu_main` - Back to main menu
- `menu_catat` - Transaction entry menu
- `menu_saldo` - Check balance
- `menu_laporan` - Report menu
- `menu_langganan` - Subscription menu
- `menu_saran` - AI advisor
- `menu_scan` - Receipt scanner guide
- `menu_help` - Help documentation
- `menu_examples` - Example commands

### Quick Transactions
- `quick_kopi_25k` - Coffee 25k
- `quick_makan_30k` - Meal 30k
- `quick_bensin_50k` - Gas 50k
- `quick_parkir_5k` - Parking 5k
- `quick_belanja` - Shopping (with guide)
- `quick_kesehatan` - Healthcare (with guide)

### Reports
- `report_this_month` - Current month report
- `report_last_month` - Previous month report
- `report_by_category` - By category breakdown
- `report_all` - All-time total

### Subscriptions
- `sub_list` - List all subscriptions
- `sub_add` - Add new subscription (with guide)
- `sub_reminders` - Active reminders
- `sub_total` - Total monthly cost

---

## Benefits

### For Users
✅ **Zero Learning Curve** - No need to memorize commands  
✅ **Visual Navigation** - Click buttons instead of typing  
✅ **Quick Actions** - One-click common transactions  
✅ **Discoverable Features** - All features visible in menu  
✅ **Mobile-Friendly** - Easy to use on phone  

### For Bot
✅ **Reduced Errors** - Structured input via templates  
✅ **Better UX** - Professional bot experience  
✅ **Higher Engagement** - Users explore more features  
✅ **Self-Service** - Comprehensive help in-app  

---

## Future Enhancements (Optional)

1. **Personalized Quick Shortcuts**
   - Learn user's most common transactions
   - Auto-suggest based on time/day patterns
   - Custom amount templates per user

2. **Smart Templates**
   - Location-based suggestions (nearby favorites)
   - Recent transactions quick-repeat
   - Favorite items bookmarks

3. **Rich Media**
   - Chart images for reports
   - Visual spending breakdown
   - Calendar view for subscriptions

4. **Web App Integration**
   - Telegram Web App for advanced features
   - Interactive charts & graphs
   - Full spreadsheet view in-app

---

## Testing Checklist

- [ ] Commands appear when typing `/`
- [ ] `/start` shows welcome + main menu
- [ ] `/menu` shows interactive menu
- [ ] Quick transaction buttons work
- [ ] Report options navigate correctly
- [ ] Subscription menu functions
- [ ] Help documentation complete
- [ ] Back buttons return to main menu
- [ ] Callback queries don't timeout
- [ ] Buttons work after message scroll

---

## Troubleshooting

### Commands Not Showing
**Problem**: User doesn't see commands when typing `/`  
**Solution**: Call `/api/telegram/setup-commands` endpoint again

### Buttons Not Responding
**Problem**: Clicking buttons does nothing  
**Solution**: Check webhook is active and receiving callback_query events

### Duplicate Processing
**Problem**: Button click processes multiple times  
**Solution**: `answerCallbackQuery` already implemented - check webhook retry settings

### Menu Lost After Scroll
**Problem**: Inline keyboard disappears in chat history  
**Solution**: This is normal Telegram behavior - user can type `/menu` to show again

---

## Support

Fitur ini fully integrated dengan existing bot functionality. Semua menu shortcuts memanggil `handleUserMessage()` yang sama, jadi:

- Data tetap consistent
- AI context understanding tetap aktif
- Logging & analytics tetap tercatat
- Google Sheets sync tetap berjalan

**User Experience**: Professional, user-friendly, zero friction! 🚀
