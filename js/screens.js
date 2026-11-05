import { daysBetween } from './dates.js';
import { doneText, dueText, formatDate, formatTime, percent, plural, targetText, weekdayDate } from './format.js';
import { CATEGORY_KEYS, findGoal, goalLists, goalProgress, LIMITS, timeline, todaySections } from './model.js';
import {
  banner,
  button,
  category,
  CATEGORIES,
  checkButton,
  confetti,
  confirm,
  createButton,
  emptyState,
  esc,
  field,
  goalBadge,
  goalShape,
  icon,
  iconButton,
  listGroup,
  listRow,
  menu,
  navBar,
  nextId,
  notice,
  ring,
  rootBar,
  segmented,
  snackbar,
  tabBar,
  tag,
} from './ui.js';

/**
 * The screens, as functions of a view: `{ state, today, platform, route, flags, form, motion, storage, installed,
 * lastBackup, backLabel }`. They only render; app.js handles every `data-action`.
 */

const MAX_FORM_STEPS = 30;

const goalAttrs = (goal, step) => ({ 'data-goal': goal.id, ...(step ? { 'data-step': step.id } : {}) });

const screen = (content, { tab = '', platform = 'ios', fab = false } = {}) =>
  `<div class="screen">${content}${fab && platform === 'android' ? createButton('android') : ''}${tab ? tabBar(tab) : ''}</div>`;

const header = ({ overline = '', title, sub = '' }) =>
  `<header class="screen-header">
    ${overline ? `<p class="screen-header__overline t-overline">${esc(overline)}</p>` : ''}
    <h1 class="screen-header__title t-large-title" tabindex="-1">${esc(title)}</h1>
    ${sub ? `<p class="screen-header__sub t-callout">${esc(sub)}</p>` : ''}
  </header>`;

/** Saving trouble is shown on every main screen: the person must know their changes are not kept. */
function storageBanner(view) {
  const { status, saveError } = view.storage;
  if (saveError) return banner({ text: '<strong>Changes can’t be saved on this phone.</strong> The browser’s storage is full or switched off. Download a backup in Settings before closing the app.' });
  if (status === 'unavailable') return banner({ text: '<strong>This browser doesn’t let the app store anything.</strong> Private browsing may be on. Your goals will be gone when you close it.' });
  if (status === 'recovered') return banner({ iconName: 'info', text: 'Some saved data couldn’t be read, so the app started empty. A copy is kept on this phone: you can download it in Settings.' });
  return '';
}

/* ───────── When things go wrong ───────── */

/** Stored data that can't be read and couldn't be put aside: nothing is saved until the person decides. */
export function recoverScreen() {
  return screen(
    `<div class="screen__content">
      <div class="card section-first">${emptyState({
        iconName: 'triangle-alert',
        title: 'Your saved data can’t be read',
        body: 'The app found data on this phone that it can’t read, and there isn’t room to keep a copy aside. Nothing is saved over it until you choose. Download it to keep it, then start fresh.',
        actions:
          button({ label: 'Download the data', size: 'lg', block: true, iconName: 'download', extra: { 'data-action': 'download-unreadable' } }) +
          button({ label: 'Start fresh', variant: 'secondary', size: 'lg', block: true, iconName: 'rotate-ccw', extra: { 'data-action': 'start-fresh' } }),
      })}</div>
    </div>`,
  );
}

/** Shown if a screen can't be drawn: the data is untouched, the backup and the other tabs stay at hand. */
export function brokenScreen(platform) {
  return screen(
    `${rootBar(platform)}
    ${header({ title: 'Something went wrong' })}
    <div class="screen__content"><div class="card section-first">${emptyState({
      iconName: 'triangle-alert',
      title: 'This screen couldn’t be shown',
      body: 'Your goals are still on this phone. Download a backup to be safe, then try another tab.',
      actions: button({ label: 'Download a backup', size: 'lg', block: true, iconName: 'download', extra: { 'data-action': 'export' } }),
    })}</div></div>`,
    { tab: 'none', platform },
  );
}

/* ───────── Today ───────── */

