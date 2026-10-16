/**
 * Google sign-in for the open-poses viewer (same Web client as SynthYoga).
 * Access token + profile live in localStorage so Suggest can credit the person
 * and call /yoga/pose-edits/github-submit.
 */
import { config } from './config.js'

const KEY = 'open-yoga-poses:auth:v1'
const SCOPES = 'openid email profile'

/** @typedef {{ name: string, email: string, picture?: string, accessToken: string, expiresAt: number }} AuthUser */

const listeners = new Set()

function read() {
  try {
    const u = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!u?.accessToken || !u?.email) return null
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

function loadGsi() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-gsi]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Google sign-in script failed to load')))
      return
    }
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.dataset.gsi = '1'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Google sign-in script failed to load'))
    document.head.appendChild(s)
  })
}

async function fetchProfile(accessToken) {
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
export async function signIn() {
  if (!config.googleClientId) throw new Error('Google sign-in is not configured for this build')
  await loadGsi()
  const accessToken = await new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: config.googleClientId,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error) reject(new Error(resp.error_description || resp.error))
        else resolve(resp.access_token)
      },
      error_callback: (err) => reject(new Error(err?.message || 'Sign-in cancelled')),
    })
    client.requestAccessToken({ prompt: '' })
  })
  const profile = await fetchProfile(accessToken)
  if (!profile.email) throw new Error('Your Google account needs an email address to submit')
  current = {
    ...profile,
    accessToken,
    expiresAt: Date.now() + 55 * 60 * 1000,
  }
  write(current)
  return current
}

export function signOut() {
  const token = current?.accessToken
  current = null
  write(null)
  if (token && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(token, () => {})
  }
}

/** Fresh access token for API calls; prompts again if expired. */
export async function accessToken() {
  const u = getUser()
  if (u) return u.accessToken
  const next = await signIn()
  return next.accessToken
}

/** Renders Sign in / signed-in name into `#auth`. */
export function renderAuthBar(root) {
  if (!root) return
  const u = getUser()
  if (!u) {
    root.innerHTML = `<button type="button" id="auth-signin" class="auth-btn">Sign in with Google</button>`
  } else {
    root.innerHTML = `<span class="auth-who" title="${u.email}">${escapeHtml(u.name || u.email)}</span>
      <button type="button" id="auth-signout" class="auth-btn linkish">Sign out</button>`
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

export function bindAuthBar(root, onChange) {
  if (!root) return
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button')
    if (!t) return
    if (t.id === 'auth-signin') {
      t.disabled = true
      try {
        await signIn()
        renderAuthBar(root)
        onChange?.()
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Sign-in failed')
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
