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
    var old = document.getElementById('aaua-alert')
    if (old) old.remove()
    var error = type === 'error'
    var dark = document.body && document.body.classList.contains('dark')
    var overlay = document.createElement('div')
    overlay.id = 'aaua-alert'
    overlay.setAttribute('role', 'alertdialog')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(15,23,43,.55);display:flex;align-items:center;justify-content:center;padding:16px;'
    var box = document.createElement('div')
    box.style.cssText = 'width:min(440px,100%);background:' + (dark ? '#1e1e21' : '#fff') + ';color:' + (dark ? '#f1f5f9' : '#0f172b') + ';border-radius:18px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.28);font-family:Inter,Outfit,sans-serif;'
    var head = document.createElement('div')
    head.style.cssText = 'background:' + (error ? '#9f1239' : '#0f172b') + ';color:#fff;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;font-weight:700;'
    head.appendChild(document.createTextNode(error ? 'Please check' : 'Success'))
    var close = document.createElement('button')
    close.type = 'button'
    close.setAttribute('aria-label', 'Close')
    close.textContent = '\u00d7'
    close.style.cssText = 'background:transparent;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1;'
    head.appendChild(close)
    var body = document.createElement('div')
    body.style.cssText = 'padding:18px 18px 8px;font-size:15px;line-height:1.5;'
    body.textContent = message || ''
    var foot = document.createElement('div')
    foot.style.cssText = 'padding:12px 18px 18px;text-align:right;'
    var ok = document.createElement('button')
    ok.type = 'button'
    ok.textContent = 'OK'
    ok.style.cssText = 'background:#0f172b;color:#fff;border:0;border-radius:999px;padding:10px 22px;font-weight:700;cursor:pointer;'
    foot.appendChild(ok)
    box.appendChild(head)
    box.appendChild(body)
    box.appendChild(foot)
    overlay.appendChild(box)
    function dismiss() { if (overlay.parentNode) overlay.remove() }
    close.addEventListener('click', dismiss)
    ok.addEventListener('click', dismiss)
    overlay.addEventListener('click', function (event) { if (event.target === overlay) dismiss() })
    document.body.appendChild(overlay)
    ok.focus()
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
})()