function stepCard(view, { goal, step }) {
  const ids = nextId('qc');
  const cat = category(goal.category);
  const done = step.doneOn !== null;
  const index = goal.steps.indexOf(step);
  let meta;
  if (done) meta = `<span class="c-done">${icon('circle-check')}${step.doneAt ? `Done today, ${formatTime(step.doneAt)}` : 'Done today'}</span>`;
  else if (step.dueDate) meta = `<span>${icon('calendar')}${esc(dueText(step.dueDate, view.today))}</span>`;
  else meta = `<span>${icon('route')}Step ${index + 1} of ${goal.steps.length}</span>`;
  if (step.note) meta += `<span>${icon('sticky-note')}Note</span>`;
  return `<article class="qcard qcard--${done ? 'done-today' : 'available'}" aria-labelledby="${ids}-t">
    <div class="qcard__lead" aria-hidden="true">${icon(done ? 'check' : cat.icon)}</div>
    <div class="qcard__body">
      <p class="qcard__context t-footnote">${icon(cat.icon)}<span>${esc(goal.title)}</span></p>
      <h3 class="qcard__title t-headline" id="${ids}-t"><a href="#" class="qcard__link" data-action="open-goal" data-goal="${esc(goal.id)}">${esc(step.title)}</a></h3>
      <p class="qcard__meta t-footnote">${meta}</p>
    </div>
    <div class="qcard__action">${checkButton({
      title: step.title,
      done,
      justDone: view.flags.justDone === step.id,
      justCompleted: view.flags.justCompleted === step.id,
      extra: { 'data-action': 'toggle-step', ...goalAttrs(goal, step) },
    })}</div>
  </article>`;
}

function ringTile(view, goal) {
  const { progress, done, total } = goalProgress(goal);
  const cat = category(goal.category);
  const when = goal.targetDate ? `, ${targetText(goal.targetDate, view.today)}` : '';
  return `<li><a class="card ring-tile" href="#" data-action="open-goal" data-goal="${esc(goal.id)}">
    ${ring({ p: progress, center: icon(cat.icon), label: `${goal.title}: ${percent(progress)} complete${when}` })}
    <span><span class="ring-tile__title t-subhead">${esc(goal.title)}</span>
    <span class="ring-tile__meta t-footnote tnum" aria-hidden="true">${percent(progress)} · ${done}/${total}</span></span>
  </a></li>`;
}

function todaySub(state, sections) {
  if (state.goals.length === 0) return 'Set a goal and break it into steps.';
  const { due, upNext, doneToday } = sections;
  if (due.length) return `${plural(due.length, 'step')} due. One at a time.`;
  if (doneToday.length && !upNext.length) return 'Everything’s done for now. Nice work.';
  if (doneToday.length) return `${plural(doneToday.length, 'step')} done today. Keep going.`;
  if (upNext.length) return 'Pick your next step whenever you’re ready.';
  return 'Add steps to your goals to see them here.';
}

export function todayScreen(view) {
  const { state, today, platform } = view;
  const sections = todaySections(state, today);
  const { active } = goalLists(state);
  const cards = (items) => `<div class="stack" style="--gap:12px">${items.map((item) => stepCard(view, item)).join('')}</div>`;
  const banners = storageBanner(view);

  let content;
  if (state.goals.length === 0) {
    content = `<div class="card section-first">${emptyState({
      title: 'Your timeline is empty',
      body: 'Start with one big goal. Break it into small steps you can tick off, and watch the path to it fill up.',
      actions:
        button({ label: 'Create a goal', size: 'lg', block: true, iconName: 'plus', extra: { 'data-action': 'new-goal' } }) +
        button({ label: 'Try an example', variant: 'secondary', size: 'lg', block: true, iconName: 'sparkles', extra: { 'data-action': 'add-example' } }),
    })}</div>`;
  } else {
    const { due, upNext, doneToday } = sections;
    const nothing =
      !due.length && !upNext.length
        ? `<div class="section-first">${notice({
            tone: 'done',
            iconName: 'circle-check',
            title: active.length ? 'Nothing open right now' : 'Every goal reached',
            body: active.length ? 'Add steps to your goals to see what’s next.' : 'Time to set the next one?',
            actions: active.length ? '' : button({ label: 'New goal', variant: 'secondary', size: 'sm', iconName: 'plus', extra: { 'data-action': 'new-goal' } }),
          })}</div>`
        : '';
    content = `${nothing}
      ${due.length ? `<section class="section section-first" aria-labelledby="today-due"><div class="section__header"><h2 class="t-title-3" id="today-due">Due</h2><span class="t-footnote c-secondary">Today or earlier</span></div>${cards(due)}</section>` : ''}
      ${upNext.length ? `<section class="section ${due.length ? '' : 'section-first'}" aria-labelledby="today-next"><div class="section__header"><h2 class="t-title-3" id="today-next">Up next</h2><span class="t-footnote c-secondary">Whenever you’re ready</span></div>${cards(upNext)}</section>` : ''}
      ${doneToday.length ? `<section class="section" aria-labelledby="today-done"><div class="section__header"><h2 class="t-title-3" id="today-done">Done today</h2></div>${cards(doneToday)}</section>` : ''}
      ${
        active.length
          ? `<section class="section" aria-labelledby="today-goals"><div class="section__header"><h2 class="t-title-3" id="today-goals">Goals</h2><a href="#" class="btn btn--text btn--sm" data-action="tab" data-tab="goals">See all</a></div><ul class="ring-grid">${active.map((goal) => ringTile(view, goal)).join('')}</ul></section>`
          : ''
      }`;
  }

  return screen(
    `${platform === 'android' ? '' : createButton('ios')}
    ${header({ overline: weekdayDate(today), title: 'Today', sub: todaySub(state, sections) })}
    <div class="screen__content">${banners ? `<div class="section-first">${banners}</div>` : ''}${content}</div>`,
    { tab: 'today', platform, fab: true },
  );
}

