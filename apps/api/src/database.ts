import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { getMigrations } from 'better-auth/db/migration';
import { twoFactor } from 'better-auth/plugins';
import pg from 'pg';
import { createAccountMailer } from './email.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const production = process.env.NODE_ENV === 'production';
const secret = process.env.BETTER_AUTH_SECRET;
if (production && (!secret || secret.length < 32)) {
  throw new Error('Set BETTER_AUTH_SECRET to a random secret of at least 32 characters.');
}
if (production && process.env.DEMO_MODE === 'true') {
  throw new Error('Demo mode is only available in development.');
}

export const demoMode = !production && process.env.DEMO_MODE !== 'false';
export const demoEmail = 'alex@example.test';
export const demoPassword = 'local-demo-linkup-2026';
export const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
export const appOrigin = new URL(appUrl).origin;
const demoAccounts = new Set([demoEmail, 'maya@example.test', 'jordan@example.test', 'priya@example.test', 'daniel@example.test']);
const emailList = (value?: string) => new Set(value?.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));
const invited = emailList(process.env.BETA_INVITE_EMAILS);
const moderators = emailList(process.env.MODERATOR_EMAILS);
const instructors = emailList(process.env.LEARNING_INSTRUCTOR_EMAILS);
const sendAccountLink = createAccountMailer(production);
export const emailEnabled = Boolean(sendAccountLink);
export const inviteOnly = process.env.BETA_INVITE_ONLY === undefined ? production : process.env.BETA_INVITE_ONLY === 'true';
if (inviteOnly && !emailEnabled) throw new Error('Configure SMTP to verify each invitation email.');
if (inviteOnly && !invited.size) throw new Error('Set BETA_INVITE_EMAILS for the invite-only beta.');

export function canUseAccount(user: { email: string; emailVerified: boolean }) {
  return (demoMode || !demoAccounts.has(user.email)) && (!emailEnabled || user.emailVerified);
}

export function isModerator(user: { email: string; emailVerified: boolean }) {
  return (demoMode && user.email === 'maya@example.test') || (user.emailVerified && moderators.has(user.email.toLowerCase()));
}

export function isLearningInstructor(user: { email: string; emailVerified: boolean }) {
  return (demoMode && user.email === 'maya@example.test') || (user.emailVerified && instructors.has(user.email.toLowerCase()));
}

export const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://linkedup@127.0.0.1:55433/linkedup'
});
export const auth = betterAuth({
  database: db,
  baseURL: appUrl,
  secret: secret ?? 'linkedup-local-development-secret-use-env-in-production',
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if (context.path !== '/sign-up/email' && context.path !== '/sign-in/email') return;
      const email = typeof context.body?.email === 'string' ? context.body.email.trim().toLowerCase() : '';
      if (!demoMode && demoAccounts.has(email)) throw new APIError('FORBIDDEN', { message: 'This email address is unavailable.' });
      if (context.path === '/sign-up/email' && inviteOnly && !invited.has(email) && !(demoMode && demoAccounts.has(email))) {
        throw new APIError('FORBIDDEN', { message: 'This beta is invite-only. Use the email address that was invited.' });
      }
    })
  },
  emailAndPassword: {
    enabled: true, minPasswordLength: 12, requireEmailVerification: emailEnabled,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: sendAccountLink ? async ({ user, url }) => {
      if (!demoAccounts.has(user.email)) await sendAccountLink(user.email, 'Reset your Linkedup Pro password',
        'Use the link below to reset your Linkedup Pro password.', url);
    } : undefined
  },
  emailVerification: sendAccountLink ? {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      if (!demoAccounts.has(user.email)) await sendAccountLink(user.email, 'Verify your Linkedup Pro email',
        'Use the link below to verify your email and sign in to Linkedup Pro.', url);
    }
  } : undefined,
  plugins: [twoFactor({ issuer: 'Linkedup Pro' })]
});

