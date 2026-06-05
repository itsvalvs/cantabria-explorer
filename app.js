// ══════════════════════════════════════════════════════════════
//  CANTABRIA EXPLORER — app.js
//  Conectado a Supabase
// ══════════════════════════════════════════════════════════════

const SUPABASE_URL  = 'https://sdsdbfjmpjbrcgrbyvkm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkc2RiZmptcGpicmNncmJ5dmttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMzQxMzksImV4cCI6MjA5MzkxMDEzOX0.EgNnrghpj9XbFUt0N-NlTIhH4GxcHOaen33RXAYMNcA';

// ── CLIENTE SUPABASE ──────────────────────────────────────────
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── ESTADO GLOBAL ─────────────────────────────────────────────
const state = {
  user:          null,
  profile:       null,
  visited:       {},       // { municipio: true }
  photos:        [],       // fotos propias
  totalMuni:     102,
  coast:         [],
  mountain:      [],
  rolling:       false,
  selectedMuni:  null,
  eventos:       [],
  inscripciones: {},       // { event_id: true }
  feedPosts:     [],
};

// ── COLORES NAV ───────────────────────────────────────────────
const NAV_ITEMS = [
  { id:'map',     icon:'ti-map-2',       label:'Mapa',    bg:'#1a7a3e', fg:'#b8f5d0', abg:'#22b050', afg:'#ffffff' },
  { id:'eventos', icon:'ti-confetti',    label:'Eventos', bg:'#aa1060', fg:'#ffc0e0', abg:'#e8288a', afg:'#ffffff' },
  { id:'dado',    icon:'ti-dice',        label:'Destino', bg:'#a07810', fg:'#fff0b0', abg:'#e8b820', afg:'#ffffff' },
  { id:'feed',    icon:'ti-users',       label:'Amigos',  bg:'#1848a8', fg:'#b0d4ff', abg:'#2272e8', afg:'#ffffff' },
  { id:'profile', icon:'ti-user-circle', label:'Perfil',  bg:'#a04010', fg:'#ffd0a0', abg:'#e86820', afg:'#ffffff' },
];

function buildNavs() {
  ['map','eventos','dado','feed','profile'].forEach(screen => {
    const container = document.getElementById('nav-' + screen);
    if (!container) return;
    container.innerHTML = NAV_ITEMS.map(item => {
      const isActive = item.id === screen;
      const bg = isActive ? item.abg : item.bg;
      const fg = isActive ? item.afg : item.fg;
      return `<button
        onclick="switchScreen('${item.id}')"
        id="nb-${screen}-${item.id}"
        aria-label="${item.label}"
        style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:10px 4px 8px;border:none;border-radius:14px;font-size:9px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;background-color:${bg};color:${fg};">
        <i class="ti ${item.icon}" style="font-size:20px;color:inherit" aria-hidden="true"></i>
        <span>${item.label}</span>
      </button>`;
    }).join('');
  });
}

function updateNavColors(activeScreen) {
  ['map','eventos','dado','feed','profile'].forEach(screen => {
    NAV_ITEMS.forEach(item => {
      const btn = document.getElementById(`nb-${screen}-${item.id}`);
      if (!btn) return;
      const isActive = item.id === activeScreen;
      btn.style.backgroundColor = isActive ? item.abg : item.bg;
      btn.style.color            = isActive ? item.afg : item.fg;
    });
  });
}

// ── AUTH — PANTALLA DE LOGIN ──────────────────────────────────
function showAuth(msg = '') {
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  if (msg) {
    const el = document.getElementById('auth-msg');
    el.textContent = msg;
    el.style.display = 'block';
  }
}

function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
}

async function doLogin() {
  const email = document.getElementById('auth-email').value.trim();
  const pass  = document.getElementById('auth-pass').value;
  const msg   = document.getElementById('auth-msg');
  if (!email || !pass) { msg.textContent = 'Rellena email y contraseña'; msg.style.display='block'; return; }
  setAuthLoading(true);
  const { error } = await db.auth.signInWithPassword({ email, password: pass });
  setAuthLoading(false);
  if (error) { msg.textContent = 'Email o contraseña incorrectos'; msg.style.display='block'; }
}

async function doRegister() {
  const email    = document.getElementById('auth-email').value.trim();
  const pass     = document.getElementById('auth-pass').value;
  const username = document.getElementById('auth-username').value.trim();
  const msg      = document.getElementById('auth-msg');
  msg.style.color = '#e8288a';

  // Validaciones básicas
  if (!email || !pass || !username) {
    msg.textContent = 'Rellena todos los campos';
    msg.style.display = 'block'; return;
  }
  if (pass.length < 6) {
    msg.textContent = 'La contraseña debe tener al menos 6 caracteres';
    msg.style.display = 'block'; return;
  }
  if (username.length < 3) {
    msg.textContent = 'El nombre de usuario debe tener al menos 3 caracteres';
    msg.style.display = 'block'; return;
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    msg.textContent = 'El nombre solo puede tener letras, números, guiones y puntos';
    msg.style.display = 'block'; return;
  }

  setAuthLoading(true);

  // Comprobar si el username ya existe ANTES de crear la cuenta
  const { data: existing } = await db
    .from('profiles')
    .select('username')
    .ilike('username', username)
    .limit(1);

  if (existing && existing.length > 0) {
    msg.textContent = 'Ese nombre de usuario ya está en uso, elige otro';
    msg.style.display = 'block';
    setAuthLoading(false); return;
  }

  // Crear cuenta
  const { error } = await db.auth.signUp({
    email, password: pass,
    options: { data: { username } }
  });

  setAuthLoading(false);

  if (error) {
    if (error.message.includes('already registered')) {
      msg.textContent = 'Ese email ya tiene una cuenta. Inicia sesión.';
    } else {
      msg.textContent = error.message;
    }
    msg.style.display = 'block';
  } else {
    msg.style.color = '#22b050';
    msg.textContent = '¡Cuenta creada! Revisa tu email para confirmar.';
    msg.style.display = 'block';
  }
}

function setAuthLoading(on) {
  document.getElementById('btn-login').disabled    = on;
  document.getElementById('btn-register').disabled = on;
}

function toggleAuthForm() {
  const regRow = document.getElementById('register-row');
  const isReg  = regRow.style.display === 'flex';
  regRow.style.display = isReg ? 'none' : 'flex';
  document.getElementById('auth-toggle-txt').textContent = isReg
    ? '¿No tienes cuenta? Regístrate'
    : '¿Ya tienes cuenta? Inicia sesión';
  document.getElementById('auth-msg').style.display = 'none';
}

async function doLogout() {
  await db.auth.signOut();
  state.user = null; state.profile = null;
  state.visited = {}; state.photos = [];
  showAuth();
}

// ── CARGAR PERFIL Y DATOS DEL USUARIO ────────────────────────
async function loadUserData(user) {
  state.user = user;

  // Perfil
  const { data: profile } = await db
    .from('profiles').select('*').eq('id', user.id).single();
  state.profile = profile;

  if (profile) {
    document.getElementById('u-name').textContent  = profile.username;
    document.getElementById('av-init').textContent = profile.username.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
    if (profile.avatar_url) {
      const ring = document.getElementById('av-ring');
      const urlFresh = profile.avatar_url + '?t=' + Date.now();
      ring.innerHTML = `<img src="${urlFresh}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/><div class="av-edit"><i class="ti ti-pencil" aria-hidden="true"></i></div>`;
    }
  }

  // Visitas
  const { data: visits } = await db
    .from('visits').select('municipio').eq('user_id', user.id);
  if (visits) visits.forEach(v => { state.visited[v.municipio] = true; });

  // Fotos
  const { data: photos } = await db
    .from('photos').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  if (photos) state.photos = photos.map(p => ({
    id:       p.id,
    src:      p.storage_path && p.storage_path !== 'text_only'
              ? (db.storage.from('evidencias').getPublicUrl(p.storage_path).data?.publicUrl || '')
              : null,
    muni:     p.municipio,
    date:     p.fecha,
    time:     p.hora || '',
    coords:   p.coords || '',
    desc:     p.descripcion || '',
    vis:      p.visibilidad,
    path:     p.storage_path,
  }));

  // Inscripciones
  const { data: signups } = await db
    .from('event_signups').select('event_id').eq('user_id', user.id);
  if (signups) signups.forEach(s => { state.inscripciones[s.event_id] = true; });

  updateProgress();

  // Suscribir a actividad en tiempo real de amigos
  subscribeToFriendActivity();
}

// ── NAVEGACIÓN ────────────────────────────────────────────────
function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  updateNavColors(name);
  if (name === 'profile')  renderProfile();
  if (name === 'feed')     { clearFeedBadge(); loadFeed(); }
  if (name === 'eventos')  loadEventos();
  if (name === 'dado')     renderMuniList();
}

// ── MAPA ──────────────────────────────────────────────────────
function updateProgress() {
  const c = Object.keys(state.visited).length;
  const t = state.totalMuni;
  document.getElementById('pfill').style.width = Math.round(c / t * 100) + '%';
  document.getElementById('plabel').textContent = c + ' municipio' + (c !== 1 ? 's' : '') + ' conquistado' + (c !== 1 ? 's' : '');
  document.getElementById('ppct').textContent = c + ' / ' + t;
}

function showMuniBar(name) {
  document.getElementById('muni-bar').style.display = 'flex';
  document.getElementById('bar-name').textContent = name;
  const vis = state.visited[name];
  document.getElementById('bar-st').textContent = vis ? '✓ Conquistado' : 'Sin visitar';
  const btn = document.getElementById('btn-ev');
  btn.style.backgroundColor = vis ? '#1a7a3e' : '#22b050';
  btn.style.color = '#ffffff';
  btn.innerHTML = vis
    ? '<i class="ti ti-check" aria-hidden="true"></i> Conquistado'
    : '<i class="ti ti-camera" aria-hidden="true"></i> Evidencia';
}

function openSheet() {
  if (!state.selectedMuni) return;
  const muni   = state.selectedMuni;
  const visita = state.visited[muni];

  document.getElementById('sht-title').textContent = muni;
  document.getElementById('sht-sub').textContent   = visita
    ? 'Ya conquistado — añade foto o descripción'
    : 'Foto, descripción o ambas (todo opcional)';

  const btnDesmarcar = document.getElementById('btn-desmarcar');
  if (btnDesmarcar) btnDesmarcar.style.display = visita ? 'block' : 'none';
  const btnConf = document.getElementById('btn-conf');
  if (btnConf) btnConf.textContent = visita ? 'Guardar' : 'Marcar como conquistado';

  document.querySelectorAll('.vis-btn').forEach(b => b.classList.remove('vis-active'));
  document.getElementById('vis-amigos').classList.add('vis-active');

  // Reset foto y descripción
  clearPhoto();
  const desc = document.getElementById('evidencia-desc');
  if (desc) desc.value = '';

  document.getElementById('upload-sheet').classList.add('open');
}

