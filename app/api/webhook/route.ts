import { NextRequest, NextResponse } from 'next/server';
import {
  sendWhatsAppTextMessage,
  sendWhatsAppListMessage,
  sendWhatsAppTemplateMessage,
  markWhatsAppMessageAsRead,
  verifyWhatsAppSignature
} from '@/lib/whatsapp';
import { handleUserMessage } from '@/lib/transactions';

/**
 * GET: Webhook verification challenge from WhatsApp Cloud API
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode && token) {
    if (mode === 'subscribe' && token === verifyToken) {
      console.log('WhatsApp webhook successfully verified.');
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    } else {
      console.warn('WhatsApp webhook verification failed: Token mismatch.');
      return new Response('Forbidden', { status: 403 });
    }
  }

  return new Response('Bad Request', { status: 400 });
}

/**
 * POST: Incoming WhatsApp message processor
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature-256');

  // Verify HMAC signature if app secret is provided
  if (signature && !verifyWhatsAppSignature(rawBody, signature)) {
    console.warn('[Webhook] Warning: WhatsApp webhook signature mismatch (check WHATSAPP_APP_SECRET)');
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch (err) {
    console.error('Failed to parse webhook JSON body:', err);
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  }

  // Check if it's a WhatsApp message notification
  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;

  if (!value || !value.messages || value.messages.length === 0) {
    // Delivery receipts, read status, etc.
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  }

  const message = value.messages[0];
  const from = message.from; // Sender's phone number e.g. "628123456789"
  const messageId = message.id;

  // Mark message as read
  markWhatsAppMessageAsRead(messageId).catch(() => {});

  // Security check: Only allow authorized phone number if set in env
  const allowedPhone = process.env.ALLOWED_PHONE_NUMBER;
  if (allowedPhone) {
    const cleanAllowed = allowedPhone.replace(/[^\d]/g, '');
    const cleanFrom = from.replace(/[^\d]/g, '');
    if (cleanFrom !== cleanAllowed) {
      console.warn(`Unauthorized message attempt from ${from}`);
      await sendWhatsAppTextMessage({
        to: from,
        body: '🔒 *Akses Ditolak*\nNomor ini tidak terdaftar untuk mengakses bot pengeluaran pribadi ini.'
      });
      return NextResponse.json({ status: 'ok' }, { status: 200 });
    }
  }

  // Extract text from text message or interactive reply (list / button tap)
  let userText = '';
  if (message.type === 'text') {
    userText = message.text?.body || '';
  } else if (message.type === 'interactive') {
    const interactive = message.interactive;
    if (interactive.type === 'list_reply') {
      userText = interactive.list_reply?.id || interactive.list_reply?.title || '';
    } else if (interactive.type === 'button_reply') {
      userText = interactive.button_reply?.id || interactive.button_reply?.title || '';
    }
  }

  if (!userText.trim()) {
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  }

  try {
    // Process message with transaction business logic
    const result = await handleUserMessage(userText, from);

    // Send WhatsApp reply (Try template first to bypass Meta cross-border restriction)
    const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'catatan_transaksi';
    let sent = false;

    if (templateName) {
      sent = await sendWhatsAppTemplateMessage(from, templateName, result.replyText, 'id');
    }

    if (!sent) {
      if (result.interactiveType === 'list' && result.interactiveData) {
        await sendWhatsAppListMessage(
          from,
          result.interactiveData.header,
          result.interactiveData.body,
          result.interactiveData.button,
          result.interactiveData.sections
        );
      } else {
        await sendWhatsAppTextMessage({
          to: from,
          body: result.replyText
        });
      }
    }
  } catch (err) {
    console.error('Error handling user message:', err);
    await sendWhatsAppTextMessage({
      to: from,
      body: '⚠️ Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi.'
    });
  }

  // Always return 200 to acknowledge webhook receipt
  return NextResponse.json({ status: 'ok' }, { status: 200 });
}
