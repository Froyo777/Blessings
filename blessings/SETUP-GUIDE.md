# ✦ BLESSINGS — Setup Guide
## Everything you need to do (step by step)

---

## ACCOUNTS YOU NEED TO CREATE (all free)

### 1. SUPABASE — your database & user accounts
→ Go to: https://supabase.com
→ Click "Start your project" → sign up with GitHub or email
→ Click "New project"
→ Name it: blessings
→ Set a database password (save this somewhere)
→ Choose region: closest to you (e.g. Sydney)
→ Wait ~2 minutes for it to spin up

**Then set up the database:**
→ In Supabase, click "SQL Editor" in the left sidebar
→ Click "New Query"
→ Open the file: supabase-schema.sql (from this zip)
→ Copy ALL the contents and paste into the SQL editor
→ Click "Run" (green button)
→ You should see "Success. No rows returned"

**Get your API keys:**
→ In Supabase, go to Settings → API
→ Copy "Project URL" → this is your SUPABASE_URL
→ Copy "anon / public" key → this is your SUPABASE_ANON_KEY
→ Copy "service_role" key → this is your SUPABASE_SERVICE_ROLE_KEY

---

### 2. RESEND — sends your notification emails
→ Go to: https://resend.com
→ Sign up for free (3,000 emails/month free)
→ Go to API Keys → Create API Key
→ Name it: blessings-production
→ Copy the key → this is your RESEND_API_KEY

**Set up your sending domain (when ready):**
→ In Resend, go to Domains → Add Domain
→ Enter your domain (e.g. yourdomain.com)
→ Add the DNS records it shows you in Namecheap/Porkbun
→ Wait for verification (usually <5 mins)

---

### 3. NETLIFY — hosts your website
→ Go to: https://app.netlify.com
→ Sign up (use GitHub for easiest experience)
→ Click "Add new site" → "Deploy manually"
→ Drag and drop the entire "blessings" folder
→ Your site will be live instantly at a random URL

**Add environment variables (connects everything together):**
→ In Netlify, go to: Site settings → Environment Variables
→ Add each of these (click "Add variable" for each):

  Key: SUPABASE_URL          Value: (your Supabase project URL)
  Key: SUPABASE_SERVICE_ROLE_KEY  Value: (your service role key)
  Key: VITE_SUPABASE_URL     Value: (your Supabase project URL)
  Key: VITE_SUPABASE_ANON_KEY    Value: (your anon key)
  Key: RESEND_API_KEY        Value: (your Resend API key)
  Key: FROM_EMAIL            Value: blessings@yourdomain.com
  Key: FROM_NAME             Value: Blessings
  Key: APP_URL               Value: https://yourdomain.com

→ After adding all variables, go to Deploys → Trigger deploy

---

### 4. UPDATE YOUR CODE WITH YOUR SUPABASE KEYS
Open: public/index.html
Find these two lines near the bottom (around line 400):
  const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
  const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE';

Replace with your actual values from Supabase → Settings → API.

---

### 5. CONNECT YOUR CUSTOM DOMAIN
→ In Netlify: Site settings → Domain management → Add custom domain
→ Enter your domain (e.g. blessings.org)
→ Netlify will show you nameservers (like dns1.p01.nsone.net)
→ Go to Namecheap/Porkbun → your domain → Nameservers
→ Switch to "Custom DNS" and paste Netlify's nameservers
→ Wait 10-60 minutes
→ Your site will be live at your domain with free HTTPS ✓

---

## SUMMARY OF ACCOUNTS

| Service   | What it does              | Cost     | URL                    |
|-----------|---------------------------|----------|------------------------|
| Supabase  | Database + user accounts  | FREE     | supabase.com           |
| Resend    | Email notifications       | FREE     | resend.com             |
| Netlify   | Website hosting           | FREE     | netlify.com            |
| Namecheap | Domain name               | ~$12/yr  | namecheap.com          |

Total ongoing cost: ~$12/year (just the domain)

---

## WHAT'S ALREADY BUILT FOR YOU

✓ Beautiful website with Give & Receive flows
✓ User sign up & sign in system
✓ Real matching engine (pairs givers with receivers globally)
✓ Blessing queue (if no match found, you're queued and notified)
✓ Email notifications (match found, blessing delivered, received)
✓ Personal dashboard (see all your blessings given & received)
✓ Anonymous delivery system
✓ Row-level security (users can only see their own data)
✓ Mobile responsive design

---

## NEED HELP?

Come back to Claude and say:
- "Help me set up Supabase for Blessings"
- "Something's not working with my deployment"
- "I want to add [feature] to Blessings"

We'll keep building this together. 🌿