function clearPhoto() {
  document.getElementById('prev-w').style.display   = 'none';
  const uzoneParent = document.getElementById('uzone')?.parentElement;
  if (uzoneParent) uzoneParent.style.display = 'block';
  try { document.getElementById('file-in').value = ''; } catch(e){}
  state.pendingFile   = null;
  state.pendingBase64 = null;
  state.pendingMime   = null;
}

let selectedVisibilidad = 'amigos';
function setVis(v) {
  selectedVisibilidad = v;
  document.querySelectorAll('.vis-btn').forEach(b => b.classList.remove('vis-active'));
  document.getElementById('vis-' + v).classList.add('vis-active');
}

async function confirmVisit() {
  const muni = state.selectedMuni;
  if (!muni || !state.user) return;

  const btn  = document.getElementById('btn-conf');
  const desc = (document.getElementById('evidencia-desc')?.value || '').trim();

  // Necesita al menos foto o descripción
  if (!state.pendingBase64 && !desc) {
    // Sin foto ni descripción — solo marcar visita
  }

  btn.textContent = 'Guardando...';
  btn.disabled    = true;

  try {
    let storagePath = null;

    // 1. Subir foto si hay (desde base64 guardado en state)
    if (state.pendingBase64) {
      // Refrescar sesión
      const { data: sessionData } = await db.auth.getSession();
      const freshUser = sessionData?.session?.user;
      if (!freshUser) throw new Error('Sesión expirada — sal y vuelve a entrar');
      const userId = freshUser.id;

      // Convertir base64 a Blob (más fiable que File en iOS)
      const base64Data = state.pendingBase64.split(',')[1];
      const mime       = state.pendingMime || 'image/jpeg';
      const byteChars  = atob(base64Data);
      const byteArrays = [];
      for (let i = 0; i < byteChars.length; i += 512) {
        const slice = byteChars.slice(i, i + 512);
        const bytes = new Uint8Array(slice.length);
        for (let j = 0; j < slice.length; j++) bytes[j] = slice.charCodeAt(j);
        byteArrays.push(bytes);
      }
      const blob = new Blob(byteArrays, { type: mime });
      const ext  = mime.includes('png') ? 'png' : 'jpg';
      const path = `${userId}/${Date.now()}.${ext}`;

      console.log('Subiendo evidencia desde base64:', path, mime, blob.size + 'b');

      const { data: upData, error: upErr } = await db.storage
        .from('evidencias')
        .upload(path, blob, { contentType: mime, cacheControl: '3600', upsert: false });

      if (upErr) {
        console.error('Upload error:', JSON.stringify(upErr));
        throw new Error('Error foto: ' + (upErr.message || JSON.stringify(upErr)));
      }
      console.log('Subida OK:', path);
      storagePath = path;
    }

    // 2. Registrar visita
    await db.from('visits').upsert({
      user_id:     state.user.id,
      municipio:   muni,
      visibilidad: selectedVisibilidad,
      coords:      state.lastCoords || null,
      fecha:       new Date().toISOString().split('T')[0],
    });

    // 3. Registrar foto si hay
    if (storagePath) {
      const now = new Date();
      const now2 = new Date();
      const { data: photoData } = await db.from('photos').insert({
        user_id:      state.user.id,
        municipio:    muni,
        storage_path: storagePath,
        descripcion:  desc || null,
        visibilidad:  selectedVisibilidad,
        coords:       state.lastCoords || null,
        fecha:        now2.toISOString().split('T')[0],
        hora:         now2.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'}),
      }).select().single();

      // Añadir a estado local
      const publicUrl = db.storage.from('evidencias').getPublicUrl(storagePath).data?.publicUrl || '';
      state.photos.unshift({
        id:    photoData?.id,
        src:   publicUrl,
        muni,
        date:  now2.toLocaleDateString('es-ES'),
        time:  now2.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'}),
        coords: state.lastCoords || '',
        desc:  desc || '',
        vis:   selectedVisibilidad,
        path:  storagePath,
      });
    } else if (desc) {
      // Solo descripción sin foto — guardar como foto sin storage_path
      const now3 = new Date();
      await db.from('photos').insert({
        user_id:      state.user.id,
        municipio:    muni,
        storage_path: 'text_only',
        descripcion:  desc,
        visibilidad:  selectedVisibilidad,
        coords:       state.lastCoords || null,
        fecha:        now3.toISOString().split('T')[0],
        hora:         now3.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'}),
      });
      state.photos.unshift({
        src:   null,
        muni,
        date:  now3.toLocaleDateString('es-ES'),
        time:  now3.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'}),
        coords: '',
        desc:  desc,
        vis:   selectedVisibilidad,
      });
    }

    // 4. Actualizar estado local
    state.visited[muni] = true;
    document.querySelectorAll('.muni-path').forEach(p => {
      if (p.getAttribute('data-name') === muni) p.classList.add('visited');
    });
    showMuniBar(muni);
    document.getElementById('upload-sheet').classList.remove('open');
    document.getElementById('file-in').value = '';
    document.getElementById('prev-w').style.display = 'none';
    document.getElementById('uzone').style.display  = 'block';
    state.pendingFile   = null;
    state.pendingBase64 = null;
    state.pendingMime   = null;
    state.feedCache     = null; // invalidar cache del feed
    const descEl = document.getElementById('evidencia-desc');
    if (descEl) descEl.value = '';
    updateProgress();

  } catch(err) {
    console.error('confirmVisit error:', err);
    // Si el error es solo de la foto, guardar la visita igualmente
    if (err.message && err.message.includes('foto')) {
      try {
        await db.from('visits').upsert({
          user_id:     state.user.id,
          municipio:   muni,
          visibilidad: selectedVisibilidad,
          coords:      state.lastCoords || null,
          fecha:       new Date().toISOString().split('T')[0],
        });
        state.visited[muni] = true;
        document.querySelectorAll('.muni-path').forEach(p => {
          if (p.getAttribute('data-name') === muni) p.classList.add('visited');
        });
        showMuniBar(muni);
        document.getElementById('upload-sheet').classList.remove('open');
        updateProgress();
        alert('⚠️ Visita guardada pero sin foto. Error: ' + err.message);
      } catch(e2) {
        alert('Error al guardar: ' + err.message);
      }
    } else {
      alert('Error al guardar: ' + err.message);
    }
  } finally {
    btn.textContent = state.visited[state.selectedMuni] ? 'Guardar nueva foto' : 'Marcar como conquistado';
    btn.disabled    = false;
  }
}

async function desmarcarVisit() {
  const muni = state.selectedMuni;
  if (!muni || !state.user) return;
  if (!confirm('¿Seguro que quieres desmarcar ' + muni + ' como conquistado?')) return;

  const btn = document.getElementById('btn-desmarcar');
  btn.textContent = 'Desmarcando...';
  btn.disabled    = true;

  try {
    // Borrar visita de Supabase
    await db.from('visits')
      .delete()
      .eq('user_id', state.user.id)
      .eq('municipio', muni);

    // Actualizar estado local
    delete state.visited[muni];

    // Actualizar mapa
    document.querySelectorAll('.muni-path').forEach(p => {
      if (p.getAttribute('data-name') === muni) {
        p.classList.remove('visited');
        p.classList.remove('selected');
      }
    });

    // Actualizar barra info
    document.getElementById('muni-bar').style.display = 'none';
    document.getElementById('upload-sheet').classList.remove('open');
    updateProgress();

  } catch(err) {
    alert('Error al desmarcar: ' + err.message);
  } finally {
    btn.textContent = 'Desmarcar como conquistado';
    btn.disabled    = false;
  }
}

// Geolocalización automática
function getCoords() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    state.lastCoords = pos.coords.latitude.toFixed(4) + '°N, ' + Math.abs(pos.coords.longitude).toFixed(4) + '°W';
  });
}

// uzone click handled by overlapping input
function handleFileSelected(file) {
  if (!file) return;
  console.log('Archivo seleccionado:', file.name, file.type, file.size);

  // Leer como base64 INMEDIATAMENTE y guardar en state
  // Esto es lo único que persiste en Safari iOS después de que el usuario
  // navega entre pantallas o la app va a background
  const reader = new FileReader();
  reader.onload = ev => {
    const base64 = ev.target.result; // data:image/jpeg;base64,....
    state.pendingBase64 = base64;
    state.pendingMime   = file.type || 'image/jpeg';
    state.pendingFile   = null; // ya no lo necesitamos

    document.getElementById('prev-img').src = base64;
    const now = new Date();
    document.getElementById('prev-meta').textContent =
      now.toLocaleDateString('es-ES') + ' · ' +
      now.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'});
    document.getElementById('prev-w').style.display = 'block';
    // Ocultar el wrapper del input
    const uzoneParent = document.getElementById('uzone')?.parentElement;
    if (uzoneParent) uzoneParent.style.display = 'none';
    console.log('Base64 guardado, longitud:', base64.length);
  };
  reader.onerror = () => alert('Error al leer la foto. Inténtalo de nuevo.');
  reader.readAsDataURL(file);
  getCoords();
}

const fileInput = document.getElementById('file-in');
fileInput.addEventListener('input',  function(e) {
  const file = e.target.files && e.target.files[0];
  if (file) handleFileSelected(file);
});
fileInput.addEventListener('change', function(e) {
  const file = e.target.files && e.target.files[0];
  if (file) handleFileSelected(file);
});

// ── EVENTOS ───────────────────────────────────────────────────
let currentFilter = 'todos';

async function loadEventos() {
  const { data } = await db.from('eventos').select('*').eq('activo', true).order('fecha');
  if (data) state.eventos = data;
  renderEventos();
}

