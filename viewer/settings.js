/**
 * Settings dialog: pick any published character and costume. Choices persist in localStorage.
 * Tiles show the same rendered previews as the app.
 */
const PREFS_KEY = 'open-yoga-poses:prefs:v1'

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
  } catch {
    return {}
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // private browsing / full
  }
}

function tileHtml(kind, id, label, previewUrl, selected) {
  const media = previewUrl
    ? `<img class="pick-preview" src="${esc(previewUrl)}" alt="" width="72" height="108" loading="lazy" />`
    : `<span class="pick-preview pick-preview-empty" aria-hidden="true"></span>`
  return `<button type="button" class="pick${selected ? ' selected' : ''}" data-${kind}="${esc(id)}" aria-pressed="${selected ? 'true' : 'false'}">
    ${media}
    <span class="pick-label">${esc(label)}</span>
  </button>`
}

/**
 * @param {{ characters: object[], styles: object[], character: string, style: string }} opts
 * @returns {Promise<{ character: string, style: string } | null>}
 */
export function openSettingsDialog(opts) {
  return new Promise((resolve) => {
    const existing = document.getElementById('settings-dialog')
    if (existing) existing.remove()

    let character = opts.character
    let style = opts.style
    const dlg = document.createElement('dialog')
    dlg.id = 'settings-dialog'
    dlg.className = 'meta-dialog settings-dialog'

    const render = () => {
      const chars = opts.characters
        .map((c) => {
          const preview = c.preview ? `characters/${c.preview}` : null
          return tileHtml('character', c.id, c.label, preview, c.id === character)
        })
        .join('')
      const styles = opts.styles
        .map((s) => {
          const preview = s.preview ? `styles/${s.preview}` : null
          return tileHtml('style', s.id, s.label, preview, s.id === style)
        })
        .join('')
      dlg.querySelector('.settings-characters').innerHTML = chars
      dlg.querySelector('.settings-styles').innerHTML = styles
    }

    dlg.innerHTML = `
      <form method="dialog" id="settings-form">
        <header class="meta-head">
          <h2>Settings</h2>
          <button type="submit" value="cancel" class="linkish">Close</button>
        </header>
        <div class="meta-body">
          <p class="muted settings-lede">Choose who appears in 3D and which outfit they wear. Your choice is saved in this browser.</p>
          <h3 class="settings-section">Character</h3>
          <div class="pick-grid settings-characters" role="listbox" aria-label="Character"></div>
          <h3 class="settings-section">Costume</h3>
          <div class="pick-grid settings-styles" role="listbox" aria-label="Costume"></div>
        </div>
        <footer class="meta-foot">
          <button type="submit" value="cancel">Cancel</button>
          <button type="submit" value="ok" class="primary">Done</button>
        </footer>
      </form>`
    document.body.appendChild(dlg)
    render()

    dlg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-character], button[data-style]')
      if (!btn) return
      if (btn.dataset.character) character = btn.dataset.character
      if (btn.dataset.style) style = btn.dataset.style
      render()
    })

    dlg.querySelector('#settings-form').addEventListener('submit', (e) => {
      const value = e.submitter?.value || 'cancel'
      dlg.close()
      dlg.remove()
      resolve(value === 'ok' ? { character, style } : null)
    })
    dlg.addEventListener('cancel', () => {
      dlg.remove()
      resolve(null)
    })
    dlg.showModal()
  })
}
