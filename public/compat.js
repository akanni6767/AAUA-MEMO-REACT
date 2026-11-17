(function () {
  var TOKEN_KEY = 'aaua_session'
  var apps = []
  var listeners = []
  var current = null
  var booted = boot()

  function token() { return localStorage.getItem(TOKEN_KEY) || '' }

  function request(url, options) {
    options = options || {}
    options.headers = options.headers || {}
    options.headers['Content-Type'] = 'application/json'
    if (token()) options.headers.Authorization = 'Bearer ' + token()
    return fetch(url, options).then(function (res) {
      return res.json().catch(function () { return {} }).then(function (body) {
        if (!res.ok) {
          var error = new Error(body.message || 'Request failed')
          error.code = body.code || 'unknown'
          throw error
        }
        return body
      })
    })
  }

  function encode(value) {
    if (!value || typeof value !== 'object') return value
    if (value.__type) return { __type: value.__type, value: value.value }
    if (Array.isArray(value)) return value.map(encode)
    var out = {}
    Object.keys(value).forEach(function (key) { out[key] = encode(value[key]) })
    return out
  }

  function wrapUser(user) {
    if (!user) return null
    user.reauthenticateWithCredential = function (cred) {
      user._credential = cred
      return Promise.resolve(user)
    }
    user.updatePassword = function (next) {
      var cred = user._credential || {}
      return request('/api/auth/password', {
        method: 'POST',
        body: JSON.stringify({ password: cred.password, next: next })
      })
    }
    user.updateProfile = function (profile) {
      if (profile && profile.displayName) user.displayName = profile.displayName
      if (profile && profile.photoURL) user.photoURL = profile.photoURL
      current = user
      auth.currentUser = user
      return Promise.resolve()
    }
    return user
  }

  window.aauaAlert = function (message, type) {
    if (typeof window.showToast === 'function') window.showToast(message, type === 'error')
  }

  window.aauaNotify = function (event, memoId, extra) {
    extra = extra || {}
    return request('/api/mail', {
      method: 'POST',
      body: JSON.stringify({ event: event, memoId: memoId, comment: extra.comment || '' })
    }).catch(function () { return { sent: 0 } })
  }

  window.aauaBindProfilePhoto = function () {
    var input = document.getElementById('profilePhotoInput')
    var btn = document.getElementById('uploadPhotoBtn')
    if (!input || !btn || btn.dataset.bound) return
    btn.dataset.bound = '1'
    btn.addEventListener('click', function () { input.click() })
    input.addEventListener('change', function () {
      var file = input.files && input.files[0]
      input.value = ''
      if (!file) return
      if (!file.type || file.type.indexOf('image/') !== 0) {
        if (typeof showToast === 'function') showToast('Choose an image file', true)
        return
      }
      var reader = new FileReader()
      reader.onload = function () {
        var img = new Image()
        img.onload = function () {
          var limit = 320
          var scale = Math.min(1, limit / Math.max(img.width, img.height))
          var canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(img.width * scale))
          canvas.height = Math.max(1, Math.round(img.height * scale))
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
          var url = canvas.toDataURL('image/jpeg', 0.82)
          selectedAvatarSrc = url
          var icon = document.getElementById('settingsAvatarIcon')
          var circle = document.getElementById('settingsAvatarCircle')
          if (icon) icon.style.display = 'none'
          if (!circle) return
          var existing = circle.querySelector('img')
          if (!existing) {
            existing = document.createElement('img')
            circle.appendChild(existing)
          }
          existing.src = url
        }
        img.src = reader.result
      }
      reader.readAsDataURL(file)
    })
  }

  function notify() {
    listeners.slice().forEach(function (fn) {
      try { fn(current) } catch (error) { console.error(error) }
    })
  }

  function boot() {
    if (!token()) return Promise.resolve(null)
    return fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token() } })
      .then(function (res) { return res.ok ? res.json() : null })
      .then(function (body) {
        current = body && body.user ? wrapUser(body.user) : null
        if (!current) localStorage.removeItem(TOKEN_KEY)
        return current
      })
      .catch(function () { return null })
  }

  function fieldName(field) {
    if (field && field.__type === 'documentId') return '__name__'
    return field
  }

  function DocSnap(doc) {
    this.id = doc.id
    this.exists = !!doc.exists
    this._data = doc.data || null
  }
  DocSnap.prototype.data = function () { return this._data }

  function QuerySnap(docs) {
    this.docs = (docs || []).map(function (doc) {
      return new DocSnap({ id: doc.id, exists: true, data: doc.data })
    })
    this.empty = this.docs.length === 0
    this.size = this.docs.length
  }
  QuerySnap.prototype.forEach = function (fn) { this.docs.forEach(fn) }

  function fs(body) {
    return request('/api/fs', { method: 'POST', body: JSON.stringify(body) })
  }

  function Ref(path) {
    this.path = path
    this.id = path[path.length - 1]
  }
  Ref.prototype.collection = function (name) { return new Query(this.path.concat(name)) }
  Ref.prototype.get = function () {
    return fs({ op: 'get', path: this.path }).then(function (doc) { return new DocSnap(doc) })
  }
  Ref.prototype.set = function (data, options) {
    return fs({ op: 'set', path: this.path, data: encode(data), merge: !!(options && options.merge) })
  }
  Ref.prototype.update = function (data) {
    return fs({ op: 'update', path: this.path, data: encode(data) })
  }
  Ref.prototype.delete = function () {
    return fs({ op: 'delete', path: this.path })
  }
  Ref.prototype.onSnapshot = function (next, error) {
    return listen(this, next, error)
  }

  function Query(path) {
    this.path = path
    this.filters = []
    this.orders = []
    this.lim = null
    this.start = null
    this.end = null
  }
  Query.prototype.where = function (field, op, value) {
    this.filters.push({ field: fieldName(field), op: op, value: value })
    return this
  }
  Query.prototype.orderBy = function (field, dir) {
    this.orders.push({ field: field, dir: dir || 'asc' })
    return this
  }
  Query.prototype.limit = function (n) { this.lim = n; return this }
  Query.prototype.startAt = function (value) { this.start = value; return this }
  Query.prototype.endAt = function (value) { this.end = value; return this }
  Query.prototype.doc = function (id) { return new Ref(this.path.concat(id || newId())) }
  Query.prototype.get = function () { return fs(this.payload()).then(function (rows) { return new QuerySnap(rows) }) }
  Query.prototype.add = function (data) {
    var self = this
    return fs({ op: 'add', path: this.path, data: encode(data) }).then(function (row) {
      return new Ref(self.path.concat(row.id))
    })
  }
  Query.prototype.onSnapshot = function (next, error) { return listen(this, next, error) }
  Query.prototype.payload = function () {
    return {
      op: 'query',
      path: this.path,
      query: { filters: this.filters, orders: this.orders, limit: this.lim, start: this.start, end: this.end }
    }
  }

  function listen(target, next, error) {
    var stopped = false
    var last = ''
    function tick() {
      if (stopped) return
      var pending = target instanceof Query ? target.get() : target.get()
      pending.then(function (snap) {
        if (stopped) return
        var serial = JSON.stringify(snap instanceof QuerySnap ? snap.docs.map(function (d) { return [d.id, d.data()] }) : [snap.id, snap.exists, snap.data()])
        if (serial !== last) {
          last = serial
          next(snap)
        }
      }).catch(function (err) {
        if (!stopped && typeof error === 'function') error(err)
      })
    }
    tick()
    var timer = setInterval(tick, 2500)
    return function () { stopped = true; clearInterval(timer) }
  }

  function newId() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    var bytes = new Uint8Array(20)
    crypto.getRandomValues(bytes)
    var id = ''
    for (var i = 0; i < bytes.length; i++) id += chars[bytes[i] % chars.length]
    return id
  }

  function Batch() { this.ops = [] }
  Batch.prototype.set = function (ref, data) { this.ops.push({ op: 'set', path: ref.path, data: encode(data) }); return this }
  Batch.prototype.update = function (ref, data) { this.ops.push({ op: 'update', path: ref.path, data: encode(data) }); return this }
  Batch.prototype.delete = function (ref) { this.ops.push({ op: 'delete', path: ref.path }); return this }
  Batch.prototype.commit = function () { return fs({ op: 'batch', ops: this.ops }) }

  function firestore() {
    return {
      collection: function (name) { return new Query([name]) },
      batch: function () { return new Batch() },
      runTransaction: function (fn) {
        var pending = []
        var t = {
          get: function (ref) { return ref.get() },
          set: function (ref, data) { pending.push(ref.set(data)); return t },
          update: function (ref, data) { pending.push(ref.update(data)); return t }
        }
        return Promise.resolve(fn(t)).then(function (result) {
          return Promise.all(pending).then(function () { return result })
        })
      }
    }
  }
  firestore.FieldValue = {
    serverTimestamp: function () { return { __type: 'serverTimestamp' } },
    increment: function (n) { return { __type: 'increment', value: n } }
  }
  firestore.FieldPath = {
    documentId: function () { return { __type: 'documentId' } }
  }

  var auth = {
    currentUser: null,
    signInWithEmailAndPassword: function (email, password) {
      return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: email, password: password }) })
        .then(function (body) {
          localStorage.setItem(TOKEN_KEY, body.token)
          current = wrapUser(body.user)
          auth.currentUser = current
          notify()
          return { user: current }
        })
    },
    createUser: function (info) {
      return request('/api/auth/users', { method: 'POST', body: JSON.stringify(info) })
    },
    signOut: function () {
      var pending = request('/api/auth/logout', { method: 'POST', body: '{}' }).catch(function () {})
      localStorage.removeItem(TOKEN_KEY)
      current = null
      auth.currentUser = null
      notify()
      return pending
    },
    onAuthStateChanged: function (fn) {
      listeners.push(fn)
      booted.then(function () {
        auth.currentUser = current
        fn(current)
      })
      return function () {
        var at = listeners.indexOf(fn)
        if (at >= 0) listeners.splice(at, 1)
      }
    }
  }

  function initializeApp(config) {
    var app = { name: '[DEFAULT]', options: config || { apiKey: 'local' } }
    apps.push(app)
    return app
  }

  window.firebase = {
    apps: apps,
    SDK_VERSION: 'local',
    initializeApp: initializeApp,
    app: function () { return apps[0] || initializeApp() },
    auth: function () {
      auth.currentUser = current
      return auth
    },
    firestore: firestore
  }
  window.firebase.auth.EmailAuthProvider = {
    credential: function (email, password) { return { email: email, password: password } }
  }

  function spinButton(btn, promise) {
    if (!btn || !promise || typeof promise.then !== 'function') return promise
    var html = btn.innerHTML
    var timer = setTimeout(function () {
      if (!btn.isConnected || btn.dataset.aauaBusy) return
      btn.dataset.aauaBusy = '1'
      btn.disabled = true
      if (!/fa-spinner/.test(btn.innerHTML)) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Please wait…'
    }, 120)
    var finish = function () {
      clearTimeout(timer)
      if (!btn.dataset.aauaBusy || !btn.isConnected) return
      btn.disabled = false
      btn.innerHTML = html
      delete btn.dataset.aauaBusy
    }
    promise.then(finish, finish)
    return promise
  }

  var nativeAdd = EventTarget.prototype.addEventListener
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (type === 'click' && this && this.tagName === 'BUTTON' && typeof fn === 'function' && !fn.__aauaBusy) {
      var button = this
      var wrapped = function (event) {
        return spinButton(button, fn.call(button, event))
      }
      wrapped.__aauaBusy = true
      return nativeAdd.call(this, type, wrapped, opts)
    }
    return nativeAdd.call(this, type, fn, opts)
  }

  function bindOnclick(btn) {
    if (!btn || btn.dataset.aauaClick || !btn.getAttribute('onclick')) return
    var code = btn.getAttribute('onclick')
    btn.dataset.aauaClick = '1'
    btn.removeAttribute('onclick')
    nativeAdd.call(btn, 'click', function () {
      var result
      try { result = (0, eval)(code) } catch (error) { throw error }
      return spinButton(btn, result)
    })
  }

  window.filterMemoCards = function (inputId, listId) {
    var q = ((document.getElementById(inputId) || {}).value || '').toLowerCase()
    var root = document.getElementById(listId)
    if (!root) return
    root.querySelectorAll('.memo-card').forEach(function (card) {
      var text = (card.textContent || '').toLowerCase()
      card.style.display = !q || text.indexOf(q) !== -1 ? '' : 'none'
    })
  }

  function mountRefSearch(navbar) {
    if (!navbar || navbar.querySelector('.aaua-ref-search') || !navbar.querySelector('#navAvatar')) return
    var wrap = document.createElement('div')
    wrap.className = 'aaua-ref-search'
    wrap.innerHTML = '<button type="button" class="aaua-ref-btn" aria-label="Search by reference number"><i class="fas fa-magnifying-glass"></i></button>' +
      '<form class="aaua-ref-form" hidden><input type="search" placeholder="Reference number" aria-label="Reference number"></form>' +
      '<div class="aaua-ref-results" hidden></div>'
    var avatar = navbar.querySelector('#navAvatar')
    navbar.insertBefore(wrap, avatar)
    var btn = wrap.querySelector('.aaua-ref-btn')
    var form = wrap.querySelector('.aaua-ref-form')
    var input = form.querySelector('input')
    var results = wrap.querySelector('.aaua-ref-results')
    btn.addEventListener('click', function () {
      var open = form.hidden
      form.hidden = !open
      results.hidden = true
      if (open) input.focus()
    })
    form.addEventListener('submit', function (event) {
      event.preventDefault()
      var q = input.value.trim().toLowerCase()
      results.innerHTML = ''
      if (!q || !window.db) { results.hidden = true; return }
      results.hidden = false
      results.textContent = 'Searching…'
      window.db.collection('memos').get().then(function (snap) {
        var me = window.currentUser || (window.firebase && firebase.auth().currentUser) || {}
        var rows = []
        snap.forEach(function (doc) {
          var data = doc.data() || {}
          var ref = String(data.refNumber || '').toLowerCase()
          if (ref.indexOf(q) === -1) return
          var type = String(me.accountType || '').toLowerCase()
          var allowed = type === 'admin' || data.senderUid === me.uid || data.hodUid === me.uid || data.deanUid === me.uid || (data.recipientUids || []).indexOf(me.uid) !== -1
          if (allowed) rows.push(Object.assign({ id: doc.id }, data))
        })
        if (!rows.length) { results.textContent = 'No memo with that reference.'; return }
        results.innerHTML = ''
        rows.slice(0, 8).forEach(function (memo) {
          var item = document.createElement('button')
          item.type = 'button'
          item.className = 'aaua-ref-hit'
          item.textContent = (memo.refNumber || '—') + ' · ' + (memo.subject || 'Memo')
          item.addEventListener('click', function () {
            results.hidden = true
            form.hidden = true
            if (window.MemoDialog) window.MemoDialog.open(memo)
          })
          results.appendChild(item)
        })
      }).catch(function (error) {
        results.textContent = error.message || 'Search failed'
      })
    })
    document.addEventListener('click', function (event) {
      if (!wrap.contains(event.target)) { form.hidden = true; results.hidden = true }
    })
  }

  function scan(root) {
    ;(root || document).querySelectorAll('button[onclick]').forEach(bindOnclick)
    document.querySelectorAll('.top-navbar').forEach(mountRefSearch)
  }

  var style = document.createElement('style')
  style.textContent = '.aaua-ref-search{position:relative;display:flex;align-items:center;margin-left:auto;margin-right:12px}' +
    '.aaua-ref-btn{width:38px;height:38px;border-radius:50%;border:1px solid var(--border,#e2e8f0);background:var(--bg-card,#fff);color:var(--text-heading,#0f172b);cursor:pointer}' +
    '.aaua-ref-form{position:absolute;right:46px;top:0}' +
    '.aaua-ref-form input{width:220px;height:38px;border-radius:999px;border:1px solid var(--border,#e2e8f0);padding:0 14px;background:var(--bg-card,#fff);color:var(--text-heading,#0f172b);font:500 14px Inter,sans-serif}' +
    '.aaua-ref-results{position:absolute;right:0;top:46px;width:min(320px,70vw);background:var(--bg-card,#fff);border:1px solid var(--border,#e2e8f0);border-radius:14px;box-shadow:0 12px 30px rgba(15,23,43,.12);padding:6px;z-index:30}' +
    '.aaua-ref-hit{display:block;width:100%;text-align:left;border:0;background:transparent;padding:8px 10px;border-radius:10px;cursor:pointer;color:var(--text-heading,#0f172b);font:600 13px Inter,sans-serif}' +
    '.aaua-ref-hit:hover{background:var(--nav-active-bg,#eef2ff)}'
  document.head.appendChild(style)
  if (document.body) scan(document)
  new MutationObserver(function (records) {
    records.forEach(function (record) { scan(record.target) })
  }).observe(document.documentElement, { childList: true, subtree: true })
})()
