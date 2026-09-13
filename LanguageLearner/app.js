/* Language Learner — Cycling Language Loop
 * Hands-free EN -> DE -> FR text-to-speech with Bluetooth headset controls.
 *
 * Two hard parts, per the spec:
 *   1) A reliable multi-language TTS queue (speak, pause between languages, auto-advance).
 *   2) OS media controls so a double-tap on Bluetooth earphones = "Next phrase".
 *      Hardware media keys only reach a web page that owns an active Media Session,
 *      and a Media Session only exists while real audio is playing. speechSynthesis
 *      does NOT count as media, so we loop a silent audio clip to hold the session
 *      and wire navigator.mediaSession action handlers to our transport functions.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Timing constants (milliseconds)
 * ------------------------------------------------------------------ */
const PAUSE_AFTER_EN = 1000;
const PAUSE_AFTER_DE = 1000;
const PAUSE_AFTER_FR = 2000; // then auto-advance to the next phrase

/* ------------------------------------------------------------------ *
 * DOM references
 * ------------------------------------------------------------------ */
const el = (id) => document.getElementById(id);
const homeScreen   = el('home');
const playerScreen = el('player');
const topicList    = el('topicList');
const courseTitleEl = el('courseTitle');
const playerTopicEl = el('playerTopic');
const progressEl   = el('progress');
const statusEl     = el('status');
const textEn = el('textEn'), textDe = el('textDe'), textFr = el('textFr');
const langRows = {
  en: document.querySelector('.lang-row[data-active="en"]'),
  de: document.querySelector('.lang-row[data-active="de"]'),
  fr: document.querySelector('.lang-row[data-active="fr"]'),
};
const playBtn = el('playBtn');
const silenceAudio = el('silence');

/* ------------------------------------------------------------------ *
 * App state
 * ------------------------------------------------------------------ */
let course = null;          // parsed phrases.json
let lessonIndex = 0;        // current topic
let items = [];             // items of the current topic
let itemIndex = 0;          // current phrase within topic
let phaseIndex = 0;         // 0 = en, 1 = de, 2 = fr
let isPlaying = false;      // are we actively running the sequence?
let sessionStarted = false; // has the silent audio / media session started?

let phaseTimer = null;      // timeout between languages / phrases
let keepAlive = null;       // Chrome speechSynthesis keep-alive pump

/* Each phase: which language, which text field, and how long to pause after. */
function phasesForCurrentItem() {
  const item = items[itemIndex];
  return [
    { key: 'en', lang: 'en-US', text: item.english, pauseAfter: PAUSE_AFTER_EN },
    { key: 'de', lang: 'de-DE', text: item.german,  pauseAfter: PAUSE_AFTER_DE },
    { key: 'fr', lang: 'fr-FR', text: item.french,  pauseAfter: PAUSE_AFTER_FR },
  ];
}

/* ================================================================== *
 * Data loading
 * ================================================================== */
async function loadCourse() {
  try {
    const res = await fetch('phrases.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    course = await res.json();
  } catch (err) {
    statusEl.textContent = 'Could not load phrases.json';
    toast('Failed to load phrases. Serve this app over http(s), not file://');
    console.error(err);
    return;
  }
  courseTitleEl.textContent = course.courseTitle || 'Language Learner';
  document.title = `${course.courseTitle} — Language Learner`;
  renderTopics();
}

/* ================================================================== *
 * Home screen
 * ================================================================== */
function renderTopics() {
  topicList.innerHTML = '';
  course.lessons.forEach((lesson, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'topic-btn';
    btn.innerHTML =
      `<span>${escapeHtml(lesson.topic)}<br><span class="count">${lesson.items.length} phrases</span></span>` +
      `<span class="chevron" aria-hidden="true">›</span>`;
    btn.addEventListener('click', () => openTopic(i));
    li.appendChild(btn);
    topicList.appendChild(li);
  });
}

function showScreen(which) {
  homeScreen.hidden = which !== 'home';
  playerScreen.hidden = which !== 'player';
}

/* ================================================================== *
 * Player screen
 * ================================================================== */
function openTopic(i) {
  lessonIndex = i;
  items = course.lessons[i].items;
  itemIndex = 0;
  phaseIndex = 0;
  playerTopicEl.textContent = course.lessons[i].topic;
  showScreen('player');
  renderItem();
  statusEl.textContent = 'Press Play to start';
}

function renderItem() {
  const item = items[itemIndex];
  textEn.textContent = item.english;
  textDe.textContent = item.german;
  textFr.textContent = item.french;
  progressEl.textContent = `${itemIndex + 1} / ${items.length}`;
  highlight(null);
  updateMediaMetadata();
}

function highlight(key) {
  for (const k of Object.keys(langRows)) {
    langRows[k].classList.toggle('speaking', k === key);
  }
}

/* ================================================================== *
 * TTS engine — Web Speech API
 * ================================================================== */
const synth = window.speechSynthesis;
let voices = [];

function refreshVoices() { voices = synth ? synth.getVoices() : []; }
if (synth) {
  refreshVoices();
  synth.addEventListener('voiceschanged', refreshVoices);
}

/* Pick the best installed voice for a language prefix ('en', 'de', 'fr'). */
function pickVoice(langPrefix) {
  if (!voices.length) refreshVoices();
  const matches = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith(langPrefix));
  if (!matches.length) return null;
  // Prefer a locally installed / default voice for reliability offline.
  return matches.find(v => v.default) || matches.find(v => v.localService) || matches[0];
}