/* ───────── Goals ───────── */

function goalCard(view, goal) {
  const cat = category(goal.category);
  const p = goalProgress(goal);
  if (p.complete) {
    return `<li><a class="card acard" href="#" data-action="open-goal" data-goal="${esc(goal.id)}">
      ${goalBadge({ iconName: cat.icon, size: 56, label: 'Reached' })}
      <span class="acard__body"><span class="acard__title t-headline">${esc(goal.title)}</span>
      <span class="acard__meta t-footnote">${tag('Reached', 'done', 'check')}<span class="tnum">${formatDate(goal.completedOn)}</span><span class="dot-sep"></span><span class="tnum">${plural(p.total, 'step')}</span></span></span>
      <span class="acard__chev" aria-hidden="true">${icon('chevron-right')}</span>
    </a></li>`;
  }
  const next = p.current ? `Next: ${esc(p.current.title)}` : 'Add the first step';
  return `<li><a class="card acard" href="#" data-action="open-goal" data-goal="${esc(goal.id)}">
    ${ring({ p: p.progress, center: icon(cat.icon) })}
    <span class="acard__body"><span class="acard__title t-headline">${esc(goal.title)}</span>
    <span class="acard__meta t-footnote"><span class="tnum">${percent(p.progress)}<span class="sr-only"> complete,</span></span><span class="dot-sep"></span><span class="tnum">${p.done} of ${plural(p.total, 'step')}</span><span class="dot-sep"></span><span class="tnum">${goal.targetDate ? esc(targetText(goal.targetDate, view.today)) : 'No target date'}</span></span>
    <span class="acard__next t-footnote">${next}</span></span>
    <span class="acard__chev" aria-hidden="true">${icon('chevron-right')}</span>
  </a></li>`;
}

export function goalsScreen(view) {
  const { state, platform } = view;
  const { active, completed } = goalLists(state);
  const filter = view.route.filter === 'reached' ? 'reached' : 'open';
  const list = filter === 'reached' ? completed : active;
  const empty =
    filter === 'reached'
      ? emptyState({ iconName: 'trophy', title: 'Nothing reached yet', body: 'When every step of a goal is done, it lands here.' })
      : emptyState({
          title: 'No open goals',
          body: 'Set a goal and break it into steps.',
          actions: button({ label: 'Create a goal', size: 'lg', block: true, iconName: 'plus', extra: { 'data-action': 'new-goal' } }),
        });
  return screen(
    `${platform === 'android' ? '' : createButton('ios')}
    ${header({ overline: `${active.length} open · ${completed.length} reached`, title: 'Goals' })}
    <div class="screen__content">
      <div class="section-first">${segmented({
        label: 'Show goals',
        selected: filter,
        action: 'filter',
        options: [
          ['open', `Open (${active.length})`],
          ['reached', `Reached (${completed.length})`],
        ],
      })}</div>
      <div class="section-first">${list.length ? `<ul class="acard-list">${list.map((goal) => goalCard(view, goal)).join('')}</ul>` : `<div class="card">${empty}</div>`}</div>
    </div>`,
    { tab: 'goals', platform, fab: true },
  );
}

/* ───────── Goal detail and its timeline ───────── */

function timingText(goal) {
  if (!goal.targetDate || !goal.completedOn) return '';
  const late = daysBetween(goal.targetDate, goal.completedOn);
  return late <= 0 ? 'On time' : `${plural(late, 'day')} after the target date`;
}