function filterEvs(btn, tipo) {
  currentFilter = tipo;
  document.querySelectorAll('.ev-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderEventos();
}

function renderEventos() {
  const filtered = currentFilter === 'todos'
    ? state.eventos
    : state.eventos.filter(e => e.tipo === currentFilter);

  document.getElementById('eventos-list').innerHTML = filtered.map(ev => {
    const insc   = state.inscripciones[ev.id];
    const btnBg  = insc ? '#1a7a3e' : '#aa1060';
    const btnTxt = insc ? 'Apuntado' : 'Apuntarme';
    const btnIco = insc ? 'ti-check'  : 'ti-plus';
    const fecha  = new Date(ev.fecha).toLocaleDateString('es-ES', {day:'numeric', month:'short'});
    return `
    <div class="ev-card">
      <div class="ev-img" style="background-color:${ev.color_bg || '#1a3a5a'}">
        <i class="ti ${ev.icon || 'ti-confetti'}" aria-hidden="true" style="color:rgba(255,255,255,0.13)"></i>
        <div class="ev-date-badge"><i class="ti ti-calendar" aria-hidden="true" style="font-size:11px"></i>${ev.dia_semana || ''} ${fecha}</div>
        <div class="ev-tipo-badge" style="background:rgba(255,255,255,0.15);color:#fff">${ev.tipo_badge || ev.tipo}</div>
      </div>
      <div class="ev-body">
        <div class="ev-name">${ev.nombre}</div>
        <div class="ev-loc"><i class="ti ti-map-pin" aria-hidden="true"></i>${ev.lugar}</div>
        <div class="ev-desc">${ev.descripcion || ''}</div>
        <div class="ev-footer">
          <div class="ev-count" id="ev-count-${ev.id}"><strong>...</strong> van</div>
          <button onclick="toggleInscripcion(${ev.id})"
            style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background-color:${btnBg};color:#ffffff;border:none;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;flex-shrink:0;">
            <i class="ti ${btnIco}" aria-hidden="true"></i>${btnTxt}
          </button>
        </div>
      </div>
    </div>`;
  }).join('');

  // Cargar contadores de inscritos
  filtered.forEach(ev => loadEventCount(ev.id));
}

async function loadEventCount(eventId) {
  const { count } = await db
    .from('event_signups')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId);
  const el = document.getElementById('ev-count-' + eventId);
  if (el) el.innerHTML = `<strong>${count || 0}</strong> van`;
}

async function toggleInscripcion(eventId) {
  if (!state.user) return;
  const insc = state.inscripciones[eventId];
  if (insc) {
    await db.from('event_signups').delete()
      .eq('user_id', state.user.id).eq('event_id', eventId);
    delete state.inscripciones[eventId];
  } else {
    await db.from('event_signups').insert({ user_id: state.user.id, event_id: eventId });
    state.inscripciones[eventId] = true;
  }
  renderEventos();
}

// ── DADO ──────────────────────────────────────────────────────
const COMARCAS   = ["Costa Occidental","Saja-Nansa","Liébana","Besaya","Campoo","Valles Pasiegos","Trasmiera","Bahía de Santander","Asón-Agüera","Costa Oriental"];
const COAST_MUNIS = ["Santander","Castro-Urdiales","Santoña","Laredo","Comillas","San Vicente de la Barquera","Suances","Miengo","Piélagos","Camargo","El Astillero","Noja","Bareyo","Arnuero","Colindres","Limpias","Marina de Cudeyo","Ribamontán al Mar","Escalante","Argoños","Meruelo","Voto"];
const LOREM      = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco.";

const DOT_POS = {
  1:[[60,60]],
  2:[[35,35],[85,85]],
  3:[[35,35],[60,60],[85,85]],
  4:[[35,35],[85,35],[35,85],[85,85]],
  5:[[35,35],[85,35],[60,60],[35,85],[85,85]],
  6:[[35,32],[85,32],[35,60],[85,60],[35,88],[85,88]],
};

function renderDice(num, col) {
  const g = document.getElementById('dice-dots');
  g.innerHTML = '';
  document.getElementById('dice-body').setAttribute('fill', col || '#f5f0e8');
  (DOT_POS[num] || []).forEach(([cx,cy]) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
    c.setAttribute('cx',cx); c.setAttribute('cy',cy);
    c.setAttribute('r','7'); c.setAttribute('fill','#1a1a2e');
    g.appendChild(c);
  });
}

function isCoast(n) { return COAST_MUNIS.some(c => n && n.toLowerCase().includes(c.toLowerCase())); }

function rollDice() {
  if (state.rolling) return;
  state.rolling = true;
  document.getElementById('dice-hint').textContent = 'Lanzando...';
  document.getElementById('result-wrap').classList.remove('show');
  document.getElementById('no-more').style.display = 'none';
  const svg = document.getElementById('dice-svg');
  svg.classList.remove('rolling'); void svg.offsetWidth; svg.classList.add('rolling');
  let t = 0;
  const iv = setInterval(() => {
    renderDice(Math.floor(Math.random()*6)+1); t++;
    if (t >= 12) {
      clearInterval(iv); svg.classList.remove('rolling');
      const fin = Math.floor(Math.random()*6)+1;
      renderDice(fin); state.rolling = false; showDiceResult(fin);
    }
  }, 55);
}

function showDiceResult(num) {
  const even  = num % 2 === 0;
  document.getElementById('badge-coast').classList.toggle('inactive-badge', !even);
  document.getElementById('badge-mount').classList.toggle('inactive-badge',  even);
  const pool = (even ? state.coast : state.mountain).filter(m => !state.visited[m]);
  const all  =  even ? state.coast : state.mountain;
  if (!all.length) { document.getElementById('no-more').style.display='block'; return; }
  const muni = (pool.length ? pool : all)[Math.floor(Math.random()*(pool.length||all.length))];

  // Buscar descripción en BD
  const muniData = state.municipiosData?.[muni] || {};

  renderDice(num, even ? '#dce8f5' : '#d5ede3');
  document.getElementById('rtop').className = 'rcard-top ' + (even ? 'coast' : 'mount');
  const rtag = document.getElementById('rtag');
  rtag.className = 'r-type-tag ' + (even ? 'tag-coast' : 'tag-mount');
  rtag.querySelector('i').className = 'ti ' + (even ? 'ti-waves' : 'ti-mountain');
  document.getElementById('rtag-txt').textContent  = even ? 'Costa' : 'Montaña';
  document.getElementById('r-num').textContent      = num;
  document.getElementById('r-muni').textContent     = muni;
  document.getElementById('r-comarca').textContent  = 'Comarca de ' + (muniData.comarca || COMARCAS[Math.floor(Math.random()*COMARCAS.length)]);
  document.getElementById('r-area').textContent     = muniData.area_km2 ? muniData.area_km2 + ' km²' : Math.round(Math.random()*200+5) + ' km²';
  document.getElementById('r-pop').textContent      = muniData.poblacion ? muniData.poblacion.toLocaleString('es-ES') + ' hab.' : Math.round(Math.random()*30000+100).toLocaleString('es-ES') + ' hab.';
  document.getElementById('r-desc').textContent     = muniData.descripcion || LOREM;
  document.getElementById('dice-hint').textContent  = pool.length ? '¡Tu próxima aventura te espera!' : 'Ya lo visitaste — aquí de nuevo';
  setTimeout(() => document.getElementById('result-wrap').classList.add('show'), 60);

  document.getElementById('btn-go').onclick = () => {
    state.selectedMuni = muni;
    switchScreen('map');
    setTimeout(() => {
      document.querySelectorAll('.muni-path').forEach(p => p.classList.remove('selected'));
      document.querySelectorAll('.muni-path').forEach(p => {
        if (p.getAttribute('data-name') === muni) { p.classList.add('selected'); showMuniBar(muni); }
      });
    }, 250);
  };

  const btnSaber = document.getElementById('btn-saber-mas');
  if (btnSaber) btnSaber.onclick = () => openMuniModal(muni);
}

// ── LISTA DE MUNICIPIOS ──────────────────────────────────────
let muniListFilter = 'todos';

function filterMuniList(tipo) {
  if (tipo) {
    muniListFilter = tipo;
    // Actualizar botones filtro
    ['todos','costa','montaña'].forEach(t => {
      const id = t === 'todos' ? 'mf-todos' : t === 'costa' ? 'mf-costa' : 'mf-mont';
      const btn = document.getElementById(id);
      if (!btn) return;
      const active = t === tipo;
      btn.style.backgroundColor = active ? '#e8b820' : 'rgba(255,255,255,0.1)';
      btn.style.color = active ? '#fff' : 'rgba(255,255,255,0.6)';
    });
  }
  renderMuniList();
}

function renderMuniList() {
  const container = document.getElementById('muni-list');
  if (!container) return;

  const search = (document.getElementById('muni-search')?.value || '').toLowerCase().trim();
  const allMunis = Object.values(state.municipiosData || {});

  const filtered = allMunis.filter(m => {
    const tipoOk = muniListFilter === 'todos' || m.tipo === muniListFilter;
    const searchOk = !search || m.nombre.toLowerCase().includes(search);
    return tipoOk && searchOk;
  }).sort((a,b) => a.nombre.localeCompare(b.nombre));

  if (!filtered.length) {
    container.innerHTML = '<p style="color:rgba(255,255,255,0.3);font-size:13px;text-align:center;padding:20px 0">No se encontraron municipios</p>';
    return;
  }

  container.innerHTML = filtered.map(m => {
    const visitado = state.visited[m.nombre];
    const coast    = m.tipo === 'costa';
    return `
    <div onclick="openMuniModal('${m.nombre.replace(/'/g, "\'")}')"
      style="display:flex;align-items:center;gap:12px;padding:11px 12px;background:#141e2c;border-radius:14px;margin-bottom:6px;cursor:pointer;border:1px solid rgba(255,255,255,0.06);">
      <div style="width:38px;height:38px;border-radius:10px;background:${coast?'#0d2a4a':'#0d2a1e'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="ti ${coast?'ti-waves':'ti-mountain'}" aria-hidden="true" style="font-size:18px;color:${coast?'#85B7EB':'#5DCAA5'}"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:500;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.nombre}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:1px">${m.comarca || ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        ${visitado ? '<span style="width:8px;height:8px;border-radius:50%;background:#22b050;display:block"></span>' : ''}
        <i class="ti ti-chevron-right" aria-hidden="true" style="font-size:16px;color:rgba(255,255,255,0.2)"></i>
      </div>
    </div>`;
  }).join('');
}

