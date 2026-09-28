import crypto from 'crypto';

interface SendMessageOptions {
  to: string;
  body: string;
}

interface InteractiveListSection {
  title: string;
  rows: {
    id: string;
    title: string;
    description?: string;
  }[];
}

export function isWhatsAppConfigured(): boolean {
  return !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * Send standard text message via WhatsApp Cloud API
 */
export async function sendWhatsAppTextMessage({ to, body }: SendMessageOptions): Promise<boolean> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.log(`[WhatsApp Mock] Sending to ${to}:\n${body}`);
    return true;
  }

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body }
      })
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      console.error(`WhatsApp API send error (${res.status}):`, JSON.stringify(errJson));
      return false;
    }

    return true;
  } catch (err) {
    console.error('Failed to send WhatsApp message:', err);
    return false;
  }
}

/**
 * Send template message via WhatsApp Cloud API (bypasses cross-border session restrictions)
 */
export async function sendWhatsAppTemplateMessage(
  to: string,
  templateName: string = 'catatan_transaksi',
  bodyText: string,
  languageCode: string = 'id'
): Promise<boolean> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    return false;
  }

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: [
            {
              type: 'body',
              parameters: [
                {
                  type: 'text',
                  text: bodyText
                }
              ]
            }
          ]
        }
      })
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      console.error('WhatsApp Template send error:', JSON.stringify(errJson));
      return false;
    }

    return true;
  } catch (err) {
    console.error('Failed to send WhatsApp template message:', err);
    return false;
  }
}

/**
 * Send interactive List message via WhatsApp Cloud API
 */
export async function sendWhatsAppListMessage(
  to: string,
  headerText: string,
  bodyText: string,
  buttonText: string,
  sections: InteractiveListSection[]
): Promise<boolean> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.log(`[WhatsApp Mock List] Sending to ${to}:\n${headerText}\n${bodyText}`);
    return true;
  }

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: {
            type: 'text',
            text: headerText
          },
          body: {
            text: bodyText
          },
          action: {
            button: buttonText,
            sections
          }
        }
      })
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      console.error('WhatsApp API list error:', errJson);
      // Fallback to text message
      return sendWhatsAppTextMessage({ to, body: `${headerText}\n\n${bodyText}` });
    }

    return true;
  } catch (err) {
    console.error('Failed to send interactive list message:', err);
    return sendWhatsAppTextMessage({ to, body: `${headerText}\n\n${bodyText}` });
  }
}

/**
 * Mark an incoming WhatsApp message as read
 */
export async function markWhatsAppMessageAsRead(messageId: string): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId || !messageId) return;

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId
      })
    });
  } catch (err) {
    console.error('Failed to mark message as read:', err);
  }
}

/**
 * Verify WhatsApp webhook signature header X-Hub-Signature-256
 */
export function verifyWhatsAppSignature(
  rawBody: string,
  signatureHeader: string | null
): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  // If app secret is not configured, pass verification (for easier initial onboarding)
  if (!appSecret) return true;
  if (!signatureHeader) return false;

  try {
    const parts = signatureHeader.split('=');
    if (parts.length !== 2 || parts[0] !== 'sha256') return false;

    const expectedSig = parts[1];
    const computedSig = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(computedSig, 'hex'), Buffer.from(expectedSig, 'hex'));
  } catch (err) {
    console.error('Signature verification error:', err);
    return false;
  }
}