/* Speak one phase; resolve when finished (or errored). */
function speakPhase(phase) {
  return new Promise((resolve) => {
    if (!synth) { resolve(); return; }
    const u = new SpeechSynthesisUtterance(phase.text);
    u.lang = phase.lang;
    const v = pickVoice(phase.lang.slice(0, 2));
    if (v) u.voice = v;
    u.rate = 0.95;
    u.pitch = 1.0;
    u.onstart = () => { highlight(phase.key); statusEl.textContent = `Speaking ${labelFor(phase.key)}…`; };
    u.onend = () => resolve();
    u.onerror = () => resolve(); // never wedge the queue on an engine error
    synth.speak(u);
  });
}

function labelFor(key) {
  return { en: 'English', de: 'German', fr: 'French' }[key] || key;
}

/* Drive the sequence forward from the current phase. */
async function runFromCurrentPhase() {
  if (!isPlaying) return;
  const phases = phasesForCurrentItem();
  const phase = phases[phaseIndex];

  await speakPhase(phase);
  if (!isPlaying) return; // paused/stopped mid-utterance

  // Pause between languages, then continue.
  phaseTimer = setTimeout(() => {
    if (!isPlaying) return;
    if (phaseIndex < phases.length - 1) {
      phaseIndex += 1;
      runFromCurrentPhase();
    } else {
      advanceToNextItem(); // finished fr -> next phrase
    }
  }, phase.pauseAfter);
}

function advanceToNextItem() {
  phaseIndex = 0;
  if (itemIndex < items.length - 1) {
    itemIndex += 1;
    renderItem();
    if (isPlaying) runFromCurrentPhase();
  } else if (el('loopChk').checked) {
    itemIndex = 0;             // loop the topic
    renderItem();
    if (isPlaying) runFromCurrentPhase();
  } else {
    stop();
    statusEl.textContent = 'Finished topic';
  }
}

/* ================================================================== *
 * Transport controls
 * ================================================================== */
function play() {
  if (isPlaying) return;
  startSession();          // begin/keep the media session (needs a user gesture)
  isPlaying = true;
  setPlayIcon(true);
  setMediaPlaybackState('playing');
  startKeepAlive();
  runFromCurrentPhase();
}

function pause() {
  if (!isPlaying) return;
  isPlaying = false;
  clearTimeout(phaseTimer);
  stopKeepAlive();
  if (synth) synth.cancel();          // stop current utterance immediately
  highlight(null);
  setPlayIcon(false);
  setMediaPlaybackState('paused');
  statusEl.textContent = 'Paused';
}

function togglePlay() { isPlaying ? pause() : play(); }

function stop() {
  isPlaying = false;
  clearTimeout(phaseTimer);
  stopKeepAlive();
  if (synth) synth.cancel();
  phaseIndex = 0;
  highlight(null);
  setPlayIcon(false);
  setMediaPlaybackState('paused');
}

/* Skip to next phrase and (if we were playing) start reading it at once.
 * This is what a double-tap on Bluetooth earphones triggers. */
