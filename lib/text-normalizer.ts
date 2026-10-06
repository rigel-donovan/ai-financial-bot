/**
 * Layer normalisasi bahasa alami.
 *
 * Tujuan: mengubah pesan mentah user yang santai (slang, typo, angka terverbal,
 * emoji, kata pengisi) menjadi bentuk stabil supaya rule-based parser dan AI NLU
 * lebih mudah mengenali maksudnya.
 *
 * Prinsip: transformasi harus konservatif. Kalau ragu, teks dibiarkan apa adanya
 * daripada berubah makna.
 */

/** Kata ganti persona & partikel gaul yang tidak menambah makna. */
const SLANG_MAP: Record<string, string> = {
  wkwk: '', wkw: '', wk: '', bvb: '', hehe: '',
  gw: '', gue: '', gua: '', aku: '', ane: '', aya: 'saya',
  lo: '', lu: '', km: ''
};

// Catatan: "abis", "makan", "keluar", "bayar" sengaja TIDAK dipetakan di sini
// karena kata-kata itu sudah punya makna spesifik di parser.

/** Slang → bentuk baku (dipisah agar mudah dirawat). */
const SLANG_FORMAL: Record<string, string> = {
  duit: 'uang',
  doku: 'uang',
  bokek: 'uang',
  brapa: 'berapa',
  brp: 'berapa',
  bera: 'berapa',
  berpa: 'berapa',
  bgitu: 'begitu',
  gitu: 'begitu',
  mgkn: 'mungkin',
  mngkin: 'mungkin',
  beliin: 'beli',
  pesen: 'pesan',
  req: 'request',
  gajian: 'gaji',
  showcash: 'tunai',
  cash: 'tunai',
  cbrid: 'transfer',
  muter: 'muter',
  otr: 'otomatis',
  aut: 'otomatis',
  auts: 'otomatis',
  nflx: 'netflix',
  nflix: 'netflix',
  spotfy: 'spotify',
  kopis: 'kopi',
  mrtb: 'martabak',
  mart: 'martabak',
  indomiet: 'indomaret',
  alfamiet: 'alfamart',
  bbm: 'bensin',
  pertmax: 'pertamax',
  pertalite: 'pertalite',
  otomotif: 'otomotif',
  rekve: 'rekening',
  rekning: 'rekening',
  struk: 'struk',
  kuitansi: 'kwitansi'
};

/** Typo umum → kata baku. */
const TYPO_MAP: Record<string, string> = {
  pngeluaran: 'pengeluaran',
  pengeluar: 'pengeluaran',
  pengeluan: 'pengeluaran',
  pengelaran: 'pengeluaran',
  pengeluaranya: 'pengeluaran',
  pmsukan: 'pemasukan',
  pemesukan: 'pemasukan',
  pmasukan: 'pemasukan',
  lggnanan: 'langganan',
  lngganan: 'langganan',
  langgan: 'langganan',
  langgann: 'langganan',
  subskripsi: 'langganan',
  subcrib: 'langganan',
  rutinn: 'rutin',
  rutn: 'rutin',
  hsl: 'hasil',
  hslx: 'hasil',
  hsil: 'hasil',
  jml: 'jumlah',
  jmlh: 'jumlah',
  totl: 'total',
  totsl: 'total',
  sldo: 'saldo',
  hrini: 'hari ini',
  hri: 'hari',
  kmrn: 'kemarin',
  kmrin: 'kemarin',
  kmr: 'kemarin',
  bgt: 'banget',
  bngt: 'banget',
  bnget: 'banget',
  dgn: 'dengan',
  yg: 'yang',
  klo: 'kalau',
  kl: 'kalau',
  tlg: 'tolong',
  msh: 'masih',
  msti: 'masih',
  blm: 'belum',
  udh: 'udah',
  skrg: 'sekarang',
  hrs: 'harus',
  hrg: 'harga',
  byr: 'bayar',
  mksh: 'makasih',
  tq: 'makasih',
  thx: 'makasih',
  td: 'tadi',
  tdi: 'tadi',
  kpn: 'kapan',
  brgk: 'berapa',
  brgki: 'berapa',
  brngk: 'berapa',
  pembelanjaan: 'belanja',
  pengeluarann: 'pengeluaran',
  transaks: 'transaksi',
  transksi: 'transaksi',
  kategori: 'kategori',
  kateori: 'kategori',
  katgori: 'kategori'
};