function openMuniModal(nombre) {
  if (!nombre) return;
  const m = (state.municipiosData && state.municipiosData[nombre])
    ? state.municipiosData[nombre]
    : { nombre, tipo: isCoast(nombre) ? 'costa' : 'montaña' };
  const coast = m.tipo === 'costa';
  const visitado = state.visited[nombre];

  // Header
  document.getElementById('mm-header').style.background = coast
    ? 'linear-gradient(135deg,#0d2a4a,#153a60)'
    : 'linear-gradient(135deg,#0d2a1e,#153020)';

  const badge = document.getElementById('mm-badge');
  badge.innerHTML = `<i class="ti ${coast?'ti-waves':'ti-mountain'}" aria-hidden="true" style="font-size:10px"></i> ${coast?'Costa':'Montaña'}`;
  badge.style.background = coast ? 'rgba(56,138,221,0.25)' : 'rgba(29,158,117,0.25)';
  badge.style.color = coast ? '#85B7EB' : '#5DCAA5';

  document.getElementById('mm-name').textContent = nombre;
  document.getElementById('mm-comarca').textContent = m.comarca ? 'Comarca de ' + m.comarca : '';

  // Pills
  const pills = [];
  if (m.poblacion) pills.push(`<div style="display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,0.1);border-radius:999px;padding:4px 10px;font-size:11px;color:rgba(255,255,255,0.7)"><i class="ti ti-users" aria-hidden="true" style="font-size:11px"></i>${m.poblacion.toLocaleString('es-ES')} hab.</div>`);
  if (m.area_km2) pills.push(`<div style="display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,0.1);border-radius:999px;padding:4px 10px;font-size:11px;color:rgba(255,255,255,0.7)"><i class="ti ti-ruler-2" aria-hidden="true" style="font-size:11px"></i>${m.area_km2} km²</div>`);
  if (visitado) pills.push(`<div style="display:inline-flex;align-items:center;gap:5px;background:rgba(34,176,80,0.2);border-radius:999px;padding:4px 10px;font-size:11px;color:#22b050"><i class="ti ti-check" aria-hidden="true" style="font-size:11px"></i>Conquistado</div>`);
  document.getElementById('mm-pills').innerHTML = pills.join(' ');

  // Contenido
  document.getElementById('mm-desc').textContent = m.descripcion || 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.';
  document.getElementById('mm-curiosidad').textContent = m.curiosidad || 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.';

  const visitasItems = (m.visitas || ['Lugar de interés 1 — Lorem ipsum dolor sit amet.','Lugar de interés 2 — Ut enim ad minim veniam quis.','Lugar de interés 3 — Duis aute irure dolor reprehenderit.']);
  document.getElementById('mm-visitas').innerHTML = visitasItems.map((v,i) => `
    <div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
      <div style="width:24px;height:24px;border-radius:50%;background:rgba(34,176,80,0.2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#22b050;flex-shrink:0">${i+1}</div>
      <p style="font-size:13px;color:rgba(255,255,255,0.65);line-height:1.45;margin:0">${v}</p>
    </div>`).join('');

  const comerItems = (m.comer || ['Restaurante 1 — Lorem ipsum especialidad local.','Restaurante 2 — Ut enim ad minim cocina tradicional.','Bar / Sidrería 3 — Gastronomía local y productos de temporada.']);
  document.getElementById('mm-comer').innerHTML = comerItems.map((c,i) => `
    <div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
      <div style="width:24px;height:24px;border-radius:50%;background:rgba(232,40,138,0.2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#e8288a;flex-shrink:0">${i+1}</div>
      <p style="font-size:13px;color:rgba(255,255,255,0.65);line-height:1.45;margin:0">${c}</p>
    </div>`).join('');

  // Botón ver en mapa
  document.getElementById('mm-btn-mapa').onclick = () => {
    closeMuniModal();
    state.selectedMuni = nombre;
    switchScreen('map');
    setTimeout(() => {
      document.querySelectorAll('.muni-path').forEach(p => p.classList.remove('selected'));
      document.querySelectorAll('.muni-path').forEach(p => {
        if (p.getAttribute('data-name') === nombre) { p.classList.add('selected'); showMuniBar(nombre); }
      });
    }, 250);
  };

  // Cargar evidencias de amigos en esta ficha
  loadMuniFriendEvidence(nombre);

  const modal = document.getElementById('muni-modal');
  modal.style.display = 'flex';
}

async function loadMuniFriendEvidence(municipio) {
  const container = document.getElementById('mm-friend-evidence');
  if (!container) return;
  container.innerHTML = '<div style="color:rgba(255,255,255,0.25);font-size:12px">Buscando evidencias de amigos...</div>';

  if (!state.user) return;

  // Obtener amigos
  const { data: friends } = await db
    .from('friendships')
    .select('follower_id, following_id')
    .or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`)
    .eq('estado', 'aceptado');

  const friendIds = (friends||[]).map(f =>
    f.follower_id === state.user.id ? f.following_id : f.follower_id
  );

  if (!friendIds.length) {
    container.innerHTML = '<div style="color:rgba(255,255,255,0.25);font-size:12px">Ningún amigo ha visitado este municipio aún.</div>';
    return;
  }

  // Visitas de amigos a este municipio
  const { data: visitas } = await db
    .from('visits')
    .select('*, profiles(id, username, avatar_url)')
    .in('user_id', friendIds)
    .eq('municipio', municipio)
    .order('created_at', { ascending: false });

  // Fotos de amigos en este municipio
  const { data: fotos } = await db
    .from('photos')
    .select('*')
    .in('user_id', friendIds)
    .eq('municipio', municipio)
    .neq('storage_path', 'text_only')
    .order('created_at', { ascending: false });

  if (!visitas || !visitas.length) {
    container.innerHTML = '<div style="color:rgba(255,255,255,0.25);font-size:12px">Ningún amigo ha visitado este municipio aún.</div>';
    return;
  }

  const fotasByUser = {};
  (fotos||[]).forEach(f => { fotasByUser[f.user_id] = f; });

  const header = '<div style="margin-bottom:10px;font-size:11px;color:rgba(255,255,255,0.4);font-weight:600;letter-spacing:.05em;text-transform:uppercase">' +
    visitas.length + ' amigo' + (visitas.length !== 1 ? 's' : '') + ' han visitado este municipio</div>';

  const cards = visitas.map(v => {
    const u      = v.profiles?.username || 'Usuario';
    const init   = u.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
    const av     = v.profiles?.avatar_url;
    const foto   = fotasByUser[v.user_id];
    const imgUrl = foto && foto.storage_path !== 'text_only'
      ? db.storage.from('evidencias').getPublicUrl(foto.storage_path).data?.publicUrl
      : null;
    const fecha  = new Date(v.created_at).toLocaleDateString('es-ES', {day:'numeric', month:'short', year:'numeric'});

    const imgHtml = imgUrl
      ? '<img src="' + imgUrl + '?t=' + Date.now() + '" style="width:100%;height:140px;object-fit:cover;display:block" alt="' + u + '"/>'
      : '';
    const avHtml = av
      ? '<img src="' + av + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="' + u + '"/>'
      : init;
    const descHtml = foto && foto.descripcion
      ? '<div style="padding:0 12px 10px;font-size:13px;color:rgba(255,255,255,0.6)">' + foto.descripcion + '</div>'
      : '';

    return '<div style="background:rgba(255,255,255,0.04);border-radius:12px;overflow:hidden;margin-bottom:10px;border:1px solid rgba(255,255,255,0.07)">' +
      imgHtml +
      '<div style="padding:10px 12px;display:flex;align-items:center;gap:10px">' +
        '<div style="width:32px;height:32px;border-radius:50%;background:#1a2535;border:1.5px solid #e86820;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;color:#e86820;flex-shrink:0;overflow:hidden">' + avHtml + '</div>' +
        '<div style="flex:1">' +
          '<div style="font-size:13px;font-weight:500;color:#fff">' + u + '</div>' +
          '<div style="font-size:11px;color:rgba(255,255,255,0.35)">Visitó el ' + fecha + '</div>' +
        '</div>' +
      '</div>' +
      descHtml +
    '</div>';
  }).join('');

  container.innerHTML = header + cards;
}

function closeMuniModal() {
  document.getElementById('muni-modal').style.display = 'none';
}

// ── FEED DE AMIGOS ────────────────────────────────────────────
async function loadFeed(forceRefresh = false) {
  if (!state.user) return;

  // Usar cache si existe y no se fuerza refresco (evita recargar al volver a la tab)
  if (!forceRefresh && state.feedCache && Date.now() - state.feedCacheTime < 60000) {
    renderFeedFromCache();
    return;
  }

  // Skeleton loading
  document.getElementById('stories-row').innerHTML = [1,2,3].map(() =>
    '<div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:5px">' +
    '<div style="width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,0.06);animation:pulse 1.5s ease infinite"></div>' +
    '<div style="width:36px;height:8px;border-radius:4px;background:rgba(255,255,255,0.06);animation:pulse 1.5s ease infinite"></div>' +
    '</div>'
  ).join('');
  document.getElementById('feed-posts').innerHTML =
    '<div style="padding:12px">' + [1,2].map(() =>
      '<div style="background:rgba(255,255,255,0.04);border-radius:18px;height:320px;margin-bottom:14px;animation:pulse 1.5s ease infinite"></div>'
    ).join('') + '</div>';

  // Cargar amigos primero (necesitamos sus IDs)
  const { data: friends } = await db
    .from('friendships')
    .select('follower_id,following_id,follower:profiles!friendships_follower_id_fkey(id,username,avatar_url),following:profiles!friendships_following_id_fkey(id,username,avatar_url)')
    .or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`)
    .eq('estado', 'aceptado');

  const seen = new Set();
  const friendProfiles = (friends || []).map(f =>
    f.follower_id === state.user.id ? f.following : f.follower
  ).filter(p => { if (!p || seen.has(p.id)) return false; seen.add(p.id); return true; });

  const friendIds = friendProfiles.map(p => p.id);
  renderStories(friendProfiles);

  if (!friendIds.length) {
    document.getElementById('feed-posts').innerHTML =
      '<div style="text-align:center;padding:30px 20px;color:rgba(255,255,255,0.3);font-size:13px;line-height:1.7">' +
      '<i class="ti ti-users" aria-hidden="true" style="font-size:32px;display:block;margin-bottom:10px"></i>' +
      'Aún no tienes amigos añadidos.<br>¡Busca a alguien por su nombre de usuario!</div>';
    return;
  }

  const allIds = [...new Set([...friendIds, state.user.id])];

  // TODAS LAS QUERIES EN PARALELO — de ~6 llamadas secuenciales a 3 simultáneas
  const [
    { data: fotasAmigos },
    { data: fotasMias },
    { data: visits },
  ] = await Promise.all([
    db.from('photos').select('*')
      .in('user_id', friendIds)
      .in('visibilidad', ['amigos','publico'])
      .order('created_at', { ascending: false }).limit(60),
    db.from('photos').select('*')
      .eq('user_id', state.user.id)
      .order('created_at', { ascending: false }).limit(60),
    db.from('visits').select('*, profiles(id,username,avatar_url)')
      .in('user_id', allIds)
      .order('created_at', { ascending: false }).limit(40),
  ]);

  const todasFotas = [...(fotasAmigos||[]), ...(fotasMias||[])];

  const fotasByUser = {};
  const fotasByMuniUser = {};
  todasFotas.forEach(f => {
    if (!fotasByUser[f.user_id]) fotasByUser[f.user_id] = [];
    fotasByUser[f.user_id].push(f);
    const key = f.user_id + '|' + normalizeMuni(f.municipio);
    if (!fotasByMuniUser[key]) fotasByMuniUser[key] = [];
    fotasByMuniUser[key].push(f);
  });

  const visibleVisits = (visits || []).filter(v =>
    v.user_id === state.user.id || ['amigos','publico'].includes(v.visibilidad)
  );

  // Guardar en cache
  state.feedCache = { visibleVisits, fotasByMuniUser, fotasByUser, friendProfiles };
  state.feedCacheTime = Date.now();

  renderFeedPosts(visibleVisits, fotasByMuniUser, fotasByUser, friendProfiles);
}

