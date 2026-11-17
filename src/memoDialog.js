import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import previewHtml from './components/preview.html?raw'

/**
 * One memo preview for every portal page.
 * Inbox and outbox call MemoDialog.open / MemoDialog.openInbox.
 * The sheet markup and styles live in src/components/preview.html.
 */

const RECIPIENT_LABELS = {
  all: 'All Users',
  faculty: 'By Faculty',
  department: 'By Department',
  type: 'By Account Type',
  manual: 'Selected recipients',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

let dialogEl = null
let sheetEl = null
let downloadBtn = null
let extraBtn = null
let current = null
let openToken = 0
let sheetCss = ''
let sheetMarkup = ''

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function ordinal(day) {
  const mod100 = day % 100
  if (mod100 >= 11 && mod100 <= 13) return `${day}<sup>th</sup>`
  switch (day % 10) {
    case 1: return `${day}<sup>st</sup>`
    case 2: return `${day}<sup>nd</sup>`
    case 3: return `${day}<sup>rd</sup>`
    default: return `${day}<sup>th</sup>`
  }
}

function parseDate(value) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'object' && typeof value.seconds === 'number') return new Date(value.seconds * 1000)
  if (typeof value === 'string') {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  }
  return null
}

function formatMemoDate(value) {
  const date = parseDate(value)
  if (!date) return escapeHtml(value || '—')
  return `${ordinal(date.getDate())} ${MONTHS[date.getMonth()]}, ${date.getFullYear()}`
}

function facultyLine(memo) {
  const name = memo.faculty || memo.senderFaculty || memo.facultyName || ''
  return String(name).trim()
}

function fromLine(memo) {
  if (memo.from) return String(memo.from)
  const role = String(memo.senderRole || memo.senderOffice || '').trim()
  if (role && !/staff member/i.test(role)) return role
  return memo.senderName || role || '—'
}

function toLine(memo) {
  if (memo.to) return String(memo.to)
  if (Array.isArray(memo.recipientNames) && memo.recipientNames.length) {
    return memo.recipientNames.join(', ')
  }
  const mode = RECIPIENT_LABELS[memo.recipientMode]
  const count = Number(memo.recipientCount) || 0
  if (mode && count) return `${mode} (${count})`
  if (mode) return mode
  if (count) return `${count} recipient${count === 1 ? '' : 's'}`
  return '—'
}

function distributionLines(memo) {
  if (Array.isArray(memo.distribution) && memo.distribution.length) {
    return memo.distribution.map(item => String(item)).filter(Boolean)
  }
  return ['—']
}

function recipientLabel(user) {
  const role = String(user.role || user.office || '').trim()
  if (role && !/^(staff|hod|dean|vc|staff member)$/i.test(role)) return role
  const type = String(user.accountType || 'staff').toLowerCase()
  const faculty = String(user.faculty || '').replace(/^faculty of\s+/i, '').trim()
  const department = String(user.department || '').trim()
  if (type === 'vc') return 'Vice Chancellor'
  if (type === 'dean') return faculty ? `Dean (${faculty})` : 'Dean'
  if (type === 'hod') {
    const unit = department || faculty
    return unit ? `HOD (${unit})` : 'HOD'
  }
  return user.fullName || user.email || 'Staff'
}

function recipientRank(user) {
  const role = String(user.role || '').toLowerCase()
  if (role.includes('vice chancellor') && !role.includes('deputy')) return 0
  if (role.includes('deputy vice')) return 1
  const type = String(user.accountType || 'staff').toLowerCase()
  if (type === 'vc') return 0
  if (type === 'dean' || role.includes('dean')) return 2
  if (type === 'hod') return 3
  return 4
}

function linesFromUsers(users) {
  const sorted = [...users].sort((a, b) => {
    const byRank = recipientRank(a) - recipientRank(b)
    if (byRank) return byRank
    const left = String(a.fullName || a.email || recipientLabel(a))
    const right = String(b.fullName || b.email || recipientLabel(b))
    return left.localeCompare(right)
  })
  return sorted.map(user => {
    const name = String(user.fullName || user.email || '').trim()
    const title = recipientLabel(user)
    if (name && title && name.toLowerCase() !== title.toLowerCase()) return `${name} — ${title}`
    return name || title || 'Staff'
  }).filter(Boolean)
}