/**
 * Kata pengisi: dibuang hanya di posisi awal / akhir kalimat supaya isi
 * kalimat tetap utuh.
 */
const FILLER_WORDS = [
  'tolong', 'tolong2', 'dong', 'dong2', 'silakan', 'tuh', 'sih', 'deh', 'dehh',
  'kok', 'ya', 'yaa', 'yaaa', 'kak', 'bang', 'mas', 'mba', 'mbak', 'gan',
  'bro', 'sis', 'saya', 'aku', 'gw', 'gue', 'gua', 'nih', 'eh', 'ah', 'oh',
  'wah', 'oke', 'ok', 'hai', 'halo', 'hei', 'hi', 'lho'
];

/** Emoji & simbol dekoratif. */
const EMOJI_OR_SYMBOLS = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{2764}\u{00A9}\u{00AE}]/gu;

/**
 * Vocabulary untuk deteksi typo fuzzy.
 * SENGJAJA pendek & hanya berisi kata kunci intent/kategori agar kata biasa
 * tidak ikut tertukar.
 */
const FUZZY_VOCAB = [
  'pengeluaran', 'pemasukan', 'transaksi', 'kategori', 'langganan', 'rutin',
  'rekap', 'ringkasan', 'laporan', 'saldo', 'jumlah', 'terbanyak', 'terbesar',
  'bandingkan', 'statistik', 'makanan', 'transferan', 'listrik', 'hasil',
  'total', 'bayar', 'terbesar'
];

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev: number[] = new Array(b.length + 1);
  let curr: number[] = new Array(b.length + 1);

  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length];
}

