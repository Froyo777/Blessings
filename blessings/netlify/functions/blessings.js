// netlify/functions/blessings.js
// Handles: get blessing, deliver blessing, acknowledge, send message

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Auth check
  const token = (event.headers.authorization || '').replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not authenticated' }) };

  const { action, blessing_id, delivery_detail, message_content } = JSON.parse(event.body || '{}');
  const pathId = event.path.split('/').pop(); // for GET /api/blessings/{id}

  try {
    // ── GET A BLESSING ──
    if (event.httpMethod === 'GET') {
      const id = blessing_id || pathId;
      const { data: blessing } = await supabase
        .from('blessings')
        .select(`
          *,
          giver:giver_id(display_name, country, avatar_emoji),
          receiver:receiver_id(display_name, country, avatar_emoji)
        `)
        .eq('id', id)
        .single();

      if (!blessing) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Blessing not found' }) };

      // Only show to participants
      if (blessing.giver_id !== user.id && blessing.receiver_id !== user.id) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not authorised' }) };
      }

      // Get messages
      const { data: messages } = await supabase
        .from('blessing_messages')
        .select('*, sender:sender_id(display_name, avatar_emoji)')
        .eq('blessing_id', id)
        .order('created_at', { ascending: true });

      return { statusCode: 200, headers, body: JSON.stringify({ blessing, messages: messages || [] }) };
    }

    // ── DELIVER (giver sends their blessing details) ──
    if (action === 'deliver') {
      const { data: blessing } = await supabase.from('blessings').select('*').eq('id', blessing_id).single();
      if (!blessing || blessing.giver_id !== user.id) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not authorised' }) };
      }

      await supabase.from('blessings')
        .update({ status: 'delivered', delivery_detail, delivered_at: new Date().toISOString() })
        .eq('id', blessing_id);

      // Update giver stats
      await supabase.from('profiles')
        .update({ blessings_given: supabase.raw('blessings_given + 1') })
        .eq('id', user.id);

      // Notify receiver
      const { data: receiverUser } = await supabase.auth.admin.getUserById(blessing.receiver_id);
      if (receiverUser?.user?.email) {
        const appUrl = process.env.APP_URL || 'https://yourdomain.com';
        await resend.emails.send({
          from: `${process.env.FROM_NAME || 'Blessings'} <${process.env.FROM_EMAIL || 'blessings@yourdomain.com'}>`,
          to: receiverUser.user.email,
          subject: '🌟 Your blessing has arrived!',
          html: `
            <div style="max-width:560px;margin:0 auto;padding:40px 20px;font-family:Georgia,serif;background:#FAF6EF;">
              <div style="background:white;border-radius:20px;padding:40px;border:1px solid rgba(196,154,60,0.15);">
                <h1 style="color:#1C1410;font-weight:400;font-size:1.6rem;">Your blessing has arrived 🌟</h1>
                <p style="color:#5C4A35;line-height:1.7;">Someone cared enough to send you something real. Open your blessing to see what they've shared with you.</p>
                <a href="${appUrl}/blessing/${blessing_id}" style="display:inline-block;background:linear-gradient(135deg,#7B9E87,#5C8870);color:white;text-decoration:none;padding:14px 32px;border-radius:100px;font-family:sans-serif;font-weight:500;">Open your blessing</a>
              </div>
            </div>`
        });
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── ACKNOWLEDGE (receiver confirms they received it) ──
    if (action === 'acknowledge') {
      await supabase.from('blessings')
        .update({ status: 'acknowledged', acknowledged_at: new Date().toISOString() })
        .eq('id', blessing_id)
        .eq('receiver_id', user.id);

      // Update receiver stats
      await supabase.from('profiles')
        .update({ blessings_received: supabase.raw('blessings_received + 1') })
        .eq('id', user.id);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── SEND MESSAGE (in-platform anonymous messaging) ──
    if (action === 'message') {
      // Verify user is part of this blessing
      const { data: blessing } = await supabase.from('blessings').select('*').eq('id', blessing_id).single();
      if (!blessing || (blessing.giver_id !== user.id && blessing.receiver_id !== user.id)) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not authorised' }) };
      }

      const { data: msg } = await supabase.from('blessing_messages')
        .insert({ blessing_id, sender_id: user.id, content: message_content })
        .select('*, sender:sender_id(display_name, avatar_emoji)')
        .single();

      return { statusCode: 200, headers, body: JSON.stringify({ message: msg }) };
    }

    // ── GET MY BLESSINGS (dashboard) ──
    if (action === 'my-blessings') {
      const { data: given } = await supabase.from('blessings')
        .select('*, receiver:receiver_id(display_name, avatar_emoji, country)')
        .eq('giver_id', user.id)
        .order('created_at', { ascending: false });

      const { data: received } = await supabase.from('blessings')
        .select('*, giver:giver_id(display_name, avatar_emoji, country)')
        .eq('receiver_id', user.id)
        .order('created_at', { ascending: false });

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ given: given || [], received: received || [] })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error('Blessings function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};
