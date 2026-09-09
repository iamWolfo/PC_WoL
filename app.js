const $ = (selector) => document.querySelector(selector);
const authView = $('#auth-view');
const appView = $('#app-view');
const toast = $('#toast');
let toastTimer;
let dashboard;
let authMode = 'login';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

async function api(path, options = {}) {
  const token = localStorage.getItem('wakebase_token');
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Une erreur est survenue.');
  }
  return response.status === 204 ? null : response.json();
}

function formatActivityDate(date) {
  const difference = Date.now() - new Date(date).getTime();
  const minutes = Math.max(1, Math.floor(difference / 60000));
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  return new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function renderDevices() {
  const devices = dashboard.devices;
  $('#device-list').innerHTML = devices.length ? devices.map((device) => `
    <article class="device-row">
      <span class="device-icon"><i data-lucide="${device.operating_system?.toLowerCase().includes('mac') ? 'laptop' : 'monitor'}"></i></span>
      <div><div class="device-name">${escapeHtml(device.name)}</div><div class="device-meta">${escapeHtml(device.local_ip || 'IP non renseignée')} · ${escapeHtml(device.operating_system || 'Système non renseigné')}</div></div>
      <span class="device-state ${device.is_online ? 'online' : ''}"><i></i>${device.is_online ? 'En ligne' : 'Hors ligne'}</span>
      <button class="wake-button" data-device-id="${device.id}" ${device.is_online ? 'disabled' : ''}><i data-lucide="zap"></i>${device.is_online ? 'En ligne' : 'Réveiller'}</button>
    </article>`).join('') : '<p class="muted">Aucun appareil enregistré. Ajoutez votre premier PC.</p>';
  $('#total-devices').textContent = devices.length;
  $('#device-count').textContent = devices.length;
  $('#online-devices').textContent = devices.filter((device) => device.is_online).length;
  lucide.createIcons();
  document.querySelectorAll('.wake-button').forEach((button) => button.addEventListener('click', () => wakeDevice(button.dataset.deviceId, button)));
}

function renderActivities() {
  const activities = dashboard.activity;
  $('#activity-list').innerHTML = activities.length ? activities.slice(0, 4).map((activity) => `<div class="activity-item"><span class="activity-bullet"><i data-lucide="${activity.event_type === 'wake' ? 'zap' : 'activity'}"></i></span><div><p>${escapeHtml(activity.message)}</p><small>${formatActivityDate(activity.created_at)}</small></div></div>`).join('') : '<p class="muted">Aucune activité pour le moment.</p>';
  lucide.createIcons();
}

function renderStats() {
  $('#today-label').textContent = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date()).toUpperCase();
  $('#welcome-name').textContent = dashboard.user.display_name;
  $('#wake-count').textContent = dashboard.stats.wakes;
  $('#availability').textContent = dashboard.stats.devices ? `${Math.round((dashboard.stats.online_devices / dashboard.stats.devices) * 100)}%` : '—';
}

function renderRouters() {
  const routers = dashboard.routers;
  $('#router-grid').innerHTML = routers.map((router) => `<article class="router-card"><div class="router-card-top"><span class="router-symbol"><i data-lucide="router"></i></span><span class="online-pill"><i></i> Configuré</span></div><h4>${escapeHtml(router.name)}</h4><p>${escapeHtml(router.local_ip)} <span>•</span> Broadcast ${escapeHtml(router.broadcast_ip)}</p><div class="router-card-foot"><span><i data-lucide="radio"></i> ${dashboard.devices.filter((device) => String(device.router_id) === String(router.id)).length} appareil(s)</span><button class="icon-button small delete-router" data-router-id="${router.id}" aria-label="Supprimer ${escapeHtml(router.name)}"><i data-lucide="trash-2"></i></button></div></article>`).join('') + '<article class="router-card router-card-add" id="add-router-card"><span class="add-circle"><i data-lucide="plus"></i></span><h4>Ajouter un routeur</h4><p>Connectez un nouvel espace</p></article>';
  const routerSelect = $('#device-router');
  routerSelect.innerHTML = '<option value="">Aucun routeur</option>' + routers.map((router) => `<option value="${router.id}">${escapeHtml(router.name)}</option>`).join('');
  lucide.createIcons();
  $('#add-router-card').addEventListener('click', () => $('#router-dialog').showModal());
  document.querySelectorAll('.delete-router').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm('Supprimer ce routeur ? Les appareils resteront enregistrés.')) return;
    try { await api(`/api/routers/${button.dataset.routerId}`, { method: 'DELETE' }); await loadDashboard(); showToast('Routeur supprimé.'); } catch (error) { showToast(error.message); }
  }));
}