function matchCase(replacement: string, original: string): string {
  if (!original) return replacement;
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/**
 * Perbaiki typo ringan via fuzzy matching pada vocabulary terbatas.
 * Konservatif: hanya token panjang >= 7 dan jarak edit <= 1.
 */
function fixTyposFuzzy(token: string): string {
  const lower = token.toLowerCase();
  if (lower.length < 7) return token;

  for (const word of FUZZY_VOCAB) {
    if (word.length < 7) continue;
    if (Math.abs(word.length - lower.length) > 1) continue;
    if (levenshtein(lower, word) <= 1) return matchCase(word, token);
  }
  return token;
}

/* ------------------------------------------------------------------ *
 * Angka terverbal ("dua puluh lima ribu" → 25000)
 * ------------------------------------------------------------------ */

const MULTIPLIERS: Record<string, number> = {
  rb: 1000,
  k: 1000,
  ribu: 1000,
  jt: 1_000_000,
  juta: 1_000_000,
  jtan: 1_000_000,
  miliar: 1_000_000_000,
  miliaran: 1_000_000_000,
  m: 1_000_000
};

/** Kata satuan (nilai < 10). */
const BASE_WORDS: Record<string, number> = {
  nol: 0,
  satu: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  delapan: 8,
  sembilan: 9
};

/**
 * Kata majemuk & satuan ("belas", "puluh", "ratus", "seratus", ...).
 * Teks dipecah per kata sebelum diproses, sehingga "dua belas" tiba sebagai
 * ["dua", "belas"] dan harus digabung ulang lewat tabel ini.
 */
/**
 * Kata yang berdiri sendiri sebagai nilai utuh (bukan pengali digit sebelumnya).
 * "sepuluh" = 10, "seratus" = 100, "seribu" = 1000.
 */
const STANDALONE_NUMBERS: Record<string, number> = {
  sepuluh: 10,
  sebelas: 11,
  seratus: 100,
  seribu: 1000,
  sejuta: 1_000_000,
  semiliar: 1_000_000_000
};

/**
 * Kata yang mengalikan digit yang mendahuluinya.
 * "dua puluh" = 20, "lima ratus" = 500.
 */
const MULTIPLIED_BY_PREV_DIGIT: Record<string, number> = {
  puluh: 10,
  ratus: 100
};

/**
 * Kata yang menambah 10 ke digit sebelumnya.
 * "dua belas" = 12 (bukan 20).
 */
const PLUS_TEN: Record<string, number> = {
  belas: 10
};

/**
 * Gabungan seluruh kata majemuk, dipakai untuk penyusunan regex & validasi.
 */
const COMPOUND_BASE: Record<string, number> = {
  ...STANDALONE_NUMBERS,
  ...MULTIPLIED_BY_PREV_DIGIT,
  ...PLUS_TEN
};

/**
 * Kata yang menyatakan jumlah tanpa nominal pasti. Frasa yang mengandung kata
 * ini TIDAK boleh dikonversi jadi angka, karena akan mengubah makna.
 */
const VAGUE_QUANTITY_WORDS = new Set(['ribuan', 'jutaan', 'miliaran', 'ratusan', 'banyak']);

/**
 * Kata-kata angka yang dikenali. Urutan alternate diurutkan dari yang terpanjang
 * supaya frasa majemuk dicoba sebelum kata tunggalnya.
 */
const NUMBER_WORD_LIST = [...new Set([
  ...Object.keys(MULTIPLIERS),
  ...Object.keys(BASE_WORDS),
  ...Object.keys(COMPOUND_BASE)
])].sort((a, b) => b.length - a.length);

/**
 * Cocokkan satu RUN kata angka berurutan, mis. "satu juta lima ratus ribu".
 * Seluruh run diproses sebagai satu kesatuan agar tidak terpecah
 * ("dua puluh lima ribu" tidak boleh jadi "20 5 ribu").
 */
const NUMBER_WORD_RE = new RegExp(
  '\\b(?:' + NUMBER_WORD_LIST.join('|') + ')(?:[\\s_]+(?:' + NUMBER_WORD_LIST.join('|') + '))*\\b',
  'gi'
);

/** Semua kata angka yang valid untuk pencocokan. */
const ALL_NUMBER_WORDS = new Set(NUMBER_WORD_LIST);

/**
 * Ubah rangkaian angka terverbal menjadi angka arab.
 * Conservative: hanya mengubah bila rangkaian itu memang bisa dihitung.
 *
 * Contoh:
 *   "dua puluh lima ribu" → "25000"
 *   "seratus lima puluh"  → "150"
 *   "satu juta"           → "1000000"
 *   "ribu"                → "ribu"   (dibiarkan)
 */
export function convertWordNumbers(text: string): string {
  return text.replace(NUMBER_WORD_RE, (match) => {
    const tokens = match.toLowerCase().split(/[\s_]+/).filter(Boolean);
    if (!tokens.length) return match;
    if (!tokens.every((t) => ALL_NUMBER_WORDS.has(t))) return match;

    // Frasa yang hanya menyatakan "banyak", bukan nominal pasti.
    if (tokens.some((t) => VAGUE_QUANTITY_WORDS.has(t))) return match;

    /**
     * Syarat mutlak: harus ada minimal satu kata yang benar-benar menyatakan
     * nilai ("lima", "seratus", "seribu"). Tanpa itu, kata satuan sendirian
     * seperti "ribu"/"juta" tidak boleh diubah karena tidak menyebut nominal.
     */
    const hasNumericWord = tokens.some(
      (t) => BASE_WORDS[t] !== undefined || COMPOUND_BASE[t] !== undefined
    );
    if (!hasNumericWord) return match;

    /**
     * Bentuk "se-" dibuka menjadi "satu <nilai>" sehingga "seratus lima puluh"
     * memberi hasil yang sama dengan "satu ratus lima puluh":
     *   seratus → "satu ratus", sejuta → "satu juta", dst.
     */
    const expanded = tokens.flatMap((token) => {
      switch (token) {
        case 'sepuluh': return ['satu', 'puluh'];
        case 'sebelas': return ['satu', 'belas'];
        case 'seratus': return ['satu', 'ratus'];
        case 'seribu': return ['satu', 'ribu'];
        case 'sejuta': return ['satu', 'juta'];
        case 'semiliar': return ['satu', 'miliar'];
        default: return [token];
      }
    });

    /**
     * Dekomposisi ala bahasa Indonesia dilakukan per KELOMPOK, dipisahkan
     * pengali besar (ribu/juta/miliar). Isi satu kelompok (satuan..ratusan)
     * dijumlahkan dulu, lalu kelompok dikalikan pangkatnya dan ditambahkan ke
     * total. Dengan begini "seratus lima puluh ribu" = (100 + 50) × 1000.
     *
     * Contoh:
     *   "dua puluh lima ribu"   → (20 + 5) × 1000 = 25.000
     *   "satu juta lima ratus ribu" → (1) × 1jt + (500) × 1000
     */
    let total = 0;
    let group = 0;    // nilai yang sedang dibangun dalam satu kelompok (< 1000)
    let pending = 0;  // digit satuan yang belum menemukan posisinya

    for (const token of expanded) {
      // Pengali besar menutup kelompok berjalan: (kelompok × pangkat) → total.
      if (MULTIPLIERS[token] !== undefined) {
        const value = (group + pending) || 1;
        total += value * MULTIPLIERS[token];
        group = 0;
        pending = 0;
        continue;
      }

      if (MULTIPLIED_BY_PREV_DIGIT[token] !== undefined) {
        // "dua puluh" = 2×10, "lima ratus" = 5×100 → ditempelkan ke kelompok.
        group += (pending || 1) * MULTIPLIED_BY_PREV_DIGIT[token];
        pending = 0;
        continue;
      }

      if (PLUS_TEN[token] !== undefined) {
        // "dua belas" = 10 + 2 (bukan 2 × 10).
        group += PLUS_TEN[token] + pending;
        pending = 0;
        continue;
      }

      // Kata satuan (nol..sembilan) menunggu kata puluh/ratus/belas/pengali.
      pending += BASE_WORDS[token] ?? 0;
    }

    const result = total + group + pending;
    if (!Number.isFinite(result) || result <= 0) return match;
    return String(result);
  });
}

/**
 * Normalisasi utama pesan user.
 *
 * - membuang emoji & simbol dekoratif
 * - membuang kata pengisi di awal / akhir kalimat
 * - memperbaiki typo & slang
 * - mengonversi angka terverbal
 * - merapikan spasi & tanda baca berlebih
 */
export function normalizeText(raw: string): string {
  if (!raw) return '';

  let text = String(raw).replace(EMOJI_OR_SYMBOLS, ' ');
  text = text.replace(/[*_~`]+/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  // Buang kata pengisi di awal & akhir (satu per iterasi, dibatasi).
  for (let guard = 0; guard < 6; guard++) {
    const before = text;
    const leading = text.match(new RegExp('^(?:' + FILLER_WORDS.join('|') + ')\\s*[,;:-]?\\s+', 'i'));
    if (leading) text = text.slice(leading[0].length);
    const trailing = text.match(new RegExp('[,;:-]?\\s+(?:' + FILLER_WORDS.join('|') + ')\\s*[,;:-]?\\s*$', 'i'));
    if (trailing) text = text.slice(0, text.length - trailing[0].length).trim();
    if (text === before) break;
  }

  // Buang kata pengisi yang menggantung sebelum tanda baca, mis.
  // "catet dong, beli kopi" → "catet beli kopi".
  text = text.replace(
    new RegExp('\\b(?:' + FILLER_WORDS.join('|') + ')\\s*[,;:-]+\\s*', 'gi'),
    ''
  );

  // Perbaiki kata per kata.
  text = text
    .split(/\s+/)
    .map((token) => {
      const bare = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (!bare) return token;

      const lower = bare.toLowerCase();

      if (TYPO_MAP[lower] !== undefined) {
        return token.replace(bare, matchCase(TYPO_MAP[lower], bare));
      }
      if (SLANG_MAP[lower] !== undefined) {
        return token.replace(bare, SLANG_MAP[lower]);
      }
      if (SLANG_FORMAL[lower] !== undefined) {
        return token.replace(bare, matchCase(SLANG_FORMAL[lower], bare));
      }
      return token.replace(bare, fixTyposFuzzy(bare));
    })
    .filter((token) => token.trim().length > 0)
    .join(' ');

  text = convertWordNumbers(text);
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/^[,.;:-]+\s*/, '').replace(/\s+[,.;:-]+$/, '').trim();

  return text;
}

/**
 * Normalisasi ringan: hanya perbaiki spasi/emoji dan angka terverbal.
 * Dipakai pada bagian kalimat yang akan disimpan sebagai catatan transaksi,
 * supaya isi catatannya tetap natural.
 */
export function normalizeGentle(raw: string): string {
  if (!raw) return '';
  return convertWordNumbers(
    String(raw)
      .replace(EMOJI_OR_SYMBOLS, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
