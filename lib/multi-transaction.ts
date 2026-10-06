/**
 * Pemecah pesan multi-transaksi.
 *
 * User sering mencatat beberapa transaksi dalam satu pesan:
 *   "makan 25k, bensin 50k, tol 7k"
 *   "gajian 5jt sama bonus 1jt"
 *
 * Modul ini memecah pesan tersebut menjadi beberapa segmen lalu mem-parsing
 * tiap segmen secara terpisah.
 *
 * Syarat AMAN agar tidak merusak pesan biasa:
 *  - Hanya aktif jika ada >= 2 segmen yang masing-masing menghasilkan intent
 *    RECORD_EXPENSE / RECORD_INCOME.
 *  - Jika satu saja segmen gagal, hasilnya dibatalkan dan pesan dikembalikan
 *    utuh ke parser normal.
 */

import { ParsedIntent } from '@/types';
import { parseMessage } from './parser';

/**
 * Pemisah keras: titik koma, newline, pipe, bullet, dan koma yang DIKUTI spasi.
 *
 * Koma hanya aman bila diikuti spasi, karena dalam penulisan Indonesia koma
 * juga dipakai sebagai tanda desimal ("25,000", "1,5jt") yang tidak boleh
 * dipecah.
 */
const HARD_SEPARATORS = /\s*(?:;|\n|\r|\||•|➜|→|,(?=\s)|\s*,\s+)\s*/;

/**
 * Pemisah kata.
 *
 * "dan" sengaja TIDAK dimasukkan di sini karena terlalu ambigu: muncul pada
 * "list pemasukan dan pengeluaran" (query) dan pada "makan 25k dan kopi 15k"
 * (dua transaksi). "dan" ditangani terpisah lewat DAN_SEPARATOR agar hanya
 * dipakai bila kedua sisi benar-benar menyebut nominal.
 */
const SOFT_SEPARATORS = /\s+(?:kemudian|terus|trus|habis\s+itu|setelah\s+itu|sama\s+dengan|ditambah|plus)\s+/gi;

/**
 * Pemisah "dan"/"sama" — hanya aman bila kedua sisi sama-sama punya nominal
 * dan kata itu bukan bagian dari frasa query.
 */
const DAN_SEPARATOR = /\s+(?:dan|sama|lewat)\s+/gi;

/**
 * Pecah satu pesan menjadi segmen-segmen kandidat transaksi.
 *
 * Mengembalikan array minimal 2 elemen, atau array kosong bila tidak ada
 * pemisah yang relevan.
 */
export function splitTransactionCandidates(text: string): string[] {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];

  let segments: string[] = [];

  // 1. Pemisah keras (koma, newline, titik koma) selalu aman untuk dipecah.
  if (HARD_SEPARATORS.test(trimmed)) {
    segments = trimmed.split(HARD_SEPARATORS).map((s) => s.trim()).filter(Boolean);
  } else {
    segments = [trimmed];
  }

  /**
   * Pecah lagi dengan kata penghubung, HANYA bila setiap bagian menyebut
   * nominal. Ini menjaga "list pemasukan dan pengeluaran" tetap utuh karena
   * tidak ada satupun bagiannya yang menyebut angka.
   */
  const hasAmount = (s: string) => /\d/.test(s);

  const refineWith = (source: string[], pattern: RegExp): string[] => {
    const refined: string[] = [];
    for (const seg of source) {
      const parts = seg.split(pattern).map((s) => s.trim()).filter(Boolean);
      if (parts.length > 1 && parts.every(hasAmount)) refined.push(...parts);
      else refined.push(seg);
    }
    return refined;
  };

  segments = refineWith(segments, SOFT_SEPARATORS);
  segments = refineWith(segments, DAN_SEPARATOR);

  // Buang segmen yang terlalu pendek (mis. "25k" sendirian) karena tidak
  // punya keterangan transaksi.
  segments = segments.filter((s) => s.length > 1);

  return segments.length >= 2 ? segments : [];
}

/**
 * Coba mem-parsing satu pesan sebagai beberapa transaksi.
 *
 * Mengembalikan daftar intent bila seluruh segmen berhasil jadi transaksi.
 * Mengembalikan null bila bukan multi-transaksi (caller memakai parsing normal).
 */
export function parseMultiTransaction(
  text: string,
  customCategoryMap?: Record<string, string[]>
): ParsedIntent[] | null {
  const segments = splitTransactionCandidates(text);
  if (!segments.length) return null;

  const RECORD_INTENTS: ParsedIntent['intent'][] = ['RECORD_EXPENSE', 'RECORD_INCOME'];

  const parsedSegments = segments.map((segment) => {
    const result = parseMessage(segment, customCategoryMap);
    return {
      segment,
      intent: result.intent,
      ok: RECORD_INTENTS.includes(result.intent) && Boolean(result.amount && result.amount > 0),
      parsed: result
    };
  });

  // Semua segmen harus benar-benar transaksi. Kalau ada yang gagal, jangan
  // pecah pesan; biarkan parser normal menanganinya sebagai satu pesan.
  if (!parsedSegments.every((s) => s.ok)) return null;

  return parsedSegments.map((s) => s.parsed);
}

/**
 * Deteksi apakah sekumpulan intent hanya expense, hanya income, atau campuran,
 * keperluan ringkasan. Mengembalikan 'mixed' bila keduanya tercampur.
 */
export function summarizeIntentKinds(intents: ParsedIntent[]): 'expense' | 'income' | 'mixed' {
  if (!intents.length) return 'mixed';
  const hasExpense = intents.some((i) => i.intent === 'RECORD_EXPENSE');
  const hasIncome = intents.some((i) => i.intent === 'RECORD_INCOME');
  if (hasExpense && hasIncome) return 'mixed';
  return hasIncome ? 'income' : 'expense';
}
