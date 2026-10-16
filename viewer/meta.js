/**
 * Dialog to edit full yoga teacher fields for a pose suggestion / new pose.
 */
import * as store from './store.js'

const CATEGORIES = [
  ['standing', 'Standing'],
  ['floor', 'Floor'],
  ['arm-balance', 'Arm balance'],
  ['inversion', 'Inversion'],
  ['chair', 'Chair'],
  ['breath', 'Breath'],
  ['transition', 'Transition'],
]

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const lines = (raw) =>
  String(raw || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
const csv = (raw) =>
  String(raw || '')
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)

function fieldHtml(f) {
  const list = (arr) => (Array.isArray(arr) ? arr.join('\n') : '')
  const tags = (arr) => (Array.isArray(arr) ? arr.join(', ') : '')
  return `
    <label class="field">English name <input name="name" required value="${esc(f.name || '')}" /></label>
    <label class="field">Sanskrit <input name="sanskrit" value="${esc(f.sanskrit || '')}" /></label>
    <label class="field">Chinese name <input name="chineseName" value="${esc(f.chineseName || '')}" /></label>
    <label class="field">Also called (comma-separated) <input name="altNames" value="${esc(tags(f.altNames))}" /></label>
    <label class="field">Category
      <select name="category">${CATEGORIES.map(([v, l]) => `<option value="${v}" ${f.category === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </label>
    <label class="field">Intensity (1–5) <input name="intensity" type="number" min="1" max="5" step="1" value="${Number(f.intensity) || 2}" /></label>
    <label class="field">Default hold (seconds) <input name="defaultHoldSec" type="number" min="1" max="600" value="${Number(f.defaultHoldSec) || 30}" /></label>
    <label class="field">Min hold (seconds, optional) <input name="minHoldSec" type="number" min="1" max="600" value="${f.minHoldSec ? Number(f.minHoldSec) : ''}" /></label>
    <label class="field">Tags (comma-separated) <input name="tags" value="${esc(tags(f.tags))}" /></label>
    <label class="field">Discipline <input name="discipline" value="${esc(f.discipline || 'yoga')}" /></label>
    <label class="field">Description <textarea name="description" rows="4">${esc(f.description || '')}</textarea></label>
    <label class="field">Good for <textarea name="goodFor" rows="2">${esc(f.goodFor || '')}</textarea></label>
    <label class="field">Muscles (comma-separated) <input name="muscles" value="${esc(tags(f.muscles))}" /></label>
    <label class="field">Breath cue <input name="breathCue" value="${esc(f.breathCue || '')}" /></label>
    <label class="field">Transition in <input name="transitionIn" value="${esc(f.transitionIn || '')}" /></label>
    <label class="field">Gaze / drishti <input name="drishti" value="${esc(f.drishti || '')}" /></label>
    <label class="field">Base pose id <input name="basePoseId" value="${esc(f.basePoseId || '')}" placeholder="e.g. warrior-ii" /></label>
    <label class="field">Props (one per line) <textarea name="props" rows="2">${esc(list(f.props))}</textarea></label>
    <label class="field">Modifications (one per line) <textarea name="modifications" rows="3">${esc(list(f.modifications))}</textarea></label>
    <label class="field">Deepen (one per line) <textarea name="deepen" rows="2">${esc(list(f.deepen))}</textarea></label>
    <label class="field">Avoid if (one per line) <textarea name="avoidIf" rows="2">${esc(list(f.avoidIf))}</textarea></label>
    <label class="field">Common mistakes (one per line) <textarea name="commonMistakes" rows="2">${esc(list(f.commonMistakes))}</textarea></label>
    <label class="field">Alignment cues (one per line) <textarea name="alignmentCues" rows="2">${esc(list(f.alignmentCues))}</textarea></label>
    <label class="field">Credit as <input name="creditName" value="${esc(f._creditName || '')}" required /></label>
    <label class="field check"><input name="licence" type="checkbox" required /> I agree this suggestion can be used under CC BY-SA 4.0</label>
  `
}

function readForm(form) {
  const g = (n) => form.elements.namedItem(n)
  const intensity = Math.min(5, Math.max(1, Number(g('intensity')?.value) || 2))
  const minRaw = g('minHoldSec')?.value
  return {
    fields: {
      name: String(g('name')?.value || '').trim(),
      sanskrit: String(g('sanskrit')?.value || '').trim(),
      chineseName: String(g('chineseName')?.value || '').trim(),
      altNames: csv(g('altNames')?.value),
      category: String(g('category')?.value || 'standing'),
      tags: csv(g('tags')?.value),
      discipline: String(g('discipline')?.value || 'yoga').trim() || 'yoga',
      intensity,
      description: String(g('description')?.value || '').trim(),
      goodFor: String(g('goodFor')?.value || '').trim(),
      muscles: csv(g('muscles')?.value),
      breathCue: String(g('breathCue')?.value || '').trim(),
      transitionIn: String(g('transitionIn')?.value || '').trim(),
      drishti: String(g('drishti')?.value || '').trim(),
      basePoseId: String(g('basePoseId')?.value || '').trim(),
      props: lines(g('props')?.value),
      modifications: lines(g('modifications')?.value),
      deepen: lines(g('deepen')?.value),
      avoidIf: lines(g('avoidIf')?.value),
      commonMistakes: lines(g('commonMistakes')?.value),
      alignmentCues: lines(g('alignmentCues')?.value),
      defaultHoldSec: Math.min(600, Math.max(1, Number(g('defaultHoldSec')?.value) || 30)),
      ...(minRaw ? { minHoldSec: Math.min(600, Math.max(1, Number(minRaw) || 1)) } : {}),
    },
    creditName: String(g('creditName')?.value || '').trim(),
    licenceAccepted: Boolean(g('licence')?.checked),
  }
}

/**
 * Opens the metadata dialog. Resolves with { fields, creditName, licenceAccepted } or null if cancelled.
 * @param {{ title: string, fields: object, creditName: string, requireLicence?: boolean }} opts
 */
export function openMetaDialog(opts) {
  return new Promise((resolve) => {
    const existing = document.getElementById('meta-dialog')
    if (existing) existing.remove()
    const seed = store.emptyFields(opts.fields || {})
    seed._creditName = opts.creditName || ''
    const dlg = document.createElement('dialog')
    dlg.id = 'meta-dialog'
    dlg.className = 'meta-dialog'
    dlg.innerHTML = `
      <form method="dialog" id="meta-form">
        <header class="meta-head">
          <h2>${esc(opts.title || 'Pose details')}</h2>
          <button type="submit" value="cancel" class="linkish">Close</button>
        </header>
        <div class="meta-body">${fieldHtml(seed)}</div>
        <footer class="meta-foot">
          <button type="submit" value="cancel">Cancel</button>
          <button type="submit" value="ok" class="primary">Save details</button>
        </footer>
      </form>`
    document.body.appendChild(dlg)
    const form = dlg.querySelector('#meta-form')
    form.addEventListener('submit', (e) => {
      const submitter = e.submitter
      const value = submitter?.value || 'cancel'
      if (value !== 'ok') {
        dlg.close()
        dlg.remove()
        resolve(null)
        return
      }
      e.preventDefault()
      if (!form.reportValidity()) return
      const data = readForm(form)
      if (!data.fields.name) return
      if (opts.requireLicence !== false && !data.licenceAccepted) return
      dlg.close()
      dlg.remove()
      resolve(data)
    })
    dlg.addEventListener('cancel', () => {
      dlg.remove()
      resolve(null)
    })
    dlg.showModal()
  })
}

/** Slug for a new pose id from an English name. */
export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}