function timelineList(view, goal) {
  const { today, flags } = view;
  const items = timeline(goal).map((item) => {
    const seg = `${item.segTop ? 'seg-top-done' : ''} ${item.segBottom ? 'seg-bottom-done' : ''}`;
    if (item.kind === 'start') {
      return `<li class="qpath__item is-first ${seg}">
        <div class="qpath__node-slot"><span class="pnode pnode--start" aria-hidden="true"></span></div>
        <div class="qpath__card qpath__card--plain t-footnote c-secondary tl-start">${icon('flag', 'icon--sm')}<span>Started ${formatDate(item.date)}</span></div>
      </li>`;
    }
    if (item.kind === 'goal') {
      const body = item.complete
        ? `<h3 class="t-headline">Reached ${formatDate(item.completedOn)}</h3><p class="t-footnote c-secondary">${esc(timingText(goal) || 'Every step done.')}</p>`
        : `<h3 class="t-headline">Reach “${esc(goal.title)}”</h3><p class="t-footnote c-secondary">${item.targetDate ? `Target ${formatDate(item.targetDate)} · ${esc(targetText(item.targetDate, today))}` : 'Finish every step to reach it.'}</p>`;
      return `<li class="qpath__item is-last ${seg}">
        <div class="qpath__node-slot"><span class="pnode pnode--goal ${item.complete ? 'pnode--goal-done' : ''}" aria-hidden="true">${goalShape()}${icon('trophy', 'icon--md')}</span></div>
        <div class="qpath__card qpath__card--plain">${body}</div>
      </li>`;
    }
    const { step, index } = item;
    const kind = item.state === 'open' ? 'available' : item.state;
    const node = item.state === 'done' ? icon('check') : item.state === 'current' ? icon('map-pin') : `<span class="pnode__num tnum">${index + 1}</span>`;
    const spoken = { done: 'Done', current: 'Current step', open: 'Open' }[item.state];
    const when =
      item.state === 'done'
        ? tag(doneText(step.doneOn, today), 'done', 'check')
        : step.dueDate
          ? `<span class="tl-due t-footnote">${icon('calendar', 'icon--sm')}${esc(dueText(step.dueDate, today))}</span>`
          : '';
    const current = item.state === 'current' ? tag('Current', 'active', 'map-pin') : '';
    return `<li class="qpath__item qpath__item--${kind} ${seg}"${item.state === 'current' ? ' aria-current="step"' : ''}>
      <div class="qpath__node-slot"><span class="pnode pnode--${kind}" aria-hidden="true">${node}</span></div>
      <div class="qpath__card tl-card">
        <div class="tl-card__body">
          <h3 class="qpath__title t-headline"><a href="#" class="tl-card__link" data-action="edit-step"${Object.entries(goalAttrs(goal, step))
            .map(([k, v]) => ` ${k}="${esc(v)}"`)
            .join('')}><span class="sr-only">${spoken}: </span>${esc(step.title)}</a></h3>
          ${current || when ? `<div class="qpath__state">${current}${when}</div>` : ''}
          ${step.note ? `<p class="tl-note t-footnote">${icon('sticky-note', 'icon--sm')}<span>${esc(step.note)}</span></p>` : ''}
        </div>
        ${checkButton({
          title: step.title,
          done: item.state === 'done',
          justDone: flags.justDone === step.id,
          justCompleted: flags.justCompleted === step.id,
          extra: { 'data-action': 'toggle-step', ...goalAttrs(goal, step) },
        })}
      </div>
    </li>`;
  });
  return `<ol class="qpath tl" aria-label="Timeline">${items.join('')}</ol>`;
}

