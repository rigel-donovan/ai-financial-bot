/**
 * Memori percakapan per pengguna.
 *
 * Bot ini stateless (setiap pesan diproses sendiri), padahal chat dunia nyata
 * berurutan: "makan siang 25rb" → "terus bensin?" → "hapus yang tadi".
 * Modul ini menyimpan konteks singkat antar pesan supaya perintah lanjutan
 * bisa dipahami.
 *
 * Penyimpanan: in-memory Map per instance serverless.
 * - Tidak menambah latency (tidak memanggil jaringan)
 * - Kehilangan konteks saat instance restart adalah perilaku yang dapat diterima
 *   (user cukup mengulang capitalize: perintahnya sendiri akan gagal baik).
 */

import { IntentType } from '@/types';

/** Konteks satu round-of-chat untuk satu pengguna. */
export interface ConversationContext {
  /** Intent terakhir yang berhasil dipahami. */
  lastIntent?: IntentType;
  /** Ringkasan transaksi terakhir yang tercatat/diedit. */
  lastTransaction?: {
    type: 'expense' | 'income';
    amount: number;
    note?: string;
    category?: string;
    date?: string;
  };
  /** Periode terakhir yang ditanyakan (untuk "yang kemarin?", "periode tadi?"). */
  lastPeriod?: {
    period?: 'day' | 'week' | 'month' | 'year';
    targetDate?: string;
    startDate?: string;
    endDate?: string;
    displayDate?: string;
  };
  /** Kategori terakhir yang difilter (untuk "yang kategori food?"). */
  lastCategory?: string;
  /** Frasa/transaksi yang belum lengkap, mis. user kirim "catat kopi" tanpa nominal. */
  pending?: {
    intent: 'RECORD_EXPENSE' | 'RECORD_INCOME';
    note?: string;
    category?: string;
  };
  updatedAt: number;
}

/** Sesi aktif menerima pembaruan selama ini (ms). */
const SESSION_TTL_MS = 15 * 60 * 1000;

/** Batas jumlah sesi yang disimpan, untuk mencegah memori membengkak. */
const MAX_SESSIONS = 500;

const sessions = new Map<string, ConversationContext>();

function prune(now: number): void {
  for (const [key, value] of sessions) {
    if (now - value.updatedAt > SESSION_TTL_MS) sessions.delete(key);
  }

  // Buang sesi terlama bila kuota terlampaui.
  while (sessions.size > MAX_SESSIONS) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, value] of sessions) {
      if (value.updatedAt < oldestTime) {
        oldestTime = value.updatedAt;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    sessions.delete(oldestKey);
  }
}

/** Ambil konteks percakapan user. Selalu mengembalikan objek (tidak null). */
export function getContext(userId?: string): ConversationContext {
  const key = userId || '__anonymous__';
  const now = Date.now();
  prune(now);

  const existing = sessions.get(key);
  if (existing) return existing;

  const fresh: ConversationContext = { updatedAt: now };
  sessions.set(key, fresh);
  return fresh;
}

/**
 * Perbarui konteks setelah satu pesan diproses.
 *
 * Sengaja tidak menyimpan konten sensitif atau nominal lengkap dari setiap
 * pesan; hanya ringkasan yang dibutuhkan untuk memahami perintah lanjutan.
 */
export function updateContext(
  userId: string | undefined,
  intent: IntentType,
  details: {
    transaction?: ConversationContext['lastTransaction'];
    period?: ConversationContext['lastPeriod'];
    category?: string;
    pending?: ConversationContext['pending'];
  } = {}
): void {
  const key = userId || '__anonymous__';
  const now = Date.now();
  prune(now);

  const ctx = sessions.get(key) || { updatedAt: now };

  ctx.lastIntent = intent;
  ctx.updatedAt = now;

  if (details.transaction) ctx.lastTransaction = details.transaction;
  if (details.period) ctx.lastPeriod = details.period;
  if (details.category) ctx.lastCategory = details.category;
  if (details.pending) ctx.pending = details.pending;
  else delete ctx.pending;

  sessions.set(key, ctx);
}

/** Hapus konteks (dipakai saat sesi selesai eksplisit, mis. "menu"). */
export function clearContext(userId?: string): void {
  sessions.delete(userId || '__anonymous__');
}

/** Hanya untuk keperluan tes: jumlah sesi aktif. */
export function __sessionCount(): number {
  return sessions.size;
}