async function allUserRecords() {
  if (!window.db) return []
  const snap = await window.db.collection('allUsers').get()
  const users = []
  snap.forEach(doc => users.push({ uid: doc.id, ...doc.data() }))
  return users
}

async function distributionFor(uids) {
  const ids = [...new Set((uids || []).filter(Boolean))]
  if (!ids.length) return []
  const users = await allUserRecords()
  const wanted = new Set(ids)
  return linesFromUsers(users.filter(user => wanted.has(user.uid || user.id)))
}

async function withDistribution(memo) {
  const enriched = await enrichFaculty(memo)
  const users = await allUserRecords()
  if (memo.recipientMode === 'all' && users.length) {
    return { ...enriched, distribution: linesFromUsers(users) }
  }
  const ids = [...new Set((memo.recipientUids || []).filter(Boolean))]
  if (ids.length && users.length) {
    const wanted = new Set(ids)
    const selected = users.filter(user => wanted.has(user.uid || user.id))
    if (selected.length) return { ...enriched, distribution: linesFromUsers(selected) }
  }
  if (Array.isArray(memo.distribution) && memo.distribution.length) {
    return { ...enriched, distribution: memo.distribution.map(item => String(item)) }
  }
  return { ...enriched, distribution: await distributionFor(ids) }
}

function bodyHtml(memo) {
  const text = String(memo.body || '').trim()
  if (!text) return '(No content)'
  return escapeHtml(text).replace(/\n/g, '<br>')
}

function readTemplate() {
  if (sheetMarkup) return
  const doc = new DOMParser().parseFromString(previewHtml, 'text/html')
  sheetCss = doc.querySelector('style')?.textContent || ''
  const page = doc.querySelector('.pdf-page')
  sheetMarkup = page ? page.outerHTML : ''
}

function scopeSheetCss(css) {
  const cleaned = css
    .replace(/@page\s*\{[^}]*\}/g, '')
    .replace(/(?:html\s*,\s*body|html|body)\s*\{[^}]*\}/g, '')
  return cleaned.replace(/(^|})\s*([^@{}][^{]*)\{/g, (_, prefix, selectors) => {
    const scoped = selectors.split(',').map(selector => {
      const trimmed = selector.trim()
      return trimmed ? `#aaua-memo-sheet ${trimmed}` : ''
    }).filter(Boolean).join(', ')
    return `${prefix} ${scoped} {`
  })
}

function toast(message, isError) {
  if (typeof window.showToast === 'function') {
    window.showToast(message, !!isError)
    return
  }
  if (isError) window.alert(message)
}

function ensureMounted() {
  if (dialogEl) return
  readTemplate()

  document.querySelectorAll('style[data-memo-dialog]').forEach(node => node.remove())
  document.getElementById('aaua-memo-dialog')?.remove()

  const style = document.createElement('style')
  style.setAttribute('data-memo-dialog', '1')
  style.textContent = DIALOG_CSS + '\n' + scopeSheetCss(sheetCss)
  document.head.appendChild(style)

  dialogEl = document.createElement('div')
  dialogEl.id = 'aaua-memo-dialog'
  dialogEl.hidden = true
  dialogEl.innerHTML = `
    <div class="aaua-memo-dialog__backdrop" data-memo-close></div>
    <div class="aaua-memo-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="aaua-memo-dialog-title">
      <header class="aaua-memo-dialog__header">
        <span class="aaua-memo-dialog__title">
          <i class="fas fa-file-lines" aria-hidden="true"></i>
          <span id="aaua-memo-dialog-title">Memo</span>
        </span>
        <button type="button" class="aaua-memo-dialog__x" data-memo-close aria-label="Close">
          <i class="fas fa-xmark" aria-hidden="true"></i>
        </button>
      </header>
      <div class="aaua-memo-dialog__body">
        <div id="aaua-memo-sheet"></div>
      </div>
      <footer class="aaua-memo-dialog__footer">
        <button type="button" class="aaua-memo-dialog__extra" id="aaua-memo-extra" hidden></button>
        <div class="aaua-memo-dialog__actions">
          <button type="button" class="aaua-memo-dialog__close" data-memo-close>
            <i class="fas fa-xmark" aria-hidden="true"></i> Close
          </button>
          <button type="button" class="aaua-memo-dialog__download" id="aaua-memo-download">
            <i class="fas fa-download" aria-hidden="true"></i> Download Memo
          </button>
        </div>
      </footer>
    </div>
  `
  document.body.appendChild(dialogEl)
  sheetEl = dialogEl.querySelector('#aaua-memo-sheet')
  downloadBtn = dialogEl.querySelector('#aaua-memo-download')
  extraBtn = dialogEl.querySelector('#aaua-memo-extra')

  dialogEl.addEventListener('click', event => {
    if (event.target.closest('[data-memo-close]')) close()
  })
  downloadBtn.addEventListener('click', () => downloadCurrent())
  extraBtn.addEventListener('click', () => runExtraAction())
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && dialogEl && !dialogEl.hidden) close()
  })
}

