import { NextRequest, NextResponse } from 'next/server';
import { handleUserMessage } from '@/lib/transactions';
import { sendTelegramTextMessage } from '@/lib/telegram';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Check if it's a message or callback_query
    const message = body.message || body.channel_post;
    const callbackQuery = body.callback_query;

    let chatId: string | number | undefined;
    let userText = '';

    if (message) {
      chatId = message.chat?.id;
      userText = (message.text || '').trim();
    } else if (callbackQuery) {
      chatId = callbackQuery.message?.chat?.id;
      userText = (callbackQuery.data || '').trim();
    }

    if (!chatId || !userText) {
      return NextResponse.json({ ok: true });
    }

    // Special command: /start or /bantuan
    if (userText === '/start' || userText === '/help' || userText.toLowerCase() === 'bantuan') {
      const welcome = 
        `👋 *Halo! Saya Bot Catatan Keuangan Anda.*\n\n` +
        `Bot ini terhubung langsung ke Google Spreadsheet Anda secara live!\n\n` +
        `💡 *Contoh Perintah Chat:*\n` +
        `• \`keluar 25000 nasi padang\` (Catat pengeluaran)\n` +
        `• \`50k bensin #transport\` (Kategori otomatis)\n` +
        `• \`masuk 5000000 gaji\` (Catat pemasukan)\n` +
        `• \`ringkasan bulan\` (Rekap saldo & pengeluaran)\n` +
        `• \`hapus terakhir\` (Batalkan transaksi terakhir)\n` +
        `• \`saran\` (Analisa keuangan via AI Gemini)\n` +
        `• \`menu\` (Daftar perintah lengkap)\n\n` +
        `Coba ketik transaksi Anda sekarang!`;

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
  } catch (err) {
    console.error('Error handling Telegram webhook:', err);
    return NextResponse.json({ ok: true });
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'online',
    message: 'Telegram Webhook Endpoint is active.'
  });
}