export function goalScreen(view) {
  const { state, today, route } = view;
  const goal = findGoal(state, route.goalId);
  if (!goal) {
    return screen(
      `${navBar({ back: view.backLabel })}<div class="screen__content"><div class="card section-first">${emptyState({ iconName: 'circle-help', title: 'This goal is gone', body: 'It was deleted on this phone.' })}</div></div>`,
      { tab: route.tab ?? 'goals' },
    );
  }
  const cat = category(goal.category);
  const p = goalProgress(goal);
  const ids = nextId('gd');
  const actions =
    iconButton({ iconName: 'pencil', label: 'Edit goal', extra: { 'data-action': 'edit-goal', 'data-goal': goal.id } }) +
    iconButton({ iconName: 'ellipsis', label: 'More actions', extra: { 'data-action': 'goal-menu', 'data-goal': goal.id, 'aria-haspopup': 'menu' } });
  const dateLine = p.complete
    ? `Reached ${formatDate(goal.completedOn)}${goal.targetDate ? ` · ${esc(timingText(goal))}` : ''}`
    : goal.targetDate
      ? `Target ${formatDate(goal.targetDate)} · ${esc(targetText(goal.targetDate, today))}`
      : 'No target date';
  const daysIn = Math.max(0, daysBetween(goal.createdOn, p.complete ? goal.completedOn : today));
  const time = p.complete ? [daysIn === 0 ? 'Same day' : plural(daysIn, 'day'), 'from start to goal'] : [`Day ${daysIn + 1}`, 'on this goal'];
  const progressCard = `<div class="card progress-card" role="group" aria-label="Progress">
    ${ring({
      p: p.progress,
      size: 'lg',
      variant: p.complete ? 'done' : '',
      center: p.complete
        ? `<span class="c-done">${icon('check', 'icon--lg')}</span><span class="t-caption c-secondary">reached</span>`
        : `<span class="t-stat">${percent(p.progress)}</span><span class="t-caption c-secondary">complete</span>`,
      label: p.complete ? `${goal.title}: reached` : `${goal.title}: ${percent(p.progress)} complete`,
    })}
    <ul class="progress-card__stats">
      <li>${icon('circle-check', 'icon--md c-done')}<span><span class="t-headline tnum">${p.done} of ${p.total}</span><span class="t-footnote c-secondary"> steps done</span></span></li>
      <li>${icon('calendar-clock', 'icon--md c-accent')}<span>${
        p.nextDue
          ? `<span class="t-headline">${esc(dueText(p.nextDue.dueDate, today))}</span><span class="t-footnote c-secondary"> next due date</span>`
          : `<span class="t-headline" aria-hidden="true">—</span><span class="t-footnote c-secondary"> no due dates ahead</span>`
      }</span></li>
      <li>${icon('flag', 'icon--md c-secondary')}<span><span class="t-headline tnum">${time[0]}</span><span class="t-footnote c-secondary"> ${time[1]}</span></span></li>
    </ul>
  </div>`;
  const nextCard =
    p.current && !p.complete
      ? `<div class="card card--accent next-card section-gap" role="group" aria-labelledby="${ids}-n">
          <p class="t-overline c-accent">Next step</p>
          <h2 class="t-title-3 next-card__title" id="${ids}-n">${esc(p.current.title)}</h2>
          <p class="next-card__meta t-footnote c-secondary">${icon('calendar', 'icon--sm')}<span>${p.current.dueDate ? esc(dueText(p.current.dueDate, today)) : 'No due date'}</span></p>
          <div class="next-card__action">${button({ label: 'Mark as done', size: 'lg', block: true, iconName: 'check', extra: { 'data-action': 'toggle-step', ...goalAttrs(goal, p.current) } })}</div>
        </div>`
      : '';
  const steps = p.total
    ? timelineList(view, goal)
    : `<div class="card">${emptyState({ title: 'Break it into steps', body: 'What’s the first thing to do? Small steps are easier to tick off.' })}</div>`;
  return screen(
    `${navBar({ back: view.backLabel, actions })}
    <div class="screen__content">
      <header class="detail-head">
        <div class="row tag-row">${tag(cat.label, 'outline', cat.icon)}${p.complete ? tag('Reached', 'done', 'check') : ''}</div>
        <h1 class="t-brand-title detail-title" tabindex="-1">${esc(goal.title)}</h1>
        ${goal.why ? `<p class="detail-head__why"><span class="sr-only">Why it matters: </span>${esc(goal.why)}</p>` : ''}
        <p class="detail-head__meta t-footnote">${icon('calendar', 'icon--sm')}<span class="tnum">${dateLine}</span></p>
      </header>
      <div class="section-gap-lg">${progressCard}</div>
      ${nextCard}
      <section class="section" aria-labelledby="${ids}-tl">
        <div class="section__header"><h2 class="t-title-3" id="${ids}-tl">Timeline</h2>${p.total ? `<span class="t-footnote c-secondary tnum">${p.done} of ${p.total} done</span>` : ''}</div>
        ${steps}
        <div class="section-gap-lg">${button({ label: p.total ? 'Add step' : 'Add the first step', variant: p.total ? 'secondary' : 'primary', block: true, iconName: 'plus', extra: { 'data-action': 'add-step', 'data-goal': goal.id } })}</div>
      </section>
    </div>`,
    { tab: route.tab ?? 'goals' },
  );
}

/* ───────── Forms ───────── */

const formTop = (view, title, context = '') =>
  `${navBar({ back: 'Cancel', backIcon: 'x' })}
  <div class="form-head">
    ${context}
    <h1 class="t-title-1" tabindex="-1">${esc(title)}</h1>
  </div>`;

function stepRow(value, index) {
  const ids = nextId('sr');
  return `<div class="field__control step-row">
    <span class="step-row__num tnum" aria-hidden="true">${index + 1}</span>
    <input id="${ids}" name="step" value="${esc(value)}" maxlength="${LIMITS.stepTitle}" placeholder="${index === 0 ? 'e.g. Buy running shoes' : `Step ${index + 1}`}" aria-label="Step ${index + 1}" autocomplete="off" autocapitalize="sentences" enterkeyhint="next">
  </div>`;
}

export function stepRowHtml(index) {
  return stepRow('', index);
}