function show() {
  ensureMounted()
  const scrollbar = window.innerWidth - document.documentElement.clientWidth
  document.documentElement.classList.add('aaua-memo-open')
  document.body.style.paddingRight = scrollbar > 0 ? `${scrollbar}px` : ''
  dialogEl.hidden = false
}

function close() {
  if (!dialogEl) return
  dialogEl.hidden = true
  document.documentElement.classList.remove('aaua-memo-open')
  document.body.style.paddingRight = ''
  openToken += 1
}

function setLoading(message) {
  show()
  extraBtn.hidden = true
  sheetEl.innerHTML = `<div class="aaua-memo-dialog__status">${escapeHtml(message)}</div>`
}

function setError(message) {
  show()
  extraBtn.hidden = true
  sheetEl.innerHTML = `<div class="aaua-memo-dialog__status is-error">${escapeHtml(message)}</div>`
}

function applyMemo(root, memo) {
  const faculty = facultyLine(memo)
  const facultyEl = root.querySelector('#faculty-name')
  if (facultyEl) {
    if (faculty) {
      facultyEl.textContent = faculty.toUpperCase()
    } else {
      const lineBreak = facultyEl.previousSibling
      if (lineBreak && lineBreak.nodeName === 'BR') lineBreak.remove()
      facultyEl.remove()
    }
  }

  const fromEl = root.querySelector('#memo-from')
  const toEl = root.querySelector('#memo-to')
  const refEl = root.querySelector('#memo-ref')
  const dateEl = root.querySelector('#memo-date')
  const titleEl = root.querySelector('#memo-title')
  const bodyEl = root.querySelector('#memo-body')
  const confidentialEl = root.querySelector('#memo-confidential')
  const listEl = root.querySelector('#memo-distribution-list')

  if (fromEl) fromEl.textContent = fromLine(memo)
  if (toEl) toEl.textContent = toLine(memo)
  if (refEl) refEl.textContent = memo.refNumber || memo.ref || '—'
  if (dateEl) dateEl.innerHTML = formatMemoDate(memo.date || memo.createdAt || memo.receivedAt)
  if (titleEl) titleEl.textContent = memo.subject || '(No Subject)'
  if (bodyEl) bodyEl.innerHTML = bodyHtml(memo)
  if (confidentialEl) confidentialEl.classList.toggle('is-visible', !!memo.confidential)

  const lines = distributionLines(memo)
  if (listEl && lines) {
    listEl.innerHTML = lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')
  }
}

function flowBlocks(source) {
  const blocks = []
  for (const child of [...source.children]) {
    if (child.classList.contains('memo-body')) {
      for (const part of [...child.children]) {
        if (part.id === 'memo-confidential' && !part.classList.contains('is-visible')) continue
        if (part.id === 'memo-body') {
          part.innerHTML.split(/<br\s*\/?>/i).forEach(chunk => {
            const text = chunk.replace(/&nbsp;/g, ' ').trim()
            if (!text) return
            const paragraph = source.ownerDocument.createElement('p')
            paragraph.className = 'memo-paragraph'
            paragraph.innerHTML = chunk
            blocks.push(paragraph)
          })
        } else {
          blocks.push(part)
        }
      }
    } else if (child.id === 'memo-distribution') {
      const label = source.ownerDocument.createElement('div')
      label.className = 'dist-label'
      label.textContent = 'Distribution'
      blocks.push(label)
      child.querySelectorAll('li').forEach(item => {
        const row = source.ownerDocument.createElement('div')
        row.className = 'dist-item'
        row.textContent = item.textContent
        blocks.push(row)
      })
    } else {
      blocks.push(child)
    }
  }
  return blocks
}

