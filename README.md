# AI Financial Bot 💸🤖

Chatbot pribadi untuk mencatat dan mengelola pengeluaran harian, ringkasan berkala, pengeluaran rutin bulanan, dan insight keuangan AI — berjalan di atas **Vercel Serverless**, **Google Sheets**, dan **100% GRATIS (Free Tier)**.

---

## 🌟 Fitur Utama

1. **Catat Pengeluaran Cepat**: Cukup kirim chat biasa seperti `keluar 25000 makan siang` atau `50k bensin #transport`.
2. **Catat Pemasukan**: `masuk 5000000 gaji` atau `masuk 500k freelance`.
3. **Deteksi Kategori Otomatis**: Mendeteksi kategori dari kata kunci (Food, Transport, Bills, Shopping, Entertainment, Health, dll) dengan fallback `Lainnya`.
4. **Ringkasan On-Demand**: `ringkasan hari`, `ringkasan minggu`, dan `ringkasan bulan` lengkap dengan persentase per kategori dan sisa tabungan.
5. **Koreksi Transaksi**: `hapus terakhir` (batalkan) atau `edit terakhir 30000` (ubah jumlah).
6. **Pengeluaran Rutin Bulanan**:
   - Tambah: `tambah rutin 150000 netflix tgl 5`
   - Daftar: `list rutin`
   - Nonaktifkan: `hapus rutin netflix`
   - *Dieksekusi otomatis oleh Vercel Cron setiap hari jam 00:00 UTC.*
7. **AI Financial Advisor (Google Gemini 2.0 Flash)**: Ketik `saran` atau `analisa` untuk mendapatkan insight hemat cerdas dari AI.
8. **Interactive Menu**: Ketik `menu` untuk memunculkan WhatsApp interactive list message.
9. **Built-in Web Simulator**: Halaman dashboard modern (`/`) untuk mencoba semua perintah langsung dari browser tanpa perlu setup WA terlebih dahulu.

---

## 💡 Mengapa Sistem Ini 100% GRATIS & Masuk Akal?

| Layanan | Kuota Gratis | Mengapa Masuk Akal untuk Personal Use? |
|---|---|---|
| **WhatsApp Cloud API** | 1.000 service conversations/bulan gratis dari Meta | Personal use hanya berinteraksi dengan nomor bot sendiri (user-initiated), 1.000 percakapan/bln (~33/hari) sangat lebih dari cukup. Menggunakan Webhook HTTP standar yang ramah serverless (bukan Baileys yang butuh VPS 24/7). |
| **Google Sheets API** | 300 read & 300 write requests/menit | Transaksi harian hanya ~5-20 per hari. Tidak ada biaya database, dan data mudah diakses/diedit di HP lewat aplikasi Google Sheets. |
| **Google Gemini 2.0 Flash** | 15 RPM / 1.500 RPD gratis tanpa kartu kredit | AI hanya dipanggil saat perintah `saran`, sedangkan parsing harian menggunakan rule-based regex super cepat (&lt;50ms) di Next.js. Dilengkapi rate-limiter 5x/hari. |
| **Vercel Serverless & Cron** | 100.000 invocations/bulan & 1 cron job/hari | Plan Hobby gratis sudah mencakup cron harian (00:00 UTC) untuk auto-insert pengeluaran rutin jatuh tempo. Tanpa sewa server VPS. |

---

## 📋 Daftar Perintah Chat WhatsApp

| Perintah | Contoh | Keterangan |
|---|---|---|
| **Catat Pengeluaran** | `keluar 25000 makan siang`<br>`k 50k bensin #transport`<br>`25000 kopi` | Mencatat transaksi keluar |
| **Catat Pemasukan** | `masuk 5000000 gaji`<br>`masuk 500k freelance` | Mencatat transaksi masuk |
| **Ringkasan** | `ringkasan hari`<br>`ringkasan minggu`<br>`ringkasan bulan` | Laporan agregasi pengeluaran & tabungan |
| **Hapus Transaksi Terakhir** | `hapus terakhir` / `undo` | Menghapus baris transaksi terakhir |
| **Koreksi Jumlah Terakhir** | `edit terakhir 35000` | Memperbarui nominal transaksi terakhir |
| **AI Advisor** | `saran` / `analisa` | Menganalisis keuangan 30 hari via Gemini AI |
| **Tambah Rutin** | `tambah rutin 150000 netflix tgl 5` | Auto-catat tiap tanggal yang ditentukan |
| **Lihat Rutin** | `list rutin` | Menampilkan semua langganan aktif |
| **Hapus Rutin** | `hapus rutin netflix` | Menonaktifkan pengeluaran rutin |
| **Menu Pilihan** | `menu` / `bantuan` | Menampilkan menu opsi interaktif |

---

## 🚀 Setup & Panduan Deployment

### 1. Dapatkan Gemini API Key (Gratis)
Buka [Google AI Studio](https://aistudio.google.com/app/apikey) dan klik **Create API Key**. Simpan ke `GEMINI_API_KEY`.

### 2. Setup Google Sheets & Service Account
1. Buat Spreadsheet baru di [Google Sheets](https://sheets.new). Salin Spreadsheet ID dari URL.
2. Buat project di [Google Cloud Console](https://console.cloud.google.com).
3. Aktifkan **Google Sheets API**.
4. Buat **Service Account** di IAM & Admin &gt; Service Accounts &gt; Keys &gt; Create JSON Key.
5. Buka spreadsheet Anda, klik **Share (Bagikan)**, lalu masukkan email service account dengan hak akses **Editor**.

### 3. Setup WhatsApp Cloud API (Meta for Developers)
1. Buka [developers.facebook.com](https://developers.facebook.com) dan buat App tipe **Business**.
2. Tambahkan produk **WhatsApp**.
3. Di **API Setup**, dapatkan **Phone Number ID** dan **Temporary/Permanent Access Token**.
4. Catat nomor WhatsApp pribadi Anda ke `ALLOWED_PHONE_NUMBER` (misal: `6281234567890`) agar hanya Anda yang dapat mengakses bot.

### 4. Deploy ke Vercel
1. Import repository ini ke [Vercel](https://vercel.com).
2. Isi Environment Variables sesuai dengan `.env.example`.
3. Setelah deploy selesai, daftarkan Webhook di Meta Developer Dashboard:
   - **Callback URL**: `https://your-domain.vercel.app/api/webhook`
   - **Verify Token**: Sesuai nilai `WHATSAPP_VERIFY_TOKEN`
   - **Webhook fields**: Centang `messages`.

---

## 🛠️ Menjalankan Lokal

```bash
# 1. Install dependencies
npm install

# 2. Jalankan server lokal
npm run dev

# 3. Buka di browser
# http://localhost:3000 -> Nikmati WhatsApp Chat Simulator & Diagnostics
```

Semua tab sheet (`transactions`, `categories`, `recurring_expenses`) dapat diinisialisasi otomatis dengan menekan tombol **"Inisialisasi Struktur Sheet"** di dashboard web.
