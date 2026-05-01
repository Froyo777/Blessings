// netlify/functions/match.js
// The heart of Blessings — pairs givers with receivers

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

exports.handler = async (event) => {
  const allowedOrigin = process.env.APP_URL || '*';
  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const authHeader = event.headers.authorization;
  if (!authHeader) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not authenticated' }) };

  const token = authHeader.split(' ')[1];
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not authenticated' }) };

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid session' }) };

  const { mode, blessing_type, message } = JSON.parse(event.body || '{}');

  if (!mode || !['give', 'receive'].includes(mode)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid mode' }) };
  }
  if (!blessing_type || typeof blessing_type !== 'string' || blessing_type.length > 50) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid blessing type' }) };
  }
  if (message && (typeof message !== 'string' || message.length > 500)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Message too long' }) };
  }

  try {
    // ── ADD TO QUEUE ──
    const { data: queueEntry, error: queueError } = await supabase
      .from('blessing_queue')
      .insert({
        user_id: user.id,
        mode,
        blessing_type,
        message: message || null,
        status: 'waiting'
      })
      .select()
      .single();

    if (queueError) throw queueError;

    // ── TRY TO MATCH ──
    // Prefer same blessing type, fall back to any
    const oppositeMode = mode === 'give' ? 'receive' : 'give';
    const now = new Date().toISOString();

    const { data: sameTypeMatches } = await supabase
      .from('blessing_queue')
      .select('*, profiles!blessing_queue_user_id_fkey(display_name, country, avatar_emoji)')
      .eq('mode', oppositeMode)
      .eq('status', 'waiting')
      .eq('blessing_type', blessing_type)
      .neq('user_id', user.id)
      .gt('expires_at', now)
      .order('created_at', { ascending: true })
      .limit(1);

    const { data: anyMatches } = await supabase
      .from('blessing_queue')
      .select('*, profiles!blessing_queue_user_id_fkey(display_name, country, avatar_emoji)')
      .eq('mode', oppositeMode)
      .eq('status', 'waiting')
      .neq('user_id', user.id)
      .gt('expires_at', now)
      .order('created_at', { ascending: true })
      .limit(1);

    const candidate = (sameTypeMatches?.length > 0)
      ? sameTypeMatches[0]
      : (anyMatches?.length > 0 ? anyMatches[0] : null);

    if (!candidate) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          status: 'queued',
          queue_id: queueEntry.id,
          message: "You're in the queue! We'll email you when your match is found."
        })
      };
    }

    // ── ATOMICALLY CLAIM THE MATCH ──
    // Only succeeds if nobody else claimed it between our SELECT and now
    const { data: claimedMatch } = await supabase
      .from('blessing_queue')
      .update({ status: 'matched' })
      .eq('id', candidate.id)
      .eq('status', 'waiting')
      .select('*, profiles!blessing_queue_user_id_fkey(display_name, country, avatar_emoji)')
      .maybeSingle();

    if (!claimedMatch) {
      // Race lost — someone else claimed this match; stay queued
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          status: 'queued',
          queue_id: queueEntry.id,
          message: "You're in the queue! We'll email you when your match is found."
        })
      };
    }

    // ── BUILD BLESSING ──
    const giverId = mode === 'give' ? user.id : claimedMatch.user_id;
    const receiverId = mode === 'give' ? claimedMatch.user_id : user.id;
    const giverQueueId = mode === 'give' ? queueEntry.id : claimedMatch.id;
    const receiverQueueId = mode === 'give' ? claimedMatch.id : queueEntry.id;

    const { data: blessing, error: blessingError } = await supabase
      .from('blessings')
      .insert({
        giver_id: giverId,
        receiver_id: receiverId,
        blessing_type: mode === 'give' ? blessing_type : claimedMatch.blessing_type,
        message: mode === 'give' ? message : claimedMatch.message,
        status: 'pending'
      })
      .select()
      .single();

    if (blessingError) throw blessingError;

    // Mark both queue entries as matched with each other
    await Promise.all([
      supabase.from('blessing_queue')
        .update({ status: 'matched', matched_with: receiverQueueId })
        .eq('id', giverQueueId),
      supabase.from('blessing_queue')
        .update({ matched_with: giverQueueId })
        .eq('id', receiverQueueId)
    ]);

    // Get auth emails for notifications
    const [{ data: giverUser }, { data: receiverUser }] = await Promise.all([
      supabase.auth.admin.getUserById(giverId),
      supabase.auth.admin.getUserById(receiverId)
    ]);

    try {
      await sendMatchEmails({
        giverEmail: giverUser?.user?.email,
        receiverEmail: receiverUser?.user?.email,
        blessing,
        blessingId: blessing.id,
        matchProfile: claimedMatch.profiles
      });
    } catch (emailErr) {
      console.error('Email send failed (non-fatal):', emailErr);
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        status: 'matched',
        blessing_id: blessing.id,
        match: {
          display_name: claimedMatch.profiles?.display_name || 'Anonymous Soul',
          country: claimedMatch.profiles?.country || 'Somewhere in the world',
          avatar_emoji: claimedMatch.profiles?.avatar_emoji || '🌟'
        }
      })
    };

  } catch (err) {
    console.error('Match error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Something went wrong. Please try again.' }) };
  }
};

