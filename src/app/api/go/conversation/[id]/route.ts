import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const MOBILE_RE = /iPhone|iPad|iPod|Android|webOS|BlackBerry|Opera Mini|IEMobile/i;
const APP_ID = 'bu625hil';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: convId } = await params;
  const ua = req.headers.get('user-agent') || '';
  const isMobile = MOBILE_RE.test(ua);

  if (isMobile) {
    // Intercom Inbox app universal link — 302 redirect lets iOS/Android intercept
    const mobileUrl = `https://app.intercom.com/a/apps/${APP_ID}/inbox/inbox/conversation/${convId}`;
    return Response.redirect(mobileUrl, 302);
  }

  const webUrl = `https://app.intercom.com/a/inbox/${APP_ID}/inbox/conversation/${convId}`;
  return Response.redirect(webUrl, 302);
}