function makeSheet(doc) {
  const sheet = doc.createElement('div')
  sheet.className = 'pdf-page'
  sheet.style.cssText = 'height:297mm;min-height:297mm;max-height:297mm;overflow:hidden;margin:0;flex-shrink:0;'
  return sheet
}

function sheetOverflows(page) {
  return page.scrollHeight > page.clientHeight
}

function paginateSheet(container) {
  const source = container.querySelector('.pdf-page')
  if (!source) return
  const doc = source.ownerDocument
  const blocks = flowBlocks(source)
  const pages = []
  let page = makeSheet(doc)
  container.replaceChildren(page)

  function newPage() {
    if (page.childNodes.length) pages.push(page)
    page = makeSheet(doc)
    container.appendChild(page)
  }

  function gapBefore(block) {
    if (!page.childNodes.length) return '0'
    if (block.classList?.contains('dist-label')) return '28px'
    if (block.classList?.contains('dist-item')) return '2px'
    return '12px'
  }

  function splitWords(node) {
    const words = node.textContent.split(/\s+/).filter(Boolean)
    if (!words.length) return
    let start = 0
    while (start < words.length) {
      const probe = node.cloneNode(false)
      probe.style.marginTop = gapBefore(probe)
      page.appendChild(probe)
      let low = start + 1
      let high = words.length
      let best = start
      while (low <= high) {
        const mid = Math.floor((low + high) / 2)
        probe.textContent = words.slice(start, mid).join(' ')
        if (!sheetOverflows(page)) {
          best = mid
          low = mid + 1
        } else {
          high = mid - 1
        }
      }
      if (best === start) best = Math.min(words.length, start + 1)
      probe.textContent = words.slice(start, best).join(' ')
      start = best
      if (start < words.length) newPage()
    }
  }

  blocks.forEach(block => {
    block.style.marginTop = gapBefore(block)
    page.appendChild(block)
    if (!sheetOverflows(page)) return

    page.removeChild(block)
    const label = page.lastElementChild
    const keepLabel = label?.classList?.contains('dist-label') && block.classList?.contains('dist-item')
    if (keepLabel) page.removeChild(label)

    if (!page.childNodes.length && block.children.length) {
      block.style.marginTop = '0'
      page.appendChild(block)
      return
    }

    if (page.childNodes.length) newPage()
    if (keepLabel) {
      label.style.marginTop = '0'
      page.appendChild(label)
      block.style.marginTop = gapBefore(block)
    } else {
      block.style.marginTop = '0'
    }

    if (!block.children.length) {
      splitWords(block)
      return
    }
    page.appendChild(block)
  })

  if (page.childNodes.length && !pages.includes(page)) pages.push(page)
  container.replaceChildren(...pages.filter(sheet => sheet.childNodes.length))
}

function renderSheet(memo) {
  readTemplate()
  sheetEl.innerHTML = sheetMarkup
  const root = sheetEl.querySelector('.pdf-page') || sheetEl
  applyMemo(root, memo)
  return waitForImages(root).then(() => {
    if (root.isConnected) paginateSheet(sheetEl)
    syncExtraButton(memo)
  })
}

function syncExtraButton(memo) {
  extraBtn.hidden = true
  extraBtn.onclick = null
  if (memo.status === 'draft' && memo.id && typeof window.sendDraftMemo === 'function') {
    extraBtn.hidden = false
    extraBtn.innerHTML = '<i class="fas fa-paper-plane" aria-hidden="true"></i> Send Now'
    extraBtn.dataset.action = 'send-draft'
    return
  }
  if (memo.inboxDocId) {
    extraBtn.hidden = false
    extraBtn.innerHTML = '<i class="fas fa-envelope" aria-hidden="true"></i> Mark Unread'
    extraBtn.dataset.action = 'mark-unread'
  }
}

