import { sql, eq } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  fullName: text('full_name').notNull().default(''),
  email: text('email').notNull().unique(),
  phone: text('phone').notNull().default(''),
  dateOfBirth: text('date_of_birth').notNull().default(''),
  gender: text('gender').notNull().default(''),
  staffId: text('staff_id').notNull().default(''),
  faculty: text('faculty').notNull().default(''),
  department: text('department').notNull().default(''),
  office: text('office').notNull().default(''),
  role: text('role').notNull().default(''),
  accountType: text('account_type').notNull().default('staff'),
  profilePictureUrl: text('profile_picture_url').notNull().default(''),
  primaryColor: text('primary_color').notNull().default('#0f172b'),
  secondaryColor: text('secondary_color').notNull().default('#3b5fcf'),
  darkMode: boolean('dark_mode').notNull().default(false),
  notifyNewMemo: boolean('notify_new_memo').notNull().default(true),
  notifyActionRequired: boolean('notify_action_required').notNull().default(true),
  notifyAnnouncements: boolean('notify_announcements').notNull().default(true),
  notifyEmail: boolean('notify_email').notNull().default(true),
  active: boolean('active').notNull().default(true),
  passwordHash: text('password_hash').notNull().default(''),
  createdBy: text('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check('users_account_type_check', sql`${table.accountType} in ('staff', 'hod', 'dean', 'vc', 'admin')`),
  index('users_account_type_idx').on(table.accountType),
  index('users_faculty_idx').on(table.faculty),
  index('users_department_idx').on(table.department),
  index('users_full_name_idx').on(table.fullName),
])