function next() {
  const wasPlaying = isPlaying;
  clearTimeout(phaseTimer);
  if (synth) synth.cancel();
  phaseIndex = 0;
  if (itemIndex < items.length - 1) itemIndex += 1;
  else itemIndex = 0; // wrap around
  renderItem();
  if (wasPlaying) { isPlaying = true; runFromCurrentPhase(); }
  else statusEl.textContent = 'Ready';
}

function previous() {
  const wasPlaying = isPlaying;
  clearTimeout(phaseTimer);
  if (synth) synth.cancel();
  phaseIndex = 0;
  if (itemIndex > 0) itemIndex -= 1;
  else itemIndex = items.length - 1; // wrap around
  renderItem();
  if (wasPlaying) { isPlaying = true; runFromCurrentPhase(); }
  else statusEl.textContent = 'Ready';
}

function setPlayIcon(playing) {
  playBtn.textContent = playing ? '⏸' : '▶';
  playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

/* Chrome silently stops speaking after ~15s of utterance/queue time.
 * Nudging the engine keeps long queues alive. */
function startKeepAlive() {
  stopKeepAlive();
  keepAlive = setInterval(() => {
    if (synth && synth.speaking && !synth.paused) { synth.pause(); synth.resume(); }
  }, 10000);
}
function stopKeepAlive() { clearInterval(keepAlive); keepAlive = null; }

/* ================================================================== *
 * Media Session — the headset / hardware-key bridge
 * ================================================================== */
function startSession() {
  if (sessionStarted) return;
  // A short silent WAV, looped, keeps a real audio stream alive so the OS
  // gives us a Media Session and routes headset media keys to this page.
  try {
    silenceAudio.src = makeSilentWavDataUri(1);
    silenceAudio.volume = 0;
    const p = silenceAudio.play();
    if (p && p.catch) p.catch(() => {/* autoplay blocked until gesture; play() is called from a click */});
  } catch (e) { console.warn('silent audio failed', e); }

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play',  () => play());
      navigator.mediaSession.setActionHandler('pause', () => pause());
      navigator.mediaSession.setActionHandler('nexttrack',     () => next());
      navigator.mediaSession.setActionHandler('previoustrack', () => previous());
      navigator.mediaSession.setActionHandler('stop', () => stop());
    } catch (e) { console.warn('mediaSession handlers failed', e); }
  }
  sessionStarted = true;
  updateMediaMetadata();
}

function updateMediaMetadata() {
  if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
  const topic = course?.lessons?.[lessonIndex]?.topic || 'Language Learner';
  const item = items[itemIndex];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: item ? item.english.slice(0, 60) : topic,
    artist: topic,
    album: course?.courseTitle || 'Cycling Language Loop',
  });
}

function setMediaPlaybackState(state) {
  if ('mediaSession' in navigator) {
    try { navigator.mediaSession.playbackState = state; } catch (e) {/* ignore */}
  }
}

/* Build a silent PCM WAV as a data: URI (mono, 8 kHz, 16-bit, all zero samples). */
function makeSilentWavDataUri(seconds) {
  const sampleRate = 8000;
  const numSamples = sampleRate * seconds;
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);      // PCM chunk size
  view.setUint16(20, 1, true);       // PCM format
  view.setUint16(22, 1, true);       // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);       // block align
  view.setUint16(34, 16, true);      // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  // sample bytes are already zero (silence)
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(binary);
}

/* ================================================================== *
 * Wiring
 * ================================================================== */
playBtn.addEventListener('click', togglePlay);
el('nextBtn').addEventListener('click', next);
el('prevBtn').addEventListener('click', previous);
el('backBtn').addEventListener('click', () => { stop(); showScreen('home'); });

// Keyboard shortcuts (handy on desktop / some wired remotes).
document.addEventListener('keydown', (e) => {
  if (playerScreen.hidden) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.code === 'ArrowRight') next();
  else if (e.code === 'ArrowLeft') previous();
});

/* ================================================================== *
 * Helpers
 * ================================================================== */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

/* ================================================================== *
 * Boot
 * ================================================================== */
if (!('speechSynthesis' in window)) {
  toast('This browser has no speech synthesis. Try Chrome, Edge or Safari.');
}
loadCourse();

// Register the service worker for offline use (PWA). Ignored on file://.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW failed', e));
  });
}