async function runExtraAction() {
  if (!current) return
  if (extraBtn.dataset.action === 'send-draft') {
    await window.sendDraftMemo(current.id)
    close()
    return
  }
  if (extraBtn.dataset.action === 'mark-unread' && current.inboxDocId && window.db && window.currentUser) {
    try {
      await window.db.collection('userInbox').doc(window.currentUser.uid)
        .collection('memos').doc(current.inboxDocId)
        .update({ read: false })
      const card = document.getElementById(`inbox-card-${current.id}`)
      if (card) card.classList.add('unread')
      toast('Marked as unread')
      close()
    } catch (error) {
      toast(error.message || 'Could not mark unread', true)
    }
  }
}

async function enrichFaculty(memo) {
  if (facultyLine(memo) || !memo.senderUid || !window.db) return memo
  try {
    const snap = await window.db.collection('userProfiles').doc(memo.senderUid).get()
    if (!snap.exists) return memo
    const profile = snap.data() || {}
    return {
      ...memo,
      faculty: profile.faculty || '',
      senderRole: memo.senderRole || profile.role || profile.office || '',
    }
  } catch (_) {
    return memo
  }
}

async function open(memo) {
  const token = ++openToken
  current = { ...(memo || {}) }
  show()
  renderSheet({ ...current, distribution: ['Loading recipients…'] })
  const ready = await withDistribution(current)
  if (token !== openToken) return
  current = ready
  await renderSheet(current)
}

