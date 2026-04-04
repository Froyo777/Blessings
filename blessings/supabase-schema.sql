-- ============================================================
--  BLESSINGS DATABASE SCHEMA
--  Run this in: Supabase → SQL Editor → New Query → Run
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── PROFILES ──
-- Extends Supabase auth.users with extra info
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT,
  country       TEXT,
  bio           TEXT,
  avatar_emoji  TEXT DEFAULT '🌟',
  is_verified   BOOLEAN DEFAULT FALSE,
  blessings_given    INT DEFAULT 0,
  blessings_received INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, display_name)
  VALUES (NEW.id, SPLIT_PART(NEW.email, '@', 1));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── BLESSING QUEUE ──
-- People waiting to give or receive
CREATE TABLE blessing_queue (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('give', 'receive')),
  blessing_type TEXT NOT NULL,  -- words, coffee, gift, skill, penpal, creative, surprise
  message       TEXT,           -- giver's message / receiver's context
  status        TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'matched', 'completed', 'cancelled')),
  matched_with  UUID REFERENCES blessing_queue(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days'
);

-- ── BLESSINGS ──
-- Completed or in-progress blessing exchanges
CREATE TABLE blessings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  giver_id      UUID REFERENCES profiles(id),
  receiver_id   UUID REFERENCES profiles(id),
  blessing_type TEXT NOT NULL,
  message       TEXT,
  giver_name    TEXT DEFAULT 'Anonymous Soul',
  status        TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'acknowledged')),
  delivery_detail TEXT,  -- gift card link, PayPal, etc. (encrypted/hidden from receiver until giver sends)
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  delivered_at  TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ
);

-- ── MESSAGES ──
-- Optional follow-up messages between matched users (anonymous)
CREATE TABLE blessing_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  blessing_id UUID REFERENCES blessings(id) ON DELETE CASCADE,
  sender_id   UUID REFERENCES profiles(id),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── ROW LEVEL SECURITY ──
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE blessing_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE blessings ENABLE ROW LEVEL SECURITY;
ALTER TABLE blessing_messages ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read all, only update their own
CREATE POLICY "Public profiles are viewable" ON profiles FOR SELECT USING (TRUE);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Queue: users manage their own entries
CREATE POLICY "Users manage own queue" ON blessing_queue
  FOR ALL USING (auth.uid() = user_id);

-- Blessings: givers and receivers can see their own
CREATE POLICY "Users see own blessings" ON blessings
  FOR SELECT USING (auth.uid() = giver_id OR auth.uid() = receiver_id);

-- Messages: participants in a blessing can read messages
CREATE POLICY "Participants see messages" ON blessing_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM blessings b
      WHERE b.id = blessing_id
      AND (b.giver_id = auth.uid() OR b.receiver_id = auth.uid())
    )
  );

CREATE POLICY "Participants send messages" ON blessing_messages
  FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- ── STATS VIEW ──
CREATE OR REPLACE VIEW public_stats AS
SELECT
  (SELECT COUNT(*) FROM blessings WHERE status != 'pending') AS total_blessings,
  (SELECT COUNT(DISTINCT giver_id) + COUNT(DISTINCT receiver_id) FROM blessings) AS total_users,
  (SELECT COUNT(*) FROM blessing_queue WHERE status = 'waiting') AS waiting_to_receive;
