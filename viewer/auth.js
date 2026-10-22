/**
 * Sign-in for the open-poses viewer: Google, Apple, or GitHub.
 * Clicking Sign in opens a chooser dialog. Access token + profile live in
 * localStorage so Suggest can credit the person and call github-submit.
 */
import { config } from './config.js'

const KEY = 'open-yoga-poses:auth:v1'
const GOOGLE_SCOPES = 'openid email profile'
const APPLE_SCRIPT = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'
const GSI_SCRIPT = 'https://accounts.google.com/gsi/client'

/**
 * @typedef {{
 *   provider: 'google' | 'apple' | 'github',
 *   name: string,
 *   email: string,
 *   picture?: string,
 *   accessToken: string,
 *   expiresAt: number,
 * }} AuthUser
 */

const listeners = new Set()

function read() {
  try {
    const u = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!u?.accessToken) return null
    if (!u.provider) u.provider = 'google'
    return u
  } catch {
    return null
  }
}

function write(user) {
  try {
    if (user) localStorage.setItem(KEY, JSON.stringify(user))
    else localStorage.removeItem(KEY)
  } catch {
    /* private browsing */
  }
  for (const fn of listeners) fn(user)
}

/** @type {AuthUser | null} */
let current = read()

export const onAuthChange = (fn) => listeners.add(fn)
export const getUser = () => (current && current.expiresAt > Date.now() + 60_000 ? current : null)
export const creditName = () => getUser()?.name?.trim() || ''

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function loadScript(src, flag) {
  if (document.querySelector(`script[${flag}]`)) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[${flag}]`)
      if (flag === 'data-gsi' && window.google?.accounts?.oauth2) return resolve()
      if (flag === 'data-apple' && window.AppleID?.auth) return resolve()
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Sign-in script failed to load')))
    })
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.setAttribute(flag, '1')
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Sign-in script failed to load'))
    document.head.appendChild(s)
  })
}

function appleAvailable() {
  if (!config.appleServiceId || typeof location === 'undefined') return false
  if (location.protocol !== 'https:') return false
  const host = location.hostname
  if (!host || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')) return false
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false
  return true
}

async function fetchGoogleProfile(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error('Could not read your Google profile')
  const p = await res.json()
  return {
    name: String(p.name || p.email || '').trim(),
    email: String(p.email || '').trim().toLowerCase(),
    picture: p.picture ? String(p.picture) : undefined,
  }
}

/** Opens the Google token popup; resolves with the signed-in user. */
export async function signInWithGoogle() {
  if (!config.googleClientId) throw new Error('Google sign-in is not configured for this build')
  await loadScript(GSI_SCRIPT, 'data-gsi')
  const accessToken = await new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: config.googleClientId,
      scope: GOOGLE_SCOPES,
      callback: (resp) => {
        if (resp.error) reject(new Error(resp.error_description || resp.error))
        else resolve(resp.access_token)
      },
      error_callback: (err) => reject(new Error(err?.message || 'Sign-in cancelled')),
    })
    client.requestAccessToken({ prompt: '' })
  })
  const profile = await fetchGoogleProfile(accessToken)
  if (!profile.email) throw new Error('Your Google account needs an email address to submit')
  current = {
    provider: 'google',
    ...profile,
    accessToken,
    expiresAt: Date.now() + 55 * 60 * 1000,
  }
  write(current)
  return current
}

async function exchangeAppleSession(idToken, { name = '', email = '' } = {}) {
  const base = String(config.apiBase || '').replace(/\/+$/, '')
  if (!base) throw new Error('API base is not configured')
  const res = await fetch(`${base}/yoga/pose-edits/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, name, email }),
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json()).detail || ''
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Apple session failed (${res.status})`)
  }
  return res.json()
}

/** Sign in with Apple (HTTPS hosts with Services ID only). */
export async function signInWithApple() {
  if (!appleAvailable()) {
    throw new Error('Sign in with Apple needs HTTPS on a real domain (not localhost)')
  }
  await loadScript(APPLE_SCRIPT, 'data-apple')
  // Must match a Return URL registered on the Services ID (popup still checks it).
  const redirectURI =
    config.appleRedirectUri ||
    (location.hostname.endsWith('github.io')
      ? `${location.origin}/open-yoga-poses/`
      : `${location.origin}/`)
  window.AppleID.auth.init({
    clientId: config.appleServiceId,
    scope: 'name email',
    redirectURI,
    usePopup: true,
  })
  const response = await window.AppleID.auth.signIn()
  const idToken = response?.authorization?.id_token
  if (!idToken) throw new Error('Apple sign-in did not return a token')
  const user = response?.user
  const name = [user?.name?.firstName, user?.name?.lastName].filter(Boolean).join(' ').trim()
  const email = String(user?.email || '').trim().toLowerCase()
  const session = await exchangeAppleSession(idToken, { name, email })
  current = {
    provider: 'apple',
    name: session.name || name || 'Apple user',
    email: session.email || email || '',
    accessToken: session.token,
    expiresAt: Number(session.expiresAt) || Date.now() + 30 * 24 * 3600 * 1000,
  }
  write(current)
  return current
}

function applyGithubAuthPayload(payload) {
  if (!payload || payload.type !== 'open-poses-github-auth') return null
  if (!payload.ok) throw new Error(payload.error || 'GitHub sign-in failed')
  if (!payload.token) throw new Error('GitHub sign-in did not return a session')
  current = {
    provider: 'github',
    name: String(payload.name || '').trim() || 'GitHub user',
    email: String(payload.email || '').trim().toLowerCase(),
    accessToken: String(payload.token),
    expiresAt: Number(payload.expiresAt) || Date.now() + 30 * 24 * 3600 * 1000,
  }
  write(current)
  return current
}

/** Consume `#op-auth=…` from a full-page GitHub OAuth return. */
export function consumeAuthHash() {
  try {
    const hash = location.hash || ''
    const m = hash.match(/(?:^|#|&)op-auth=([^&]+)/)
    if (!m) return null
    const payload = JSON.parse(decodeURIComponent(m[1]))
    const user = applyGithubAuthPayload(payload)
    const cleaned = hash
      .replace(/^[?#]/, '')
      .split('&')
      .filter((p) => p && !p.startsWith('op-auth='))
      .join('&')
    history.replaceState(null, '', cleaned ? `${location.pathname}${location.search}#${cleaned}` : `${location.pathname}${location.search}`)
    return user
  } catch (err) {
    console.warn('Could not finish GitHub sign-in from URL', err)
    return null
  }
}

/** Opens GitHub OAuth via the resolver (popup when possible). */
export async function signInWithGithub() {
  const base = String(config.apiBase || '').replace(/\/+$/, '')
  if (!base) throw new Error('API base is not configured')
  const returnUrl = `${location.origin}${location.pathname}${location.search}`
  const start = `${base}/yoga/pose-edits/oauth/github/start?return=${encodeURIComponent(returnUrl)}`
  return new Promise((resolve, reject) => {
    const expectedOrigin = new URL(base).origin
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      window.clearInterval(timer)
      fn(value)
    }
    const onMessage = (event) => {
      if (event.origin !== expectedOrigin) return
      try {
        finish(resolve, applyGithubAuthPayload(event.data))
      } catch (err) {
        finish(reject, err)
      }
    }
    window.addEventListener('message', onMessage)
    const popup = window.open(start, 'open-poses-github', 'width=600,height=720')
    if (!popup) {
      // Popup blocked — full-page redirect; hash handler finishes on return.
      window.removeEventListener('message', onMessage)
      location.assign(start)
      return
    }
    const timer = window.setInterval(() => {
      if (popup.closed && !settled) {
        finish(reject, new Error('GitHub sign-in was cancelled'))
      }
    }, 400)
  })
}

/** @deprecated Prefer signInWithGoogle / openSignInChooser */
export async function signIn() {
  return openSignInChooser()
}

export function signOut() {
  const token = current?.accessToken
  const provider = current?.provider
  current = null
  write(null)
  if (provider === 'google' && token && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(token, () => {})
  }
}

/** Fresh access token for API calls; opens the chooser if expired. */
export async function accessToken() {
  const u = getUser()
  if (u) return u.accessToken
  const next = await openSignInChooser()
  if (!next) throw new Error('Sign-in cancelled')
  return next.accessToken
}

function googleLogoSvg() {
  return `<svg class="signin-chooser-option__logo" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>`
}

function appleLogoSvg() {
  return `<svg class="signin-chooser-option__logo" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M16.37 12.64c-.03-2.94 2.4-4.35 2.51-4.42-1.37-2-3.5-2.27-4.25-2.3-1.81-.18-3.53 1.06-4.45 1.06-.92 0-2.34-1.04-3.85-1.01-1.98.03-3.81 1.15-4.83 2.93-2.06 3.57-.53 8.85 1.48 11.75.98 1.42 2.15 3.01 3.69 2.95 1.48-.06 2.04-.95 3.83-.95 1.78 0 2.29.95 3.85.92 1.59-.03 2.6-1.44 3.57-2.87 1.13-1.64 1.59-3.23 1.62-3.31-.04-.01-3.1-1.19-3.13-4.75zM13.7 4.24c.82-.99 1.37-2.37 1.22-3.74-1.18.05-2.61.79-3.46 1.78-.76.87-1.42 2.27-1.24 3.61 1.31.1 2.65-.67 3.48-1.65z"/>
  </svg>`
}

function githubLogoSvg() {
  return `<svg class="signin-chooser-option__logo" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2 0-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.9 4.4 19 4.7 19 4.7c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.2 0 4.7-2.9 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3z"/>
  </svg>`
}

/**
 * Modal to pick Google / Apple / GitHub. Resolves with the user, or null if cancelled.
 * @returns {Promise<AuthUser | null>}
 */
export function openSignInChooser() {
  return new Promise((resolve) => {
    const existing = document.getElementById('signin-chooser')
    if (existing) existing.remove()
    const appleOk = appleAvailable()
    const dlg = document.createElement('dialog')
    dlg.id = 'signin-chooser'
    dlg.className = 'meta-dialog signin-chooser-dialog'
    dlg.innerHTML = `
      <form method="dialog" id="signin-chooser-form">
        <header class="meta-head">
          <h2>Sign in</h2>
          <button type="submit" value="cancel" class="linkish" formnovalidate>Close</button>
        </header>
        <div class="meta-body signin-chooser">
          <p class="muted">Sign in so we can credit your suggestions on the open pose library.</p>
          <button type="button" class="signin-chooser-option signin-chooser-option--google" data-provider="google">
            <span class="signin-chooser-option__label">${googleLogoSvg()} Sign in with Google</span>
          </button>
          <button type="button" class="signin-chooser-option signin-chooser-option--apple${appleOk ? '' : ' is-disabled'}" data-provider="apple" ${appleOk ? '' : 'disabled'}>
            <span class="signin-chooser-option__label">${appleLogoSvg()} Sign in with Apple</span>
            ${appleOk ? '' : '<span class="signin-chooser-option__note">HTTPS on a registered domain is required for Apple.</span>'}
          </button>
          <button type="button" class="signin-chooser-option signin-chooser-option--github" data-provider="github">
            <span class="signin-chooser-option__label">${githubLogoSvg()} Sign in with GitHub</span>
          </button>
          <p class="signin-chooser-error muted" id="signin-chooser-error" hidden></p>
        </div>
        <footer class="meta-foot">
          <button type="submit" value="cancel" formnovalidate>Cancel</button>
        </footer>
      </form>`
    document.body.appendChild(dlg)
    const errEl = dlg.querySelector('#signin-chooser-error')
    let busy = false

    const close = (user) => {
      dlg.close()
      dlg.remove()
      resolve(user)
    }

    dlg.querySelector('#signin-chooser-form').addEventListener('submit', (e) => {
      e.preventDefault()
      if (busy) return
      close(null)
    })
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault()
      if (busy) return
      close(null)
    })

    dlg.querySelectorAll('[data-provider]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (busy) return
        const provider = btn.getAttribute('data-provider')
        busy = true
        dlg.querySelectorAll('[data-provider]').forEach((b) => {
          b.disabled = true
        })
        errEl.hidden = true
        try {
          let user = null
          if (provider === 'google') user = await signInWithGoogle()
          else if (provider === 'apple') user = await signInWithApple()
          else if (provider === 'github') user = await signInWithGithub()
          close(user)
        } catch (err) {
          busy = false
          dlg.querySelectorAll('[data-provider]').forEach((b) => {
            if (b.getAttribute('data-provider') === 'apple' && !appleOk) return
            b.disabled = false
          })
          errEl.textContent = err instanceof Error ? err.message : 'Sign-in failed'
          errEl.hidden = false
        }
      })
    })

    dlg.showModal()
  })
}

/** Renders Sign in / signed-in name into `#auth`. */
export function renderAuthBar(root) {
  if (!root) return
  const u = getUser()
  if (!u) {
    root.innerHTML = `<button type="button" id="auth-signin" class="auth-btn">Sign in</button>`
  } else {
    const label = escapeHtml(u.name || u.email || u.provider)
    const title = escapeHtml(u.email || u.provider)
    root.innerHTML = `<span class="auth-who" title="${title}">${label}</span>
      <button type="button" id="auth-signout" class="auth-btn linkish">Sign out</button>`
  }
}

export function bindAuthBar(root, onChange) {
  if (!root) return
  consumeAuthHash()
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button')
    if (!t) return
    if (t.id === 'auth-signin') {
      t.disabled = true
      try {
        const user = await openSignInChooser()
        renderAuthBar(root)
        if (user) onChange?.()
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Sign-in failed')
      } finally {
        t.disabled = false
      }
    } else if (t.id === 'auth-signout') {
      signOut()
      renderAuthBar(root)
      onChange?.()
    }
  })
  onAuthChange(() => {
    renderAuthBar(root)
    onChange?.()
  })
  renderAuthBar(root)
}
