import { NextRequest, NextResponse } from 'next/server';
import { handleUserMessage } from '@/lib/transactions';
import { sendTelegramTextMessage } from '@/lib/telegram';
import { scanReceiptImage } from '@/lib/receipt-scanner';

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

    if (message) {
      chatId = message.chat?.id;
      userText = (message.text || '').trim();
    } else if (callbackQuery) {
      chatId = callbackQuery.message?.chat?.id;
      userText = (callbackQuery.data || '').trim();
    }

    if (!chatId) {
      return NextResponse.json({ ok: true });
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

            const scanResult = await scanReceiptImage(buffer, 'image/jpeg');
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

    // Special command: /start or /bantuan
    if (userText === '/start' || userText === '/help' || userText.toLowerCase() === 'bantuan') {
      const welcome = 
        `👋 *Halo! Saya Bot Catatan Keuangan Anda.*\n\n` +
        `Bot ini terhubung langsung ke Google Sheets Anda secara live!\n\n` +
        `💡 *Bebas Chat Tanpa Format Kaku:*\n` +
        `• \`beli kopi 25rb\` atau \`kopi 20k\`\n` +
        `• \`bensin 50k\` atau \`beli bensin 50.000\`\n` +
        `• \`makan siang nasi padang 25rb\`\n` +
        `• \`bayar listrik 150 ribu\`\n` +
        `• \`gajian 5.000.000\` atau \`dapat transferan 500rb\`\n` +
        `• \`pengeluaran hari ini\` atau \`saldo sekarang\`\n` +
        `• \`saran\` (AI Financial Advisor)\n` +
        `• Atau *kirim foto struk belanja* 📷\n\n` +
        `Coba ketik transaksi Anda sekarang santai saja!`;

      await sendTelegramTextMessage({ chatId, text: welcome });
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
