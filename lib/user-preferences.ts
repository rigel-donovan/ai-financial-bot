import { randomUUID } from 'node:crypto';

export interface UserPreference {
  userId: string;
  type: 'merchant_category' | 'amount_avg' | 'alias';
  key: string;
  value: string;
  count: number;
  lastUpdated: string;
}

// In-memory cache per userId dengan TTL 5 menit
const cache = new Map<string, { data: UserPreference[]; loadedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Get Sheets client (dynamic import to avoid circular dependency)
 */
function getSheetsClient(): any {
  try {
    const sheetsModule = require('./sheets');
    return sheetsModule.getSheetsClient ? sheetsModule.getSheetsClient() : null;
  } catch {
    return null;
  }
}

/**
 * Get all user preferences (dengan cache 5 menit)
 */
export async function getUserPreferences(userId: string): Promise<UserPreference[]> {
  const now = Date.now();
  const cached = cache.get(userId);
  
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const client = getSheetsClient();
  if (!client) {
    return [];
  }

  const { sheets, sheetId } = client;

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'user_preferences!A2:F'
    });

    const rows = res.data.values || [];
    const prefs: UserPreference[] = rows
      .filter((row: any) => row[0] === userId)
      .map((row: any) => ({
        userId: String(row[0]),
        type: String(row[1]) as 'merchant_category' | 'amount_avg' | 'alias',
        key: String(row[2]),
        value: String(row[3]),
        count: Number(row[4]) || 1,
        lastUpdated: String(row[5])
      }));

    cache.set(userId, { data: prefs, loadedAt: now });
    return prefs;
  } catch (err) {
    console.error('[getUserPreferences] Error:', err);
    return [];
  }
}

/**
 * Learn from transaction: update merchant→category dan amount_avg
 */
export async function learnFromTransaction(
  userId: string,
  note: string,
  category: string,
  amount: number
): Promise<void> {
  if (!userId || !note || !category || amount <= 0) return;

  const client = getSheetsClient();
  if (!client) return;

  const { sheets, sheetId } = client;

  try {
    // 1. Merchant category mapping
    const merchantKey = note.toLowerCase().trim();
    if (merchantKey.length > 2 && merchantKey.length < 50) {
      await upsertPreference(sheets, sheetId, userId, 'merchant_category', merchantKey, category);
    }

    // 2. Amount average (simplified: store latest amount as "avg" for now)
    const avgKey = `${merchantKey.substring(0, 20)}_amt`;
    await upsertPreference(sheets, sheetId, userId, 'amount_avg', avgKey, String(amount));

    // Invalidate cache
    cache.delete(userId);
  } catch (err) {
    console.error('[learnFromTransaction] Error:', err);
  }
}

/**
 * Suggest category berdasarkan learned preferences + default keywords
 */
export async function suggestCategory(
  userId: string,
  text: string,
  fallback: string,
  customKeywords?: Record<string, string[]>
): Promise<string> {
  const prefs = await getUserPreferences(userId);
  const lowerText = text.toLowerCase();

  // Cek learned merchant→category
  for (const pref of prefs) {
    if (pref.type === 'merchant_category' && lowerText.includes(pref.key)) {
      return pref.value;
    }
  }

  // Fallback ke default keywords
  if (customKeywords) {
    for (const [category, keywords] of Object.entries(customKeywords)) {
      for (const kw of keywords) {
        if (lowerText.includes(kw.toLowerCase())) {
          return category;
        }
      }
    }
  }

  return fallback;
}

/**
 * Suggest amount berdasarkan merchant hint
 */
export async function suggestAmount(userId: string, merchantHint: string): Promise<number | null> {
  if (!merchantHint) return null;

  const prefs = await getUserPreferences(userId);
  const lowerHint = merchantHint.toLowerCase().trim().substring(0, 20);
  const avgKey = `${lowerHint}_amt`;

  for (const pref of prefs) {
    if (pref.type === 'amount_avg' && pref.key === avgKey) {
      const amt = Number(pref.value);
      return amt > 0 ? amt : null;
    }
  }

  return null;
}

/**
 * Upsert preference ke Sheets (internal helper)
 */
async function upsertPreference(
  sheets: any,
  sheetId: string,
  userId: string,
  type: string,
  key: string,
  value: string
): Promise<void> {
  // Simplified: append new row (untuk production, consider UPSERT logic)
  const now = new Date().toISOString();
  
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'user_preferences!A:F',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[userId, type, key, value, 1, now]]
    }
  });
}
