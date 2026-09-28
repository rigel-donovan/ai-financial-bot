interface SendTelegramOptions {
  chatId: string | number;
  text: string;
}

export function isTelegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

/**
 * Send text message to Telegram user/chat
 */
export async function sendTelegramTextMessage({ chatId, text }: SendTelegramOptions): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN is not configured.');
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    // Try sending with Markdown formatting first
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown'
      })
    });

    if (res.ok) {
      return true;
    }

    // If Telegram rejects due to markdown parsing, fallback to plain text
    const fallbackRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    });

    return fallbackRes.ok;
  } catch (err) {
    console.error('Failed to send Telegram message:', err);
    return false;
  }
}
