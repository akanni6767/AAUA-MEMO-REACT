-- AAUA Memo: Firestore structure as Neon Postgres.
--
-- Extracted from the collections this app reads and writes.
-- Document ids are kept as text so existing Firebase ids can be imported.
-- Passwords live in users.password_hash (scrypt). Sessions live in sessions.
--
-- Firestore path                          Postgres
-- userProfiles/{uid}                      users
-- allUsers/{uid}                          users          (directory fields on the same row)
-- dashboardStats/{uid}                    dashboard_stats view
-- memos/{id}                              memos
--   recipientUids[]                       memo_recipients
--   distribution[]                        memo_distribution
-- userInbox/{uid}/memos/{memoId}          inbox_items
-- memoViews/{memoId}_{uid}                memo_views
-- memoAnalytics/{memoId}                  memo_analytics view
-- alerts/{id}                             alerts
-- companyNews/{id}                        company_news
-- approvalQueue/{uid}/pending/{memoId}    approval_queue
-- _counters/memoRef                       memo_ref_counters

create table users (
  id text primary key,
  full_name text not null default '',
  email text not null unique,
  phone text not null default '',
  date_of_birth text not null default '',
  gender text not null default '',
  staff_id text not null default '',
  faculty text not null default '',
  department text not null default '',
  office text not null default '',
  role text not null default '',
  account_type text not null default 'staff'
    check (account_type in ('staff', 'hod', 'dean', 'vc', 'admin')),
  profile_picture_url text not null default '',
  primary_color text not null default '#0f172b',
  secondary_color text not null default '#3b5fcf',
  dark_mode boolean not null default false,
  notify_new_memo boolean not null default true,
  notify_action_required boolean not null default true,
  notify_announcements boolean not null default true,
  notify_email boolean not null default true,
  active boolean not null default true,
  password_hash text not null default '',
  created_by text references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_account_type_idx on users (account_type);
create index users_faculty_idx on users (faculty);
create index users_department_idx on users (department);
create index users_full_name_idx on users (full_name);

create table memos (
  id text primary key,
  subject text not null default '',
  body text not null default '',
  ref_number text not null default '',
  memo_date text not null default '',
  category text not null default 'general',
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  recipient_mode text not null default 'all'
    check (recipient_mode in ('all', 'faculty', 'department', 'type', 'manual')),
  confidential boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'sent', 'rejected')),
  approval_status text not null default 'none',
  sender_id text not null references users (id),
  sender_name text not null default '',
  sender_department text not null default '',
  sender_faculty text not null default '',
  hod_id text references users (id),
  hod_name text not null default '',
  hod_approval boolean,
  hod_comment text not null default '',
  hod_approved_at timestamptz,
  dean_id text references users (id),
  dean_name text not null default '',
  dean_approval boolean,
  dean_comment text not null default '',
  dean_approved_at timestamptz,
  created_at timestamptz not null default now(),
  submitted_for_approval_at timestamptz,
  sent_at timestamptz
);

create index memos_sender_idx on memos (sender_id, created_at desc);
create index memos_status_idx on memos (status);

create table memo_recipients (
  memo_id text not null references memos (id) on delete cascade,
  user_id text not null references users (id) on delete cascade,
  primary key (memo_id, user_id)
);

create table memo_distribution (
  memo_id text not null references memos (id) on delete cascade,
  position integer not null,
  label text not null,
  primary key (memo_id, position)
);

create table inbox_items (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  memo_id text not null references memos (id) on delete cascade,
  subject text not null default '',
  priority text not null default 'normal',
  category text not null default 'general',
  sender_name text not null default '',
  sender_id text references users (id),
  memo_date text not null default '',
  confidential boolean not null default false,
  read boolean not null default false,
  read_at timestamptz,
  acknowledged boolean not null default false,
  received_at timestamptz not null default now(),
  unique (user_id, memo_id)
);

create index inbox_items_user_idx on inbox_items (user_id, received_at desc);

create table memo_views (
  memo_id text not null references memos (id) on delete cascade,
  user_id text not null references users (id) on delete cascade,
  viewer_name text not null default '',
  viewer_email text not null default '',
  viewed_at timestamptz not null default now(),
  primary key (memo_id, user_id)
);

create table alerts (
  id text primary key,
  recipient_id text not null references users (id) on delete cascade,
  type text not null default '',
  title text not null default '',
  body text not null default '',
  priority text not null default 'normal',
  memo_id text references memos (id) on delete set null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index alerts_recipient_idx on alerts (recipient_id, created_at desc);

create table company_news (
  id text primary key,
  title text not null,
  content text not null default '',
  date_label text not null default '',
  published_on date,
  created_at timestamptz not null default now()
);

create table approval_queue (
  reviewer_id text not null references users (id) on delete cascade,
  memo_id text not null references memos (id) on delete cascade,
  subject text not null default '',
  priority text not null default 'normal',
  category text not null default 'general',
  sender_name text not null default '',
  sender_id text references users (id),
  sender_department text not null default '',
  sender_faculty text not null default '',
  hod_name text not null default '',
  stage text not null check (stage in ('hod', 'dean')),
  read boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (reviewer_id, memo_id)
);

create table sessions (
  token text primary key,
  user_id text not null references users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table memo_ref_counters (
  year integer primary key,
  seq integer not null default 0,
  updated_at timestamptz not null default now()
);

create view dashboard_stats as
select
  u.id as user_id,
  count(i.id)::integer as total_received,
  count(i.id) filter (where i.read)::integer as total_opened,
  count(i.id) filter (where not i.read)::integer as total_unread,
  count(i.id) filter (where not i.read)::integer as awaiting_action
from users u
left join inbox_items i on i.user_id = u.id
group by u.id;

create view memo_analytics as
select
  m.id as memo_id,
  count(v.user_id)::integer as view_count,
  max(v.viewed_at) as last_viewed
from memos m
left join memo_views v on v.memo_id = m.id
group by m.id;
