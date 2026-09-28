import { NextRequest, NextResponse } from 'next/server';
import { handleUserMessage } from '@/lib/transactions';
import { parseMessage } from '@/lib/parser';
import { getCategoryMappings } from '@/lib/sheets';
import { scanReceiptImage } from '@/lib/receipt-scanner';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const phone = body.phone || '6281234567890';

    // Check if an image is uploaded
    if (body.image) {
      const cleanBase64 = body.image.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');
      const scanResult = await scanReceiptImage(buffer, body.mimeType || 'image/jpeg');

      return NextResponse.json({
        status: 'ok',
        input: '[Foto Struk Belanja]',
        parsed: { intent: 'SCAN_RECEIPT' },
        result: scanResult
      });
    }

    const text = (body.text || '').trim();

    if (!text) {
      return NextResponse.json({ error: 'Text or image is required' }, { status: 400 });
    }

    const categoryMap = await getCategoryMappings();
    const parsed = parseMessage(text, categoryMap);
    const result = await handleUserMessage(text, phone);

    return NextResponse.json({
      status: 'ok',
      input: text,
      parsed,
      result
    });
  } catch (err: any) {
    console.error('Error in simulate API:', err);
    return NextResponse.json(
      { error: 'Internal Server Error', message: err.message },
      { status: 500 }
    );
  }
}