// ── EMAIL NOTIFICATIONS ──
async function sendMatchEmails({ giverEmail, receiverEmail, blessing, blessingId }) {
  const appUrl = process.env.APP_URL || 'https://yourdomain.com';
  const fromEmail = process.env.FROM_EMAIL || 'blessings@yourdomain.com';
  const fromName = process.env.FROM_NAME || 'Blessings';

  const typeLabels = {
    words: '💬 Words of warmth',
    coffee: '☕ A coffee',
    gift: '🎁 A virtual gift',
    skill: '🧠 Skills & advice',
    penpal: '🤝 A pen pal connection',
    creative: '🎨 A creative gift',
    surprise: '🎲 A surprise'
  };

  const blessingLabel = typeLabels[blessing.blessing_type] || '✦ A blessing';

  const sends = [];

  if (giverEmail) {
    sends.push(resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: giverEmail,
      subject: '✦ Your match is ready — someone is waiting for your blessing',
      html: emailTemplate({
        heading: "You've been matched! ✦",
        body: `Someone in the world has opened their heart to receive. It's time to send your blessing.`,
        detail: blessing.message ? `Your message: <em>"${escapeHtml(blessing.message)}"</em>` : `Blessing type: ${blessingLabel}`,
        ctaText: 'Send your blessing now',
        ctaUrl: `${appUrl}/blessing/${blessingId}`,
        footer: 'Thank you for being the reason someone smiles today.'
      })
    }));
  }

  if (receiverEmail) {
    sends.push(resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: receiverEmail,
      subject: '🌿 A blessing is on its way to you',
      html: emailTemplate({
        heading: "Someone is thinking of you 🌿",
        body: `A real person — somewhere in the world — has chosen to send you a blessing. It's on its way.`,
        detail: `Blessing type: ${blessingLabel}`,
        ctaText: 'See your blessing',
        ctaUrl: `${appUrl}/blessing/${blessingId}`,
        footer: 'You deserve this. When you feel ready, you can pass a blessing forward to someone else.'
      })
    }));
  }

  await Promise.all(sends);
}

function emailTemplate({ heading, body, detail, ctaText, ctaUrl, footer }) {
  const appUrl = process.env.APP_URL || 'https://yourdomain.com';
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#FAF6EF;font-family:Georgia,serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <span style="font-size:2rem;color:#C49A3C;">✦</span>
      <div style="font-size:1.6rem;font-weight:300;color:#1C1410;margin-top:8px;letter-spacing:-0.01em;">Blessings</div>
    </div>
    <div style="background:white;border-radius:20px;padding:40px;border:1px solid rgba(196,154,60,0.15);box-shadow:0 4px 24px rgba(28,20,16,0.06);">
      <h1 style="font-size:1.6rem;font-weight:400;color:#1C1410;margin:0 0 16px;line-height:1.3;">${heading}</h1>
      <p style="color:#5C4A35;line-height:1.7;margin:0 0 20px;font-size:1rem;">${body}</p>
      ${detail ? `<div style="background:rgba(196,154,60,0.08);border-radius:12px;padding:16px;margin:0 0 24px;color:#5C4A35;font-style:italic;">${detail}</div>` : ''}
      <a href="${ctaUrl}" style="display:inline-block;background:linear-gradient(135deg,#C49A3C,#D4854A);color:white;text-decoration:none;padding:14px 32px;border-radius:100px;font-family:sans-serif;font-size:0.95rem;font-weight:500;">${ctaText}</a>
    </div>
    <p style="text-align:center;color:#9C8870;font-size:0.82rem;margin-top:24px;line-height:1.6;">${footer}</p>
    <p style="text-align:center;color:#C8C0B8;font-size:0.75rem;margin-top:16px;">You're receiving this because you joined Blessings. <a href="${appUrl}/unsubscribe" style="color:#C49A3C;">Unsubscribe</a></p>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
