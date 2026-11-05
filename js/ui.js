import { ICONS } from './icons.js';

/**
 * Questline UI components as HTML-string renderers, adapted from the Questline design package
 * (docs/design/assets/js/ui.js and ui-more.js): the same classes, roles, labels and 48 pt targets. Every piece of
 * the person's own text goes through `esc`, because the screens are rendered with innerHTML.
 */

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let uid = 0;
export const nextId = (prefix = 'ql') => `${prefix}-${(uid += 1)}`;

export const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;

export const attrs = (obj = {}) =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join('');

export const CATEGORIES = Object.freeze({
  study: { label: 'Study', icon: 'graduation-cap' },
  health: { label: 'Health & Fitness', icon: 'heart-pulse' },
  independence: { label: 'Independence', icon: 'key-round' },
  career: { label: 'Career', icon: 'briefcase-business' },
  finance: { label: 'Finance', icon: 'piggy-bank' },
  custom: { label: 'Other', icon: 'compass' },
});

export const category = (key) => CATEGORIES[key] ?? CATEGORIES.custom;

export const tag = (label, variant = '', iconName = '') =>
  `<span class="tag ${variant ? `tag--${variant}` : ''}">${iconName ? icon(iconName) : ''}${esc(label)}</span>`;

export const button = ({ label, variant = 'primary', size = '', iconName = '', block = false, type = 'button', extra = {} }) =>
  `<button type="${type}" class="btn btn--${variant} ${size ? `btn--${size}` : ''} ${block ? 'btn--block' : ''}"${attrs(extra)}>${iconName ? icon(iconName) : ''}<span>${esc(label)}</span></button>`;

export const iconButton = ({ iconName, label, variant = '', extra = {} }) =>
  `<button type="button" class="icon-btn ${variant ? `icon-btn--${variant}` : ''}"${attrs({ 'aria-label': label, ...extra })}>${icon(iconName)}</button>`;

/** The one-tap toggle: its name stays "Mark as done: …", the pressed state says whether it is done. */
export const checkButton = ({ title, done, justDone = false, justCompleted = false, extra = {} }) => {
  const motion = justCompleted ? 'check--just-done check--just-completed' : justDone ? 'check--just-done' : '';
  return `<button type="button" class="check ${done ? 'check--done' : ''} ${motion}"${attrs({
    'aria-label': `Mark as done: ${title}`,
    'aria-pressed': String(done),
    ...extra,
  })}>${icon('check')}</button>`;
};

const RING_GEOMETRY = { sm: [44, 6], md: [72, 7], lg: [128, 10] };