export function goalFormScreen(view) {
  const { route, state } = view;
  const goal = route.goalId ? findGoal(state, route.goalId) : null;
  const editing = goal !== null && goal !== undefined;
  const values = view.form?.values ?? (editing ? { ...goal, targetDate: goal.targetDate ?? '' } : { title: '', why: '', category: 'custom', targetDate: '', steps: ['', '', ''] });
  const errors = view.form?.errors ?? {};
  const chips = CATEGORY_KEYS.map((key) => {
    const cat = CATEGORIES[key];
    const on = values.category === key;
    return `<button type="button" class="chip" role="radio" aria-checked="${on}" data-action="pick-category" data-value="${key}">${icon(cat.icon)}<span>${esc(cat.label)}</span></button>`;
  }).join('');
  const stepsBlock = editing
    ? ''
    : `<fieldset class="field form-fieldset">
        <legend class="field__label">First steps <span class="field__optional">(optional)</span></legend>
        <div class="stack step-rows" style="--gap:8px" id="step-rows">${(values.steps?.length ? values.steps : ['']).map(stepRow).join('')}</div>
        <div>${button({ label: 'Add another step', variant: 'text', size: 'sm', iconName: 'plus', extra: { 'data-action': 'add-step-row', 'data-max': MAX_FORM_STEPS } })}</div>
        <p class="field__helper t-footnote">Due dates and notes can be added to each step later.</p>
      </fieldset>`;
  return screen(
    `${formTop(view, editing ? 'Edit goal' : 'New goal')}
    <form class="screen__content form" data-form="goal" novalidate>
      ${field({ label: 'Goal', name: 'title', value: values.title, placeholder: 'e.g. Run my first 10 km race', error: errors.title, maxlength: LIMITS.goalTitle, enterkeyhint: 'next' })}
      <fieldset class="field form-fieldset">
        <legend class="field__label">Category</legend>
        <div class="chip-wrap" role="radiogroup" aria-label="Category">${chips}</div>
        <input type="hidden" name="category" value="${esc(values.category)}">
      </fieldset>
      ${field({ label: 'Why it matters', name: 'why', value: values.why, area: true, optional: true, placeholder: 'What will reaching it change for you?', error: errors.why, maxlength: LIMITS.why })}
      ${field({ label: 'Target date', name: 'targetDate', type: 'date', value: values.targetDate, optional: true, clearable: true, helper: 'The day you’d like to reach it by.', error: errors.targetDate })}
      ${stepsBlock}
      <div class="form-actions">${button({ label: editing ? 'Save' : 'Create goal', type: 'submit', size: 'lg', block: true, iconName: editing ? 'check' : 'plus' })}</div>
    </form>`,
  );
}

export function stepFormScreen(view) {
  const { route, state, today } = view;
  const goal = findGoal(state, route.goalId);
  if (!goal) return goalScreen(view);
  const step = route.stepId ? goal.steps.find((s) => s.id === route.stepId) : null;
  const editing = step !== null && step !== undefined;
  const values = view.form?.values ?? (editing ? { title: step.title, dueDate: step.dueDate ?? '', note: step.note } : { title: '', dueDate: '', note: '' });
  const errors = view.form?.errors ?? {};
  const cat = category(goal.category);
  const index = editing ? goal.steps.indexOf(step) : -1;
  const done = editing && step.doneOn !== null;
  const manage = editing
    ? `<div class="section">${listGroup({
        title: `Step ${index + 1} of ${goal.steps.length}`,
        rows: [
          listRow({
            iconName: done ? 'rotate-ccw' : 'circle-check',
            tone: done ? '' : 'done',
            label: done ? 'Mark as not done' : 'Mark as done',
            sub: done ? esc(doneText(step.doneOn, today)) : 'Not done yet',
            extra: { 'data-action': 'toggle-step', ...goalAttrs(goal, step) },
          }),
          ...(index > 0 ? [listRow({ iconName: 'arrow-up', label: 'Move earlier', sub: 'One place up the timeline', extra: { 'data-action': 'move-step', 'data-delta': '-1', ...goalAttrs(goal, step) } })] : []),
          ...(index < goal.steps.length - 1 ? [listRow({ iconName: 'arrow-down', label: 'Move later', sub: 'One place down the timeline', extra: { 'data-action': 'move-step', 'data-delta': '1', ...goalAttrs(goal, step) } })] : []),
          listRow({ iconName: 'trash-2', tone: 'danger', danger: true, label: 'Delete step', extra: { 'data-action': 'delete-step', ...goalAttrs(goal, step) } }),
        ],
      })}</div>`
    : '';
  return screen(
    `${formTop(view, editing ? 'Edit step' : 'New step', `<p class="form-context t-footnote c-secondary">${icon(cat.icon, 'icon--sm')}<span>${esc(goal.title)}</span></p>`)}
    <form class="screen__content form" data-form="step" novalidate>
      ${field({ label: 'Step', name: 'title', value: values.title, placeholder: 'e.g. Run 5 km without stopping', error: errors.title, maxlength: LIMITS.stepTitle, enterkeyhint: 'done' })}
      ${field({ label: 'Due date', name: 'dueDate', type: 'date', value: values.dueDate, optional: true, clearable: true, error: errors.dueDate })}
      ${field({ label: 'Note', name: 'note', value: values.note, area: true, optional: true, placeholder: 'Anything worth remembering?', error: errors.note, maxlength: LIMITS.note })}
      <div class="form-actions">${button({ label: editing ? 'Save' : 'Add step', type: 'submit', size: 'lg', block: true, iconName: editing ? 'check' : 'plus' })}</div>
      ${manage}
    </form>`,
  );
}