function renderScreen(view) {
  const screen = $('#dynamic-screen');
  const overviewElements = [...document.querySelector('.page-content').children].filter((element) => element.id !== 'dynamic-screen');
  const isOverview = view === 'overview';
  overviewElements.forEach((element) => element.classList.toggle('hidden', !isOverview));
  screen.classList.toggle('hidden', isOverview);
  if (isOverview) return;
  const content = {
    devices: `<div class="screen-heading"><div><p class="eyebrow">INVENTAIRE</p><h3>Mes appareils</h3><p class="muted">Toutes les machines rattachées à votre compte.</p></div><button class="button button-dark" id="screen-add-device"><i data-lucide="plus"></i> Ajouter</button></div><div class="screen-list">${dashboard.devices.map((device) => `<div class="screen-row"><div><strong>${escapeHtml(device.name)}</strong><small>${escapeHtml(device.mac_address)} · ${escapeHtml(device.local_ip || 'IP non renseignée')}</small></div><span class="device-state ${device.is_online ? 'online' : ''}"><i></i>${device.is_online ? 'En ligne' : 'Hors ligne'}</span><button class="wake-button screen-wake" data-device-id="${device.id}" ${device.is_online ? 'disabled' : ''}><i data-lucide="zap"></i> Réveiller</button></div>`).join('') || '<p class="muted">Aucun appareil enregistré.</p>'}</div>`,
    routers: `<div class="screen-heading"><div><p class="eyebrow">RÉSEAU</p><h3>Mes routeurs</h3><p class="muted">Configurez les réseaux qui peuvent réveiller vos machines.</p></div><button class="button button-dark" id="screen-add-router"><i data-lucide="plus"></i> Ajouter</button></div><div class="router-grid screen-router-grid">${dashboard.routers.map((router) => `<article class="router-card"><div class="router-card-top"><span class="router-symbol"><i data-lucide="router"></i></span><button class="icon-button small delete-router" data-router-id="${router.id}" aria-label="Supprimer"><i data-lucide="trash-2"></i></button></div><h4>${escapeHtml(router.name)}</h4><p>${escapeHtml(router.local_ip)} <span>•</span> ${escapeHtml(router.broadcast_ip)}</p></article>`).join('') || '<p class="muted">Aucun routeur enregistré.</p>'}</div>`,
    activity: `<div class="screen-heading"><div><p class="eyebrow">HISTORIQUE</p><h3>Journal d’activité</h3><p class="muted">Les événements de votre espace sont conservés ici.</p></div></div><div class="screen-list">${dashboard.activity.map((item) => `<div class="screen-row"><div><strong>${escapeHtml(item.message)}</strong><small>${formatActivityDate(item.created_at)}</small></div><span class="activity-bullet"><i data-lucide="${item.event_type === 'wake' ? 'zap' : 'activity'}"></i></span></div>`).join('') || '<p class="muted">Aucun événement enregistré.</p>'}</div>`,
    settings: `<div class="screen-heading"><div><p class="eyebrow">COMPTE</p><h3>Paramètres</h3><p class="muted">Modifiez les informations de votre espace.</p></div></div><form id="account-form" class="settings-form"><label for="settings-name">Nom affiché</label><input id="settings-name" value="${escapeHtml(dashboard.user.display_name)}" required /><label for="settings-email">Adresse e-mail</label><input id="settings-email" type="email" value="${escapeHtml(dashboard.user.email)}" required /><button class="button button-dark" type="submit">Enregistrer les modifications <i data-lucide="check"></i></button></form>`
  }[view];
  screen.innerHTML = content;
  lucide.createIcons();
  $('#screen-add-device')?.addEventListener('click', () => $('#device-dialog').showModal());
  $('#screen-add-router')?.addEventListener('click', () => $('#router-dialog').showModal());
  document.querySelectorAll('.screen-wake').forEach((button) => button.addEventListener('click', () => wakeDevice(button.dataset.deviceId, button)));
  document.querySelectorAll('.delete-router').forEach((button) => button.addEventListener('click', async () => { if (window.confirm('Supprimer ce routeur ?')) { await api(`/api/routers/${button.dataset.routerId}`, { method: 'DELETE' }); await loadDashboard(); renderScreen('routers'); showToast('Routeur supprimé.'); } }));
  $('#account-form')?.addEventListener('submit', async (event) => { event.preventDefault(); try { await api('/api/account', { method: 'PATCH', body: JSON.stringify({ displayName: $('#settings-name').value, email: $('#settings-email').value }) }); await loadDashboard(); renderScreen('settings'); showToast('Paramètres enregistrés.'); } catch (error) { showToast(error.message); } });
}

function renderUser() {
  const initials = dashboard.user.display_name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  document.querySelectorAll('.top-avatar, .workspace-switcher .avatar').forEach((element) => { element.textContent = initials; });
  $('.workspace-switcher strong').textContent = dashboard.user.display_name;
}

async function loadDashboard() {
  dashboard = await api('/api/dashboard');
  renderUser();
  renderStats();
  renderDevices();
  renderActivities();
  renderRouters();
}

async function wakeDevice(id, button) {
  button.classList.add('loading');
  button.disabled = true;
  button.innerHTML = '<i data-lucide="loader-circle"></i> Envoi...';
  lucide.createIcons();
  try {
    const result = await api(`/api/devices/${id}/wake`, { method: 'POST', body: '{}' });
    await loadDashboard();
    showToast(result.message);
  } catch (error) {
    button.classList.remove('loading');
    button.disabled = false;
    button.innerHTML = '<i data-lucide="zap"></i> Réveiller';
    lucide.createIcons();
    showToast(error.message);
  }
}

