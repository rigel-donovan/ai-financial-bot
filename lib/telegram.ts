interface SendTelegramOptions {
  chatId: string | number;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
}

interface TelegramReplyMarkup {
  inline_keyboard?: TelegramInlineButton[][];
  keyboard?: TelegramKeyboardButton[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
}

interface TelegramInlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

interface TelegramKeyboardButton {
  text: string;
}

export function isTelegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

function normalizeTelegramCommand(text: string): string {
  return text.trim().toLowerCase().replace(/@\w+$/, '');
}

export function isTelegramMenuRequest(text: string): boolean {
  return /^(?:\/menu|menu(?:\s+(?:utama|dong|ya|please|bot))?|(?:tolong\s+)?(?:tampilkan|lihat|buka)\s+menu|mau\s+menu)$/.test(
    normalizeTelegramCommand(text)
  );
}

export function isTelegramHelpRequest(text: string): boolean {
  return /^(?:\/(?:help|bantuan|panduan)|(?:bantuan|panduan|help)(?:\s+(?:dong|ya|please|me|penggunaan(?:\s+bot)?|bot|ini))?|cara\s+(?:pakai|pake|menggunakan|penggunaan)(?:\s+bot)?|gimana(?:\s+cara(?:nya)?)?(?:\s+(?:pakai|pake|menggunakan))?|tolong\s+(?:bantu|bantuan)|minta\s+bantuan|butuh\s+bantuan|bisa\s+apa(?:\s+saja)?|perintah)$/.test(
    normalizeTelegramCommand(text)
  );
}

/**
 * Send text message to Telegram user/chat with optional reply markup (buttons)
 */
export async function sendTelegramTextMessage({ chatId, text, replyMarkup }: SendTelegramOptions): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN is not configured.');
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  // Escape underscores in URL text because Telegram legacy Markdown otherwise
  // treats them as formatting delimiters and can corrupt a spreadsheet ID.
  const telegramText = text.replace(/https?:\/\/[^\s]+/g, (link) =>
    link.replace(/_/g, '\\_')
  );

  try {
    // Try sending with Markdown formatting first
    const payload: any = {
      chat_id: chatId,
      text: telegramText,
      parse_mode: 'Markdown'
    };

    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      return true;
    }

    // If Telegram rejects due to markdown parsing, fallback to plain text
    const fallbackPayload: any = {
      chat_id: chatId,
      text
    };

    if (replyMarkup) {
      fallbackPayload.reply_markup = replyMarkup;
    }

    const fallbackRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fallbackPayload)
    });

    return fallbackRes.ok;
  } catch (err) {
    console.error('Failed to send Telegram message:', err);
    return false;
  }
}

/**
 * Send chat action (typing, upload_photo, etc) to show bot is working
 */
export async function sendChatAction(chatId: string | number, action: 'typing' | 'upload_photo' | 'upload_document' = 'typing'): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;

  const url = `https://api.telegram.org/bot${token}/sendChatAction`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        action
      })
    });

    return res.ok;
  } catch (err) {
    console.error('Failed to send chat action:', err);
    return false;
  }
}

/**
 * Send a loading message that can be edited later
 * Returns message_id for editing
 */
export async function sendLoadingMessage(chatId: string | number, loadingText: string): Promise<number | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: loadingText
      })
    });

    if (res.ok) {
      const data = await res.json();
      return data.result?.message_id || null;
    }
    return null;
  } catch (err) {
    console.error('Failed to send loading message:', err);
    return null;
  }
}

/**
 * Edit an existing message by message_id
 */
export async function editTelegramMessage(
  chatId: string | number,
  messageId: number,
  text: string,
  replyMarkup?: TelegramReplyMarkup
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;

  const url = `https://api.telegram.org/bot${token}/editMessageText`;
  const telegramText = text.replace(/https?:\/\/[^\s]+/g, (link) =>
    link.replace(/_/g, '\\_')
  );

  try {
    const payload: any = {
      chat_id: chatId,
      message_id: messageId,
      text: telegramText,
      parse_mode: 'Markdown'
    };

    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      return true;
    }

    // Fallback without markdown
    const fallbackPayload: any = {
      chat_id: chatId,
      message_id: messageId,
      text
    };

    if (replyMarkup) {
      fallbackPayload.reply_markup = replyMarkup;
    }

    const fallbackRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fallbackPayload)
    });

    return fallbackRes.ok;
  } catch (err) {
    console.error('Failed to edit message:', err);
    return false;
  }
}