/* ───────── Settings ───────── */

const INSTALL_STEPS = {
  ios: 'In Safari, tap <strong>Share</strong> (the square with the arrow), then <strong>Add to Home Screen</strong>. Open the app from there from now on: it keeps its own storage.',
  android: 'In Chrome, open the <strong>⋮</strong> menu and tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>).',
};

export function settingsScreen(view) {
  const { state, platform, storage, installed, lastBackup } = view;
  const steps = state.goals.reduce((sum, goal) => sum + goal.steps.length, 0);
  const persisted = storage.persisted === true ? 'Yes' : storage.persisted === false ? 'Not yet' : 'Unknown';
  const backupFooter = lastBackup
    ? `Last backup: ${formatDate(lastBackup)}. Keep backups somewhere other than this phone.`
    : 'No backup yet. Your goals live only in this browser on this phone: if it is lost or its website data is cleared, they are gone.';
  return screen(
    `${rootBar(platform)}
    ${header({ title: 'Settings', sub: `${plural(state.goals.length, 'goal')} · ${plural(steps, 'step')} on this phone` })}
    <div class="screen__content">
      <div class="section-first">${listGroup({
        title: 'Your data',
        rows: [
          listRow({ kind: 'static', iconName: 'smartphone', tone: 'accent', label: 'Stored only on this phone', sub: 'No account, no server. Nothing you enter leaves this browser.' }),
          listRow({
            kind: 'static',
            iconName: 'shield-check',
            label: 'Kept safe from clean-up',
            sub: storage.persisted === true ? 'The browser won’t clear this data to free up space.' : 'Install the app (below) so the browser keeps your data.',
            value: persisted,
          }),
          listRow({ iconName: 'download', label: 'Download a backup', sub: 'A file with all your goals and steps.', extra: { 'data-action': 'export' } }),
          listRow({ iconName: 'history', label: 'Restore a backup', sub: 'Replaces what’s on this phone with the file.', extra: { 'data-action': 'import' } }),
          ...(view.asideCopies
            ? [listRow({ iconName: 'file-down', tone: 'accent', label: 'Download unreadable data', sub: 'Data the app couldn’t read was kept aside on this phone.', extra: { 'data-action': 'download-aside' } })]
            : []),
        ],
        footer: esc(backupFooter),
      })}</div>
      <div class="section">${listGroup({
        title: 'On your home screen',
        rows: installed
          ? [listRow({ kind: 'static', iconName: 'circle-check', tone: 'done', label: 'Installed', sub: 'You’re using the app from your home screen.' })]
          : [listRow({ kind: 'static', iconName: 'smartphone', label: 'Install the app', sub: INSTALL_STEPS[platform] })],
      })}</div>
      <div class="section">${listGroup({
        title: 'Try it out',
        rows: [listRow({ iconName: 'sparkles', tone: 'accent', label: 'Add an example goal', sub: 'A goal that’s already under way, to see the timeline.', extra: { 'data-action': 'add-example' } })],
      })}</div>
      <div class="section">${listGroup({
        title: 'Start over',
        rows: [listRow({ iconName: 'trash-2', tone: 'danger', danger: true, label: 'Delete all data', sub: 'Removes every goal and step from this phone.', extra: { 'data-action': 'delete-all' } })],
      })}</div>
      <div class="section">${listGroup({
        title: 'About',
        rows: [
          listRow({ kind: 'static', iconName: 'flag', label: 'Questline Pocket', sub: 'Goals, steps and a timeline — just for you.', value: `v${esc(view.version)}` }),
          listRow({ kind: 'link', iconName: 'type', label: 'Fraunces font licence', extra: { href: 'LICENSES/Fraunces-OFL.txt', target: '_blank', rel: 'noopener' } }),
          listRow({ kind: 'link', iconName: 'image', label: 'Lucide icons licence', extra: { href: 'LICENSES/Lucide-ISC.txt', target: '_blank', rel: 'noopener' } }),
        ],
      })}</div>
    </div>`,
    { tab: 'settings', platform },
  );
}

/* ───────── Overlays ───────── */

