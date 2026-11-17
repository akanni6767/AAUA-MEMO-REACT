import nodemailer from 'nodemailer'
import { getSql } from '../db/index.js'

let transport

function mailer() {
  if (!process.env.SMTP_HOST) return null
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
        : undefined,
    })
  }
  return transport
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function excerpt(body) {
  const text = String(body || '').replace(/\s+/g, ' ').trim()
  return text.length > 400 ? text.slice(0, 400) + '…' : text
}

async function people(sql, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))]
  if (!unique.length) return []
  return sql`
    select id, email, full_name, notify_email, notify_new_memo, notify_action_required
    from users
    where id in ${sql(unique)} and active = true and email <> ''
  `
}

function allow(person, kind) {
  if (!person || person.notify_email === false) return false
  if (kind === 'memo') return person.notify_new_memo !== false
  if (kind === 'action') return person.notify_action_required !== false
  return true
}

async function deliver(messages) {
  const client = mailer()
  if (!client) return { sent: 0, skipped: true }
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'AAUA MEMO <noreply@aaua.edu.ng>'
  let sent = 0
  for (const message of messages) {
    if (!message.to) continue
    try {
      await client.sendMail({ from, to: message.to, subject: message.subject, text: message.text, html: message.html })
      sent += 1
    } catch (error) {
      console.error('Mail failed:', error.message)
    }
  }
  return { sent, skipped: false }
}

function memoMessage(to, subject, lines, memo) {
  const text = lines.join('\n')
  const html = `<div style="font-family:Georgia,serif;color:#0f172b;line-height:1.5">
    <p style="margin:0 0 12px">${lines.map(escapeHtml).join('<br>')}</p>
    <p style="margin:0"><strong>${escapeHtml(memo.subject)}</strong><br>
    Reference: ${escapeHtml(memo.ref_number || '—')}<br>
    From: ${escapeHtml(memo.sender_name || '')}</p>
    <p style="margin:12px 0 0;color:#334155">${escapeHtml(excerpt(memo.body))}</p>
  </div>`
  return { to, subject, text: text + '\n\n' + (memo.subject || '') + '\nReference: ' + (memo.ref_number || '—'), html }
}

export async function notifyMemo({ event, memoId, comment }) {
  const sql = getSql()
  const [memo] = await sql`select * from memos where id = ${memoId}`
  if (!memo) return { sent: 0, skipped: true }
  const recipientRows = await sql`select user_id from memo_recipients where memo_id = ${memoId}`
  const ids = recipientRows.map(row => row.user_id)
  ids.push(memo.sender_id, memo.hod_id, memo.dean_id)
  const rows = await people(sql, ids)
  const byId = new Map(rows.map(row => [row.id, row]))
  const sender = byId.get(memo.sender_id)
  const messages = []
  const note = comment ? ` Comment: ${comment}` : ''

  if (event === 'sent' || (event === 'approved' && memo.status === 'sent')) {
    for (const row of rows) {
      if (row.id === memo.sender_id || !ids.includes(row.id) || !recipientRows.some(item => item.user_id === row.id)) continue
      if (!allow(row, 'memo')) continue
      messages.push(memoMessage(
        row.email,
        `New memo ${memo.ref_number || ''}`.trim(),
        [`Hello ${row.full_name || 'colleague'},`, 'A memo has been sent to you on AAUA MEMO.'],
        memo
      ))
    }
  }

  if (event === 'submitted') {
    const reviewerId = memo.approval_status === 'pending_hod' ? memo.hod_id : memo.dean_id
    const reviewer = byId.get(reviewerId)
    if (allow(reviewer, 'action')) {
      messages.push(memoMessage(
        reviewer.email,
        `Memo awaiting your approval ${memo.ref_number || ''}`.trim(),
        [`Hello ${reviewer.full_name || 'colleague'},`, `${memo.sender_name || 'A staff member'} submitted a memo for your approval.`],
        memo
      ))
    }
  }

  if (event === 'approved' && sender && allow(sender, 'action')) {
    const delivered = memo.status === 'sent'
    messages.push(memoMessage(
      sender.email,
      delivered ? `Memo approved ${memo.ref_number || ''}`.trim() : `Memo moved forward ${memo.ref_number || ''}`.trim(),
      [delivered
        ? 'Your memo was approved and delivered to the recipients.'
        : 'Your memo was approved and sent to the next reviewer.'],
      memo
    ))
  }

  if (event === 'approved' && memo.approval_status === 'pending_dean') {
    const dean = byId.get(memo.dean_id)
    if (allow(dean, 'action')) {
      messages.push(memoMessage(
        dean.email,
        `Memo awaiting your approval ${memo.ref_number || ''}`.trim(),
        [`Hello ${dean.full_name || 'Dean'},`, 'A memo approved by the HOD is waiting for your review.'],
        memo
      ))
    }
  }

  if (event === 'rejected' && sender && allow(sender, 'action')) {
    messages.push(memoMessage(
      sender.email,
      `Memo rejected ${memo.ref_number || ''}`.trim(),
      [`Your memo was rejected.${note}`],
      memo
    ))
  }

  return deliver(messages)
}