function renderFeedFromCache() {
  const { visibleVisits, fotasByMuniUser, fotasByUser, friendProfiles } = state.feedCache;
  renderStories(friendProfiles);
  renderFeedPosts(visibleVisits, fotasByMuniUser, fotasByUser, friendProfiles);
}

function normalizeMuni(s) {
  return (s || '').trim().toLowerCase();
}

const STORY_COLORS = ['#c97ae8','#7ae8c9','#e87a9a','#e8b97a','#7ab3e8','#a8e87a'];

function renderStories(friendProfiles) {
  if (!friendProfiles.length) {
    document.getElementById('stories-row').innerHTML = '';
    return;
  }
  document.getElementById('stories-row').innerHTML = friendProfiles.slice(0,8).map((p, i) => {
    const initials = (p.username || '?').split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
    const color    = STORY_COLORS[i % STORY_COLORS.length];
    const avatar   = p.avatar_url
      ? `<img src="${p.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="${p.username}"/>`
      : `<span style="color:${color};font-family:'Playfair Display',serif;font-size:14px;font-weight:500">${initials}</span>`;
    return `
      <div class="story-item">
        <div class="story-ring">
          <div class="story-av">${avatar}</div>
        </div>
        <div class="story-name">${p.username || '?'}</div>
      </div>`;
  }).join('');
}

async function getPhotoUrl(storagePath) {
  if (!storagePath || storagePath === 'text_only') return null;
  // Crear URL firmada válida 1 hora (funciona para buckets privados y públicos)
  const { data } = await db.storage
    .from('evidencias')
    .createSignedUrl(storagePath, 3600);
  return data?.signedUrl || db.storage.from('evidencias').getPublicUrl(storagePath).data?.publicUrl || null;
}