/**
 * Set bot commands menu that appears when user types /
 */
export async function setTelegramBotCommands(): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN is not configured.');
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/setMyCommands`;
  const commands = [
    { command: 'start', description: '🏠 Panduan awal & info bot' },
    { command: 'menu', description: '📋 Menu utama fitur bot' },
    { command: 'catat', description: '✏️ Catat pengeluaran cepat' },
    { command: 'saldo', description: '💰 Cek saldo & ringkasan' },
    { command: 'laporan', description: '📊 Laporan keuangan bulan ini' },
    { command: 'langganan', description: '📅 Kelola langganan bulanan' },
    { command: 'saran', description: '💡 Saran financial AI' },
    { command: 'help', description: '❓ Bantuan & contoh penggunaan' }
  ];

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands })
    });

    return res.ok;
  } catch (err) {
    console.error('Failed to set Telegram bot commands:', err);
    return false;
  }
}

/**
 * Get persistent reply keyboard (always visible at bottom of chat)
 * This keyboard appears below the text input and persists across messages
 */
export function getPersistentReplyKeyboard(): TelegramReplyMarkup {
  return {
    keyboard: [
      [
        { text: '✏️ Catat Pengeluaran' },
        { text: '💰 Cek Saldo' }
      ],
      [
        { text: '📊 Laporan Bulan Ini' },
        { text: '📅 Kelola Langganan' }
      ],
      [
        { text: '💡 Saran AI' },
        { text: '📷 Scan Struk' }
      ],
      [
        { text: '❓ Bantuan' },
        { text: '📝 Contoh Chat' }
      ]
    ],
    resize_keyboard: true,
    one_time_keyboard: false // Keep keyboard visible after use
  };
}

/**
 * Remove reply keyboard (hide the persistent keyboard)
 */
export function removeReplyKeyboard(): any {
  return {
    remove_keyboard: true
  };
}

/**
 * Get main menu inline keyboard
 */
export function getMainMenuKeyboard(): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✏️ Catat Pengeluaran', callback_data: 'menu_catat' },
        { text: '💰 Cek Saldo', callback_data: 'menu_saldo' }
      ],
      [
        { text: '📊 Laporan Bulan Ini', callback_data: 'menu_laporan' },
        { text: '📅 Kelola Langganan', callback_data: 'menu_langganan' }
      ],
      [
        { text: '💡 Saran AI', callback_data: 'menu_saran' },
        { text: '📷 Scan Struk', callback_data: 'menu_scan' }
      ],
      [
        { text: '❓ Bantuan', callback_data: 'menu_help' },
        { text: '📝 Contoh Chat', callback_data: 'menu_examples' }
      ]
    ]
  };
}

/**
 * Get quick transaction templates keyboard
 */
export function getQuickTransactionKeyboard(): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      [
        { text: '☕ Kopi 25k', callback_data: 'quick_kopi_25k' },
        { text: '🍜 Makan 30k', callback_data: 'quick_makan_30k' }
      ],
      [
        { text: '⛽ Bensin 50k', callback_data: 'quick_bensin_50k' },
        { text: '🚗 Parkir 5k', callback_data: 'quick_parkir_5k' }
      ],
      [
        { text: '🛒 Belanja', callback_data: 'quick_belanja' },
        { text: '💊 Kesehatan', callback_data: 'quick_kesehatan' }
      ],
      [
        { text: '🔙 Kembali ke Menu', callback_data: 'menu_main' }
      ]
    ]
  };
}

/**
 * Get report options keyboard
 */
export function getReportOptionsKeyboard(): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📅 Bulan Ini', callback_data: 'report_this_month' },
        { text: '📆 Bulan Lalu', callback_data: 'report_last_month' }
      ],
      [
        { text: '📊 Per Kategori', callback_data: 'report_by_category' },
        { text: '📈 Total Semua', callback_data: 'report_all' }
      ],
      [
        { text: '🔙 Kembali ke Menu', callback_data: 'menu_main' }
      ]
    ]
  };
}

/**
 * Get subscription management keyboard
 */
export function getSubscriptionKeyboard(): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      [
        { text: '📋 List Langganan', callback_data: 'sub_list' },
        { text: '➕ Tambah Baru', callback_data: 'sub_add' }
      ],
      [
        { text: '🔔 Reminder Aktif', callback_data: 'sub_reminders' },
        { text: '💰 Total per Bulan', callback_data: 'sub_total' }
      ],
      [
        { text: '🔙 Kembali ke Menu', callback_data: 'menu_main' }
      ]
    ]
  };
}
