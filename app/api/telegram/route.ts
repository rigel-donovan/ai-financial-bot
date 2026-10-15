import { NextRequest, NextResponse } from 'next/server';
import { handleUserMessage } from '@/lib/transactions';
import { 
  sendTelegramTextMessage, 
  getMainMenuKeyboard, 
  getQuickTransactionKeyboard,
  getReportOptionsKeyboard,
  getSubscriptionKeyboard,
  sendChatAction,
  sendLoadingMessage,
  editTelegramMessage,
  getPersistentReplyKeyboard
} from '@/lib/telegram';
import { scanReceiptImage } from '@/lib/receipt-scanner';
import { parseQueryDate } from '@/lib/parser';

// In-memory set to deduplicate processed Telegram update_ids
const processedUpdateIds = new Set<number>();

export async function POST(req: NextRequest) {
  let chatId: string | number | undefined;

  try {
    const body = await req.json();

    // Deduplicate Telegram update_id to prevent webhook retry spam
    const updateId = body.update_id;
    if (updateId) {
      if (processedUpdateIds.has(updateId)) {
        return NextResponse.json({ ok: true });
      }
      processedUpdateIds.add(updateId);
      if (processedUpdateIds.size > 2000) {
        const first = processedUpdateIds.values().next().value;
        if (first !== undefined) processedUpdateIds.delete(first);
      }
    }

    // Check if it's a message or callback_query
    const message = body.message || body.channel_post;
    const callbackQuery = body.callback_query;

    let userText = '';
    let isCallbackQuery = false;

    if (message) {
      chatId = message.chat?.id;
      userText = (message.text || '').trim();
    } else if (callbackQuery) {
      chatId = callbackQuery.message?.chat?.id;
      userText = (callbackQuery.data || '').trim();
      isCallbackQuery = true;

      // Answer callback query to remove loading state
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (token) {
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id })
        }).catch(() => {});
      }
    }

    if (!chatId) {
      return NextResponse.json({ ok: true });
    }

    // Handle callback query menu navigation
    if (isCallbackQuery && userText.startsWith('menu_')) {
      return await handleMenuCallback(chatId, userText);
    }

    // Handle quick transaction shortcuts
    if (isCallbackQuery && userText.startsWith('quick_')) {
      return await handleQuickTransaction(chatId, userText);
    }

    // Handle report shortcuts
    if (isCallbackQuery && userText.startsWith('report_')) {
      return await handleReportCallback(chatId, userText);
    }

    // Handle subscription shortcuts
    if (isCallbackQuery && userText.startsWith('sub_')) {
      return await handleSubscriptionCallback(chatId, userText);
    }

    // Check if user sent a photo (receipt image)
    if (message && message.photo && message.photo.length > 0) {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (token) {
        await sendTelegramTextMessage({
          chatId,
          text: '🔍 *Sedang menganalisis foto struk dengan AI...*\nMohon tunggu beberapa detik.'
        });

        try {
          const highestPhoto = message.photo[message.photo.length - 1];
          const fileInfoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${highestPhoto.file_id}`);
          const fileInfo = await fileInfoRes.json();

          if (fileInfo.ok && fileInfo.result?.file_path) {
            const downloadUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`;
            const imageRes = await fetch(downloadUrl);
            const arrayBuffer = await imageRes.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const captionText = message.caption || '';
            const targetDate = parseQueryDate(captionText).targetDate;
            const scanResult = await scanReceiptImage(buffer, 'image/jpeg', String(chatId), targetDate);
            await sendTelegramTextMessage({
              chatId,
              text: scanResult.replyText
            });
            return NextResponse.json({ ok: true });
          }
        } catch (imgErr) {
          console.error('Error downloading/processing Telegram photo:', imgErr);
          await sendTelegramTextMessage({
            chatId,
            text: '⚠️ Terjadi kendala saat mengunduh gambar struk. Silakan coba kirim ulang.'
          });
          return NextResponse.json({ ok: true });
        }
      }
    }

    if (!userText) {
      return NextResponse.json({ ok: true });
    }

    // Special command: /start
    if (userText === '/start') {
      const welcome = 
        `👋 *Selamat Datang di Bot Keuangan Pribadi!*\n\n` +
        `👤 *ID Anda:* \`${chatId}\`\n` +
        `🔒 *Privasi Terjamin:* Data keuangan Anda terisolasi & terpisah di Google Sheets\n\n` +
        `💬 *Chat Bebas Tanpa Format Kaku:*\n` +
        `• \`beli kopi 25rb\`\n` +
        `• \`makan siang 30k\`\n` +
        `• \`bensin 50.000\`\n` +
        `• \`gajian 5 juta\`\n` +
        `• Atau kirim *foto struk* 📷\n\n` +
        `⚡ *Gunakan tombol di bawah untuk akses cepat!*`;

      await sendTelegramTextMessage({ 
        chatId, 
        text: welcome,
        replyMarkup: getPersistentReplyKeyboard()
      });
      return NextResponse.json({ ok: true });
    }

    // Special command: /menu
    if (userText === '/menu') {
      const menuText = 
        `📋 *Menu Utama Bot Keuangan*\n\n` +
        `Pilih menu yang Anda butuhkan dengan tombol di bawah:`;

      await sendTelegramTextMessage({ 
        chatId, 
        text: menuText,
        replyMarkup: getPersistentReplyKeyboard()
      });
      return NextResponse.json({ ok: true });
    }

    // Special command: /catat
    if (userText === '/catat') {
      const catatText = 
        `✏️ *Catat Pengeluaran Cepat*\n\n` +
        `Pilih template atau ketik manual:\n` +
        `Contoh: \`beli makan siang 35rb\``;

      await sendTelegramTextMessage({ 
        chatId, 
        text: catatText,
        replyMarkup: getQuickTransactionKeyboard()
      });
      return NextResponse.json({ ok: true });
    }

    // Special command: /saldo
    if (userText === '/saldo') {
      const result = await handleUserMessage('saldo sekarang', String(chatId));
      await sendTelegramTextMessage({
        chatId,
        text: result.replyText
      });
      return NextResponse.json({ ok: true });
    }

    // Special command: /laporan
    if (userText === '/laporan') {
      const laporanText = 
        `📊 *Laporan Keuangan*\n\n` +
        `Pilih jenis laporan yang ingin dilihat:`;

      await sendTelegramTextMessage({ 
        chatId, 
        text: laporanText,
        replyMarkup: getReportOptionsKeyboard()
      });
      return NextResponse.json({ ok: true });
    }

    // Special command: /langganan
    if (userText === '/langganan') {
      const subText = 
        `📅 *Kelola Langganan Bulanan*\n\n` +
        `Apa yang ingin Anda lakukan?`;

      await sendTelegramTextMessage({ 
        chatId, 
        text: subText,
        replyMarkup: getSubscriptionKeyboard()
      });
      return NextResponse.json({ ok: true });
    }

    // Special command: /saran
    if (userText === '/saran') {
      const result = await handleUserMessage('saran financial', String(chatId));
      await sendTelegramTextMessage({
        chatId,
        text: result.replyText
      });
      return NextResponse.json({ ok: true });
    }

    // Special command: /help or /bantuan
    if (userText === '/help' || userText.toLowerCase() === 'bantuan' || userText.toLowerCase() === '/bantuan') {
      const helpText = 
        `❓ *Panduan Penggunaan Bot*\n\n` +
        `*📝 Cara Mencatat Transaksi:*\n` +
        `• Pengeluaran: \`kopi 25k\`, \`makan 30rb\`, \`bensin 50.000\`\n` +
        `• Pemasukan: \`gajian 5jt\`, \`dapat bonus 500rb\`\n` +
        `• Multi-item: \`beli ayam 25k sama tempe 5rb\`\n` +
        `• Edit: \`bukan 25rb tapi 30rb\`, \`ubah jadi 20k\`\n` +
        `• Hapus: \`hapus kopi tadi\`, \`batalkan transaksi terakhir\`\n\n` +
        `*📊 Cek Data:*\n` +
        `• \`saldo sekarang\` - Total saldo\n` +
        `• \`pengeluaran hari ini\` - Rekap harian\n` +
        `• \`pengeluaran bulan ini\` - Rekap bulanan\n` +
        `• \`pengeluaran januari\` - Rekap bulan tertentu\n\n` +
        `*📅 Langganan Berulang:*\n` +
        `• \`list langganan\` - Daftar langganan\n` +
        `• \`langganan netflix 186k tgl 5\` - Tambah langganan\n\n` +
        `*📷 Scan Struk:*\n` +
        `Kirim foto struk belanja untuk dicatat otomatis!\n\n` +
        `*💡 AI Financial Advisor:*\n` +
        `Ketik \`saran\` untuk analisis & saran keuangan\n\n` +
        `⚡ Gunakan tombol di bawah untuk akses cepat!`;

      await sendTelegramTextMessage({ 
        chatId, 
        text: helpText,
        replyMarkup: getPersistentReplyKeyboard()
      });
      return NextResponse.json({ ok: true });
    }

    // Handle keyboard button presses (match button text)
    // These match the text from getPersistentReplyKeyboard()
    switch (userText) {
      case '✏️ Catat Pengeluaran':
        const catatText = 
          `✏️ *Catat Pengeluaran Cepat*\n\n` +
          `Pilih template atau ketik manual:\n` +
          `Contoh: \`beli makan siang 35rb\``;
        await sendTelegramTextMessage({ 
          chatId, 
          text: catatText,
          replyMarkup: getQuickTransactionKeyboard()
        });
        return NextResponse.json({ ok: true });

      case '💰 Cek Saldo':
        await sendChatAction(chatId, 'typing');
        const loadingMsgSaldo = await sendLoadingMessage(chatId, '💰 *Mengecek saldo...*\n⏳ Mohon tunggu sebentar...');
        const saldoResult = await handleUserMessage('saldo sekarang', String(chatId));
        if (loadingMsgSaldo) {
          await editTelegramMessage(chatId, loadingMsgSaldo, saldoResult.replyText);
        } else {
          await sendTelegramTextMessage({ chatId, text: saldoResult.replyText });
        }
        return NextResponse.json({ ok: true });

      case '📊 Laporan Bulan Ini':
        await sendChatAction(chatId, 'typing');
        const loadingMsgLaporan = await sendLoadingMessage(chatId, '📊 *Membuat laporan...*\n⏳ Mengumpulkan data transaksi...');
        const laporanResult = await handleUserMessage('pengeluaran bulan ini', String(chatId));
        if (loadingMsgLaporan) {
          await editTelegramMessage(chatId, loadingMsgLaporan, laporanResult.replyText);
        } else {
          await sendTelegramTextMessage({ chatId, text: laporanResult.replyText });
        }
        return NextResponse.json({ ok: true });

      case '📅 Kelola Langganan':
        const subMenuText = 
          `📅 *Kelola Langganan Bulanan*\n\n` +
          `Apa yang ingin Anda lakukan?`;
        await sendTelegramTextMessage({ 
          chatId, 
          text: subMenuText,
          replyMarkup: getSubscriptionKeyboard()
        });
        return NextResponse.json({ ok: true });

      case '💡 Saran AI':
        await sendChatAction(chatId, 'typing');
        const loadingMsgSaran = await sendLoadingMessage(chatId, '💡 *Menganalisis keuangan Anda...*\n🤖 AI sedang bekerja, mohon tunggu...');
        const saranResult = await handleUserMessage('saran financial', String(chatId));
        if (loadingMsgSaran) {
          await editTelegramMessage(chatId, loadingMsgSaran, saranResult.replyText);
        } else {
          await sendTelegramTextMessage({ chatId, text: saranResult.replyText });
        }
        return NextResponse.json({ ok: true });

      case '🛒 Scan Struk':
        const scanMenuText = 
          `📷 *Scan Struk Belanja*\n\n` +
          `Kirim foto struk belanja Anda, dan bot akan:\n` +
          `✅ Membaca semua item dengan OCR + AI\n` +
          `✅ Mendeteksi harga dan kategori\n` +
          `✅ Mencatat otomatis ke spreadsheet\n\n` +
          `💡 *Tips:*\n` +
          `• Pastikan foto jelas & tulisan terbaca\n` +
          `• Bisa tambahkan caption untuk tanggal khusus\n` +
          `• Contoh caption: \`kemarin\`, \`3 hari lalu\``;
        await sendTelegramTextMessage({ 
          chatId, 
          text: scanMenuText
        });
        return NextResponse.json({ ok: true });

      case '❓ Bantuan':
        const helpMenuText = 
          `❓ *Panduan Penggunaan Bot*\n\n` +
          `*📝 Cara Mencatat Transaksi:*\n` +
          `• Pengeluaran: \`kopi 25k\`, \`makan 30rb\`\n` +
          `• Pemasukan: \`gajian 5jt\`, \`bonus 500rb\`\n` +
          `• Multi-item: \`ayam 25k sama tempe 5rb\`\n` +
          `• Edit: \`bukan 25rb tapi 30rb\`\n` +
          `• Hapus: \`hapus kopi tadi\`\n\n` +
          `*📊 Cek Data:*\n` +
          `• \`saldo\` - Total saldo\n` +
          `• \`pengeluaran hari ini\`\n` +
          `• \`pengeluaran bulan ini\`\n\n` +
          `*📅 Langganan:*\n` +
          `• \`list langganan\`\n` +
          `• \`langganan netflix 186k tgl 5\`\n\n` +
          `*💡 AI Advisor:*\n` +
          `Ketik \`saran\` untuk analisis keuangan`;
        await sendTelegramTextMessage({ 
          chatId, 
          text: helpMenuText,
          replyMarkup: getMainMenuKeyboard()
        });
        return NextResponse.json({ ok: true });

      case '📝 Contoh Chat':
        const examplesMenuText = 
          `📝 *Contoh Chat dengan Bot*\n\n` +
          `*Pengeluaran:*\n` +
          `• \`kopi 25k\`\n` +
          `• \`beli bensin 50rb\`\n` +
          `• \`makan siang warteg 15 ribu\`\n` +
          `• \`bayar listrik 150.000\`\n` +
          `• \`belanja indomaret 75k\`\n\n` +
          `*Pemasukan:*\n` +
          `• \`gajian 5 juta\`\n` +
          `• \`dapat bonus 500rb\`\n` +
          `• \`terima transferan 1jt\`\n\n` +
          `*Multi-Item:*\n` +
          `• \`beli ayam 25k sama tempe 5rb\`\n` +
          `• \`kopi 20k dan roti 15k\`\n\n` +
          `*Edit/Hapus:*\n` +
          `• \`bukan 25rb tapi 30rb\`\n` +
          `• \`ubah jadi 20k\`\n` +
          `• \`hapus kopi tadi\`\n` +
          `• \`batalkan transaksi terakhir\`\n\n` +
          `Coba ketik sekarang! 💬`;
        await sendTelegramTextMessage({ 
          chatId, 
          text: examplesMenuText
        });
        return NextResponse.json({ ok: true });
    }

    // Process user input through the core expense business logic
    const result = await handleUserMessage(userText, String(chatId));

    // Send result back to Telegram
    await sendTelegramTextMessage({
      chatId,
      text: result.replyText
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Error handling Telegram webhook:', err);
    if (chatId) {
      await sendTelegramTextMessage({
        chatId,
        text: '⚠️ Terjadi kendala teknis saat memproses pesan Anda. Silakan coba lagi.'
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'online',
    message: 'Telegram Webhook Endpoint is active.'
  });
}

// ==================== MENU CALLBACK HANDLERS ====================

async function handleMenuCallback(chatId: string | number, callbackData: string): Promise<NextResponse> {
  let loadingMessageId: number | null = null;

  switch (callbackData) {
    case 'menu_main':
      const menuText = 
        `📋 *Menu Utama Bot Keuangan*\n\n` +
        `Pilih menu yang Anda butuhkan:`;
      await sendTelegramTextMessage({ 
        chatId, 
        text: menuText,
        replyMarkup: getMainMenuKeyboard()
      });
      break;

    case 'menu_catat':
      const catatText = 
        `✏️ *Catat Pengeluaran Cepat*\n\n` +
        `Pilih template atau ketik manual:\n` +
        `Contoh: \`beli makan siang 35rb\``;
      await sendTelegramTextMessage({ 
        chatId, 
        text: catatText,
        replyMarkup: getQuickTransactionKeyboard()
      });
      break;

    case 'menu_saldo':
      // Show loading indicator
      await sendChatAction(chatId, 'typing');
      loadingMessageId = await sendLoadingMessage(chatId, '💰 *Mengecek saldo...*\n⏳ Mohon tunggu sebentar...');
      
      const result = await handleUserMessage('saldo sekarang', String(chatId));
      
      // Edit loading message with result
      if (loadingMessageId) {
        await editTelegramMessage(chatId, loadingMessageId, result.replyText);
      } else {
        await sendTelegramTextMessage({ chatId, text: result.replyText });
      }
      break;

    case 'menu_laporan':
      const laporanText = 
        `📊 *Laporan Keuangan*\n\n` +
        `Pilih jenis laporan yang ingin dilihat:`;
      await sendTelegramTextMessage({ 
        chatId, 
        text: laporanText,
        replyMarkup: getReportOptionsKeyboard()
      });
      break;

    case 'menu_langganan':
      const subText = 
        `📅 *Kelola Langganan Bulanan*\n\n` +
        `Apa yang ingin Anda lakukan?`;
      await sendTelegramTextMessage({ 
        chatId, 
        text: subText,
        replyMarkup: getSubscriptionKeyboard()
      });
      break;

    case 'menu_saran':
      // Show loading indicator
      await sendChatAction(chatId, 'typing');
      loadingMessageId = await sendLoadingMessage(chatId, '💡 *Menganalisis keuangan Anda...*\n🤖 AI sedang bekerja, mohon tunggu...');
      
      const saranResult = await handleUserMessage('saran financial', String(chatId));
      
      // Edit loading message with result
      if (loadingMessageId) {
        await editTelegramMessage(chatId, loadingMessageId, saranResult.replyText);
      } else {
        await sendTelegramTextMessage({ chatId, text: saranResult.replyText });
      }
      break;

    case 'menu_scan':
      const scanText = 
        `📷 *Scan Struk Belanja*\n\n` +
        `Kirim foto struk belanja Anda, dan bot akan:\n` +
        `✅ Membaca semua item dengan OCR + AI\n` +
        `✅ Mendeteksi harga dan kategori\n` +
        `✅ Mencatat otomatis ke spreadsheet\n\n` +
        `💡 *Tips:*\n` +
        `• Pastikan foto jelas & tulisan terbaca\n` +
        `• Bisa tambahkan caption untuk tanggal khusus\n` +
        `• Contoh caption: \`kemarin\`, \`3 hari lalu\``;
      await sendTelegramTextMessage({ 
        chatId, 
        text: scanText,
        replyMarkup: getMainMenuKeyboard()
      });
      break;

    case 'menu_help':
      const helpText = 
        `❓ *Panduan Penggunaan Bot*\n\n` +
        `*📝 Cara Mencatat Transaksi:*\n` +
        `• Pengeluaran: \`kopi 25k\`, \`makan 30rb\`\n` +
        `• Pemasukan: \`gajian 5jt\`, \`bonus 500rb\`\n` +
        `• Multi-item: \`ayam 25k sama tempe 5rb\`\n` +
        `• Edit: \`bukan 25rb tapi 30rb\`\n` +
        `• Hapus: \`hapus kopi tadi\`\n\n` +
        `*📊 Cek Data:*\n` +
        `• \`saldo\` - Total saldo\n` +
        `• \`pengeluaran hari ini\`\n` +
        `• \`pengeluaran bulan ini\`\n\n` +
        `*📅 Langganan:*\n` +
        `• \`list langganan\`\n` +
        `• \`langganan netflix 186k tgl 5\`\n\n` +
        `*💡 AI Advisor:*\n` +
        `Ketik \`saran\` untuk analisis keuangan`;
      await sendTelegramTextMessage({ 
        chatId, 
        text: helpText,
        replyMarkup: getMainMenuKeyboard()
      });
      break;

    case 'menu_examples':
      const examplesText = 
        `📝 *Contoh Chat dengan Bot*\n\n` +
        `*Pengeluaran:*\n` +
        `• \`kopi 25k\`\n` +
        `• \`beli bensin 50rb\`\n` +
        `• \`makan siang warteg 15 ribu\`\n` +
        `• \`bayar listrik 150.000\`\n` +
        `• \`belanja indomaret 75k\`\n\n` +
        `*Pemasukan:*\n` +
        `• \`gajian 5 juta\`\n` +
        `• \`dapat bonus 500rb\`\n` +
        `• \`terima transferan 1jt\`\n\n` +
        `*Multi-Item:*\n` +
        `• \`beli ayam 25k sama tempe 5rb\`\n` +
        `• \`kopi 20k dan roti 15k\`\n\n` +
        `*Edit/Hapus:*\n` +
        `• \`bukan 25rb tapi 30rb\`\n` +
        `• \`ubah jadi 20k\`\n` +
        `• \`hapus kopi tadi\`\n` +
        `• \`batalkan transaksi terakhir\`\n\n` +
        `Coba ketik sekarang! 💬`;
      await sendTelegramTextMessage({ 
        chatId, 
        text: examplesText,
        replyMarkup: getMainMenuKeyboard()
      });
      break;
  }

  return NextResponse.json({ ok: true });
}

async function handleQuickTransaction(chatId: string | number, callbackData: string): Promise<NextResponse> {
  let transactionText = '';

  switch (callbackData) {
    case 'quick_kopi_25k':
      transactionText = 'beli kopi 25rb';
      break;
    case 'quick_makan_30k':
      transactionText = 'makan siang 30rb';
      break;
    case 'quick_bensin_50k':
      transactionText = 'isi bensin 50rb';
      break;
    case 'quick_parkir_5k':
      transactionText = 'parkir 5rb';
      break;
    case 'quick_belanja':
      const belanjaText = 
        `🛒 *Catat Belanja*\n\n` +
        `Ketik detail belanja Anda:\n` +
        `Contoh:\n` +
        `• \`belanja indomaret 75rb\`\n` +
        `• \`belanja sayur 25k\`\n` +
        `• \`belanja bulanan 500rb\`\n\n` +
        `Atau kirim foto struk untuk scan otomatis! 📷`;
      await sendTelegramTextMessage({ 
        chatId, 
        text: belanjaText,
        replyMarkup: getQuickTransactionKeyboard()
      });
      return NextResponse.json({ ok: true });
    case 'quick_kesehatan':
      const kesehatanText = 
        `💊 *Catat Pengeluaran Kesehatan*\n\n` +
        `Ketik detail pengeluaran:\n` +
        `Contoh:\n` +
        `• \`beli obat 50rb\`\n` +
        `• \`dokter 150rb\`\n` +
        `• \`cek lab 200rb\``;
      await sendTelegramTextMessage({ 
        chatId, 
        text: kesehatanText,
        replyMarkup: getQuickTransactionKeyboard()
      });
      return NextResponse.json({ ok: true });
  }

  if (transactionText) {
    // Show loading indicator
    await sendChatAction(chatId, 'typing');
    const loadingMessageId = await sendLoadingMessage(chatId, `✏️ *Mencatat transaksi...*\n⏳ _"${transactionText}"_`);
    
    const result = await handleUserMessage(transactionText, String(chatId));
    
    // Edit loading message with result
    if (loadingMessageId) {
      await editTelegramMessage(chatId, loadingMessageId, result.replyText);
    } else {
      await sendTelegramTextMessage({ chatId, text: result.replyText });
    }
  }

  return NextResponse.json({ ok: true });
}

async function handleReportCallback(chatId: string | number, callbackData: string): Promise<NextResponse> {
  let queryText = '';

  switch (callbackData) {
    case 'report_this_month':
      queryText = 'pengeluaran bulan ini';
      break;
    case 'report_last_month':
      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      const monthNames = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];
      queryText = `pengeluaran ${monthNames[lastMonth.getMonth()]}`;
      break;
    case 'report_by_category':
      queryText = 'pengeluaran per kategori bulan ini';
      break;
    case 'report_all':
      queryText = 'total pengeluaran semua waktu';
      break;
  }

  if (queryText) {
    // Show loading indicator
    await sendChatAction(chatId, 'typing');
    const loadingMessageId = await sendLoadingMessage(chatId, '📊 *Membuat laporan...*\n⏳ Mengumpulkan data transaksi...');
    
    const result = await handleUserMessage(queryText, String(chatId));
    
    // Edit loading message with result
    if (loadingMessageId) {
      await editTelegramMessage(chatId, loadingMessageId, result.replyText, getReportOptionsKeyboard());
    } else {
      await sendTelegramTextMessage({
        chatId,
        text: result.replyText,
        replyMarkup: getReportOptionsKeyboard()
      });
    }
  }

  return NextResponse.json({ ok: true });
}

async function handleSubscriptionCallback(chatId: string | number, callbackData: string): Promise<NextResponse> {
  let queryText = '';

  switch (callbackData) {
    case 'sub_list':
      queryText = 'list langganan';
      break;
    case 'sub_add':
      const addSubText = 
        `➕ *Tambah Langganan Baru*\n\n` +
        `Format:\n` +
        `\`langganan [nama] [harga] tgl [tanggal]\`\n\n` +
        `Contoh:\n` +
        `• \`langganan netflix 186k tgl 5\`\n` +
        `• \`langganan spotify 55rb tgl 1\`\n` +
        `• \`langganan gym 300k tgl 15\`\n\n` +
        `Ketik sekarang untuk menambahkan! 📝`;
      await sendTelegramTextMessage({ 
        chatId, 
        text: addSubText,
        replyMarkup: getSubscriptionKeyboard()
      });
      return NextResponse.json({ ok: true });
    case 'sub_reminders':
      queryText = 'reminder langganan bulan ini';
      break;
    case 'sub_total':
      queryText = 'total langganan per bulan';
      break;
  }

  if (queryText) {
    // Show loading indicator
    await sendChatAction(chatId, 'typing');
    const loadingMessageId = await sendLoadingMessage(chatId, '📅 *Memproses...*\n⏳ Mengambil data langganan...');
    
    const result = await handleUserMessage(queryText, String(chatId));
    
    // Edit loading message with result
    if (loadingMessageId) {
      await editTelegramMessage(chatId, loadingMessageId, result.replyText, getSubscriptionKeyboard());
    } else {
      await sendTelegramTextMessage({
        chatId,
        text: result.replyText,
        replyMarkup: getSubscriptionKeyboard()
      });
    }
  }

  return NextResponse.json({ ok: true });
}