async function markReadAndTrack(memoId, inboxDocId) {
  const db = window.db
  const user = window.currentUser
  if (!db || !user) return

  const card = document.getElementById(`inbox-card-${memoId}`)
  if (card?.classList.contains('unread')) {
    card.classList.remove('unread')
    try {
      await db.collection('userInbox').doc(user.uid).collection('memos').doc(inboxDocId)
        .update({ read: true, readAt: window.firebase.firestore.FieldValue.serverTimestamp() })
    } catch (_) {}
  }

  try {
    const profileSnap = await db.collection('userProfiles').doc(user.uid).get()
    const profile = profileSnap.exists ? profileSnap.data() : {}
    const viewId = `${memoId}_${user.uid}`
    const existing = await db.collection('memoViews').doc(viewId).get()
    if (!existing.exists) {
      await db.collection('memoViews').doc(viewId).set({
        memoId,
        uid: user.uid,
        name: profile.fullName || user.displayName || user.email,
        email: profile.email || user.email,
        viewedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
      })
      await db.collection('memoAnalytics').doc(memoId).set({
        memoId,
        viewCount: window.firebase.firestore.FieldValue.increment(1),
        lastViewed: window.firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
    }
  } catch (error) {
    console.warn('Analytics write error:', error.message)
  }
}

async function openInbox(memoId, inboxDocId) {
  const token = ++openToken
  setLoading('Loading memo…')
  if (!window.db) {
    setError('Memo preview is not available on this page.')
    return
  }
  try {
    await markReadAndTrack(memoId, inboxDocId)
    const snap = await window.db.collection('memos').doc(memoId).get()
    if (token !== openToken) return
    if (!snap.exists) {
      setError('Memo content not found.')
      return
    }
    current = { id: memoId, inboxDocId, ...snap.data() }
    renderSheet({ ...current, distribution: current.distribution?.length ? current.distribution : ['Loading recipients…'] })
    const ready = await withDistribution(current)
    if (token !== openToken) return
    current = { ...ready, id: memoId, inboxDocId }
    await renderSheet(current)
  } catch (error) {
    if (token !== openToken) return
    setError(error.message || 'Failed to load memo.')
  }
}

function fileName(memo) {
  const ref = String(memo?.refNumber || memo?.subject || 'memo')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `AAUA-Memo-${ref || 'memo'}.pdf`
}

function waitForImages(root) {
  const images = [...root.querySelectorAll('img')]
  return Promise.all(images.map(img => {
    if (img.complete) return Promise.resolve()
    return new Promise(resolve => {
      img.onload = () => resolve()
      img.onerror = () => resolve()
    })
  }))
}

async function paintSheet(memo) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;border:0;background:#fff;'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>
    ${sheetCss}
    html, body { margin: 0; padding: 0; background: #fff; display: block !important; }
    .pdf-page { margin: 0; }
  </style></head><body>${sheetMarkup}</body>`)
  doc.close()
  const page = doc.querySelector('.pdf-page')
  applyMemo(page, memo)
  await waitForImages(doc.body)
  paginateSheet(doc.body)
  const pages = [...doc.querySelectorAll('.pdf-page')]
  frame.style.width = '794px'
  frame.style.height = `${Math.max(pages.length, 1) * 1200}px`
  return { frame, pages }
}

async function downloadCurrent() {
  if (!current || !sheetEl.querySelector('.pdf-page')) return
  const label = downloadBtn.innerHTML
  downloadBtn.disabled = true
  downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Preparing…'
  let frame = null
  try {
    readTemplate()
    const painted = await paintSheet(current)
    frame = painted.frame
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    for (let index = 0; index < painted.pages.length; index += 1) {
      const canvas = await html2canvas(painted.pages[index], {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        windowWidth: 794,
      })
      const image = canvas.toDataURL('image/jpeg', 0.92)
      let height = (canvas.height * pageWidth) / canvas.width
      if (height > pageHeight) height = pageHeight
      if (index > 0) pdf.addPage()
      pdf.addImage(image, 'JPEG', 0, 0, pageWidth, height, undefined, 'FAST')
    }
    pdf.save(fileName(current))
  } catch (error) {
    console.error(error)
    toast(error.message || 'Could not download this memo.', true)
  } finally {
    frame?.remove()
    downloadBtn.disabled = false
    downloadBtn.innerHTML = label
  }
}

const DIALOG_CSS = `
  html.aaua-memo-open { overflow: hidden; }
  #aaua-memo-dialog[hidden] { display: none !important; }
  #aaua-memo-dialog {
    position: fixed;
    inset: 0;
    z-index: 4000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    font-family: Inter, "Segoe UI", sans-serif;
  }
  .aaua-memo-dialog__backdrop {
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.55);
  }
  .aaua-memo-dialog__panel {
    position: relative;
    width: min(920px, 100%);
    max-height: min(92vh, 980px);
    display: flex;
    flex-direction: column;
    background: #ffffff;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
  }
  .aaua-memo-dialog__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    background: #0f172b;
    color: #ffffff;
    flex-shrink: 0;
  }
  .aaua-memo-dialog__title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
    font-weight: 600;
  }
  .aaua-memo-dialog__x {
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: #ffffff;
    cursor: pointer;
    font-size: 16px;
  }
  .aaua-memo-dialog__x:hover { background: rgba(255,255,255,0.1); }
  .aaua-memo-dialog__body {
    overflow: auto;
    background: #eef1f6;
    padding: 18px 12px;
    min-height: 180px;
  }
  #aaua-memo-sheet {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    width: 100%;
  }
  #aaua-memo-sheet .pdf-page {
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
    flex-shrink: 0;
  }
  .aaua-memo-dialog__status {
    padding: 48px 16px;
    text-align: center;
    color: #475569;
    font-size: 14px;
  }
  .aaua-memo-dialog__status.is-error { color: #be123c; }
  .aaua-memo-dialog__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    background: #ffffff;
    border-top: 1px solid #e5e7eb;
    flex-shrink: 0;
  }
  .aaua-memo-dialog__actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-left: auto;
  }
  .aaua-memo-dialog__close,
  .aaua-memo-dialog__download,
  .aaua-memo-dialog__extra {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border-radius: 999px;
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .aaua-memo-dialog__close {
    background: #ffffff;
    color: #1f2937;
    border: 1px solid #d1d5db;
  }
  .aaua-memo-dialog__close:hover { background: #f8fafc; }
  .aaua-memo-dialog__download {
    background: #6b7280;
    color: #ffffff;
    border: 1px solid #6b7280;
  }
  .aaua-memo-dialog__download:hover { background: #4b5563; }
  .aaua-memo-dialog__download:disabled { opacity: 0.7; cursor: wait; }
  .aaua-memo-dialog__extra {
    background: transparent;
    color: #334155;
    border: 1px solid #d1d5db;
  }
  .aaua-memo-dialog__extra[hidden] { display: none !important; }
`

export function installMemoDialog() {
  window.MemoDialog = { open, openInbox, close, distributionFor }
}