export async function migrate() {
  const lock = await db.connect();
  try {
    await lock.query("SELECT pg_advisory_lock(77124831)");
    const migrations = await getMigrations(auth.options);
    await migrations.runMigrations();
    await lock.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
        headline text NOT NULL DEFAULT '',
        location text NOT NULL DEFAULT '',
        about text NOT NULL DEFAULT '',
        skills text[] NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS posts (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        author_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        body text NOT NULL,
        image text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS reactions (
        post_id integer REFERENCES posts(id) ON DELETE CASCADE,
        user_id text REFERENCES "user"(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS bookmarks (
        post_id integer REFERENCES posts(id) ON DELETE CASCADE,
        user_id text REFERENCES "user"(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS comments (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        post_id integer NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        author_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS connections (
        sender text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        recipient text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        accepted boolean NOT NULL DEFAULT false,
        CHECK (sender <> recipient)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS connection_pair ON connections
        (LEAST(sender, recipient), GREATEST(sender, recipient));
      CREATE TABLE IF NOT EXISTS projects (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        title text NOT NULL,
        contribution text NOT NULL,
        url text,
        verifier_id text REFERENCES "user"(id) ON DELETE SET NULL,
        verified_at timestamptz,
        is_public boolean NOT NULL DEFAULT true
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        title text NOT NULL,
        company text NOT NULL,
        location text NOT NULL,
        work_mode text NOT NULL,
        employment_type text NOT NULL,
        salary text NOT NULL,
        description text NOT NULL,
        response_date date,
        color text NOT NULL DEFAULT 'violet',
        closed boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS saved_jobs (
        job_id integer REFERENCES jobs(id) ON DELETE CASCADE,
        user_id text REFERENCES "user"(id) ON DELETE CASCADE,
        PRIMARY KEY (job_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS applications (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        job_id integer NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        project_id integer REFERENCES projects(id) ON DELETE SET NULL,
        note text NOT NULL,
        resume_url text,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(job_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS application_events (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        application_id integer NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
        status text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS application_resumes (
        application_id integer PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
        filename text NOT NULL,
        content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 5242880)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        sender text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        recipient text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (sender <> recipient)
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        message text NOT NULL,
        category text NOT NULL,
        seen boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS post_reports (
        post_id integer REFERENCES posts(id) ON DELETE CASCADE,
        user_id text REFERENCES "user"(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, user_id)
      );
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
      ALTER TABLE post_reports ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'Other';
      ALTER TABLE post_reports ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE post_reports ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
      CREATE TABLE IF NOT EXISTS professional_groups (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        name text NOT NULL,
        description text NOT NULL,
        industry text NOT NULL,
        visibility text NOT NULL CHECK (visibility IN ('public','private')),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS group_members (
        group_id integer NOT NULL REFERENCES professional_groups(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        membership text NOT NULL CHECK (membership IN ('active','pending','invited')),
        role text NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (group_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS group_members_by_user ON group_members(user_id, group_id);
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS group_id integer REFERENCES professional_groups(id) ON DELETE CASCADE;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS group_topic text;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS group_hidden_at timestamptz;
      CREATE INDEX IF NOT EXISTS group_discussions ON posts(group_id, created_at DESC) WHERE group_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS professional_events (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        host_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        title text NOT NULL,
        description text NOT NULL,
        category text NOT NULL CHECK (category IN ('Meetup','Webinar','Conference')),
        format text NOT NULL CHECK (format IN ('online','in-person')),
        starts_at timestamptz NOT NULL,
        ends_at timestamptz NOT NULL,
        venue text,
        meeting_url text,
        cancelled_at timestamptz,
        live_started_at timestamptz,
        live_ended_at timestamptz,
        CHECK (ends_at > starts_at),
        CHECK ((format='online' AND meeting_url IS NOT NULL AND venue IS NULL)
          OR (format='in-person' AND venue IS NOT NULL AND meeting_url IS NULL))
      );
      CREATE INDEX IF NOT EXISTS professional_events_starts ON professional_events(starts_at);
      CREATE TABLE IF NOT EXISTS event_attendees (
        event_id integer NOT NULL REFERENCES professional_events(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        status text NOT NULL CHECK (status IN ('invited','registered','declined')),
        updated_at timestamptz NOT NULL DEFAULT now(),
        reminded_at timestamptz,
        checked_in_at timestamptz,
        PRIMARY KEY (event_id,user_id)
      );
      CREATE INDEX IF NOT EXISTS event_attendees_by_user ON event_attendees(user_id,event_id);
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS event_id integer REFERENCES professional_events(id) ON DELETE CASCADE
        CHECK (group_id IS NULL OR event_id IS NULL);
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS event_topic text;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS event_hidden_at timestamptz;
      CREATE INDEX IF NOT EXISTS event_discussions ON posts(event_id,created_at DESC) WHERE event_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS newsletters (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        title text NOT NULL,
        description text NOT NULL,
        cadence text NOT NULL CHECK (cadence IN ('Weekly','Every two weeks','Monthly','Occasional')),
        cover bytea,
        cover_type text,
        cover_alt text NOT NULL DEFAULT '',
        edition_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK ((cover IS NULL AND cover_type IS NULL) OR
          (cover_type IS NOT NULL AND cover_type IN ('image/jpeg','image/png','image/webp') AND octet_length(cover) BETWEEN 1 AND 5242880))
      );
      ALTER TABLE newsletters ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
      CREATE INDEX IF NOT EXISTS newsletters_by_owner ON newsletters(owner_id,id DESC);
      CREATE TABLE IF NOT EXISTS publication_articles (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        author_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        newsletter_id integer REFERENCES newsletters(id) ON DELETE CASCADE,
        edition_number integer,
        title text NOT NULL DEFAULT '',
        excerpt text NOT NULL DEFAULT '',
        body jsonb NOT NULL,
        cover bytea,
        cover_type text,
        cover_alt text NOT NULL DEFAULT '',
        published_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (newsletter_id,edition_number),
        CHECK (edition_number IS NULL OR (newsletter_id IS NOT NULL AND published_at IS NOT NULL)),
        CHECK ((cover IS NULL AND cover_type IS NULL) OR
          (cover_type IS NOT NULL AND cover_type IN ('image/jpeg','image/png','image/webp') AND octet_length(cover) BETWEEN 1 AND 5242880))
      );
      CREATE INDEX IF NOT EXISTS publication_articles_published ON publication_articles(published_at DESC) WHERE published_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS publication_articles_by_author ON publication_articles(author_id,updated_at DESC);
      CREATE INDEX IF NOT EXISTS publication_articles_by_newsletter ON publication_articles(newsletter_id,published_at DESC);
      CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
        newsletter_id integer NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        PRIMARY KEY (newsletter_id,user_id)
      );
      CREATE INDEX IF NOT EXISTS newsletter_subscriptions_by_user ON newsletter_subscriptions(user_id,newsletter_id);
      CREATE TABLE IF NOT EXISTS article_reads (
        article_id integer NOT NULL REFERENCES publication_articles(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        PRIMARY KEY (article_id,user_id)
      );
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS publication_article_id integer REFERENCES publication_articles(id) ON DELETE SET NULL;
      CREATE TABLE IF NOT EXISTS professional_companies (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        owner_id text NOT NULL REFERENCES "user"(id),
        name text NOT NULL,
        description text NOT NULL,
        industry text NOT NULL,
        size text NOT NULL,
        headquarters text NOT NULL,
        locations text[] NOT NULL DEFAULT '{}',
        workplace text NOT NULL CHECK (workplace IN ('On-site','Hybrid','Remote','Varies by role')),
        website text,
        culture text NOT NULL DEFAULT '',
        cta_label text,
        cta_url text,
        logo bytea,
        logo_type text,
        logo_alt text NOT NULL DEFAULT '',
        banner bytea,
        banner_type text,
        banner_alt text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK ((cta_label IS NULL) = (cta_url IS NULL)),
        CHECK ((logo IS NULL AND logo_type IS NULL) OR
          (logo_type IS NOT NULL AND logo_type IN ('image/jpeg','image/png','image/webp') AND octet_length(logo) BETWEEN 1 AND 2097152)),
        CHECK ((banner IS NULL AND banner_type IS NULL) OR
          (banner_type IS NOT NULL AND banner_type IN ('image/jpeg','image/png','image/webp') AND octet_length(banner) BETWEEN 1 AND 5242880))
      );
      CREATE INDEX IF NOT EXISTS professional_companies_name ON professional_companies(name);
      CREATE TABLE IF NOT EXISTS company_members (
        company_id integer NOT NULL REFERENCES professional_companies(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        role text NOT NULL CHECK (role IN ('requested','employee','admin')),
        requested_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (company_id,user_id)
      );
      CREATE INDEX IF NOT EXISTS company_members_by_user ON company_members(user_id,company_id);
      CREATE TABLE IF NOT EXISTS company_followers (
        company_id integer NOT NULL REFERENCES professional_companies(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        PRIMARY KEY (company_id,user_id)
      );
      CREATE INDEX IF NOT EXISTS company_followers_by_user ON company_followers(user_id,company_id);
      CREATE TABLE IF NOT EXISTS company_visits (
        company_id integer NOT NULL REFERENCES professional_companies(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        PRIMARY KEY (company_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS company_showcases (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        company_id integer NOT NULL REFERENCES professional_companies(id) ON DELETE CASCADE,
        kind text NOT NULL CHECK (kind IN ('Product','Showcase')),
        title text NOT NULL,
        description text NOT NULL,
        url text
      );
      CREATE INDEX IF NOT EXISTS company_showcases_by_company ON company_showcases(company_id,id DESC);
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company_id integer REFERENCES professional_companies(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS jobs_by_company ON jobs(company_id,created_at DESC) WHERE company_id IS NOT NULL;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS company_id integer REFERENCES professional_companies(id) ON DELETE CASCADE
        CHECK (company_id IS NULL OR (group_id IS NULL AND event_id IS NULL));
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS company_hidden_at timestamptz;
      CREATE INDEX IF NOT EXISTS company_updates ON posts(company_id,created_at DESC) WHERE company_id IS NOT NULL;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS company_id integer REFERENCES professional_companies(id) ON DELETE SET NULL;
      CREATE TABLE IF NOT EXISTS learning_courses (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        instructor_id text REFERENCES "user"(id) ON DELETE SET NULL,
        title text NOT NULL,
        description text NOT NULL,
        category text NOT NULL CHECK (category IN ('Technical','Business','Soft skills','Certification prep')),
        level text NOT NULL CHECK (level IN ('Beginner','Intermediate','Advanced')),
        skills text[] NOT NULL DEFAULT '{}',
        lessons jsonb NOT NULL CHECK (jsonb_typeof(lessons)='array' AND jsonb_array_length(lessons) BETWEEN 1 AND 16),
        published_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS learning_courses_instructor ON learning_courses(instructor_id,id DESC);
      CREATE TABLE IF NOT EXISTS learning_bookmarks (
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        course_id integer NOT NULL REFERENCES learning_courses(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id,course_id)
      );
      CREATE TABLE IF NOT EXISTS learning_enrollments (
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        course_id integer NOT NULL REFERENCES learning_courses(id) ON DELETE CASCADE,
        completed_lessons integer[] NOT NULL DEFAULT '{}',
        completed_at timestamptz,
        certificate_id uuid UNIQUE,
        profile_visible boolean NOT NULL DEFAULT false,
        PRIMARY KEY (user_id,course_id),
        CHECK ((completed_at IS NULL) = (certificate_id IS NULL)),
        CHECK (NOT profile_visible OR certificate_id IS NOT NULL)
      );
      CREATE TABLE IF NOT EXISTS learning_paths (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        title text NOT NULL,
        description text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS learning_path_courses (
        path_id integer NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
        position integer NOT NULL CHECK (position > 0),
        course_id integer NOT NULL REFERENCES learning_courses(id),
        PRIMARY KEY(path_id,position),
        UNIQUE(path_id,course_id)
      );
      CREATE TABLE IF NOT EXISTS service_providers (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        owner_id text NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
        headline text NOT NULL,
        about text NOT NULL,
        work_mode text NOT NULL CHECK (work_mode IN ('Remote','On-site','Both')),
        location text NOT NULL DEFAULT '',
        accepting boolean NOT NULL DEFAULT true,
        CHECK (work_mode='Remote' OR length(location)>0)
      );
      CREATE TABLE IF NOT EXISTS service_offerings (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        provider_id integer NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
        title text NOT NULL,
        description text NOT NULL,
        category text NOT NULL CHECK (category IN ('Design','Development','Marketing','Writing','Business consulting','Career coaching','Other')),
        pricing_note text NOT NULL DEFAULT '',
        active boolean NOT NULL DEFAULT true,
        UNIQUE (id,provider_id)
      );
      CREATE INDEX IF NOT EXISTS service_offerings_provider ON service_offerings(provider_id,id);
      CREATE TABLE IF NOT EXISTS service_requests (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        provider_id integer NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
        client_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        client_key uuid NOT NULL,
        offering_id integer,
        offering_title text,
        kind text NOT NULL CHECK (kind IN ('inquiry','proposal')),
        title text NOT NULL,
        brief text NOT NULL,
        budget text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','quoted','accepted','delivered','completed','declined','cancelled')),
        quote_amount integer CHECK (quote_amount>0),
        quote_currency text CHECK (quote_currency IN ('USD','INR','EUR','GBP','CAD','AUD')),
        quote_scope text,
        quote_delivery date,
        quote_version integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (offering_id,provider_id) REFERENCES service_offerings(id,provider_id) ON DELETE CASCADE,
        UNIQUE (client_id,client_key),
        CHECK ((offering_id IS NULL) = (offering_title IS NULL)),
        CHECK ((quote_version=0 AND quote_amount IS NULL AND quote_currency IS NULL AND quote_scope IS NULL AND quote_delivery IS NULL)
          OR (quote_version>0 AND quote_amount IS NOT NULL AND quote_currency IS NOT NULL AND quote_scope IS NOT NULL AND quote_delivery IS NOT NULL)),
        CHECK (status NOT IN ('quoted','accepted','delivered','completed') OR quote_version>0)
      );
      CREATE INDEX IF NOT EXISTS service_requests_provider ON service_requests(provider_id,updated_at DESC);
      CREATE INDEX IF NOT EXISTS service_requests_client ON service_requests(client_id,updated_at DESC);
      CREATE TABLE IF NOT EXISTS service_request_messages (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        request_id integer NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
        sender_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        kind text NOT NULL CHECK (kind IN ('message','activity')),
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS service_request_thread ON service_request_messages(request_id,id);
      CREATE TABLE IF NOT EXISTS service_reviews (
        request_id integer PRIMARY KEY REFERENCES service_requests(id) ON DELETE CASCADE,
        rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS service_request_id integer REFERENCES service_requests(id) ON DELETE CASCADE;
      CREATE TABLE IF NOT EXISTS sales_leads (
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        lead_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        stage text NOT NULL DEFAULT 'Prospect' CHECK (stage IN ('Prospect','Contacted','Qualified','Won','Lost')),
        notes text NOT NULL DEFAULT '',
        follow_up_at timestamptz,
        alerted_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(user_id,lead_id),
        CHECK (user_id<>lead_id)
      );
      CREATE INDEX IF NOT EXISTS sales_leads_due ON sales_leads(follow_up_at) WHERE follow_up_at IS NOT NULL AND alerted_at IS NULL;
      CREATE TABLE IF NOT EXISTS sales_accounts (
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        company_id integer NOT NULL REFERENCES professional_companies(id) ON DELETE CASCADE,
        watched_at timestamptz,
        saved_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(user_id,company_id)
      );
      CREATE INDEX IF NOT EXISTS sales_accounts_watched ON sales_accounts(company_id,watched_at) WHERE watched_at IS NOT NULL;
      CREATE TABLE IF NOT EXISTS sales_lists (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        name text NOT NULL,
        UNIQUE(id,user_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS sales_list_names ON sales_lists(user_id,lower(name));
      CREATE TABLE IF NOT EXISTS sales_list_leads (
        list_id integer NOT NULL,
        user_id text NOT NULL,
        lead_id text NOT NULL,
        PRIMARY KEY(list_id,lead_id),
        FOREIGN KEY(list_id,user_id) REFERENCES sales_lists(id,user_id) ON DELETE CASCADE,
        FOREIGN KEY(user_id,lead_id) REFERENCES sales_leads(user_id,lead_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS sales_list_leads_saved ON sales_list_leads(user_id,lead_id);
      CREATE TABLE IF NOT EXISTS sales_list_accounts (
        list_id integer NOT NULL,
        user_id text NOT NULL,
        company_id integer NOT NULL,
        PRIMARY KEY(list_id,company_id),
        FOREIGN KEY(list_id,user_id) REFERENCES sales_lists(id,user_id) ON DELETE CASCADE,
        FOREIGN KEY(user_id,company_id) REFERENCES sales_accounts(user_id,company_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS sales_list_accounts_saved ON sales_list_accounts(user_id,company_id);
      CREATE TABLE IF NOT EXISTS sales_job_alerts (
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        job_id integer NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        PRIMARY KEY(user_id,job_id)
      );
      CREATE TABLE IF NOT EXISTS ad_campaigns (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        company_id integer NOT NULL REFERENCES professional_companies(id) ON DELETE CASCADE,
        name text NOT NULL,
        format text NOT NULL CHECK (format IN ('Sponsored post','Single image','Text')),
        post_id integer REFERENCES posts(id) ON DELETE SET NULL,
        headline text NOT NULL DEFAULT '',
        body text NOT NULL DEFAULT '',
        image bytea,
        image_type text,
        image_alt text NOT NULL DEFAULT '',
        objective text NOT NULL CHECK (objective IN ('company','website','lead')),
        destination text,
        button_label text NOT NULL,
        target_location text NOT NULL DEFAULT '',
        target_skills text[] NOT NULL DEFAULT '{}',
        followers_only boolean NOT NULL DEFAULT false,
        budget integer NOT NULL CHECK (budget BETWEEN 1 AND 1000000),
        delivered integer NOT NULL DEFAULT 0 CHECK (delivered>=0 AND delivered<=budget),
        starts_at timestamptz,
        ends_at timestamptz,
        state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','active','paused','ended')),
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK ((objective='website') = (destination IS NOT NULL)),
        CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at<ends_at),
        CHECK ((image IS NULL AND image_type IS NULL) OR (image IS NOT NULL AND image_type IS NOT NULL
          AND image_type IN ('image/jpeg','image/png','image/webp') AND octet_length(image) BETWEEN 1 AND 5242880)),
        CHECK ((format='Single image') = (image IS NOT NULL))
      );
      CREATE INDEX IF NOT EXISTS ad_campaigns_by_company ON ad_campaigns(company_id,id DESC);
      CREATE INDEX IF NOT EXISTS ad_campaigns_running ON ad_campaigns(starts_at,id) WHERE state='active' AND delivered<budget;
      CREATE TABLE IF NOT EXISTS ad_deliveries (
        id uuid PRIMARY KEY,
        campaign_id integer NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
        viewer_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        delivery_day date NOT NULL,
        delivered_at timestamptz NOT NULL DEFAULT now(),
        clicked_at timestamptz,
        UNIQUE(campaign_id,viewer_id,delivery_day),
        UNIQUE(id,campaign_id,viewer_id)
      );
      CREATE INDEX IF NOT EXISTS ad_deliveries_reporting ON ad_deliveries(campaign_id,delivered_at);
      CREATE TABLE IF NOT EXISTS ad_leads (
        campaign_id integer NOT NULL,
        member_id text NOT NULL,
        delivery_id uuid NOT NULL UNIQUE,
        name text NOT NULL,
        email text NOT NULL,
        message text NOT NULL DEFAULT '',
        consented_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(campaign_id,member_id),
        FOREIGN KEY(delivery_id,campaign_id,member_id) REFERENCES ad_deliveries(id,campaign_id,viewer_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS analytics_installation (
        singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
        started_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO analytics_installation DEFAULT VALUES ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS analytics_profile_activity (
        subject_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        viewer_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        day date NOT NULL,
        kind text NOT NULL CHECK (kind IN ('profile','search')),
        PRIMARY KEY(subject_id,day,kind,viewer_id),
        CHECK (subject_id<>viewer_id)
      );
      CREATE INDEX IF NOT EXISTS analytics_profile_viewer ON analytics_profile_activity(viewer_id);
      CREATE TABLE IF NOT EXISTS analytics_post_impressions (
        post_id integer NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        viewer_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        day date NOT NULL,
        PRIMARY KEY(post_id,day,viewer_id)
      );
      CREATE INDEX IF NOT EXISTS analytics_post_viewer ON analytics_post_impressions(viewer_id);
      CREATE TABLE IF NOT EXISTS analytics_article_views (
        article_id integer NOT NULL REFERENCES publication_articles(id) ON DELETE CASCADE,
        viewer_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        day date NOT NULL,
        PRIMARY KEY(article_id,day,viewer_id)
      );
      CREATE INDEX IF NOT EXISTS analytics_article_viewer ON analytics_article_views(viewer_id);
      CREATE TABLE IF NOT EXISTS analytics_company_views (
        company_id integer NOT NULL REFERENCES professional_companies(id) ON DELETE CASCADE,
        viewer_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        day date NOT NULL,
        PRIMARY KEY(company_id,day,viewer_id)
      );
      CREATE INDEX IF NOT EXISTS analytics_company_viewer ON analytics_company_views(viewer_id);
      ALTER TABLE reactions ADD COLUMN IF NOT EXISTS created_at timestamptz;
      ALTER TABLE reactions ALTER COLUMN created_at SET DEFAULT now();
      ALTER TABLE company_followers ADD COLUMN IF NOT EXISTS followed_at timestamptz;
      ALTER TABLE company_followers ALTER COLUMN followed_at SET DEFAULT now();
      ALTER TABLE newsletter_subscriptions ADD COLUMN IF NOT EXISTS subscribed_at timestamptz;
      ALTER TABLE newsletter_subscriptions ALTER COLUMN subscribed_at SET DEFAULT now();
      CREATE INDEX IF NOT EXISTS analytics_posts_by_author ON posts(author_id,created_at DESC) WHERE group_id IS NULL AND event_id IS NULL AND company_id IS NULL;
      CREATE INDEX IF NOT EXISTS analytics_applications_date ON applications(job_id,created_at);
      CREATE INDEX IF NOT EXISTS analytics_campaign_leads_date ON ad_leads(campaign_id,consented_at);
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS required_skills text[] NOT NULL DEFAULT '{}';
      CREATE TABLE IF NOT EXISTS ai_daily_usage (
        user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        day date NOT NULL,
        requests integer NOT NULL CHECK (requests>0),
        PRIMARY KEY(user_id,day)
      );
      CREATE TABLE IF NOT EXISTS post_reviews (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        post_id integer REFERENCES posts(id) ON DELETE SET NULL,
        moderator_id text REFERENCES "user"(id) ON DELETE SET NULL,
        action text NOT NULL CHECK (action IN ('dismiss','hide','restore')),
        report_count int NOT NULL CHECK (report_count >= 0),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS open_post_reports ON post_reports (post_id, created_at DESC) WHERE reviewed_at IS NULL;
      CREATE INDEX IF NOT EXISTS post_reviews_post ON post_reviews (post_id, id DESC);
      CREATE INDEX IF NOT EXISTS posts_created_at ON posts (created_at DESC);
      CREATE INDEX IF NOT EXISTS comments_post ON comments (post_id, id);
      CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, id DESC);
      CREATE INDEX IF NOT EXISTS messages_participants ON messages (sender, recipient, id DESC);
      CREATE INDEX IF NOT EXISTS application_timeline ON application_events (application_id, id DESC);
    `);
  } finally {
    try {
      await lock.query("SELECT pg_advisory_unlock(77124831)");
    } finally {
      lock.release();
    }
  }
}