function showApp() {
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  loadDashboard().catch((error) => { localStorage.removeItem('wakebase_token'); appView.classList.add('hidden'); authView.classList.remove('hidden'); showToast(error.message); });
  lucide.createIcons();
}

function updateAuthMode() {
  const signup = authMode === 'signup';
  $('.auth-heading h2').textContent = signup ? 'Créez votre espace.' : 'Content de vous revoir.';
  $('.auth-heading>p:last-child').textContent = signup ? 'Centralisez vos routeurs et réveillez vos machines depuis n’importe où.' : 'Connectez-vous pour retrouver vos appareils et les réveiller à distance.';
  $('#login-form button[type="submit"]').innerHTML = `${signup ? 'Créer mon compte' : 'Se connecter'} <i data-lucide="arrow-up-right"></i>`;
  $('#signup-link').textContent = signup ? 'Se connecter' : 'Créer un compte';
  $('.demo-note').classList.toggle('hidden', signup);
  if (signup && !$('#display-name')) {
    const label = document.createElement('label');
    label.setAttribute('for', 'display-name');
    label.textContent = 'Nom affiché';
    const input = document.createElement('div');
    input.className = 'input-wrap';
    input.innerHTML = '<i data-lucide="user-round"></i><input id="display-name" type="text" placeholder="Alex Morgan" required />';
    $('#email').closest('.input-wrap').before(label, input);
  } else if (!signup && $('#display-name')) {
    $('#display-name').closest('.input-wrap').previousElementSibling.remove();
    $('#display-name').closest('.input-wrap').remove();
  }
  lucide.createIcons();
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const payload = { email: $('#email').value, password: $('#password').value };
    if (authMode === 'signup') payload.displayName = $('#display-name').value;
    const result = await api(authMode === 'signup' ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
    localStorage.setItem('wakebase_token', result.token);
    showApp();
  } catch (error) {
    showToast(error.message);
    submitButton.disabled = false;
  }
});

$('.reveal-pass').addEventListener('click', (event) => {
  const input = $('#password');
  input.type = input.type === 'password' ? 'text' : 'password';
  event.currentTarget.innerHTML = `<i data-lucide="${input.type === 'password' ? 'eye' : 'eye-off'}"></i>`;
  lucide.createIcons();
});

$('#signup-link').addEventListener('click', (event) => { event.preventDefault(); authMode = authMode === 'login' ? 'signup' : 'login'; updateAuthMode(); });
$('#forgot-link').addEventListener('click', (event) => { event.preventDefault(); showToast('La réinitialisation sera disponible prochainement.'); });
$('#logout-button').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => {}); localStorage.removeItem('wakebase_token'); appView.classList.add('hidden'); authView.classList.remove('hidden'); showToast('Vous êtes déconnecté.'); });
$('#notification-button').addEventListener('click', () => showToast('Aucune nouvelle notification.'));
$('#clear-activity').addEventListener('click', () => showToast('Le journal est conservé côté serveur.'));
$('#add-device-button').addEventListener('click', () => $('#device-dialog').showModal());
$('#view-devices').addEventListener('click', () => showToast('Vous consultez déjà vos appareils principaux.'));

document.querySelectorAll('[data-view], [data-view-link]').forEach((element) => element.addEventListener('click', () => {
  const view = element.dataset.view || element.dataset.viewLink;
  const labels = { overview: 'Vue d’ensemble', devices: 'Mes appareils', routers: 'Routeurs', settings: 'Paramètres', activity: 'Journal d’activité' };
  if (element.dataset.view) document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item === element));
  $('#page-title').textContent = labels[view];
  renderScreen(view);
  $('.sidebar').classList.remove('open');
}));

$('.menu-trigger').addEventListener('click', () => $('.sidebar').classList.add('open'));
$('.mobile-close').addEventListener('click', () => $('.sidebar').classList.remove('open'));

$('#device-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/devices', { method: 'POST', body: JSON.stringify({ name: $('#device-name').value.trim(), macAddress: $('#device-mac').value.trim(), localIp: $('#device-ip').value.trim(), operatingSystem: $('#device-os').value.trim(), routerId: $('#device-router').value || null }) });
    $('#device-dialog').close();
    event.currentTarget.reset();
    await loadDashboard();
    showToast('Appareil ajouté à votre espace.');
  } catch (error) { showToast(error.message); }
});

$('#router-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/routers', { method: 'POST', body: JSON.stringify({ name: $('#router-name').value.trim(), localIp: $('#router-ip').value.trim(), broadcastIp: $('#router-broadcast').value.trim() }) });
    $('#router-dialog').close();
    event.currentTarget.reset();
    await loadDashboard();
    showToast('Routeur ajouté à votre espace.');
  } catch (error) { showToast(error.message); }
});

lucide.createIcons();
if (localStorage.getItem('wakebase_token')) showApp();