export function reachedOverlay(view, goal) {
  const ids = nextId('rc');
  const cat = category(goal.category);
  const { total } = goalProgress(goal);
  const days = Math.max(0, daysBetween(goal.createdOn, goal.completedOn));
  return `<div class="unlock" role="dialog" aria-modal="true" aria-labelledby="${ids}-t" aria-describedby="${ids}-d">
    ${view.motion ? confetti() : ''}
    <div class="unlock__glow" aria-hidden="true"></div>
    <div class="unlock__content">
      <p class="t-overline c-accent">Goal reached</p>
      <div class="unlock__badge">${goalBadge({ iconName: cat.icon, size: 156, label: `Goal reached: ${goal.title}` })}</div>
      <h2 class="t-brand-large unlock__title" id="${ids}-t">${esc(goal.title)}</h2>
      <div id="${ids}-d" class="unlock__desc">
        ${goal.why ? `<p class="t-callout c-secondary unlock__why">“${esc(goal.why)}”</p>` : ''}
        <ul class="unlock__sum">
          <li><span class="t-subhead c-secondary">Steps done</span><span class="t-headline tnum">${total}</span></li>
          <li><span class="t-subhead c-secondary">Time it took</span><span class="t-headline tnum">${days === 0 ? 'Same day' : plural(days, 'day')}</span></li>
          ${goal.targetDate ? `<li><span class="t-subhead c-secondary">Target date</span><span class="t-headline">${esc(timingText(goal))}</span></li>` : ''}
        </ul>
      </div>
      <div class="stack unlock__actions" style="--gap:8px">${button({ label: 'Continue', size: 'lg', block: true, extra: { 'data-action': 'close-overlay', 'data-autofocus': true } })}</div>
    </div>
  </div>`;
}

export function overlayHtml(view) {
  const { overlay, platform, state } = view;
  if (!overlay) return '';
  const goal = overlay.goalId ? findGoal(state, overlay.goalId) : null;
  switch (overlay.type) {
    case 'reached':
      return goal ? reachedOverlay(view, goal) : '';
    case 'goal-menu':
      return goal
        ? menu(
            [
              { icon: 'calendar-days', label: 'Sort steps by due date', attrs: { 'data-action': 'sort-steps', 'data-goal': goal.id } },
              '-',
              { icon: 'trash-2', label: 'Delete goal…', danger: true, attrs: { 'data-action': 'delete-goal', 'data-goal': goal.id } },
            ],
            { label: `Actions for ${goal.title}` },
          )
        : '';
    case 'confirm-delete-goal':
      return goal
        ? confirm({
            platform,
            title: `Delete “${goal.title}”?`,
            message: `The goal and its ${plural(goal.steps.length, 'step')} are removed from this phone.`,
            action: 'Delete goal',
            actionAttrs: { 'data-action': 'confirm-delete-goal', 'data-goal': goal.id },
          })
        : '';
    case 'confirm-delete-step': {
      const step = goal?.steps.find((s) => s.id === overlay.stepId);
      return step
        ? confirm({
            platform,
            title: 'Delete this step?',
            message: `“${step.title}”${step.note ? ' and its note' : ''} will be removed from the timeline.`,
            action: 'Delete step',
            actionAttrs: { 'data-action': 'confirm-delete-step', 'data-goal': goal.id, 'data-step': step.id },
          })
        : '';
    }
    case 'confirm-import': {
      const goals = overlay.backup.goals.length;
      const steps = overlay.backup.goals.reduce((sum, g) => sum + g.steps.length, 0);
      return confirm({
        platform,
        title: 'Restore this backup?',
        message: `It holds ${plural(goals, 'goal')} with ${plural(steps, 'step')}. Everything on this phone now is replaced.`,
        action: 'Replace my data',
        actionAttrs: { 'data-action': 'confirm-import' },
      });
    }
    case 'confirm-delete-all':
      return confirm({
        platform,
        title: 'Delete all data?',
        message: 'Every goal and step on this phone is deleted. Download a backup first if you may want them back.',
        action: 'Delete everything',
        actionAttrs: { 'data-action': 'confirm-delete-all' },
      });
    case 'confirm-start-fresh':
      return confirm({
        platform,
        title: 'Start fresh?',
        message: 'The data that can’t be read is deleted from this phone. Download it first if you want to keep it.',
        action: 'Delete and start fresh',
        actionAttrs: { 'data-action': 'confirm-start-fresh' },
      });
    default:
      return '';
  }
}

export function snackHtml(snack) {
  if (!snack) return '';
  return snackbar({ text: snack.text, iconName: snack.iconName ?? 'circle-check', action: snack.undo ? 'Undo' : '', actionAttrs: { 'data-action': 'undo' } });
}
