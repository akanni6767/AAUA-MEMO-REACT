import { randomBytes, randomUUID } from 'node:crypto'
import { getSql } from '../db/index.js'
import { hashPassword, verifyPassword } from './password.js'

const SEED_EMAIL = 'admin@aaua.edu.ng'
const SEED_PASSWORD = 'Admin@12345'

function ts(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return { seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 }
}

function fromTs(value) {
  if (value == null || value === '') return null
  if (value.__type === 'serverTimestamp') return new Date()
  if (typeof value === 'object' && typeof value.seconds === 'number') return new Date(value.seconds * 1000)
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function has(data, key) {
  return Object.prototype.hasOwnProperty.call(data, key)
}

function ident(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('Bad column')
  return name
}

async function insert(tx, table, row) {
  if (!Object.keys(row).length) return
  await tx`insert into ${tx(ident(table))} ${tx(row)}`
}

async function patch(tx, table, idCol, id, row) {
  if (!Object.keys(row).length) return
  await tx`update ${tx(ident(table))} set ${tx(row)} where ${tx(ident(idCol))} = ${id}`
}

function textOrEmpty(value) {
  if (value == null) return ''
  return String(value)
}

function profileDoc(row) {
  return {
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    dateOfBirth: row.date_of_birth,
    gender: row.gender,
    staffId: row.staff_id,
    faculty: row.faculty,
    department: row.department,
    office: row.office,
    role: row.role,
    accountType: row.account_type,
    profilePictureUrl: row.profile_picture_url,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    darkMode: row.dark_mode,
    notifications: {
      newMemo: row.notify_new_memo,
      actionRequired: row.notify_action_required,
      announcements: row.notify_announcements,
      email: row.notify_email,
    },
    createdBy: row.created_by,
    createdAt: ts(row.created_at),
    updatedAt: ts(row.updated_at),
  }
}

function directoryDoc(row) {
  return {
    uid: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    faculty: row.faculty,
    department: row.department,
    accountType: row.account_type,
    role: row.role,
    profilePictureUrl: row.profile_picture_url,
    createdBy: row.created_by,
    createdAt: ts(row.created_at),
    active: row.active,
  }
}

function userColumns(data) {
  const out = {}
  const map = {
    fullName: 'full_name',
    email: 'email',
    phone: 'phone',
    dateOfBirth: 'date_of_birth',
    gender: 'gender',
    staffId: 'staff_id',
    faculty: 'faculty',
    department: 'department',
    office: 'office',
    role: 'role',
    accountType: 'account_type',
    profilePictureUrl: 'profile_picture_url',
    primaryColor: 'primary_color',
    secondaryColor: 'secondary_color',
    darkMode: 'dark_mode',
    active: 'active',
  }
  for (const [key, col] of Object.entries(map)) {
    if (!has(data, key) || (data[key] && data[key].__type)) continue
    if (col === 'dark_mode' || col === 'active') out[col] = !!data[key]
    else if (col === 'email') out[col] = String(data[key] || '').trim()
    else out[col] = textOrEmpty(data[key])
  }
  if (has(data, 'createdBy')) out.created_by = data.createdBy || null
  if (has(data, 'createdAt')) out.created_at = fromTs(data.createdAt) || new Date()
  if (has(data, 'updatedAt')) out.updated_at = fromTs(data.updatedAt) || new Date()
  if (data.notifications && typeof data.notifications === 'object') {
    const n = data.notifications
    if (has(n, 'newMemo')) out.notify_new_memo = !!n.newMemo
    if (has(n, 'actionRequired')) out.notify_action_required = !!n.actionRequired
    if (has(n, 'announcements')) out.notify_announcements = !!n.announcements
    if (has(n, 'email')) out.notify_email = !!n.email
  }
  return out
}

const MEMO_TEXT = new Set([
  'subject', 'body', 'ref_number', 'memo_date', 'category', 'priority', 'recipient_mode',
  'status', 'approval_status', 'sender_name', 'sender_department', 'sender_faculty',
  'hod_name', 'hod_comment', 'dean_name', 'dean_comment',
])
const MEMO_TIME = new Set([
  'hod_approved_at', 'dean_approved_at', 'created_at', 'submitted_for_approval_at', 'sent_at',
])
const MEMO_BOOL = new Set(['confidential', 'hod_approval', 'dean_approval'])

function memoColumns(data) {
  const map = {
    subject: 'subject',
    body: 'body',
    refNumber: 'ref_number',
    date: 'memo_date',
    category: 'category',
    priority: 'priority',
    recipientMode: 'recipient_mode',
    confidential: 'confidential',
    status: 'status',
    approvalStatus: 'approval_status',
    senderUid: 'sender_id',
    senderName: 'sender_name',
    senderDepartment: 'sender_department',
    senderFaculty: 'sender_faculty',
    hodUid: 'hod_id',
    hodName: 'hod_name',
    hodApproval: 'hod_approval',
    hodComment: 'hod_comment',
    hodApprovedAt: 'hod_approved_at',
    deanUid: 'dean_id',
    deanName: 'dean_name',
    deanApproval: 'dean_approval',
    deanComment: 'dean_comment',
    deanApprovedAt: 'dean_approved_at',
    createdAt: 'created_at',
    submittedForApprovalAt: 'submitted_for_approval_at',
    sentAt: 'sent_at',
  }
  const out = {}
  for (const [key, col] of Object.entries(map)) {
    if (!has(data, key)) continue
    const value = data[key]
    if (value && value.__type === 'increment') continue
    if (MEMO_TIME.has(col)) out[col] = fromTs(value)
    else if (MEMO_BOOL.has(col)) out[col] = value == null ? null : !!value
    else if (col === 'sender_id' || col === 'hod_id' || col === 'dean_id') out[col] = value || null
    else if (MEMO_TEXT.has(col)) out[col] = textOrEmpty(value)
    else out[col] = value
  }
  return out
}

async function memoDoc(tx, row) {
  const recipients = await tx`select user_id from memo_recipients where memo_id = ${row.id}`
  const distribution = await tx`select label from memo_distribution where memo_id = ${row.id} order by position`
  return {
    subject: row.subject,
    body: row.body,
    refNumber: row.ref_number,
    date: row.memo_date,
    category: row.category,
    priority: row.priority,
    recipientMode: row.recipient_mode,
    recipientUids: recipients.map(r => r.user_id),
    recipientCount: recipients.length,
    distribution: distribution.map(d => d.label),
    confidential: row.confidential,
    status: row.status,
    approvalStatus: row.approval_status,
    senderUid: row.sender_id,
    senderName: row.sender_name,
    senderDepartment: row.sender_department,
    senderFaculty: row.sender_faculty,
    hodUid: row.hod_id,
    hodName: row.hod_name,
    hodApproval: row.hod_approval,
    hodComment: row.hod_comment,
    hodApprovedAt: ts(row.hod_approved_at),
    deanUid: row.dean_id,
    deanName: row.dean_name,
    deanApproval: row.dean_approval,
    deanComment: row.dean_comment,
    deanApprovedAt: ts(row.dean_approved_at),
    createdAt: ts(row.created_at),
    submittedForApprovalAt: ts(row.submitted_for_approval_at),
    sentAt: ts(row.sent_at),
  }
}

function inboxDoc(row) {
  return {
    memoId: row.memo_id,
    subject: row.subject,
    priority: row.priority,
    category: row.category,
    senderName: row.sender_name,
    senderUid: row.sender_id,
    date: row.memo_date,
    refNumber: row.ref_number || '',
    confidential: row.confidential,
    read: row.read,
    readAt: ts(row.read_at),
    acknowledged: row.acknowledged,
    receivedAt: ts(row.received_at),
  }
}

function alertDoc(row) {
  return {
    recipientUid: row.recipient_id,
    type: row.type,
    title: row.title,
    body: row.body,
    priority: row.priority,
    memoId: row.memo_id,
    read: row.read,
    createdAt: ts(row.created_at),
  }
}

function viewDoc(row) {
  return {
    memoId: row.memo_id,
    uid: row.user_id,
    name: row.viewer_name,
    email: row.viewer_email,
    viewedAt: ts(row.viewed_at),
  }
}

function newsDoc(row) {
  return {
    title: row.title,
    content: row.content,
    dateStr: row.date_label,
    date: ts(row.published_on || row.created_at),
  }
}

function queueDoc(row) {
  return {
    memoId: row.memo_id,
    subject: row.subject,
    priority: row.priority,
    category: row.category,
    senderName: row.sender_name,
    senderUid: row.sender_id,
    senderDepartment: row.sender_department,
    senderFaculty: row.sender_faculty,
    hodName: row.hod_name,
    stage: row.stage,
    read: row.read,
    createdAt: ts(row.created_at),
  }
}

function splitViewId(id) {
  const at = String(id).lastIndexOf('_')
  if (at <= 0) return null
  return { memoId: id.slice(0, at), userId: id.slice(at + 1) }
}

function collection(path) {
  if (path.length === 1) return { name: path[0], parent: null }
  if (path.length === 3) return { name: `${path[0]}/${path[2]}`, parent: path[1] }
  throw new Error(`Unknown collection ${path.join('/')}`)
}

async function rowsFor(tx, spec) {
  const { name, parent } = spec
  if (name === 'userProfiles' || name === 'allUsers') return tx`select * from users`
  if (name === 'memos') return tx`select * from memos`
  if (name === 'alerts') return tx`select * from alerts`
  if (name === 'companyNews') return tx`select * from company_news`
  if (name === 'memoViews') return tx`select * from memo_views`
  if (name === 'dashboardStats') return tx`select * from dashboard_stats`
  if (name === 'memoAnalytics') return tx`select * from memo_analytics`
  if (name === 'userInbox/memos') return tx`select * from inbox_items where user_id = ${parent}`
  if (name === 'approvalQueue/pending') return tx`select * from approval_queue where reviewer_id = ${parent}`
  throw new Error(`Unknown collection ${name}`)
}

function docFromRow(spec, row) {
  if (spec.name === 'userProfiles') return { id: row.id, data: profileDoc(row) }
  if (spec.name === 'allUsers') return { id: row.id, data: directoryDoc(row) }
  if (spec.name === 'alerts') return { id: row.id, data: alertDoc(row) }
  if (spec.name === 'companyNews') return { id: row.id, data: newsDoc(row) }
  if (spec.name === 'memoViews') return { id: `${row.memo_id}_${row.user_id}`, data: viewDoc(row) }
  if (spec.name === 'dashboardStats') {
    return {
      id: row.user_id,
      data: {
        totalReceived: Number(row.total_received) || 0,
        totalOpened: Number(row.total_opened) || 0,
        totalUnread: Number(row.total_unread) || 0,
        awaitingAction: Number(row.awaiting_action) || 0,
      },
    }
  }
  if (spec.name === 'memoAnalytics') {
    return {
      id: row.memo_id,
      data: {
        memoId: row.memo_id,
        viewCount: Number(row.view_count) || 0,
        lastViewed: ts(row.last_viewed),
      },
    }
  }
  if (spec.name === 'userInbox/memos') return { id: row.id, data: inboxDoc(row) }
  if (spec.name === 'approvalQueue/pending') return { id: row.memo_id, data: queueDoc(row) }
  return null
}

function compare(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const left = String(a ?? '')
  const right = String(b ?? '')
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function readField(doc, field) {
  if (field === '__name__') return doc.id
  const value = doc.data[field]
  if (value && typeof value === 'object' && typeof value.seconds === 'number') return value.seconds
  return value
}

function matches(doc, filter) {
  const value = readField(doc, filter.field)
  const expected = filter.value
  if (filter.op === '==') return value === expected
  if (filter.op === 'in') return Array.isArray(expected) && expected.includes(value)
  if (filter.op === '>=') return compare(value, expected) >= 0
  if (filter.op === '<=') return compare(value, expected) <= 0
  throw new Error(`Unsupported operator ${filter.op}`)
}

async function query(tx, path, querySpec) {
  const spec = collection(path)
  if (spec.name === 'memos') {
    const rows = await rowsFor(tx, spec)
    const docs = []
    for (const row of rows) docs.push({ id: row.id, data: await memoDoc(tx, row) })
    return finishQuery(docs, querySpec)
  }
  const rows = await rowsFor(tx, spec)
  return finishQuery(rows.map(row => docFromRow(spec, row)).filter(Boolean), querySpec)
}

function finishQuery(docs, querySpec) {
  let list = docs
  for (const filter of querySpec.filters || []) {
    if (filter.op === 'in' && (!Array.isArray(filter.value) || !filter.value.length)) return []
    list = list.filter(doc => matches(doc, filter))
  }
  const orders = querySpec.orders || []
  if (orders.length) {
    list.sort((a, b) => {
      for (const order of orders) {
        const diff = compare(readField(a, order.field), readField(b, order.field))
        if (diff) return order.dir === 'desc' ? -diff : diff
      }
      return 0
    })
  }
  if (querySpec.start != null || querySpec.end != null) {
    const field = orders[0]?.field
    if (field) {
      list = list.filter(doc => {
        const value = readField(doc, field)
        if (querySpec.start != null && compare(value, querySpec.start) < 0) return false
        if (querySpec.end != null && compare(value, querySpec.end) > 0) return false
        return true
      })
    }
  }
  if (querySpec.limit) list = list.slice(0, querySpec.limit)
  return list
}

async function getCounter(tx) {
  const rows = await tx`select year, seq, updated_at from memo_ref_counters order by year desc limit 1`
  if (!rows.length) return { id: 'memoRef', exists: false, data: null }
  const row = rows[0]
  return { id: 'memoRef', exists: true, data: { year: row.year, seq: row.seq, updatedAt: ts(row.updated_at) } }
}

async function getDoc(tx, path) {
  if (path[0] === '_counters' && path[1] === 'memoRef') return getCounter(tx)
  if (path.length === 2) {
    const [name, id] = path
    if (name === 'userProfiles' || name === 'allUsers') {
      const [row] = await tx`select * from users where id = ${id}`
      if (!row) return { id, exists: false, data: null }
      return { id, exists: true, data: name === 'allUsers' ? directoryDoc(row) : profileDoc(row) }
    }
    if (name === 'memos') {
      const [row] = await tx`select * from memos where id = ${id}`
      if (!row) return { id, exists: false, data: null }
      return { id, exists: true, data: await memoDoc(tx, row) }
    }
    if (name === 'alerts') {
      const [row] = await tx`select * from alerts where id = ${id}`
      if (!row) return { id, exists: false, data: null }
      return { id, exists: true, data: alertDoc(row) }
    }
    if (name === 'companyNews') {
      const [row] = await tx`select * from company_news where id = ${id}`
      if (!row) return { id, exists: false, data: null }
      return { id, exists: true, data: newsDoc(row) }
    }
    if (name === 'memoViews') {
      const parts = splitViewId(id)
      if (!parts) return { id, exists: false, data: null }
      const [row] = await tx`select * from memo_views where memo_id = ${parts.memoId} and user_id = ${parts.userId}`
      if (!row) return { id, exists: false, data: null }
      return { id, exists: true, data: viewDoc(row) }
    }
    if (name === 'dashboardStats') {
      const [row] = await tx`select * from dashboard_stats where user_id = ${id}`
      if (!row) return { id, exists: false, data: null }
      return { id, exists: true, data: docFromRow({ name }, row).data }
    }
    if (name === 'memoAnalytics') {
      const [row] = await tx`select * from memo_analytics where memo_id = ${id}`
      if (!row) return { id, exists: false, data: null }
      return { id, exists: true, data: docFromRow({ name }, row).data }
    }
  }
  if (path.length === 4 && path[0] === 'userInbox' && path[2] === 'memos') {
    const [row] = await tx`select * from inbox_items where user_id = ${path[1]} and id = ${path[3]}`
    if (!row) return { id: path[3], exists: false, data: null }
    return { id: row.id, exists: true, data: inboxDoc(row) }
  }
  if (path.length === 4 && path[0] === 'approvalQueue' && path[2] === 'pending') {
    const [row] = await tx`select * from approval_queue where reviewer_id = ${path[1]} and memo_id = ${path[3]}`
    if (!row) return { id: path[3], exists: false, data: null }
    return { id: row.memo_id, exists: true, data: queueDoc(row) }
  }
  throw new Error(`Unknown document ${path.join('/')}`)
}

async function assertRolePlacement(tx, id, accountType, faculty, department) {
  const type = String(accountType || 'staff').toLowerCase()
  if (type === 'vc') {
    const [other] = await tx`select full_name from users where account_type = 'vc' and id <> ${id} limit 1`
    if (other) {
      const error = new Error('The university already has a Vice Chancellor. Only one VC is allowed.')
      error.status = 400
      throw error
    }
    return
  }
  if (type === 'dean') {
    if (!faculty) {
      const error = new Error('A Dean must belong to a faculty.')
      error.status = 400
      throw error
    }
    const [other] = await tx`
      select full_name from users
      where account_type = 'dean' and lower(faculty) = lower(${faculty}) and id <> ${id}
      limit 1
    `
    if (other) {
      const error = new Error(`This faculty already has a Dean (${other.full_name || 'another user'}). Only one Dean is allowed in each faculty.`)
      error.status = 400
      throw error
    }
    return
  }
  if (type === 'hod') {
    if (!faculty || !department) {
      const error = new Error('A Head of Department must belong to a faculty and a department.')
      error.status = 400
      throw error
    }
    const [other] = await tx`
      select full_name from users
      where account_type = 'hod'
        and lower(faculty) = lower(${faculty})
        and lower(department) = lower(${department})
        and id <> ${id}
      limit 1
    `
    if (other) {
      const error = new Error(`This department already has a Head of Department (${other.full_name || 'another user'}). Only one HOD is allowed in each department.`)
      error.status = 400
      throw error
    }
  }
}

async function saveUser(tx, id, data) {
  const cols = userColumns(data)
  const [existing] = await tx`select * from users where id = ${id}`
  const accountType = String(cols.account_type || existing?.account_type || 'staff').toLowerCase()
  const faculty = has(data, 'faculty') ? textOrEmpty(data.faculty) : (existing?.faculty || '')
  const department = has(data, 'department') ? textOrEmpty(data.department) : (existing?.department || '')
  if (accountType === 'vc') {
    cols.faculty = ''
    cols.department = ''
  }
  await assertRolePlacement(tx, id, accountType, accountType === 'vc' ? '' : faculty, accountType === 'vc' ? '' : department)
  if (!existing) {
    if (!cols.email) throw new Error('email is required')
    cols.id = id
    if (!cols.account_type) cols.account_type = 'staff'
    if (!cols.updated_at) cols.updated_at = new Date()
    await insert(tx, 'users', cols)
    return
  }
  if (!cols.updated_at) cols.updated_at = new Date()
  await patch(tx, 'users', 'id', id, cols)
}

async function replaceRecipients(tx, id, uids) {
  await tx`delete from memo_recipients where memo_id = ${id}`
  for (const userId of [...new Set(uids || [])]) {
    if (!userId) continue
    await tx`insert into memo_recipients (memo_id, user_id) values (${id}, ${userId}) on conflict do nothing`
  }
}

async function replaceDistribution(tx, id, lines) {
  await tx`delete from memo_distribution where memo_id = ${id}`
  for (let i = 0; i < (lines || []).length; i++) {
    await tx`insert into memo_distribution (memo_id, position, label) values (${id}, ${i}, ${String(lines[i])})`
  }
}

async function saveMemo(tx, id, data) {
  const cols = memoColumns(data)
  const [existing] = await tx`select id from memos where id = ${id}`
  if (!existing) {
    if (!cols.sender_id) throw new Error('senderUid is required')
    cols.id = id
    if (!cols.created_at) cols.created_at = new Date()
    await insert(tx, 'memos', cols)
  } else if (Object.keys(cols).length) {
    await patch(tx, 'memos', 'id', id, cols)
  }
  if (has(data, 'recipientUids')) await replaceRecipients(tx, id, data.recipientUids)
  if (has(data, 'distribution')) await replaceDistribution(tx, id, data.distribution)
}

async function saveInbox(tx, userId, id, data) {
  const memoId = data.memoId || id
  const row = {
    id,
    user_id: userId,
    memo_id: memoId,
    subject: textOrEmpty(data.subject),
    priority: textOrEmpty(data.priority || 'normal'),
    category: textOrEmpty(data.category || 'general'),
    sender_name: textOrEmpty(data.senderName),
    sender_id: data.senderUid || null,
    memo_date: textOrEmpty(data.date),
    confidential: !!data.confidential,
    read: !!data.read,
    read_at: fromTs(data.readAt),
    acknowledged: !!data.acknowledged,
    received_at: fromTs(data.receivedAt) || new Date(),
  }
  if (has(data, 'refNumber')) row.ref_number = textOrEmpty(data.refNumber)
  const [byPair] = await tx`select id from inbox_items where user_id = ${userId} and memo_id = ${memoId}`
  const [byId] = byPair ? [byPair] : await tx`select id from inbox_items where id = ${id}`
  if (!byId) await insert(tx, 'inbox_items', row)
  else {
    row.id = byId.id
    await patch(tx, 'inbox_items', 'id', byId.id, row)
  }
}

async function saveQueue(tx, reviewerId, memoId, data) {
  const row = {
    reviewer_id: reviewerId,
    memo_id: data.memoId || memoId,
    subject: textOrEmpty(data.subject),
    priority: textOrEmpty(data.priority || 'normal'),
    category: textOrEmpty(data.category || 'general'),
    sender_name: textOrEmpty(data.senderName),
    sender_id: data.senderUid || null,
    sender_department: textOrEmpty(data.senderDepartment),
    sender_faculty: textOrEmpty(data.senderFaculty),
    hod_name: textOrEmpty(data.hodName),
    stage: data.stage,
    read: !!data.read,
    created_at: fromTs(data.createdAt) || new Date(),
  }
  const [existing] = await tx`select memo_id from approval_queue where reviewer_id = ${reviewerId} and memo_id = ${row.memo_id}`
  if (!existing) await insert(tx, 'approval_queue', row)
  else {
    const { reviewer_id, memo_id, ...rest } = row
    if (Object.keys(rest).length) {
      await tx`update approval_queue set ${tx(rest)} where reviewer_id = ${reviewerId} and memo_id = ${row.memo_id}`
    }
  }
}

async function saveAlert(tx, id, data) {
  const row = {
    id,
    recipient_id: data.recipientUid,
    type: textOrEmpty(data.type),
    title: textOrEmpty(data.title),
    body: textOrEmpty(data.body),
    priority: textOrEmpty(data.priority || 'normal'),
    memo_id: data.memoId || null,
    read: !!data.read,
    created_at: fromTs(data.createdAt) || new Date(),
  }
  if (!row.recipient_id) throw new Error('recipientUid is required')
  const [existing] = await tx`select id from alerts where id = ${id}`
  if (!existing) await insert(tx, 'alerts', row)
  else await patch(tx, 'alerts', 'id', id, row)
}

async function saveView(tx, id, data) {
  const parts = splitViewId(id)
  const memoId = data.memoId || parts?.memoId
  const userId = data.uid || parts?.userId
  if (!memoId || !userId) throw new Error('memo view id is invalid')
  await tx`
    insert into memo_views (memo_id, user_id, viewer_name, viewer_email, viewed_at)
    values (${memoId}, ${userId}, ${textOrEmpty(data.name)}, ${textOrEmpty(data.email)}, ${fromTs(data.viewedAt) || new Date()})
    on conflict (memo_id, user_id) do nothing
  `
}

async function setDoc(tx, path, data) {
  if (path[0] === 'dashboardStats' || path[0] === 'memoAnalytics') return
  if (path[0] === '_counters' && path[1] === 'memoRef') {
    const year = Number(data.year)
    const seq = Number(data.seq) || 0
    await tx`
      insert into memo_ref_counters (year, seq, updated_at)
      values (${year}, ${seq}, now())
      on conflict (year) do update set seq = excluded.seq, updated_at = now()
    `
    return
  }
  if (path.length === 2) {
    const [name, id] = path
    if (name === 'userProfiles' || name === 'allUsers') return saveUser(tx, id, data || {})
    if (name === 'memos') return saveMemo(tx, id, data || {})
    if (name === 'alerts') return saveAlert(tx, id, data || {})
    if (name === 'memoViews') return saveView(tx, id, data || {})
    if (name === 'companyNews') {
      const row = {
        id,
        title: textOrEmpty(data.title),
        content: textOrEmpty(data.content),
        date_label: textOrEmpty(data.dateStr),
        published_on: fromTs(data.date),
      }
      const [existing] = await tx`select id from company_news where id = ${id}`
      if (!existing) await insert(tx, 'company_news', row)
      else await patch(tx, 'company_news', 'id', id, row)
      return
    }
  }
  if (path.length === 4 && path[0] === 'userInbox' && path[2] === 'memos') return saveInbox(tx, path[1], path[3], data || {})
  if (path.length === 4 && path[0] === 'approvalQueue' && path[2] === 'pending') return saveQueue(tx, path[1], path[3], data || {})
  throw new Error(`Cannot write ${path.join('/')}`)
}

async function updateDoc(tx, path, data) {
  if (path[0] === 'dashboardStats' || path[0] === 'memoAnalytics') return
  const current = await getDoc(tx, path)
  if (!current.exists) {
    const error = new Error('No document to update')
    error.code = 'not-found'
    throw error
  }
  if (path.length === 4 && path[0] === 'userInbox') {
    const cols = {}
    if (has(data, 'read')) cols.read = !!data.read
    if (has(data, 'readAt')) cols.read_at = fromTs(data.readAt)
    if (has(data, 'acknowledged')) cols.acknowledged = !!data.acknowledged
    await patch(tx, 'inbox_items', 'id', path[3], cols)
    return
  }
  if (path.length === 4 && path[0] === 'approvalQueue') {
    const cols = {}
    if (has(data, 'read')) cols.read = !!data.read
    if (Object.keys(cols).length) {
      await tx`update approval_queue set ${tx(cols)} where reviewer_id = ${path[1]} and memo_id = ${path[3]}`
    }
    return
  }
  if (path[0] === 'alerts') {
    const cols = {}
    if (has(data, 'read')) cols.read = !!data.read
    await patch(tx, 'alerts', 'id', path[1], cols)
    return
  }
  if (path[0] === 'memos') return saveMemo(tx, path[1], data || {})
  if (path[0] === 'userProfiles' || path[0] === 'allUsers') return saveUser(tx, path[1], data || {})
  return setDoc(tx, path, { ...current.data, ...data })
}

async function deleteUser(tx, id) {
  const [row] = await tx`select id from users where id = ${id}`
  if (!row) return
  await tx`update users set created_by = null where created_by = ${id}`
  await tx`update inbox_items set sender_id = null where sender_id = ${id}`
  await tx`update approval_queue set sender_id = null where sender_id = ${id}`
  await tx`update memos set hod_id = null where hod_id = ${id}`
  await tx`update memos set dean_id = null where dean_id = ${id}`
  await tx`delete from memos where sender_id = ${id}`
  await tx`delete from users where id = ${id}`
}

async function deleteDoc(tx, path) {
  if (path[0] === 'dashboardStats' || path[0] === 'memoAnalytics') return
  if (path.length === 2 && (path[0] === 'userProfiles' || path[0] === 'allUsers')) return deleteUser(tx, path[1])
  if (path.length === 2 && path[0] === 'memos') {
    await tx`delete from memos where id = ${path[1]}`
    return
  }
  if (path.length === 2 && path[0] === 'alerts') {
    await tx`delete from alerts where id = ${path[1]}`
    return
  }
  if (path.length === 4 && path[0] === 'userInbox') {
    await tx`delete from inbox_items where user_id = ${path[1]} and id = ${path[3]}`
    return
  }
  if (path.length === 4 && path[0] === 'approvalQueue') {
    await tx`delete from approval_queue where reviewer_id = ${path[1]} and memo_id = ${path[3]}`
    return
  }
}

async function apply(tx, op) {
  if (op.op === 'get') return getDoc(tx, op.path)
  if (op.op === 'query') return query(tx, op.path, op.query || {})
  if (op.op === 'set') return setDoc(tx, op.path, op.data || {})
  if (op.op === 'update') return updateDoc(tx, op.path, op.data || {})
  if (op.op === 'delete') return deleteDoc(tx, op.path)
  if (op.op === 'add') {
    const id = randomUUID()
    await setDoc(tx, op.path.concat(id), op.data || {})
    return { id }
  }
  throw new Error(`Unknown op ${op.op}`)
}

export async function run(op) {
  const sql = getSql()
  return sql.begin(tx => apply(tx, op))
}

export async function runBatch(ops) {
  const sql = getSql()
  await sql.begin(async tx => {
    for (const op of ops) await apply(tx, op)
  })
}

function publicUser(row) {
  return {
    uid: row.id,
    email: row.email,
    displayName: row.full_name || row.email,
    accountType: row.account_type,
    role: row.role,
  }
}

export async function login(email, password) {
  const sql = getSql()
  const [user] = await sql`select * from users where lower(email) = lower(${email})`
  if (!user || !user.active) {
    const error = new Error('No account found with this email.')
    error.code = 'auth/user-not-found'
    throw error
  }
  const ok = await verifyPassword(password, user.password_hash)
  if (!ok) {
    const error = new Error('Incorrect password. Please try again.')
    error.code = 'auth/wrong-password'
    throw error
  }
  const token = randomBytes(32).toString('hex')
  await sql`insert into sessions (token, user_id) values (${token}, ${user.id})`
  return { token, user: publicUser(user) }
}

export async function logout(token) {
  if (!token) return
  await getSql()`delete from sessions where token = ${token}`
}

export async function userForToken(token) {
  if (!token) return null
  const [user] = await getSql()`
    select u.* from sessions s join users u on u.id = s.user_id where s.token = ${token}
  `
  return user ? publicUser(user) : null
}

export async function changePassword(token, current, next) {
  const sql = getSql()
  const [user] = await sql`select u.* from sessions s join users u on u.id = s.user_id where s.token = ${token}`
  if (!user) {
    const error = new Error('Not signed in')
    error.code = 'auth/unauthenticated'
    throw error
  }
  const ok = await verifyPassword(current, user.password_hash)
  if (!ok) {
    const error = new Error('The password is invalid or the user does not have a password.')
    error.code = 'auth/wrong-password'
    throw error
  }
  if (!next || next.length < 6) {
    const error = new Error('Min 6 characters required.')
    error.code = 'auth/weak-password'
    throw error
  }
  const passwordHash = await hashPassword(next)
  await sql`update users set password_hash = ${passwordHash}, updated_at = now() where id = ${user.id}`
}

export async function createUser({ email, password, displayName }) {
  const sql = getSql()
  const clean = String(email || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    const error = new Error('The email address is not valid.')
    error.code = 'auth/invalid-email'
    throw error
  }
  if (!password || password.length < 6) {
    const error = new Error('Password must be at least 6 characters.')
    error.code = 'auth/weak-password'
    throw error
  }
  const [existing] = await sql`select id from users where lower(email) = lower(${clean})`
  if (existing) {
    const error = new Error('This email address is already registered.')
    error.code = 'auth/email-already-in-use'
    throw error
  }
  const id = randomUUID()
  const passwordHash = await hashPassword(password)
  await sql`
    insert into users (id, full_name, email, password_hash, account_type, role, active)
    values (${id}, ${textOrEmpty(displayName)}, ${clean}, ${passwordHash}, 'staff', 'staff', true)
  `
  return { uid: id }
}

let ready
export function prepare() {
  if (!ready) {
    ready = seed().catch(error => {
      ready = null
      throw error
    })
  }
  return ready
}

async function seed() {
  const sql = getSql()
  await sql`alter table inbox_items add column if not exists ref_number text not null default ''`
  await sql`
    update inbox_items i
    set ref_number = m.ref_number
    from memos m
    where m.id = i.memo_id and i.ref_number = ''
  `
  const [{ count }] = await sql`select count(*)::int as count from users`
  if (count > 0) return
  const passwordHash = await hashPassword(SEED_PASSWORD)
  await sql`
    insert into users (id, full_name, email, role, account_type, password_hash, active)
    values (${randomUUID()}, 'Administrator', ${SEED_EMAIL}, 'Administrator', 'admin', ${passwordHash}, true)
  `
}

export const seedAccount = { email: SEED_EMAIL, password: SEED_PASSWORD }
