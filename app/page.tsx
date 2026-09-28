'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Bot,
  Send,
  Sparkles,
  CheckCircle2,
  ShieldCheck,
  Calendar,
  Layers,
  HelpCircle,
  ExternalLink,
  RefreshCw,
  Zap,
  ArrowRight,
  Database,
  Smartphone,
  Cpu,
  Camera,
  ImagePlus,
  Receipt
} from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
  interactiveData?: any;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'simulator' | 'freeAudit' | 'setup' | 'schema'>('simulator');
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [systemStatus, setSystemStatus] = useState<any>(null);
  const [initializingSheet, setInitializingSheet] = useState(false);
  const [sheetInitResult, setSheetInitResult] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'bot',
      text: '👋 Halo Christian! Saya *WA Expense Bot* Anda.\n\nKetik transaksi atau pilih perintah cepat di bawah untuk mencoba:',
      timestamp: '08:00'
    }
  ]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleUploadReceipt(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        sender: 'user',
        text: `📸 *[Mengirim Foto Struk: ${file.name}]*`,
        timestamp: time
      };

      setMessages(prev => [...prev, userMsg]);
      setLoading(true);

      try {
        const res = await fetch('/api/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: base64,
            mimeType: file.type || 'image/jpeg'
          })
        });
        const data = await res.json();
        const botReply = data.result?.replyText || '⚠️ Tidak ada respons dari sistem AI.';
        const botMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          sender: 'bot',
          text: botReply,
          timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
        };
        setMessages(prev => [...prev, botMsg]);
      } catch {
        setMessages(prev => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            sender: 'bot',
            text: '❌ Terjadi kesalahan saat menganalisis foto struk.',
            timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      } finally {
        setLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  }

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setSystemStatus(data);
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  }

  async function handleSendMessage(textToSend?: string) {
    const text = (textToSend || inputMessage).trim();
    if (!text || loading) return;

    const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text,
      timestamp: time
    };

    setMessages(prev => [...prev, userMsg]);
    setInputMessage('');
    setLoading(true);

    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await res.json();

      const botReply = data.result?.replyText || '⚠️ Tidak ada respons dari sistem.';
      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: botReply,
        timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        interactiveData: data.result?.interactiveData
      };
      setMessages(prev => [...prev, botMsg]);
    } catch {
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: 'bot',
          text: '❌ Terjadi kesalahan jaringan saat memproses pesan.',
          timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleInitSheet() {
    setInitializingSheet(true);
    setSheetInitResult(null);
    try {
      const res = await fetch('/api/setup-sheet', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSheetInitResult('✅ ' + data.message);
      } else {
        setSheetInitResult('ℹ️ ' + (data.message || data.error));
      }
    } catch (err: any) {
      setSheetInitResult('❌ Gagal inisialisasi: ' + err.message);
    } finally {
      setInitializingSheet(false);
    }
  }

  async function handleTriggerCron() {
    setLoading(true);
    try {
      const res = await fetch('/api/cron/recurring');
      const data = await res.json();
      const botMsg: ChatMessage = {
        id: Date.now().toString(),
        sender: 'bot',
        text: `🤖 *Simulasi Cron Job Rutin Selesai*\n\n` +
          `• Tanggal: ${data.date}\n` +
          `• Hari ke: ${data.dayOfMonth}\n` +
          `• Transaksi diproses: ${data.processedCount || 0} item\n\n` +
          `_${data.processedCount > 0 ? 'Notifikasi otomatis telah dikirim.' : 'Tidak ada pengeluaran rutin jatuh tempo hari ini.'}_`,
        timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, botMsg]);
    } catch {
      alert('Gagal menjalankan simulasi cron.');
    } finally {
      setLoading(false);
    }
  }

  const quickCommands = [
    'keluar 25000 kopi susu',
    'keluar 50k bensin #transport',
    'masuk 5000000 gaji',
    'ringkasan bulan',
    'saran',
    'tambah rutin 150000 netflix tgl 5',
    'list rutin',
    'hapus terakhir',
    'menu'
  ];

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#c9d1d9] flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="border-b border-[#30363d] bg-[#161b22]/90 backdrop-blur sticky top-0 z-50 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Bot className="w-6 h-6 text-slate-950 font-bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-white tracking-tight">WA Expense Bot</h1>
                <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                  100% Free Stack
                </span>
              </div>
              <p className="text-xs text-[#8b949e]">Personal Finance WhatsApp Bot on Vercel Serverless</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#21262d] border border-[#30363d] text-xs">
              <span className={`w-2 h-2 rounded-full ${systemStatus ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              <span className="text-[#8b949e]">Status:</span>
              <span className="text-white font-medium">
                {systemStatus?.services?.googleSheets?.configured ? 'Cloud Connected' : 'Local Fallback'}
              </span>
            </div>
            <button
              onClick={fetchStatus}
              title="Refresh status"
              className="p-1.5 rounded-lg bg-[#21262d] border border-[#30363d] hover:bg-[#30363d] text-[#8b949e] hover:text-white transition"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto w-full px-4 py-6 flex-1 flex flex-col gap-6">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-[#30363d] pb-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === 'simulator'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'text-[#8b949e] hover:text-white hover:bg-[#161b22]'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            WhatsApp Simulator & Test
          </button>

          <button
            onClick={() => setActiveTab('freeAudit')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === 'freeAudit'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'text-[#8b949e] hover:text-white hover:bg-[#161b22]'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            Audit 100% Gratis & Masuk Akal
          </button>

          <button
            onClick={() => setActiveTab('setup')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === 'setup'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'text-[#8b949e] hover:text-white hover:bg-[#161b22]'
            }`}
          >
            <Layers className="w-4 h-4" />
            Panduan Setup Kredensial
          </button>

          <button
            onClick={() => setActiveTab('schema')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === 'schema'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'text-[#8b949e] hover:text-white hover:bg-[#161b22]'
            }`}
          >
            <Database className="w-4 h-4" />
            Skema Sheet & API
          </button>
        </div>

        {/* TAB 1: WhatsApp Simulator */}
        {activeTab === 'simulator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
            {/* Left Column: Quick Commands & Controls */}
            <div className="lg:col-span-5 flex flex-col gap-4">
              <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-400" />
                    Perintah Cepat (Klik untuk Coba)
                  </h2>
                  <span className="text-xs text-[#8b949e]">Rule-based parser</span>
                </div>
                <p className="text-xs text-[#8b949e] mb-4">
                  Klik perintah contoh di bawah untuk langsung menguji parsing transaksi, kalkulasi ringkasan, maupun saran AI.
                </p>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                    className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition active:scale-95 flex items-center gap-1.5 font-medium disabled:opacity-50"
                  >
                    <Camera className="w-3.5 h-3.5 text-emerald-400" />
                    📸 Scan Foto Struk AI
                  </button>

                  {quickCommands.map((cmd) => (
                    <button
                      key={cmd}
                      onClick={() => handleSendMessage(cmd)}
                      disabled={loading}
                      className="text-xs px-3 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-emerald-300 border border-[#30363d] transition active:scale-95 text-left disabled:opacity-50"
                    >
                      <code>{cmd}</code>
                    </button>
                  ))}
                </div>
              </div>

              {/* Tools & Cron Simulation */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-emerald-400" />
                  Simulasi Vercel Cron Harian
                </h3>
                <p className="text-xs text-[#8b949e] mb-4">
                  Vercel Cron berjalan otomatis setiap hari jam 00:00 UTC mengecek pengeluaran rutin jatuh tempo (mencegah duplikasi dengan pengecekan <code>last_run_date</code>).
                </p>

                <button
                  onClick={handleTriggerCron}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium text-xs shadow-md transition disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Jalankan Simulasi Cron Sekarang (/api/cron/recurring)
                </button>
              </div>

              {/* Sheet Initializer Card */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                  <Database className="w-4 h-4 text-teal-400" />
                  Auto-Inisialisasi Google Sheet
                </h3>
                <p className="text-xs text-[#8b949e] mb-3">
                  Buat tab <code>transactions</code>, <code>categories</code>, dan <code>recurring_expenses</code> serta header kolomnya secara otomatis di Google Spreadsheet Anda.
                </p>
                <button
                  onClick={handleInitSheet}
                  disabled={initializingSheet}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-white text-xs font-medium transition"
                >
                  {initializingSheet ? 'Memproses...' : 'Inisialisasi Struktur Sheet'}
                </button>
                {sheetInitResult && (
                  <p className="text-xs mt-2.5 p-2 rounded-lg bg-[#0d1117] border border-[#30363d] text-[#c9d1d9]">
                    {sheetInitResult}
                  </p>
                )}
              </div>
            </div>

            {/* Right Column: WhatsApp Interactive Chat Mockup */}
            <div className="lg:col-span-7 flex flex-col">
              <div className="bg-[#161b22] border border-[#30363d] rounded-3xl overflow-hidden shadow-2xl flex flex-col h-[680px]">
                {/* Simulated Phone Header */}
                <div className="bg-[#1f2c34] px-4 py-3 flex items-center justify-between border-b border-[#2a3942]">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-bold shadow">
                        <Bot className="w-5 h-5" />
                      </div>
                      <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-400 border-2 border-[#1f2c34] rounded-full" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                        WA Expense Bot
                        <span className="px-1.5 py-0.2 text-[10px] bg-emerald-500/20 text-emerald-400 rounded">Official Cloud API</span>
                      </h3>
                      <p className="text-[11px] text-emerald-400">Online &bull; Siap Mencatat</p>
                    </div>
                  </div>
                  <div className="text-xs text-[#8b949e]">
                    Vercel Edge
                  </div>
                </div>

                {/* Simulated Chat Feed */}
                <div
                  className="flex-1 p-4 overflow-y-auto space-y-3 bg-[#0b141a]"
                  style={{
                    backgroundImage: `radial-gradient(#1f2c34 1px, transparent 1px)`,
                    backgroundSize: '20px 20px'
                  }}
                >
                  {messages.map((m) => {
                    const isUser = m.sender === 'user';
                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow text-sm leading-relaxed whitespace-pre-line ${
                            isUser
                              ? 'bg-[#005c4b] text-white rounded-tr-none'
                              : 'bg-[#202c33] text-[#e9edef] rounded-tl-none border border-[#2a3942]'
                          }`}
                        >
                          {/* Markdown formatted text */}
                          <div>
                            {m.text.split('\n').map((line, idx) => {
                              // basic parser for *bold* and `code`
                              const formatted = line.replace(/\*(.*?)\*/g, '<strong>$1</strong>');
                              return (
                                <p
                                  key={idx}
                                  dangerouslySetInnerHTML={{ __html: formatted }}
                                  className={idx > 0 && line === '' ? 'h-2' : ''}
                                />
                              );
                            })}
                          </div>

                          {/* Interactive List preview if available */}
                          {m.interactiveData && (
                            <div className="mt-3 pt-2 border-t border-[#374248]">
                              <div className="text-xs font-semibold text-emerald-400 mb-1">
                                🔘 {m.interactiveData.button || 'Pilihan Menu'}
                              </div>
                              <div className="space-y-1">
                                {m.interactiveData.sections?.map((sec: any, sIdx: number) => (
                                  <div key={sIdx} className="mb-2">
                                    <div className="text-[11px] text-[#8696a0] font-medium">{sec.title}</div>
                                    <div className="grid grid-cols-1 gap-1 mt-1">
                                      {sec.rows?.map((row: any) => (
                                        <button
                                          key={row.id}
                                          onClick={() => handleSendMessage(row.id)}
                                          className="text-left text-xs px-2.5 py-1.5 rounded bg-[#111b21] hover:bg-[#222e35] text-white flex items-center justify-between border border-[#2a3942] transition"
                                        >
                                          <span>{row.title}</span>
                                          <ArrowRight className="w-3 h-3 text-emerald-400" />
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="text-[10px] text-[#8696a0] text-right mt-1 flex items-center justify-end gap-1">
                            <span>{m.timestamp}</span>
                            {isUser && <CheckCircle2 className="w-3 h-3 text-emerald-400 inline" />}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {loading && (
                    <div className="flex items-center gap-2 p-3 rounded-2xl bg-[#202c33] text-emerald-400 text-xs w-fit">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                      Bot sedang memproses transaksi...
                    </div>
                  )}

                  <div ref={chatEndRef} />
                </div>

                {/* Simulated Input Bar */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMessage();
                  }}
                  className="bg-[#202c33] p-3 border-t border-[#2a3942] flex items-center gap-2"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleUploadReceipt}
                    accept="image/*"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                    title="Upload / Foto Struk"
                    className="w-10 h-10 rounded-xl bg-[#2a3942] hover:bg-[#374248] text-slate-300 hover:text-emerald-400 flex items-center justify-center transition disabled:opacity-50"
                  >
                    <Camera className="w-5 h-5" />
                  </button>

                  <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder="Ketik pengeluaran atau upload foto struk..."
                    className="flex-1 bg-[#2a3942] text-white placeholder-[#8696a0] text-sm px-4 py-2.5 rounded-xl border border-transparent focus:border-emerald-500 focus:outline-none transition"
                  />
                  <button
                    type="submit"
                    disabled={!inputMessage.trim() || loading}
                    className="w-10 h-10 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 flex items-center justify-center transition disabled:opacity-50 disabled:hover:bg-emerald-500 font-bold"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Audit 100% Gratis & Masuk Akal */}
        {activeTab === 'freeAudit' && (
          <div className="space-y-6">
            <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-2">
                <ShieldCheck className="w-6 h-6 text-emerald-400" />
                <h2 className="text-lg font-bold text-white">Laporan Kelayakan & Verifikasi "100% Free & Makes Sense"</h2>
              </div>
              <p className="text-sm text-[#8b949e]">
                Berikut analisis lengkap setiap komponen sistem yang membuktikan bahwa seluruh arsitektur ini berjalan <strong>100% GRATIS</strong> tanpa perlu sewa VPS bulanan dan tanpa jebakan biaya.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* WhatsApp Cloud API */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                        <MessageSquare className="w-4 h-4" />
                      </div>
                      <h3 className="font-semibold text-white text-sm">WhatsApp Cloud API (Resmi)</h3>
                    </div>
                    <span className="px-2 py-0.5 text-xs bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/20 font-medium">
                      Gratis
                    </span>
                  </div>
                  <ul className="text-xs text-[#8b949e] space-y-2 mb-4">
                    <li>&bull; <strong className="text-white">Meta Developer Free Tier:</strong> Termasuk 1.000 percakapan inisiasi pengguna (service conversations) per bulan secara cuma-cuma.</li>
                    <li>&bull; <strong className="text-white">Mengapa Masuk Akal?</strong> Untuk penggunaan personal 1 pengguna, Anda hanya chat dengan nomor bot Anda sendiri. Pesan balasan dari bot dalam 24 jam adalah respon terhadap chat Anda (user-initiated), sehingga 1.000 percakapan/bulan sangat lebih dari cukup (rata-rata 33 percakapan/hari).</li>
                    <li>&bull; <strong className="text-white">Kenapa bukan Baileys?</strong> Baileys membutuhkan koneksi WebSocket persisten (harus server nyala 24 jam di VPS berbayar). WhatsApp Cloud API berbasis Webhook HTTP murni yang 100% ramah serverless Vercel!</li>
                  </ul>
                </div>
                <div className="text-[11px] text-emerald-400/90 bg-emerald-950/30 border border-emerald-800/30 p-2.5 rounded-xl">
                  Biaya Bulanan: <strong>Rp 0 (FREE)</strong>
                </div>
              </div>

              {/* Google Sheets API */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
                        <Database className="w-4 h-4" />
                      </div>
                      <h3 className="font-semibold text-white text-sm">Google Sheets API (Database)</h3>
                    </div>
                    <span className="px-2 py-0.5 text-xs bg-teal-500/10 text-teal-400 rounded-full border border-teal-500/20 font-medium">
                      Gratis
                    </span>
                  </div>
                  <ul className="text-xs text-[#8b949e] space-y-2 mb-4">
                    <li>&bull; <strong className="text-white">Google Cloud Quota:</strong> 300 request baca per menit dan 300 request tulis per menit per project.</li>
                    <li>&bull; <strong className="text-white">Mengapa Masuk Akal?</strong> Personal finance mencatat ~5-20 transaksi sehari. 300 req/menit tidak akan pernah tersentuh.</li>
                    <li>&bull; <strong className="text-white">Keuntungan Besar:</strong> Anda bisa membuka Google Spreadsheet langsung di HP/laptop kapan saja, membuat grafik sendiri, pivot table, atau export ke Excel/CSV tanpa butuh UI admin tambahan.</li>
                  </ul>
                </div>
                <div className="text-[11px] text-teal-400/90 bg-teal-950/30 border border-teal-800/30 p-2.5 rounded-xl">
                  Biaya Bulanan: <strong>Rp 0 (FREE)</strong>
                </div>
              </div>

              {/* Google Gemini AI Advisor */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <h3 className="font-semibold text-white text-sm">Google Gemini 2.0 Flash (AI Advisor)</h3>
                    </div>
                    <span className="px-2 py-0.5 text-xs bg-indigo-500/10 text-indigo-400 rounded-full border border-indigo-500/20 font-medium">
                      Gratis
                    </span>
                  </div>
                  <ul className="text-xs text-[#8b949e] space-y-2 mb-4">
                    <li>&bull; <strong className="text-white">Google AI Studio Free Tier:</strong> 15 RPM (Request Per Minute) dan 1.500 RPD (Request Per Day) tanpa kartu kredit.</li>
                    <li>&bull; <strong className="text-white">Strategi Hemat:</strong> AI hanya dipanggil saat Anda mengetik `saran` atau `analisa`. Untuk parsing harian (seperti `keluar 25000 kopi`), bot menggunakan parser regex berbasis rule di kode Next.js (kecepatan &lt;50ms & Rp 0).</li>
                    <li>&bull; Bot juga dilengkapi proteksi limit maksimal 5 request saran/hari agar kuota aman.</li>
                  </ul>
                </div>
                <div className="text-[11px] text-indigo-400/90 bg-indigo-950/30 border border-indigo-800/30 p-2.5 rounded-xl">
                  Biaya Bulanan: <strong>Rp 0 (FREE)</strong>
                </div>
              </div>

              {/* Vercel Serverless & Cron */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                        <Cpu className="w-4 h-4" />
                      </div>
                      <h3 className="font-semibold text-white text-sm">Vercel Serverless & Cron Jobs</h3>
                    </div>
                    <span className="px-2 py-0.5 text-xs bg-purple-500/10 text-purple-400 rounded-full border border-purple-500/20 font-medium">
                      Gratis
                    </span>
                  </div>
                  <ul className="text-xs text-[#8b949e] space-y-2 mb-4">
                    <li>&bull; <strong className="text-white">Vercel Hobby Plan:</strong> 100.000 request serverless per bulan gratis.</li>
                    <li>&bull; <strong className="text-white">Vercel Cron:</strong> Plan Hobby memberikan 1 cron job gratis per hari. Tepat dengan konfigurasi <code>vercel.json</code> kita yang jalan 1x sehari di jam 00:00 UTC untuk mengecek pengeluaran rutin jatuh tempo.</li>
                    <li>&bull; <strong className="text-white">Zero Server Maintenance:</strong> Tidak ada risiko server down karena restart OS, memory leak, atau kehabisan disk space.</li>
                  </ul>
                </div>
                <div className="text-[11px] text-purple-400/90 bg-purple-950/30 border border-purple-800/30 p-2.5 rounded-xl">
                  Biaya Bulanan: <strong>Rp 0 (FREE)</strong>
                </div>
              </div>
            </div>

            {/* Comparison Table */}
            <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-white mb-4">Perbandingan Arsitektur: Solusi Kami vs Solusi Lama (Baileys/VPS)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-[#30363d] text-[#8b949e]">
                      <th className="py-2.5 px-3">Aspek</th>
                      <th className="py-2.5 px-3 text-emerald-400">Arsitektur Bot Ini (Cloud API + Vercel)</th>
                      <th className="py-2.5 px-3 text-[#8b949e]">Arsitektur Lama (Baileys + VPS)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363d]/50">
                    <tr>
                      <td className="py-2.5 px-3 font-medium text-white">Biaya Server Hosting</td>
                      <td className="py-2.5 px-3 text-emerald-300">Rp 0 (Vercel Serverless Free Tier)</td>
                      <td className="py-2.5 px-3 text-rose-300">Rp 50.000 - Rp 150.000 / bln (Sewa VPS)</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-medium text-white">Stabilitas Koneksi WA</td>
                      <td className="py-2.5 px-3 text-emerald-300">Tinggi (Resmi Meta Cloud API via Webhook)</td>
                      <td className="py-2.5 px-3 text-rose-300">Sering putus / disconnect QR code</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-medium text-white">Kebutuhan Database</td>
                      <td className="py-2.5 px-3 text-emerald-300">Google Sheets (Bisa dilihat/diedit di HP)</td>
                      <td className="py-2.5 px-3">SQLite / Postgres di server lokal</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-medium text-white">AI Financial Advisor</td>
                      <td className="py-2.5 px-3 text-emerald-300">Google Gemini 2.0 Flash (Gratis 1.500 RPD)</td>
                      <td className="py-2.5 px-3">OpenAI API (Berbayar per token)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: Setup Guide */}
        {activeTab === 'setup' && (
          <div className="space-y-6">
            <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-6">
              <h2 className="text-lg font-bold text-white mb-2">Panduan 5 Langkah Menghubungkan Kredensial</h2>
              <p className="text-sm text-[#8b949e]">
                Ikuti langkah berikut untuk mengaktifkan bot di nomor WhatsApp Anda dan menghubungkannya dengan Google Spreadsheet pribadi Anda.
              </p>
            </div>

            <div className="space-y-4">
              {/* Step 1 */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center text-xs border border-emerald-500/30">1</span>
                  <h3 className="font-semibold text-white text-sm">Dapatkan Gemini API Key (1 Menit)</h3>
                </div>
                <p className="text-xs text-[#8b949e] mb-3">
                  Buka Google AI Studio dan buat API Key secara instan:
                </p>
                <div className="flex items-center gap-2 mb-2">
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-xs font-medium transition"
                  >
                    Buka Google AI Studio <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
                <p className="text-xs text-[#8b949e]">Simpan sebagai: <code>GEMINI_API_KEY</code></p>
              </div>

              {/* Step 2 */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center text-xs border border-emerald-500/30">2</span>
                  <h3 className="font-semibold text-white text-sm">Buat Google Spreadsheet & Service Account</h3>
                </div>
                <ol className="text-xs text-[#8b949e] space-y-2 list-decimal list-inside mb-4">
                  <li>Buat Spreadsheet baru di <a href="https://sheets.new" target="_blank" rel="noreferrer" className="text-emerald-400 underline">sheets.new</a>. Salin ID Spreadsheet dari URL-nya (antara <code>/d/</code> dan <code>/edit</code>).</li>
                  <li>Buka <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="text-emerald-400 underline">Google Cloud Console</a>, buat project baru.</li>
                  <li>Di menu <strong>APIs & Services &gt; Library</strong>, cari dan aktifkan <strong>Google Sheets API</strong>.</li>
                  <li>Buka <strong>IAM & Admin &gt; Service Accounts</strong>, klik <strong>Create Service Account</strong>.</li>
                  <li>Buka tab <strong>Keys &gt; Add Key &gt; Create new key (JSON)</strong>. File JSON akan terdownload.</li>
                  <li>Buka Spreadsheet Anda, klik tombol <strong>Bagikan (Share)</strong>, lalu masukkan email Service Account tersebut dengan hak akses <strong>Editor</strong>.</li>
                </ol>
                <p className="text-xs text-[#8b949e]">
                  Simpan sebagai: <code>GOOGLE_SHEET_ID</code>, <code>GOOGLE_SERVICE_ACCOUNT_EMAIL</code>, dan <code>GOOGLE_PRIVATE_KEY</code> (atau isi <code>GOOGLE_SERVICE_ACCOUNT_JSON</code>).
                </p>
              </div>

              {/* Step 3 */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center text-xs border border-emerald-500/30">3</span>
                  <h3 className="font-semibold text-white text-sm">Setup WhatsApp Cloud API di Meta Developer</h3>
                </div>
                <ol className="text-xs text-[#8b949e] space-y-2 list-decimal list-inside mb-4">
                  <li>Buka <a href="https://developers.facebook.com" target="_blank" rel="noreferrer" className="text-emerald-400 underline">developers.facebook.com</a> &gt; Buat App tipe <strong>Other &gt; Business</strong>.</li>
                  <li>Tambahkan produk <strong>WhatsApp</strong>.</li>
                  <li>Di menu <strong>API Setup</strong>, Anda akan mendapatkan <strong>Phone Number ID</strong> dan <strong>Temporary Access Token</strong> (atau buat System User token permanen).</li>
                  <li>Kirim pesan tes ke nomor WA Anda dari dashboard untuk memastikan nomor penerima terdaftar.</li>
                </ol>
                <p className="text-xs text-[#8b949e]">
                  Simpan sebagai: <code>WHATSAPP_PHONE_NUMBER_ID</code>, <code>WHATSAPP_ACCESS_TOKEN</code>, dan <code>ALLOWED_PHONE_NUMBER</code> (nomor WA Anda).
                </p>
              </div>

              {/* Step 4 */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center text-xs border border-emerald-500/30">4</span>
                  <h3 className="font-semibold text-white text-sm">Deploy ke Vercel & Konfigurasi Webhook</h3>
                </div>
                <ol className="text-xs text-[#8b949e] space-y-2 list-decimal list-inside mb-4">
                  <li>Push repository ini ke GitHub Anda, lalu import ke <a href="https://vercel.com" target="_blank" rel="noreferrer" className="text-emerald-400 underline">Vercel</a>.</li>
                  <li>Di Vercel Project Settings &gt; <strong>Environment Variables</strong>, masukkan semua variabel dari file <code>.env.example</code>.</li>
                  <li>Setelah deploy sukses, Anda akan mendapatkan URL Vercel (misal: <code>https://bot-expense.vercel.app</code>).</li>
                  <li>Kembali ke Meta Developer Dashboard &gt; <strong>WhatsApp &gt; Configuration &gt; Webhook</strong>:</li>
                  <ul className="list-disc list-inside pl-4 text-emerald-300">
                    <li>Callback URL: <code>https://your-app.vercel.app/api/webhook</code></li>
                    <li>Verify Token: isi string yang sama dengan <code>WHATSAPP_VERIFY_TOKEN</code></li>
                  </ul>
                  <li>Klik <strong>Verify and Save</strong>, lalu klik <strong>Manage</strong> di Webhook fields dan aktifkan subscribe untuk <strong>messages</strong>.</li>
                </ol>
              </div>

              {/* Step 5 */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center text-xs border border-emerald-500/30">5</span>
                  <h3 className="font-semibold text-white text-sm">Selesai! Mulai Chat di WhatsApp</h3>
                </div>
                <p className="text-xs text-[#8b949e]">
                  Sekarang Anda cukup membuka chat WhatsApp ke nomor bot Anda dan kirim:
                  <code className="text-emerald-300 ml-1">keluar 25000 kopi</code> atau <code className="text-emerald-300 ml-1">menu</code>!
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: Data Schema & API */}
        {activeTab === 'schema' && (
          <div className="space-y-6">
            <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-6">
              <h2 className="text-lg font-bold text-white mb-2">Struktur Google Sheet Sesuai AGENT.md</h2>
              <p className="text-sm text-[#8b949e]">
                Sistem secara otomatis membaca dan menulis ke 3 tab sheet berikut:
              </p>
            </div>

            <div className="space-y-4">
              {/* Sheet transactions */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 overflow-hidden">
                <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Sheet: <code>transactions</code>
                </h3>
                <p className="text-xs text-[#8b949e] mb-3">Menyimpan riwayat pengeluaran & pemasukan harian.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="bg-[#21262d] text-white">
                        <th className="py-2 px-3">id</th>
                        <th className="py-2 px-3">type</th>
                        <th className="py-2 px-3">amount</th>
                        <th className="py-2 px-3">category</th>
                        <th className="py-2 px-3">note</th>
                        <th className="py-2 px-3">raw_message</th>
                        <th className="py-2 px-3">source</th>
                        <th className="py-2 px-3">created_at</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#30363d]">
                      <tr className="text-[#8b949e]">
                        <td className="py-2 px-3 font-mono">UUID</td>
                        <td className="py-2 px-3 text-rose-400">expense</td>
                        <td className="py-2 px-3 text-white">25000</td>
                        <td className="py-2 px-3">Food</td>
                        <td className="py-2 px-3">kopi susu</td>
                        <td className="py-2 px-3">keluar 25000 kopi susu</td>
                        <td className="py-2 px-3">manual</td>
                        <td className="py-2 px-3 font-mono text-[11px]">2026-09-27T01:48:00Z</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Sheet recurring_expenses */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 overflow-hidden">
                <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-teal-400" />
                  Sheet: <code>recurring_expenses</code>
                </h3>
                <p className="text-xs text-[#8b949e] mb-3">Menyimpan daftar langganan/tagihan rutin bulanan.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="bg-[#21262d] text-white">
                        <th className="py-2 px-3">id</th>
                        <th className="py-2 px-3">name</th>
                        <th className="py-2 px-3">amount</th>
                        <th className="py-2 px-3">category</th>
                        <th className="py-2 px-3">due_date</th>
                        <th className="py-2 px-3">active</th>
                        <th className="py-2 px-3">last_run_date</th>
                        <th className="py-2 px-3">created_at</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#30363d]">
                      <tr className="text-[#8b949e]">
                        <td className="py-2 px-3 font-mono">UUID</td>
                        <td className="py-2 px-3 text-white font-medium">Netflix</td>
                        <td className="py-2 px-3 text-white">150000</td>
                        <td className="py-2 px-3">Entertainment</td>
                        <td className="py-2 px-3 text-amber-300 font-bold">5</td>
                        <td className="py-2 px-3 text-emerald-400">TRUE</td>
                        <td className="py-2 px-3 font-mono text-[11px]">2026-09-05</td>
                        <td className="py-2 px-3 font-mono text-[11px]">2026-09-01T...</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Sheet categories */}
              <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 overflow-hidden">
                <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-400" />
                  Sheet: <code>categories</code>
                </h3>
                <p className="text-xs text-[#8b949e] mb-3">Mapping kata kunci khusus ke kategori pengeluaran.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="bg-[#21262d] text-white">
                        <th className="py-2 px-3">keyword</th>
                        <th className="py-2 px-3">category</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#30363d]">
                      <tr className="text-[#8b949e]">
                        <td className="py-2 px-3">makan, kopi, jajan, cafe, lunch</td>
                        <td className="py-2 px-3 text-emerald-300 font-medium">Food</td>
                      </tr>
                      <tr className="text-[#8b949e]">
                        <td className="py-2 px-3">bensin, ojek, tol, grab, gojek, parkir</td>
                        <td className="py-2 px-3 text-emerald-300 font-medium">Transport</td>
                      </tr>
                      <tr className="text-[#8b949e]">
                        <td className="py-2 px-3">listrik, pln, air, pdam, wifi, pulsa</td>
                        <td className="py-2 px-3 text-emerald-300 font-medium">Bills</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#30363d] py-4 px-4 bg-[#161b22] text-xs text-[#8b949e]">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <p>WA Expense Bot &bull; WhatsApp Cloud API &bull; Google Sheets &bull; Gemini 2.0 Flash &bull; Vercel</p>
          <div className="flex items-center gap-4">
            <a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-white transition">Documentation</a>
            <span>&bull;</span>
            <span className="text-emerald-400">100% Free Tier Verified</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
