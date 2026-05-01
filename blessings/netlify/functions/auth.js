// netlify/functions/auth.js
// Handles: signup, login, logout, get-user

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const allowedOrigin = process.env.APP_URL || '*';
  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { action, email, password, name, country } = JSON.parse(event.body || '{}');

  try {
    // ── SIGN UP ──
    if (action === 'signup') {
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'A valid email is required.' }) };
      }
      if (!password || typeof password !== 'string' || password.length < 8) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Password must be at least 8 characters.' }) };
      }
      if (name && (typeof name !== 'string' || name.length > 50)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name must be 50 characters or fewer.' }) };
      }

      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Could not create account. Please try again.' }) };

      if (data.user) {
        await supabase.from('profiles').update({
          display_name: (name || email.split('@')[0]).slice(0, 50),
          country: country || null,
          avatar_emoji: pickEmoji()
        }).eq('id', data.user.id);
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          message: 'Account created! Please check your email to confirm.',
          user: data.user
        })
      };
    }

    // ── SIGN IN ──
    if (action === 'signin') {
      if (!email || !password) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email and password are required.' }) };
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid email or password.' }) };

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          session: data.session,
          user: data.user,
          profile
        })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error('Auth error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error. Please try again.' }) };
  }
};

function pickEmoji() {
  const emojis = ['🌟','🌸','🌺','🌻','🌼','🌷','🦋','🌈','☀️','🌙','⭐','🌿','🍀','🌊','🔥','💫'];
  return emojis[Math.floor(Math.random() * emojis.length)];
}