async function renderFeedPosts(visits, fotasByMuniUser, fotasByUser, friendProfiles) {
  if (!visits.length) {
    document.getElementById('feed-posts').innerHTML = `
      <div style="text-align:center;padding:24px;color:rgba(255,255,255,0.3);font-size:13px;line-height:1.7">
        <i class="ti ti-map-2" aria-hidden="true" style="font-size:32px;display:block;margin-bottom:10px"></i>
        Tus amigos aún no han conquistado municipios.
      </div>`;
    return;
  }

  document.getElementById('feed-posts').innerHTML = visits.map((v, i) => {
    const coast      = isCoast(v.municipio);
    const username   = v.profiles?.username || 'Usuario';
    const userId     = v.profiles?.id || v.user_id;
    const initials   = username.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
    const color      = STORY_COLORS[i % STORY_COLORS.length];
    const isMe       = userId === state.user?.id;
    const fp         = isMe ? state.profile : (friendProfiles || []).find(f => f.id === userId);
    const avatarUrl  = fp?.avatar_url || v.profiles?.avatar_url;
    const avatarHtml = avatarUrl
      ? `<img src="${avatarUrl}?t=${Date.now()}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="${username}"/>`
      : initials;

    // Buscar foto: 1) por user+municipio exacto, 2) por user+municipio normalizado, 3) cualquier foto del usuario
    const keyExact = v.user_id + '|' + normalizeMuni(v.municipio);
    const keyOld   = v.user_id + '_' + normalizeMuni(v.municipio);
    const fotos    = fotasByMuniUser[keyExact] || fotasByMuniUser[keyOld] || [];
    // Si no hay foto del municipio exacto, buscar cualquier foto del usuario para ese municipio
    const foto = fotos.find(f => normalizeMuni(f.municipio) === normalizeMuni(v.municipio))
              || fotos[0]
              || null;
    const imgUrl = foto && foto.storage_path && foto.storage_path !== 'text_only'
      ? '__FOTO__' + (foto.id || '')
      : null;

    const fecha = new Date(v.created_at).toLocaleDateString('es-ES', {day:'numeric', month:'short', year:'numeric'});

    return `
    <div class="feed-post">
      <div class="post-header" onclick="openFriendProfile('${userId}','${username}')" style="cursor:pointer">
        <div class="post-av" style="color:${color};overflow:hidden">${avatarHtml}</div>
        <div>
          <div class="post-user">${username}</div>
          <div class="post-time">${fecha}</div>
        </div>
        <div class="post-badge ${coast?'pb-coast':'pb-mount'}">
          <i class="ti ${coast?'ti-waves':'ti-mountain'}" aria-hidden="true" style="font-size:10px"></i>
          ${coast?'Costa':'Montaña'}
        </div>
      </div>
      <div class="post-img" style="background:${coast?'#0d2535':'#0d2a1e'}">
        ${imgUrl && imgUrl.startsWith('__FOTO__')
          ? `<img src="" data-foto-id="${imgUrl.replace('__FOTO__','')}" style="width:100%;height:100%;object-fit:cover;display:none" alt="${v.municipio}" onerror="this.style.display='none'"/>
             <div class="post-img-placeholder" style="display:flex;flex-direction:column;align-items:center;gap:8px;color:rgba(255,255,255,0.2)">
               <div class="spin" style="width:20px;height:20px;border-width:2px"></div>
             </div>`
          : `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;color:rgba(255,255,255,0.2)">
               <i class="ti ${coast?'ti-waves':'ti-mountain'}" aria-hidden="true" style="font-size:38px"></i>
               <span style="font-size:11px">Sin foto de evidencia</span>
             </div>`}
        <div class="post-location">
          <i class="ti ti-map-pin" aria-hidden="true"></i>${v.municipio}
        </div>
      </div>
      <div class="post-body">
        <div class="post-muni">${v.municipio}</div>
        ${foto?.descripcion ? `<div class="post-desc">${foto.descripcion}</div>` : ''}
        <div class="post-actions">
          ${foto ? `
          <button class="post-action" onclick="toggleLike(this,'${foto.id}')" data-liked="false">
            <i class="ti ti-heart" aria-hidden="true"></i><span id="likes-${foto.id}">0</span>
          </button>` : `<div></div>`}
          <button class="post-action" style="margin-left:auto" onclick="openMuniModal(this.dataset.muni)" data-muni="${v.municipio}">
            <i class="ti ti-info-circle" aria-hidden="true"></i><span style="font-size:11px">Ver ficha</span>
          </button>
          <button class="post-action" onclick="goToMuniOnMap(this.dataset.muni)" data-muni="${v.municipio}">
            <i class="ti ti-map-pin" aria-hidden="true"></i><span style="font-size:11px">Mapa</span>
          </button>
          ${v.user_id === state.user?.id ? `
          <button class="post-action" onclick="deleteFeedPost('${v.id}','${foto ? foto.id : ''}','${foto ? (foto.path||foto.storage_path||'') : ''}')" style="color:rgba(232,40,40,0.5)">
            <i class="ti ti-trash" aria-hidden="true"></i>
          </button>` : ''}
        </div>
        <!-- Comentarios: usar foto.id si hay foto, visit.id como fallback -->
        <div id="comments-${foto ? foto.id : v.id}" class="post-comments" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06)">
          <div style="color:rgba(255,255,255,0.25);font-size:11px">Cargando comentarios...</div>
        </div>
        <div class="comment-input-row">
          <input class="comment-input" id="comment-input-${foto ? foto.id : v.id}" type="text" placeholder="Añade un comentario..." maxlength="200"
            onkeydown="if(event.key==='Enter')postComment('${foto ? foto.id : v.id}','${v.user_id}','${v.municipio.replace(/'/g,"\\'")}')"/>
          <button class="comment-send" onclick="postComment('${foto ? foto.id : v.id}','${v.user_id}','${v.municipio.replace(/'/g,"\\'")}')">
            <i class="ti ti-send" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');

  // Cargar signed URLs, likes y comentarios
  visits.forEach(v => {
    const keyE = v.user_id + '|' + normalizeMuni(v.municipio);
    const keyO = v.user_id + '_' + normalizeMuni(v.municipio);
    const foto = (fotasByMuniUser[keyE] || fotasByMuniUser[keyO] || [])[0];
    if (foto && foto.storage_path && foto.storage_path !== 'text_only') {
      loadSignedFotoUrl(foto.id, foto.storage_path, v.id);
      loadPhotoLikes(foto.id);
    }
    // Cargar comentarios por foto_id si existe, si no por visit_id
    const commentId = foto?.id || v.id;
    loadVisitComments(commentId, v.id);
  });
}

async function loadSignedFotoUrl(fotoId, storagePath, visitId) {
  try {
    // Intentar URL firmada primero (funciona con bucket privado o público)
    const { data: signed } = await db.storage
      .from('evidencias')
      .createSignedUrl(storagePath, 3600);

    const url = signed?.signedUrl
      || db.storage.from('evidencias').getPublicUrl(storagePath).data?.publicUrl;

    if (!url) return;

    // Buscar la img con placeholder y reemplazar src
    const imgEl = document.querySelector('img[data-foto-id="' + fotoId + '"]');
    if (imgEl) {
      imgEl.src = url;
      imgEl.style.display = 'block';
      imgEl.closest('.post-img')?.querySelector('.post-img-placeholder')?.remove();
    }
  } catch(e) {
    console.error('Error cargando foto firmada:', e);
  }
}

async function loadVisitComments(commentId, visitId) {
  const id = commentId || visitId;
  const container = document.getElementById('comments-' + id);
  if (!container) return;

  const { data: comments } = await db
    .from('photo_comments')
    .select('*, profiles(username, avatar_url)')
    .eq('photo_id', id)
    .order('created_at', { ascending: true })
    .limit(20);

  if (!comments || !comments.length) {
    container.innerHTML = '<div style="color:rgba(255,255,255,0.2);font-size:11px;padding:4px 0">Sin comentarios aún</div>';
    return;
  }

  container.innerHTML = comments.map(c => {
    const u        = c.profiles?.username || 'Usuario';
    const initials = u.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
    const avatar   = c.profiles?.avatar_url
      ? '<img src="' + c.profiles.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="' + u + '"/>'
      : initials;
    const isMe  = c.user_id === state.user?.id;
    const delBtn = isMe
      ? '<button class="c-del" onclick="deleteComment(\'' + c.id + '\',\'' + id + '\')" title="Borrar"><i class="ti ti-trash" aria-hidden="true"></i></button>'
      : '';
    return '<div class="comment"><div class="c-av">' + avatar + '</div><div class="c-text"><strong>' + u + '</strong> ' + c.texto + '</div>' + delBtn + '</div>';
  }).join('');
}

async function postComment(visitId, targetUserId, municipio) {
  const input = document.getElementById('comment-input-' + visitId);
  if (!input || !state.user) return;
  const texto = input.value.trim();
  if (!texto) return;

  input.value = '';
  input.disabled = true;

  try {
    await db.from('photo_comments').insert({
      user_id:  state.user.id,
      photo_id: visitId,
      texto,
    });
    await loadVisitComments(visitId);
  } catch(err) {
    alert('Error al comentar: ' + err.message);
  } finally {
    input.disabled = false;
  }
}

async function deleteFeedPost(visitId, photoId, storagePath) {
  if (!state.user) return;
  if (!confirm('¿Borrar esta publicación?')) return;
  try {
    // Borrar foto del storage si existe
    if (storagePath && storagePath !== 'text_only' && storagePath !== '') {
      await db.storage.from('evidencias').remove([storagePath]);
    }
    // Borrar foto de la tabla
    if (photoId) await db.from('photos').delete().eq('id', photoId).eq('user_id', state.user.id);
    // Borrar visita
    await db.from('visits').delete().eq('id', visitId).eq('user_id', state.user.id);
    // Actualizar estado
    delete state.visited[state.feedCache?.visibleVisits?.find(v => v.id === visitId)?.municipio];
    state.feedCache = null;
    state.photos = state.photos.filter(p => p.id !== photoId);
    updateProgress();
    loadFeed(true);
  } catch(err) {
    alert('Error al borrar: ' + err.message);
  }
}

function goToMuniOnMap(muni) {
  state.selectedMuni = muni;
  switchScreen('map');
  setTimeout(() => {
    document.querySelectorAll('.muni-path').forEach(p => p.classList.remove('selected'));
    document.querySelectorAll('.muni-path').forEach(p => {
      if (p.getAttribute('data-name') === muni) { p.classList.add('selected'); showMuniBar(muni); }
    });
  }, 250);
}

// ── PERFIL DE AMIGO ──────────────────────────────────────────
async function openFriendProfile(userId, username) {
  const modal = document.getElementById('friend-profile-modal');
  if (!modal) return;

  // Limpiar y mostrar loading
  document.getElementById('fp-username').textContent  = username;
  document.getElementById('fp-avatar').textContent    = username.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
  document.getElementById('fp-visits-count').textContent = '...';
  document.getElementById('fp-photos-count').textContent = '...';
  document.getElementById('fp-gallery').innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:12px;padding:10px 0">Cargando...</div>';
  document.getElementById('fp-map').innerHTML = '';
  modal.style.display = 'flex';

  // Cargar datos del amigo
  const [profileRes, visitsRes, photosRes] = await Promise.all([
    db.from('profiles').select('username, avatar_url').eq('id', userId).single(),
    db.from('visits').select('municipio, fecha, created_at').eq('user_id', userId).in('visibilidad',['amigos','publico']).order('created_at',{ascending:false}),
    db.from('photos').select('*').eq('user_id', userId).in('visibilidad',['amigos','publico']).order('created_at',{ascending:false}).limit(9),
  ]);

  const profile = profileRes.data;
  const visits  = visitsRes.data || [];
  const photos  = photosRes.data || [];

  // Avatar
  if (profile?.avatar_url) {
    document.getElementById('fp-avatar').innerHTML = `<img src="${profile.avatar_url}?t=${Date.now()}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="${username}"/>`;
  }

  // Stats
  document.getElementById('fp-visits-count').textContent = visits.length;
  document.getElementById('fp-photos-count').textContent = photos.length;

  // Últimas visitas (lista)
  const fpMap = document.getElementById('fp-map');
  if (visits.length) {
    fpMap.innerHTML = visits.slice(0,10).map(v => {
      const coast = isCoast(v.municipio);
      const fecha = new Date(v.created_at).toLocaleDateString('es-ES',{day:'numeric',month:'short'});
      return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
        <div style="width:32px;height:32px;border-radius:8px;background:${coast?'#0d2a4a':'#0d2a1e'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i class="ti ${coast?'ti-waves':'ti-mountain'}" style="font-size:15px;color:${coast?'#85B7EB':'#5DCAA5'}" aria-hidden="true"></i>
        </div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:500;color:#fff">${v.municipio}</div>
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,0.35)">${fecha}</div>
      </div>`;
    }).join('');
  } else {
    fpMap.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:12px;padding:10px 0">Sin visitas públicas</div>';
  }

  // Galería fotos
  const gallery = document.getElementById('fp-gallery');
  if (photos.length) {
    gallery.innerHTML = photos.map(p => {
      const url = db.storage.from('evidencias').getPublicUrl(p.storage_path).data?.publicUrl || '';
      return `<div style="aspect-ratio:1;border-radius:8px;overflow:hidden;background:#1a2535">
        ${url ? `<img src="${url}" style="width:100%;height:100%;object-fit:cover" alt="${p.municipio}"/>` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.15);font-size:20px"><i class="ti ti-camera" aria-hidden="true"></i></div>`}
      </div>`;
    }).join('');
  } else {
    gallery.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:12px;padding:10px 0">Sin fotos públicas</div>';
  }
}

function closeFriendProfile() {
  document.getElementById('friend-profile-modal').style.display = 'none';
}

async function loadPhotoLikes(photoId) {
  const { count } = await db
    .from('photo_likes')
    .select('*', { count:'exact', head:true })
    .eq('photo_id', photoId);
  const el = document.getElementById('likes-' + photoId);
  if (el) el.textContent = count || 0;
}

async function toggleLike(btn, photoId) {
  if (!state.user) return;
  const liked = btn.getAttribute('data-liked') === 'true';
  btn.setAttribute('data-liked', String(!liked));
  btn.classList.toggle('liked', !liked);
  const span = btn.querySelector('span');
  if (!liked) {
    await db.from('photo_likes').insert({ user_id: state.user.id, photo_id: photoId });
    span.textContent = parseInt(span.textContent) + 1;
  } else {
    await db.from('photo_likes').delete().eq('user_id', state.user.id).eq('photo_id', photoId);
    span.textContent = parseInt(span.textContent) - 1;
  }
}

// ── BUSCAR AMIGOS ─────────────────────────────────────────────
async function searchUser() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  const res = document.getElementById('search-results');
  res.innerHTML = '<div style="color:rgba(255,255,255,0.35);font-size:12px;padding:8px 0">Buscando...</div>';

  const { data } = await db
    .from('profiles')
    .select('id, username')
    .ilike('username', `%${q}%`)
    .neq('id', state.user.id)
    .limit(10);

  if (!data || !data.length) {
    res.innerHTML = '<div style="color:rgba(255,255,255,0.4);font-size:13px;padding:8px 0">No se encontró ningún usuario</div>';
    return;
  }

  // Obtener estado de amistad con cada resultado
  const { data: friendships } = await db
    .from('friendships')
    .select('follower_id, following_id, estado')
    .or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`);

  res.innerHTML = data.map(u => {
    const rel = (friendships || []).find(f =>
      (f.follower_id === state.user.id && f.following_id === u.id) ||
      (f.following_id === state.user.id && f.follower_id === u.id)
    );
    const initials = u.username.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
    let btnHtml = '';
    if (!rel) {
      btnHtml = `<button onclick="sendFriendRequest('${u.id}','${u.username}',this)"
        style="padding:6px 13px;background-color:#2272e8;color:#fff;border:none;border-radius:999px;font-size:11px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;">
        + Añadir
      </button>`;
    } else if (rel.estado === 'pendiente') {
      btnHtml = `<span style="font-size:11px;color:rgba(255,255,255,0.35);background:rgba(255,255,255,0.07);padding:5px 10px;border-radius:999px">
        <i class="ti ti-clock" aria-hidden="true" style="font-size:10px"></i> Pendiente
      </span>`;
    } else if (rel.estado === 'aceptado') {
      btnHtml = `<span style="font-size:11px;color:#22b050;background:rgba(34,176,80,0.12);padding:5px 10px;border-radius:999px">
        <i class="ti ti-check" aria-hidden="true" style="font-size:10px"></i> Amigos
      </span>`;
    }
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07)">
      <div style="width:34px;height:34px;border-radius:50%;background:#1a2535;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;color:#7ab3e8;flex-shrink:0;font-family:Playfair Display,serif">${initials}</div>
      <span style="color:#fff;font-size:13px;flex:1">${u.username}</span>
      ${btnHtml}
    </div>`;
  }).join('');
}

async function sendFriendRequest(toId, toUsername, btn) {
  if (!state.user) return;
  // Cambiar botón a pendiente inmediatamente
  if (btn) {
    btn.outerHTML = `<span style="font-size:11px;color:rgba(255,255,255,0.35);background:rgba(255,255,255,0.07);padding:5px 10px;border-radius:999px">
      <i class="ti ti-clock" aria-hidden="true" style="font-size:10px"></i> Pendiente
    </span>`;
  }
  const { error } = await db.from('friendships').insert({
    follower_id:  state.user.id,
    following_id: toId,
    estado:       'pendiente',
  });
  if (error && error.code !== '23505') {
    alert('Error al enviar solicitud. Inténtalo de nuevo.');
    searchUser(); // refrescar
  }
}

// ── PERFIL ────────────────────────────────────────────────────
async function renderProfile() {
  const c = Object.keys(state.visited).length;
  document.getElementById('sv').textContent  = c;
  document.getElementById('sp').textContent  = Math.round(c / state.totalMuni * 100) + '%';
  document.getElementById('sph').textContent = state.photos.length;
  renderGallery();
  await Promise.all([loadSolicitudes(), loadFriendCount()]);
}

async function loadFriendCount() {
  if (!state.user) return;
  const { count } = await db
    .from('friendships')
    .select('*', { count: 'exact', head: true })
    .or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`)
    .eq('estado', 'aceptado');
  const el = document.getElementById('sf');
  if (el) el.textContent = count || 0;
}

async function openFriendsModal() {
  const modal = document.getElementById('friends-list-modal');
  const content = document.getElementById('friends-list-content');
  if (!modal || !content) return;
  content.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:13px;padding:10px 0">Cargando...</div>';
  modal.style.display = 'flex';

  const { data: friends } = await db
    .from('friendships')
    .select('follower_id,following_id,follower:profiles!friendships_follower_id_fkey(id,username,avatar_url),following:profiles!friendships_following_id_fkey(id,username,avatar_url)')
    .or(`follower_id.eq.${state.user.id},following_id.eq.${state.user.id}`)
    .eq('estado', 'aceptado');

  const seen = new Set();
  const list = (friends || []).map(f =>
    f.follower_id === state.user.id ? f.following : f.follower
  ).filter(p => { if (!p || seen.has(p.id)) return false; seen.add(p.id); return true; });

  if (!list.length) {
    content.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:13px;padding:20px 0;text-align:center">Aún no tienes amigos añadidos</div>';
    return;
  }

  content.innerHTML = list.map(p => {
    const init = (p.username||'?').split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
    const av   = p.avatar_url
      ? '<img src="' + p.avatar_url + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="' + p.username + '"/>'
      : init;
    return '<div onclick="closeFriendsModal();openFriendProfile(\'' + p.id + '\',\'' + p.username.replace(/'/g,"\\'") + '\')" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer">' +
      '<div style="width:42px;height:42px;border-radius:50%;background:#1a2535;border:1.5px solid #e86820;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:500;color:#e86820;flex-shrink:0;overflow:hidden">' + av + '</div>' +
      '<div style="flex:1"><div style="font-size:14px;font-weight:500;color:#fff">' + p.username + '</div></div>' +
      '<i class="ti ti-chevron-right" style="color:rgba(255,255,255,0.2);font-size:16px" aria-hidden="true"></i>' +
    '</div>';
  }).join('');
}

function closeFriendsModal() {
  document.getElementById('friends-list-modal').style.display = 'none';
}

async function loadSolicitudes() {
  if (!state.user) return;

  const { data: recibidas } = await db
    .from('friendships')
    .select('follower_id, created_at, profiles!friendships_follower_id_fkey(username)')
    .eq('following_id', state.user.id)
    .eq('estado', 'pendiente');

  const { data: enviadas } = await db
    .from('friendships')
    .select('following_id, created_at, profiles!friendships_following_id_fkey(username)')
    .eq('follower_id', state.user.id)
    .eq('estado', 'pendiente');

  const container = document.getElementById('solicitudes-section');
  if (!container) return;

  const totalPendientes = (recibidas?.length || 0) + (enviadas?.length || 0);

  if (totalPendientes === 0) {
    container.innerHTML = '';
    return;
  }

  let html = `
    <div style="padding:14px 14px 0">
      <h2 style="font-size:11px;font-weight:500;color:rgba(255,255,255,0.4);margin-bottom:10px;letter-spacing:.06em;text-transform:uppercase">
        Solicitudes de amistad
        <span style="background:#e8288a;color:#fff;border-radius:999px;padding:1px 7px;font-size:10px;margin-left:6px">${totalPendientes}</span>
      </h2>`;

  if (recibidas?.length > 0) {
    html += `<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:8px">Recibidas</div>`;
    html += recibidas.map(s => {
      const username = s.profiles?.username || 'Usuario';
      const initials = username.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
      const fecha    = new Date(s.created_at).toLocaleDateString('es-ES');
      return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07)">
        <div style="width:38px;height:38px;border-radius:50%;background:#1a2535;border:1.5px solid #e8288a;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;color:#e8288a;flex-shrink:0;font-family:Playfair Display,serif">${initials}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:500;color:#fff">${username}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:1px">${fecha}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button onclick="aceptarSolicitud('${s.follower_id}','${username}')"
            style="padding:7px 12px;background-color:#22b050;color:#fff;border:none;border-radius:999px;font-size:11px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;">
            <i class="ti ti-check" aria-hidden="true"></i> Aceptar
          </button>
          <button onclick="rechazarSolicitud('${s.follower_id}','${username}')"
            style="padding:7px 10px;background-color:rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);border:none;border-radius:999px;font-size:11px;cursor:pointer;font-family:Inter,sans-serif;">
            <i class="ti ti-x" aria-hidden="true"></i>
          </button>
        </div>
      </div>`;
    }).join('');
  }

  if (enviadas?.length > 0) {
    html += `<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:12px;margin-bottom:8px">Enviadas</div>`;
    html += enviadas.map(s => {
      const username = s.profiles?.username || 'Usuario';
      const initials = username.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
      const fecha    = new Date(s.created_at).toLocaleDateString('es-ES');
      return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07)">
        <div style="width:38px;height:38px;border-radius:50%;background:#1a2535;border:1.5px solid rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;color:rgba(255,255,255,0.5);flex-shrink:0;font-family:Playfair Display,serif">${initials}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:500;color:#fff">${username}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:1px">${fecha}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:11px;color:rgba(255,255,255,0.3);background:rgba(255,255,255,0.07);padding:5px 10px;border-radius:999px">
            <i class="ti ti-clock" aria-hidden="true" style="font-size:11px"></i> Pendiente
          </span>
          <button onclick="cancelarSolicitud('${s.following_id}','${username}')"
            style="padding:7px 10px;background-color:rgba(255,255,255,0.08);color:rgba(255,255,255,0.5);border:none;border-radius:999px;font-size:11px;cursor:pointer;font-family:Inter,sans-serif;">
            <i class="ti ti-x" aria-hidden="true"></i>
          </button>
        </div>
      </div>`;
    }).join('');
  }

  html += `</div>`;
  container.innerHTML = html;
}

async function aceptarSolicitud(fromUserId, username) {
  await db.from('friendships')
    .update({ estado: 'aceptado' })
    .eq('follower_id', fromUserId)
    .eq('following_id', state.user.id);
  await db.from('friendships').upsert({
    follower_id:  state.user.id,
    following_id: fromUserId,
    estado:       'aceptado',
  });
  await loadSolicitudes();
}

async function rechazarSolicitud(fromUserId, username) {
  if (!confirm('Rechazar la solicitud de ' + username + '?')) return;
  await db.from('friendships')
    .delete()
    .eq('follower_id', fromUserId)
    .eq('following_id', state.user.id);
  await loadSolicitudes();
}

async function cancelarSolicitud(toUserId, username) {
  if (!confirm('Cancelar la solicitud enviada a ' + username + '?')) return;
  await db.from('friendships')
    .delete()
    .eq('follower_id', state.user.id)
    .eq('following_id', toUserId);
  await loadSolicitudes();
}

function renderGallery() {
  const g = document.getElementById('gallery');
  const e = document.getElementById('g-empty');
  if (!state.photos.length) { g.innerHTML = ''; e.style.display = 'block'; return; }
  e.style.display = 'none';
  g.innerHTML = state.photos.map((p,i) => `
    <div class="gi" onclick="openPM(${i})">
      ${p.src
        ? `<img src="${p.src}?nocache=${Date.now()}" alt="${p.muni}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div class="gi-ph" style="display:none"><i class="ti ti-camera" aria-hidden="true"></i></div>`
        : `<div class="gi-ph" style="background:rgba(34,176,80,0.08);flex-direction:column;gap:4px">
             <i class="ti ti-message-circle" aria-hidden="true" style="font-size:18px;color:rgba(255,255,255,0.2)"></i>
             <span style="font-size:9px;color:rgba(255,255,255,0.2);text-align:center;padding:0 4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${p.desc||''}</span>
           </div>`}
      <div class="gi-hov">
        <div class="gm">
          <div style="font-weight:500">${p.muni.length>14?p.muni.substring(0,12)+'…':p.muni}</div>
          <div>${p.date}</div>
        </div>
      </div>
    </div>`).join('');
}

function openPM(i) {
  const p = state.photos[i];
  state.currentPhotoIndex = i;
  const imgEl = document.getElementById('pm-img');
  if (p.src) {
    imgEl.src   = p.src + '?nocache=' + Date.now();
    imgEl.style.display = 'block';
  } else {
    imgEl.src   = '';
    imgEl.style.display = 'none';
  }
  document.getElementById('pm-meta').innerHTML = `
    <div class="mrow"><i class="ti ti-map-pin" aria-hidden="true"></i><span>Municipio</span><strong>${p.muni}</strong></div>
    <div class="mrow"><i class="ti ti-calendar" aria-hidden="true"></i><span>Fecha</span><strong>${p.date}</strong></div>
    <div class="mrow"><i class="ti ti-clock" aria-hidden="true"></i><span>Hora</span><strong>${p.time || '—'}</strong></div>
    <div class="mrow"><i class="ti ti-location" aria-hidden="true"></i><span>Coordenadas</span><strong>${p.coords || '—'}</strong></div>
    ${p.desc ? `<div class="mrow"><i class="ti ti-message-circle" aria-hidden="true"></i><span>Descripción</span><strong style="white-space:pre-wrap">${p.desc}</strong></div>` : ''}
    <div class="mrow" style="padding-bottom:4px">
      <button onclick="deletePhoto(${i})" style="width:100%;padding:10px;background:rgba(232,40,40,0.15);color:#ff6b6b;border:1px solid rgba(232,40,40,0.3);border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;gap:6px;margin-top:4px">
        <i class="ti ti-trash" aria-hidden="true"></i> Borrar foto
      </button>
    </div>
    <div class="mrow"><i class="ti ti-eye" aria-hidden="true"></i><span>Visibilidad</span>
      <strong style="display:flex;gap:6px;margin-top:4px">
        ${['privado','amigos','publico'].map(v => `
          <button onclick="changePhotoVis('${p.id}','${v}',this)"
            style="padding:4px 10px;border:none;border-radius:999px;font-size:10px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;
              background-color:${p.vis===v?'#2272e8':'rgba(255,255,255,0.1)'};
              color:${p.vis===v?'#fff':'rgba(255,255,255,0.6)'};">
            ${v}
          </button>`).join('')}
      </strong>
    </div>`;
}

async function changePhotoVis(photoId, vis, btn) {
  if (!photoId) return;
  await db.from('photos').update({ visibilidad: vis }).eq('id', photoId);
  const photo = state.photos.find(p => p.id === photoId);
  if (photo) photo.vis = vis;
  // actualizar botones
  btn.closest('strong').querySelectorAll('button').forEach(b => {
    b.style.backgroundColor = b.textContent.trim() === vis ? '#2272e8' : 'rgba(255,255,255,0.1)';
    b.style.color = b.textContent.trim() === vis ? '#fff' : 'rgba(255,255,255,0.6)';
  });
}

function closePM() { document.getElementById('photo-modal').classList.remove('open'); }

async function deletePhoto(i) {
  const p = state.photos[i];
  if (!p || !state.user) return;
  if (!confirm('¿Borrar esta foto de ' + p.muni + '? Esta acción no se puede deshacer.')) return;

  try {
    // Borrar de Storage si tiene path real
    if (p.path && p.path !== 'text_only') {
      await db.storage.from('evidencias').remove([p.path]);
    }
    // Borrar de la tabla photos
    if (p.id) {
      await db.from('photos').delete().eq('id', p.id).eq('user_id', state.user.id);
    }
    // Actualizar estado local
    state.photos.splice(i, 1);
    state.feedCache = null;
    closePM();
    renderGallery();
    const c = Object.keys(state.visited).length;
    document.getElementById('sph').textContent = state.photos.length;
  } catch(err) {
    alert('Error al borrar: ' + err.message);
  }
}

function toggleEdit() {
  const r = document.getElementById('u-edit-row');
  r.style.display = r.style.display === 'flex' ? 'none' : 'flex';
  if (r.style.display === 'flex') {
    document.getElementById('u-inp').value = state.profile?.username || '';
    document.getElementById('u-inp').focus();
  }
}

async function saveUser() {
  const v = document.getElementById('u-inp').value.trim();
  if (!v || !state.user) return;
  await db.from('profiles').update({ username: v }).eq('id', state.user.id);
  state.profile.username = v;
  document.getElementById('u-name').textContent  = v;
  document.getElementById('av-init').textContent = v.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
  document.getElementById('u-edit-row').style.display = 'none';
}

document.getElementById('av-in').addEventListener('change', async function(e) {
  const file = e.target.files[0];
  if (!file || !state.user) return;

  const ring     = document.getElementById('av-ring');
  const initials = ring.querySelector('#av-init')?.textContent || 'EX';
  ring.innerHTML = `<div style="font-size:11px;color:rgba(255,255,255,0.5);display:flex;align-items:center;justify-content:center;width:100%;height:100%">...</div>`;

  try {
    const ext      = file.name.split('.').pop().replace(/[^a-z0-9]/gi,'').toLowerCase() || 'jpg';
    const fileName = `${state.user.id}.${ext}`;

    // Borrar anterior si existe
    await db.storage.from('avatares').remove([fileName]);

    // Subir directo
    const { data: upData, error: upErr } = await db.storage
      .from('avatares')
      .upload(fileName, file, {
        contentType:  file.type || 'image/jpeg',
        upsert:       true,
        cacheControl: '3600',
      });

    if (upErr) {
      console.error('Upload error:', upErr);
      throw new Error(upErr.message);
    }

    // URL pública directa (bucket público)
    const { data: urlData } = db.storage.from('avatares').getPublicUrl(fileName);
    const url = urlData?.publicUrl;

    if (!url) throw new Error('No se pudo obtener la URL pública');

    const urlFresh = url + '?t=' + Date.now();

    // Guardar en perfil
    const { error: dbErr } = await db.from('profiles')
      .update({ avatar_url: url })
      .eq('id', state.user.id);

    if (dbErr) throw dbErr;

    // Actualizar estado local
    if (state.profile) state.profile.avatar_url = url;

    // Mostrar imagen
    ring.innerHTML = `<img src="${urlFresh}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/><div class="av-edit"><i class="ti ti-pencil" aria-hidden="true"></i></div>`;

  } catch(err) {
    console.error('Avatar error:', err);
    ring.innerHTML = `<span id="av-init">${initials}</span><div class="av-edit"><i class="ti ti-pencil" aria-hidden="true"></i></div>`;
    alert('No se pudo subir el avatar: ' + err.message);
  }
});

// ── MAPA GEOGRÁFICO REAL ──────────────────────────────────────
async function loadMap() {
  try {
    // Cargar datos de municipios desde Supabase
    const { data: muniData } = await db.from('municipios').select('*');
    if (muniData) {
      state.municipiosData = {};
      muniData.forEach(m => { state.municipiosData[m.nombre] = m; });
      state.coast    = muniData.filter(m => m.tipo === 'costa').map(m => m.nombre);
      state.mountain = muniData.filter(m => m.tipo === 'montaña').map(m => m.nombre);
    }

    const topo = await d3.json('https://cdn.jsdelivr.net/npm/es-atlas@0.5.0/es/municipalities.json');
    const all  = topojson.feature(topo, topo.objects.municipalities);
    const cant = {
      type: 'FeatureCollection',
      features: all.features.filter(f => String(f.id || '').startsWith('39')),
    };
    state.totalMuni = cant.features.length;

    const cont = document.getElementById('map-cont');
    const W    = cont.clientWidth || 410;
    const H    = Math.round(W * .49);
    const svgEl = document.getElementById('map-svg');
    svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const proj = d3.geoMercator().fitSize([W, H], cant);
    const path = d3.geoPath(proj);
    const svg  = d3.select('#map-svg');
    svg.selectAll('*').remove();

    svg.selectAll('path.muni-path')
      .data(cant.features).join('path')
      .attr('class', d => {
        const name = d.properties.name || d.properties.NAME || d.properties.NAMEUNIT || ('Mun-'+d.id);
        return 'muni-path' + (state.visited[name] ? ' visited' : '');
      })
      .attr('d', path)
      .attr('data-name', d => d.properties.name || d.properties.NAME || d.properties.NAMEUNIT || ('Mun-'+d.id))
      .on('click', function(ev, d) {
        const name = d3.select(this).attr('data-name');
        svg.selectAll('.muni-path').classed('selected', false);
        d3.select(this).classed('selected', true);
        state.selectedMuni = name;
        showMuniBar(name);
      });

    document.getElementById('map-load').style.display = 'none';
    updateProgress();
  } catch(err) {
    document.getElementById('map-load').innerHTML =
      '<p style="color:rgba(255,255,255,0.4);font-size:12px;padding:20px;text-align:center">Error al cargar el mapa.</p>';
  }
}

// ── RELOJ ─────────────────────────────────────────────────────
function updateClock() {
  const t = new Date().toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'});
  document.querySelectorAll('.clock').forEach(el => { el.textContent = t; });
}

// ── SERVICE WORKER ────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ── INIT ──────────────────────────────────────────────────────
// ── ANTI-CACHE: detectar nueva versión y limpiar ─────────────────────────
async function checkForUpdates() {
  try {
    // Leer la versión actual del HTML
    const currentVersion = document.querySelector('meta[name="app-version"]')?.content;
    if (!currentVersion) return;

    // Comparar con la última versión guardada
    const savedVersion = localStorage.getItem('ce_version');

    if (savedVersion && savedVersion !== currentVersion) {
      console.log('Nueva versión detectada, limpiando cache...');
      // Borrar todos los caches del SW
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      // Actualizar versión guardada
      localStorage.setItem('ce_version', currentVersion);
      // No recargar — el cache ya está limpio para la próxima vez
    } else {
      localStorage.setItem('ce_version', currentVersion);
    }
  } catch(e) {
    console.log('checkForUpdates error:', e);
  }
}

// ── Registrar SW con detección de actualización ───────────────────────────
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');

    // Detectar cuando hay un nuevo SW listo
    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      if (!newSW) return;
      newSW.addEventListener('statechange', () => {
        // Nuevo SW instalado y activo — el cache ya está limpio
        if (newSW.state === 'activated') {
          console.log('SW actualizado');
        }
      });
    });

    // Forzar que el SW activo tome control inmediatamente
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });

  } catch(e) {
    console.log('SW registro error:', e);
  }
}