export const memos = pgTable('memos', {
  id: text('id').primaryKey(),
  subject: text('subject').notNull().default(''),
  body: text('body').notNull().default(''),
  refNumber: text('ref_number').notNull().default(''),
  memoDate: text('memo_date').notNull().default(''),
  category: text('category').notNull().default('general'),
  priority: text('priority').notNull().default('normal'),
  recipientMode: text('recipient_mode').notNull().default('all'),
  confidential: boolean('confidential').notNull().default(false),
  status: text('status').notNull().default('draft'),
  approvalStatus: text('approval_status').notNull().default('none'),
  senderId: text('sender_id').notNull().references(() => users.id),
  senderName: text('sender_name').notNull().default(''),
  senderDepartment: text('sender_department').notNull().default(''),
  senderFaculty: text('sender_faculty').notNull().default(''),
  hodId: text('hod_id').references(() => users.id),
  hodName: text('hod_name').notNull().default(''),
  hodApproval: boolean('hod_approval'),
  hodComment: text('hod_comment').notNull().default(''),
  hodApprovedAt: timestamp('hod_approved_at', { withTimezone: true }),
  deanId: text('dean_id').references(() => users.id),
  deanName: text('dean_name').notNull().default(''),
  deanApproval: boolean('dean_approval'),
  deanComment: text('dean_comment').notNull().default(''),
  deanApprovedAt: timestamp('dean_approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  submittedForApprovalAt: timestamp('submitted_for_approval_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, table => [
  check('memos_priority_check', sql`${table.priority} in ('low', 'normal', 'high', 'urgent')`),
  check('memos_recipient_mode_check', sql`${table.recipientMode} in ('all', 'faculty', 'department', 'type', 'manual')`),
  check('memos_status_check', sql`${table.status} in ('draft', 'pending_approval', 'sent', 'rejected')`),
  index('memos_sender_idx').on(table.senderId, table.createdAt),
  index('memos_status_idx').on(table.status),
])

export const memoRecipients = pgTable('memo_recipients', {
  memoId: text('memo_id').notNull().references(() => memos.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, table => [
  primaryKey({ columns: [table.memoId, table.userId] }),
])

export const memoDistribution = pgTable('memo_distribution', {
  memoId: text('memo_id').notNull().references(() => memos.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  label: text('label').notNull(),
}, table => [
  primaryKey({ columns: [table.memoId, table.position] }),
])

export const inboxItems = pgTable('inbox_items', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  memoId: text('memo_id').notNull().references(() => memos.id, { onDelete: 'cascade' }),
  subject: text('subject').notNull().default(''),
  priority: text('priority').notNull().default('normal'),
  category: text('category').notNull().default('general'),
  senderName: text('sender_name').notNull().default(''),
  senderId: text('sender_id').references(() => users.id),
  memoDate: text('memo_date').notNull().default(''),
  confidential: boolean('confidential').notNull().default(false),
  read: boolean('read').notNull().default(false),
  readAt: timestamp('read_at', { withTimezone: true }),
  acknowledged: boolean('acknowledged').notNull().default(false),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('inbox_items_user_memo_unique').on(table.userId, table.memoId),
  index('inbox_items_user_idx').on(table.userId, table.receivedAt),
])

export const memoViews = pgTable('memo_views', {
  memoId: text('memo_id').notNull().references(() => memos.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  viewerName: text('viewer_name').notNull().default(''),
  viewerEmail: text('viewer_email').notNull().default(''),
  viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.memoId, table.userId] }),
])

export const alerts = pgTable('alerts', {
  id: text('id').primaryKey(),
  recipientId: text('recipient_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull().default(''),
  title: text('title').notNull().default(''),
  body: text('body').notNull().default(''),
  priority: text('priority').notNull().default('normal'),
  memoId: text('memo_id').references(() => memos.id, { onDelete: 'set null' }),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index('alerts_recipient_idx').on(table.recipientId, table.createdAt),
])

export const companyNews = pgTable('company_news', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull().default(''),
  dateLabel: text('date_label').notNull().default(''),
  publishedOn: date('published_on'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const approvalQueue = pgTable('approval_queue', {
  reviewerId: text('reviewer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  memoId: text('memo_id').notNull().references(() => memos.id, { onDelete: 'cascade' }),
  subject: text('subject').notNull().default(''),
  priority: text('priority').notNull().default('normal'),
  category: text('category').notNull().default('general'),
  senderName: text('sender_name').notNull().default(''),
  senderId: text('sender_id').references(() => users.id),
  senderDepartment: text('sender_department').notNull().default(''),
  senderFaculty: text('sender_faculty').notNull().default(''),
  hodName: text('hod_name').notNull().default(''),
  stage: text('stage').notNull(),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.reviewerId, table.memoId] }),
  check('approval_queue_stage_check', sql`${table.stage} in ('hod', 'dean')`),
])

export const sessions = pgTable('sessions', {
  token: text('token').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const memoRefCounters = pgTable('memo_ref_counters', {
  year: integer('year').primaryKey(),
  seq: integer('seq').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const dashboardStats = pgView('dashboard_stats').as(qb =>
  qb.select({
    userId: sql`${users.id}`.as('user_id'),
    totalReceived: sql`count(${inboxItems.id})::integer`.as('total_received'),
    totalOpened: sql`count(${inboxItems.id}) filter (where ${inboxItems.read})::integer`.as('total_opened'),
    totalUnread: sql`count(${inboxItems.id}) filter (where not ${inboxItems.read})::integer`.as('total_unread'),
    awaitingAction: sql`count(${inboxItems.id}) filter (where not ${inboxItems.read})::integer`.as('awaiting_action'),
  })
    .from(users)
    .leftJoin(inboxItems, eq(inboxItems.userId, users.id))
    .groupBy(users.id)
)

export const memoAnalytics = pgView('memo_analytics').as(qb =>
  qb.select({
    memoId: sql`${memos.id}`.as('memo_id'),
    viewCount: sql`count(${memoViews.userId})::integer`.as('view_count'),
    lastViewed: sql`max(${memoViews.viewedAt})`.as('last_viewed'),
  })
    .from(memos)
    .leftJoin(memoViews, eq(memoViews.memoId, memos.id))
    .groupBy(memos.id)
)