/** Progress ring, `p` in 0…1; `label` is what a screen reader hears for the whole ring. */
export const ring = ({ p = 0, size = 'md', center = '', label = '', variant = '' }) => {
  const [px, stroke] = RING_GEOMETRY[size];
  const r = (px - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(1, p)));
  const a11y = label ? ` role="img"${attrs({ 'aria-label': label })}` : ' aria-hidden="true"';
  return `<div class="ring ring--${size} ${variant ? `ring--${variant}` : ''}"${a11y}>
    <svg viewBox="0 0 ${px} ${px}" aria-hidden="true">
      <circle class="ring__track" cx="${px / 2}" cy="${px / 2}" r="${r}" stroke-width="${stroke}"></circle>
      ${p > 0 ? `<circle class="ring__fill" cx="${px / 2}" cy="${px / 2}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>` : ''}
    </svg>
    <span class="ring__center" aria-hidden="true">${center}</span>
  </div>`;
};

export const bar = ({ p = 0, cls = '', label = '', valueText = '' }) =>
  `<div class="bar ${cls}"${
    label ? attrs({ role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(p * 100), 'aria-valuetext': valueText || undefined }) : ' aria-hidden="true"'
  }><div class="bar__fill" style="--p:${Math.max(0, Math.min(1, p)).toFixed(4)}"></div></div>`;

/** Hexagon of the badge and the goal marker; viewBox 0 0 100 108. */
export const HEX = (r, cx = 50, cy = 54) =>
  [-90, -30, 30, 90, 150, 210]
    .map((deg) => {
      const rad = (deg * Math.PI) / 180;
      return `${(cx + r * Math.cos(rad)).toFixed(2)},${(cy + r * Math.sin(rad)).toFixed(2)}`;
    })
    .join(' ');

/** The honey hexagon of a reached goal (the design's "Unlocked" badge, without ranks). */
export const goalBadge = ({ iconName = 'trophy', size = 88, label = '' }) => {
  const id = nextId('bdg');
  return `<div class="badge" role="img" aria-label="${esc(label || 'Goal reached')}" style="--badge:${size}px">
    <div class="badge__art" aria-hidden="true">
      <svg viewBox="0 -4 100 116">
        <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--rank-unlocked-from)"/><stop offset="1" stop-color="var(--rank-unlocked-to)"/></linearGradient></defs>
        <polygon class="badge__outer" points="${HEX(46)}" fill="url(#${id})" stroke="url(#${id})" stroke-width="8" stroke-linejoin="round"></polygon>
        <polygon class="badge__inner" points="${HEX(35)}" stroke="var(--bg-surface)" stroke-width="6" stroke-linejoin="round"></polygon>
        <polygon class="badge__line" points="${HEX(29)}" stroke="var(--rank-unlocked-to)" stroke-linejoin="round"></polygon>
      </svg>
      <span class="badge__glyph" style="--badge-ink: var(--rank-unlocked-to)">${icon(iconName)}</span>
    </div>
  </div>`;
};

export const goalShape = () => `<svg class="goal-shape" viewBox="0 0 100 108"><path d="M${HEX(46).split(' ').join(' L')} Z"/></svg>`;

/* ───────── Navigation chrome ───────── */

/* Tab icons are drawn so their shapes can fill (iOS fills them; Android fills only the selected one). Lucide, ISC. */
const TAB_ICONS = {
  today:
    '<circle class="f" cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  goals:
    '<path class="f" d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/>',
  settings: ICONS.settings,
};

const TABS = [
  ['today', 'Today'],
  ['goals', 'Goals'],
  ['settings', 'Settings'],
];

export const tabBar = (active) =>
  `<nav class="tabbar glass" aria-label="Main">${TABS.map(
    ([id, text]) =>
      `<a href="#" class="tab" data-action="tab" data-tab="${id}"${attrs({ 'aria-current': id === active ? 'page' : undefined })}><span class="tab__icon"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${TAB_ICONS[id]}</svg></span><span class="tab__label">${esc(text)}</span></a>`,
  ).join('')}</nav>`;

export const navBar = ({ back = 'Back', backIcon = 'chevron-left', actions = '', title = '' }) =>
  `<div class="navbar">
    <a href="#" class="navbar__back glass" data-action="back">${icon(backIcon)}<span class="navbar__back-label t-callout">${esc(back)}</span><span class="sr-only">Back to ${esc(back)}</span></a>
    ${title ? `<span class="navbar__title t-headline">${esc(title)}</span>` : ''}
    <span class="navbar__actions${actions ? ' glass' : ''}">${actions}</span>
  </div>`;

/** iOS root screens keep the bar row above the large title so titles line up across tabs; Android starts with it. */
export const rootBar = (platform, actions = '') =>
  platform === 'android' ? '' : `<div class="navbar navbar--root">${actions ? `<span class="navbar__actions">${actions}</span>` : ''}</div>`;

/** "New goal": iOS — a prominent "+" in the top bar of a root screen; Android — an extended FAB. */
export const createButton = (platform, label = 'New goal') =>
  platform === 'android'
    ? `<div class="fab-wrap"><button type="button" class="fab" data-action="new-goal">${icon('plus')}<span>${esc(label)}</span></button></div>`
    : rootBar('ios', `<button type="button" class="glass-btn glass-btn--prominent" data-action="new-goal" aria-label="${esc(label)}">${icon('plus')}</button>`);

/* ───────── Overlays and feedback ───────── */

const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'for', 'to', 'of', 'on', 'in', 'from', 'with']);
const titleCase = (text) =>
  text
    .split(' ')
    .map((w, i, all) => (i > 0 && i < all.length - 1 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

/**
 * Confirmation of an action the person chose. iOS: an action sheet, the destructive choice on top, Cancel apart at
 * the bottom. Android: a Material 3 dialog, Cancel first. Cancel gets the initial focus on both.
 */
export const confirm = ({ platform, title, message, action, actionAttrs, destructive = true, ids = nextId('cf') }) =>
  platform === 'android'
    ? `<div class="scrim" data-action="close-overlay"></div>
      <div class="mdialog" role="alertdialog" aria-modal="true" aria-labelledby="${ids}-t" aria-describedby="${ids}-d">
        <h2 class="mdialog__title" id="${ids}-t">${esc(title)}</h2>
        <p class="mdialog__msg" id="${ids}-d">${esc(message)}</p>
        <div class="mdialog__actions">
          <button type="button" class="mbtn" data-action="close-overlay" data-autofocus>Cancel</button>
          <button type="button" class="mbtn ${destructive ? 'mbtn--danger' : ''}"${attrs(actionAttrs)}>${esc(action)}</button>
        </div>
      </div>`
    : `<div class="scrim" data-action="close-overlay"></div>
      <div class="asheet" role="alertdialog" aria-modal="true" aria-labelledby="${ids}-t" aria-describedby="${ids}-d">
        <div class="asheet__group">
          <div class="asheet__head"><h2 class="asheet__title" id="${ids}-t">${esc(title)}</h2><p class="asheet__msg" id="${ids}-d">${esc(message)}</p></div>
          <button type="button" class="asheet__btn ${destructive ? 'asheet__btn--destructive' : ''}"${attrs(actionAttrs)}>${esc(titleCase(action))}</button>
        </div>
        <button type="button" class="asheet__btn asheet__cancel" data-action="close-overlay" data-autofocus>Cancel</button>
      </div>`;

export const snackbar = ({ text, action = '', actionAttrs = {}, iconName = 'circle-check' }) =>
  `<div class="snackbar snackbar--floating" role="status" aria-live="polite">
    ${iconName ? icon(iconName) : ''}<p class="snackbar__text t-subhead">${esc(text)}</p>
    ${action ? `<button type="button" class="snackbar__action"${attrs(actionAttrs)}>${esc(action)}</button>` : ''}
  </div>`;

export const banner = ({ iconName = 'triangle-alert', text }) =>
  `<div class="banner" role="status">${icon(iconName)}<p class="banner__text t-subhead">${text}</p></div>`;

/** A menu anchored under the bar's ⋯ button; items are `{ icon, label, attrs, danger }` or '-'. */
export const menu = (items, { label = 'More actions' } = {}) =>
  `<div class="scrim scrim--clear" data-action="close-overlay"></div>
  <div class="popover app-menu"><div class="menu" role="menu" aria-label="${esc(label)}">${items
    .map((it) =>
      it === '-'
        ? '<div class="menu__sep" role="separator"></div>'
        : `<button type="button" role="menuitem" class="menu__item ${it.danger ? 'menu__item--danger' : ''}"${attrs(it.attrs)}>${icon(it.icon)}<span>${esc(it.label)}</span></button>`,
    )
    .join('')}</div></div>`;

/* ───────── Forms ───────── */

export const field = ({
  label,
  name,
  value = '',
  type = 'text',
  placeholder = '',
  helper = '',
  error = '',
  optional = false,
  area = false,
  maxlength,
  enterkeyhint,
  clearable = false,
  ids = nextId('fld'),
}) => {
  const describedBy = helper || error ? `${ids}-h` : undefined;
  const common = { id: ids, name, placeholder: placeholder || undefined, maxlength, 'aria-describedby': describedBy, 'aria-invalid': error ? 'true' : undefined, enterkeyhint };
  const control = area
    ? `<textarea rows="3"${attrs(common)}>${esc(value)}</textarea>`
    : `<input type="${type}" value="${esc(value)}" autocomplete="off"${attrs({ ...common, autocapitalize: type === 'text' ? 'sentences' : undefined })}>`;
  const clear = clearable ? `<button type="button" class="field__clear btn btn--text btn--sm" data-action="clear-field" data-field="${ids}"${value ? '' : ' hidden'}>Clear</button>` : '';
  return `<div class="field ${error ? 'field--error' : ''}">
    <label class="field__label" for="${ids}">${esc(label)}${optional ? ' <span class="field__optional">(optional)</span>' : ''}</label>
    <div class="field__control ${area ? 'field__control--area' : ''} ${type === 'date' ? 'field__control--date' : ''}">${control}${clear}</div>
    ${error ? `<p class="field__helper t-footnote" id="${ids}-h">${icon('circle-alert', 'icon--sm')}<span>${esc(error)}</span></p>` : helper ? `<p class="field__helper t-footnote" id="${ids}-h">${esc(helper)}</p>` : ''}
  </div>`;
};

export const segmented = ({ options, selected, label, action }) =>
  `<div class="seg seg--block" role="group" aria-label="${esc(label)}">${options
    .map(
      ([value, text]) =>
        `<button type="button" class="seg__btn" aria-pressed="${value === selected}"${attrs({ 'data-action': action, 'data-value': value })}><span>${esc(text)}</span></button>`,
    )
    .join('')}</div>`;

/* ───────── Lists, empty and notice ───────── */

export const listRow = ({ iconName = '', label, sub = '', value = '', kind = 'button', danger = false, tone = '', extra = {}, ids = nextId('lr') }) => {
  const lead = iconName ? `<span class="lrow__icon ${tone ? `lrow__icon--${tone}` : ''}" aria-hidden="true">${icon(iconName)}</span>` : '';
  const text = `<span class="lrow__body"><span class="lrow__label t-callout" id="${ids}-l">${esc(label)}</span>${sub ? `<span class="lrow__sub t-footnote">${sub}</span>` : ''}</span>`;
  const valueHtml = value ? `<span class="lrow__value t-subhead">${value}</span>` : '';
  if (kind === 'static') return `<li><div class="lrow">${lead}${text}${valueHtml}</div></li>`;
  if (kind === 'link') return `<li><a class="lrow lrow--action"${attrs(extra)}>${lead}${text}${valueHtml}<span class="lrow__chev" aria-hidden="true">${icon('external-link')}</span></a></li>`;
  return `<li><button type="button" class="lrow lrow--action ${danger ? 'lrow--danger' : ''}"${attrs(extra)}>${lead}${text}${valueHtml}</button></li>`;
};

export const listGroup = ({ title = '', rows = [], footer = '', ids = nextId('lg') }) =>
  `<div class="lgroup"${title ? ` role="group" aria-labelledby="${ids}-t"` : ''}>
    ${title ? `<h2 class="lgroup__title t-overline" id="${ids}-t">${esc(title)}</h2>` : ''}
    <ul class="lgroup__list">${rows.join('')}</ul>
    ${footer ? `<p class="lgroup__footer t-footnote">${footer}</p>` : ''}
  </div>`;

export const pathArt = () =>
  `<svg class="empty__art" viewBox="0 0 160 120" aria-hidden="true">
    <path d="M24 98 C 52 98, 44 60, 80 60 S 112 22, 136 22" class="empty__path"></path>
    <circle cx="24" cy="98" r="7" class="empty__start"></circle>
    <circle cx="68" cy="63" r="6" class="empty__node"></circle>
    <circle cx="98" cy="45" r="6" class="empty__node"></circle>
    <polygon points="${HEX(17, 136, 22)}" class="empty__goal"></polygon>
  </svg>`;

export const emptyState = ({ title, body, actions = '', iconName = '' }) =>
  `<div class="empty">
    ${iconName ? `<span class="empty__icon" aria-hidden="true">${icon(iconName)}</span>` : pathArt()}
    <h2 class="t-title-3">${esc(title)}</h2>
    <p class="t-callout c-secondary">${esc(body)}</p>
    ${actions ? `<div class="empty__actions">${actions}</div>` : ''}
  </div>`;

export const notice = ({ iconName = 'circle-alert', title, body, actions = '', tone = 'neutral' }) =>
  `<div class="card notice notice--${tone}" role="${tone === 'error' ? 'alert' : 'status'}">
    <span class="notice__icon" aria-hidden="true">${icon(iconName)}</span>
    <div class="notice__body"><p class="t-headline">${esc(title)}</p><p class="t-subhead c-secondary">${esc(body)}</p>${actions ? `<div class="notice__actions">${actions}</div>` : ''}</div>
  </div>`;

export const confetti = (n = 26) =>
  `<div class="confetti" aria-hidden="true">${Array.from({ length: n }, (_, i) => {
    const left = (i * 37) % 100;
    const delay = ((i * 113) % 900) / 1000;
    const dur = 1.6 + ((i * 7) % 9) / 10;
    const kind = ['honey', 'moss', 'plum', 'sand'][i % 4];
    return `<span class="confetti__bit confetti__bit--${kind}" style="left:${left}%;animation-delay:${delay}s;animation-duration:${dur}s;--r:${(i * 47) % 360}deg"></span>`;
  }).join('')}</div>`;