async function init() {
  // Limpiar cache si hay nueva versión
  await checkForUpdates();

  buildNavs();
  renderDice(6);
  updateClock();
  setInterval(updateClock, 30000);

  // Registrar SW
  registerSW();

  // Escuchar cambios de sesión
  db.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      await loadUserData(session.user);
      showApp();
      loadMap();
      loadEventos();
    } else {
      showAuth();
    }
  });

  // Sesión activa
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) {
    await loadUserData(session.user);
    showApp();
    loadMap();
    loadEventos();
  } else {
    showAuth();
  }
}

init();


// ══════════════════════════════════════════════════════════════
//  NOTIFICACIONES PUSH
// ══════════════════════════════════════════════════════════════

const VAPID_PUBLIC_KEY = ''; // Rellenar después de generar las claves VAPID

async function registerPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('Push no soportado en este dispositivo');
    return;
  }
  if (!state.user) return;

  try {
    // Pedir permiso
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('Permiso de notificaciones denegado');
      return;
    }

    if (!VAPID_PUBLIC_KEY) {
      console.log('VAPID key no configurada todavía');
      return;
    }

    // Obtener registro del SW
    const reg = await navigator.serviceWorker.ready;

    // Suscribirse al push
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    // Guardar suscripción en Supabase
    const subJson = sub.toJSON();
    await db.from('push_subscriptions').upsert({
      user_id:   state.user.id,
      endpoint:  subJson.endpoint,
      p256dh:    subJson.keys.p256dh,
      auth:      subJson.keys.auth,
      device:    navigator.userAgent.includes('iPhone') ? 'ios' : 'android',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,endpoint' });

    console.log('✅ Push registrado');
    state.pushRegistered = true;
  } catch(err) {
    console.error('Error registrando push:', err);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = window.atob(base64);
  const output  = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

// Botón para activar notificaciones — llamado desde perfil
async function toggleNotifications() {
  const btn = document.getElementById('btn-notif');
  if (!btn) return;

  if (state.pushRegistered) {
    btn.textContent = '🔔 Notificaciones activas';
    return;
  }

  btn.textContent = 'Activando...';
  btn.disabled = true;
  await registerPushNotifications();
  btn.disabled = false;
  btn.textContent = state.pushRegistered ? '🔔 Notificaciones activas' : '🔕 Activar notificaciones';
}

// Escuchar cambios en tiempo real (Supabase Realtime)
// Esto actualiza el feed cuando un amigo sube algo nuevo
function subscribeToFriendActivity() {
  if (!state.user || state.realtimeSubscribed) return;
  state.realtimeSubscribed = true;

  // Escuchar nuevas visitas
  db.channel('friend-visits')
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'visits',
    }, payload => {
      // Solo refrescar si es de un amigo
      const isFriend = state.feedCache?.friendProfiles?.some(f => f.id === payload.new.user_id);
      if (isFriend || payload.new.user_id === state.user.id) {
        state.feedCache = null; // invalidar cache
        showFeedBadge();
      }
    })
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'photo_comments',
    }, payload => {
      // Refrescar comentarios del post afectado
      loadVisitComments(payload.new.photo_id, null);
    })
    .subscribe();
}

function showFeedBadge() {
  // Mostrar punto rojo en el botón de amigos para indicar actividad nueva
  const btns = document.querySelectorAll('[id^="nb-"][id$="-feed"]');
  btns.forEach(btn => {
    if (!btn.querySelector('.feed-badge')) {
      const dot = document.createElement('div');
      dot.className = 'feed-badge';
      dot.style.cssText = 'position:absolute;top:6px;right:10px;width:8px;height:8px;background:#e8288a;border-radius:50%;border:2px solid #0f1923';
      btn.style.position = 'relative';
      btn.appendChild(dot);
    }
  });
}

function clearFeedBadge() {
  document.querySelectorAll('.feed-badge').forEach(el => el.remove());
}
