import { NextResponse } from 'next/server';
import { setTelegramBotCommands } from '@/lib/telegram';

/**
 * Endpoint to setup Telegram bot commands menu
 * Call this once after deploying to initialize bot commands
 * GET /api/telegram/setup-commands
 */
export async function GET() {
  try {
    const success = await setTelegramBotCommands();

    if (success) {
      return NextResponse.json({
        success: true,
        message: 'Bot commands setup successfully! Users can now see commands when typing / in Telegram.',
        commands: [
          '/start - Panduan awal & info bot',
          '/menu - Menu utama fitur bot',
          '/catat - Catat pengeluaran cepat',
          '/saldo - Cek saldo & ringkasan',
          '/laporan - Laporan keuangan bulan ini',
          '/langganan - Kelola langganan bulanan',
          '/saran - Saran financial AI',
          '/help - Bantuan & contoh penggunaan'
        ]
      });
    } else {
      return NextResponse.json({
        success: false,
        message: 'TELEGRAM_BOT_TOKEN is not configured. Please set it in environment variables.'
      }, { status: 500 });
    }
  } catch (error: any) {
    console.error('Error setting up bot commands:', error);
    return NextResponse.json({
      success: false,
      message: 'Failed to setup bot commands',
      error: error.message
    }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
