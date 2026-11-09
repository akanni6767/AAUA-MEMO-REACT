import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

// Patch window.location.href and window.location.replace so Firebase redirects
// work with React Router instead of hard reloading the page.
function patchLocationForReact(navigate) {
  const handler = {
    get(target, prop) {
      if (prop === 'href') return target.href
      if (prop === 'replace') return (url) => {
        const path = url.startsWith('http') ? new URL(url).pathname : url
        navigate(path, { replace: true })
      }
      if (typeof target[prop] === 'function') return target[prop].bind(target)
      return target[prop]
    },
    set(target, prop, value) {
      if (prop === 'href') {
        const path = value.startsWith('http') ? new URL(value).pathname : value
        navigate(path)
        return true
      }
      target[prop] = value
      return true
    }
  }
  try {
    Object.defineProperty(window, '__reactLocation', { value: new Proxy(window.location, handler), configurable: true })
  } catch (_) {}
}

export default function HtmlPage({ html, title }) {
  const containerRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (title) document.title = title

    const el = containerRef.current
    if (!el) return

    // --- 1. Extract <style> blocks from the HTML string ---
    const styleMatches = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    // Inject styles into <head> with a unique marker so we can remove on unmount
    const injectedStyles = styleMatches.map(m => {
      const tag = document.createElement('style')
      tag.setAttribute('data-htmlpage', '1')
      tag.textContent = m[1]
      document.head.appendChild(tag)
      return tag
    })

    // --- 2. Extract <body> content (between <body> and </body>) ---
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    const bodyHtml = bodyMatch ? bodyMatch[1] : html

    // Remove inline <script> tags from bodyHtml before setting innerHTML
    // (we'll run them manually below so they execute in the live DOM)
    const cleanBody = bodyHtml.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, '')
    el.innerHTML = cleanBody

    // --- 3. Patch location BEFORE running scripts ---
    patchLocationForReact(navigate)

    // Override window.location.replace for inline scripts. Location.replace is
    // often non-configurable, and React Strict Mode runs this twice — skip if
    // already patched and never throw on redefine.
    const patchScript = document.createElement('script')
    patchScript.textContent = `
      (function() {
        if (window.__reactLocationPatched) return;
        window.__reactLocationPatched = true;
        function reactNav(url) {
          var path = url;
          try { if(url.startsWith('http')) path = new URL(url).pathname; } catch(e) {}
          window.__reactNavigate && window.__reactNavigate(path);
        }
        try {
          Object.defineProperty(window.location, 'replace', {
            value: function(url) { reactNav(url); },
            writable: true, configurable: true
          });
        } catch (e) {}
      })();
    `
    document.head.appendChild(patchScript)

    // Store navigate on window so the patch can call it
    window.__reactNavigate = (path) => navigate(path, { replace: false })

    // --- 4. Extract and re-execute all <script> blocks ---
    const scriptMatches = [...bodyHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    const injectedScripts = []

    scriptMatches.forEach(match => {
      const attrs = match[1] || ''
      const content = match[2] || ''

      const tag = document.createElement('script')
      // Copy attributes (type, src, etc.)
      const attrRe = /(\w[\w-]*)(?:=(?:"([^"]*)"|'([^']*)'|(\S+)))?/g
      let attrMatch
      while ((attrMatch = attrRe.exec(attrs)) !== null) {
        const name = attrMatch[1]
        const val = attrMatch[2] || attrMatch[3] || attrMatch[4] || ''
        if (name && name !== 'type') tag.setAttribute(name, val)
      }
      // Don't mark as module — Firebase compat uses global firebase.*
      // Rewrite window.location.href = '...' → window.__reactNavigate('...')
      // Top-level let/const become global lexical bindings. Removing the <script>
      // tag does not undeclare them, so React Strict Mode (effect runs twice)
      // and SPA navigations throw "Identifier has already been declared".
      // Rewrite let/const to var so re-injection is safe (including indented
      // declarations like login.html's `  const firebaseConfig`).
      const patched = content
        .replace(/window\.location\.href\s*=\s*([^;]+);/g, 'window.__reactNavigate && window.__reactNavigate($1);')
        .replace(/window\.location\.replace\s*\(/g, 'window.__reactNavigate && window.__reactNavigate(')
        .replace(/^(\s*)(let|const)\s+/gm, '$1var ')
        .replace(
          /firebase\.initializeApp\s*\(/g,
          '(window.firebase && firebase.apps && firebase.apps.length) ? firebase.app() : firebase.initializeApp('
        )

      tag.textContent = patched
      tag.setAttribute('data-htmlpage', '1')
      try {
        document.body.appendChild(tag)
      } catch (err) {
        console.error('HtmlPage inline script failed:', err)
      }
      injectedScripts.push(tag)
    })

    return () => {
      // Cleanup styles and scripts on route change
      injectedStyles.forEach(t => t.remove())
      injectedScripts.forEach(t => t.remove())
      patchScript.remove()
      el.innerHTML = ''
    }
  }, [html, title])

  return (
    <div
      ref={containerRef}
      style={{ minHeight: '100vh', width: '100%' }}
    />
  )
}
