# agent.md — WA Expense Bot

> Panduan untuk AI coding agent (mis. Claude Code) saat membangun sistem ini. Lihat `prd.md` untuk detail fitur & kebutuhan produk. Asumsi ditandai 💡.

## Tech Stack
- **Framework**: Next.js (App Router / API Route Handlers) — dipilih karena native support di Vercel dan konsisten dengan stack yang biasa dipakai
- **Hosting**: Vercel (Hobby plan cukup untuk personal use)
- **WhatsApp Gateway**: 💡 WhatsApp Cloud API resmi (webhook-based, cocok untuk serverless) — BUKAN Baileys, karena Baileys butuh koneksi persisten yang tidak kompatibel dengan Vercel
- **Database**: Google Sheets (via Google Sheets API + Service Account) — stateless per-request, cocok untuk serverless
- **AI Advisor**: Google Gemini API — 💡 model `gemini-2.0-flash` atau setara di free tier (cek [ai.google.dev/pricing](https://ai.google.dev/pricing) untuk limit terbaru)
- **Scheduler**: Vercel Cron Jobs (via `vercel.json`) — menggantikan node-cron karena tidak ada proses long-running di serverless
  - 💡 Plan Hobby Vercel membatasi cron hanya bisa jalan 1x/hari; untuk kebutuhan ini (cek recurring expense harian) sudah cukup

## Setup Awal yang Perlu Dilakukan Manusia (bukan agent)
Beberapa langkah ini butuh akun & verifikasi manual di luar coding:
1. Buat Meta Developer App + WhatsApp Business Platform, verifikasi nomor WA yang akan dipakai bot
2. Buat Google Cloud project, aktifkan Sheets API, buat Service Account, download JSON credential
3. Buat Google Spreadsheet dengan struktur sheet sesuai skema di bawah, share ke email Service Account (akses Editor)
4. Dapatkan Gemini API key dari [ai.google.dev](https://ai.google.dev)
5. Deploy project ke Vercel, set semua kredensial di atas sebagai Environment Variables

## Struktur Proyek (usulan)
```
wa-expense-bot/
├── app/
│   └── api/
│       ├── webhook/
│       │   └── route.js          # endpoint webhook WhatsApp Cloud API (GET verify + POST pesan masuk)
│       └── cron/
│           └── recurring/
│               └── route.js      # dipanggil Vercel Cron, cek pengeluaran rutin jatuh tempo
├── lib/
│   ├── whatsapp.js                # kirim pesan via WhatsApp Cloud API (fetch ke Graph API)
│   ├── parser.js                  # parsing intent & ekstraksi jumlah/kategori
│   ├── sheets.js                  # koneksi & operasi baca/tulis Google Sheets
│   ├── ai-advisor.js              # integrasi Gemini API
│   └── transactions.js            # logic transaksi (create, edit, delete, summary)
├── credentials/                   # (JANGAN commit — masuk .gitignore)
├── vercel.json                    # konfigurasi cron job
├── .env.example
└── package.json
```

### Contoh `vercel.json` untuk cron
```json
{
  "crons": [
    {
      "path": "/api/cron/recurring",
      "schedule": "0 0 * * *"
    }
  ]
}
```

## Skema Data (struktur Google Sheet)

**Sheet `transactions`**

| id | type | amount | category | note | raw_message | source | created_at |
|---|---|---|---|---|---|---|---|
| UUID | expense/income | angka | kategori | catatan bebas | pesan asli user | manual/recurring | ISO timestamp |

**Sheet `categories`** (opsional, mapping kata kunci → kategori)

| keyword | category |
|---|---|
| makan, kopi, jajan | Food |
| bensin, ojek, tol | Transport |

**Sheet `recurring_expenses`**

| id | name | amount | category | due_date | active | last_run_date | created_at |
|---|---|---|---|---|---|---|---|
| UUID | "Netflix" | 150000 | Hiburan | 5 (tanggal tiap bulan) | TRUE/FALSE | tanggal terakhir sukses insert | ISO timestamp |

💡 Kolom `last_run_date` penting untuk mencegah double-insert kalau cron ke-trigger lebih dari sekali di hari yang sama. Kolom `due_date` cukup angka 1–31; kalau bulan tidak punya tanggal tsb (mis. 31 di Februari), fallback ke hari terakhir bulan itu.

## Aturan Parsing Pesan
- `keluar 25000 makan siang` → type=expense, amount=25000, note="makan siang", category=auto-detect dari sheet `categories`
- `masuk 500000 gaji` → type=income, amount=500000, note="gaji"
- `ringkasan bulan` → ambil semua baris `transactions` bulan berjalan dari Sheet, agregat di kode (bukan formula spreadsheet)
- `hapus terakhir` → soft-delete transaksi terbaru
- Telegram `menu`, `/menu`, `bantuan`, `panduan`, dan `/help` → tampilkan panduan dengan tombol keyboard persisten
- `saran` / `analisa` → ambil data transaksi 7–30 hari terakhir, kirim ke Gemini API, balas hasilnya
- `tambah rutin 150000 netflix tgl 5` → simpan ke sheet `recurring_expenses`
- `list rutin` → tampilkan baris `recurring_expenses` yang `active=TRUE`
- `hapus rutin netflix` → set `active=FALSE` pada baris dengan name cocok
- Jika format tidak dikenali → balas contoh format yang benar, jangan silent-fail

## Task Breakdown untuk Agent
1. Setup project Next.js + konfigurasi deploy ke Vercel
2. Setup webhook WhatsApp Cloud API (`GET` untuk verification challenge, `POST` untuk terima pesan masuk) + fungsi kirim pesan keluar via Graph API
3. Setup Google Cloud Service Account + koneksi ke Sheets API, buat helper baca/tulis baris (`lib/sheets.js`)
4. Implementasi parser intent (rule-based/keyword, bukan LLM, agar cepat & murah)
5. Implementasi handler: catat transaksi, ringkasan, edit/hapus terakhir
6. Implementasi menu interaktif (WhatsApp List Message)
7. Implementasi AI advisor: integrasi Gemini API dengan prompt template yang menyertakan ringkasan transaksi (hindari kirim data mentah berlebihan agar hemat token)
8. Implementasi pengeluaran rutin: CRUD ke sheet `recurring_expenses` + endpoint `/api/cron/recurring` yang dipanggil Vercel Cron
9. Set konfigurasi `vercel.json` untuk cron schedule
10. Testing end-to-end dengan nomor WA pribadi (termasuk simulasi tanggal jatuh tempo rutin)
11. Dokumentasi environment variables yang perlu di-set di Vercel, cara re-verify webhook kalau token berubah, dan cara backup spreadsheet berkala

## Batasan & Catatan untuk Agent
- Jangan pakai Baileys atau library WhatsApp unofficial lain — arsitektur ini didesain serverless, dan koneksi persisten tidak akan bertahan di Vercel function yang mati setelah request selesai.
- Semua kredensial (WhatsApp token, Google Service Account JSON, Gemini API key) disimpan sebagai Environment Variables di Vercel dashboard, bukan hardcoded atau di-commit ke repo.
- Prioritaskan parsing berbasis rule dulu sebelum LLM — Gemini hanya dipakai untuk fitur advisor/saran, bukan parsing pesan sehari-hari, agar kuota free tier tidak cepat habis.
- Tambahkan rate-limiting sederhana untuk command `saran` (mis. maksimal beberapa kali per hari) untuk berjaga-jaga terhadap limit free tier Gemini.
- Untuk query ringkasan, ambil baris relevan dari Sheet lalu filter/agregat di kode, bukan pakai formula spreadsheet.
- Endpoint cron (`/api/cron/recurring`) harus mengecek `last_run_date` sebelum insert, supaya tidak double-catat kalau Vercel Cron ter-trigger ulang di hari yang sama.
- Perhatikan batas eksekusi function Vercel (10 detik di Hobby plan) — hindari operasi yang terlalu berat/lama dalam satu request (mis. loop baca ratusan baris Sheet berulang kali; ambil sekali lalu proses di memory).
- Pastikan endpoint webhook memvalidasi request benar-benar datang dari WhatsApp (verify token / signature), jangan proses request sembarangan.
