// ═══════════════════════════════════════════════════════
//  PATCHES — sobrescriben funciones del app.min.js
// ═══════════════════════════════════════════════════════

// FIX 1: guardarNombre — función nueva sin conflicto con el minificado
async function guardarNombre() {
  const v   = document.getElementById('u-inp').value.trim();
  const row = document.getElementById('u-edit-row');
  
  console.log('guardarNombre llamado, valor:', v, 'user:', state?.user?.id);
  
  if (!v) { alert('Escribe un nombre'); return; }
  if (!state?.user) { alert('No hay sesión activa'); return; }

  // Cerrar PRIMERO visualmente
  row.style.display = 'none';
  row.setAttribute('data-open', '0');

  // Luego guardar en BD
  const { error } = await db.from('profiles').update({ username: v }).eq('id', state.user.id);
  if (error) { alert('Error: ' + error.message); return; }
  
  if (state.profile) state.profile.username = v;
  document.getElementById('u-name').textContent  = v;
  document.getElementById('av-init').textContent = v.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
  console.log('Nombre guardado OK:', v);
}

// FIX 1b: toggleEdit limpio
function toggleEdit() {
  const r = document.getElementById('u-edit-row');
  const isOpen = r.style.display === 'flex';
  if (isOpen) {
    r.style.display = 'none';
    r.setAttribute('data-open', '0');
  } else {
    r.style.display = 'flex';
    r.setAttribute('data-open', '1');
    const inp = document.getElementById('u-inp');
    if (inp) {
      inp.value = state.profile?.username || '';
      setTimeout(() => inp.focus(), 50);
    }
  }
}

// FIX 2: @menciones — azul clicable, abre perfil, solicitar amistad si no es amigo
function renderMentions(texto) {
  return texto.replace(/@(\w+)/g, function(match, user) {
    return '<span class="mention" onclick="openMentionProfile(\'' + user + '\')" style="cursor:pointer;color:#2272e8;font-weight:600;text-decoration:none">@' + user + '</span>';
  });
}

async function openMentionProfile(username) {
  if (!state.user) return;
  const { data: profile } = await db
    .from('profiles').select('id, username, avatar_url')
    .ilike('username', username).single();
  if (!profile) { alert('@' + username + ' no encontrado'); return; }
  if (profile.id === state.user.id) return; // soy yo

  // Comprobar si es amigo
  const { data: friendship } = await db
    .from('friendships')
    .select('estado')
    .or('follower_id.eq.' + state.user.id + ',following_id.eq.' + state.user.id)
    .or('follower_id.eq.' + profile.id + ',following_id.eq.' + profile.id)
    .single();

  const esFriend = friendship?.estado === 'aceptado';
  const esPendiente = friendship?.estado === 'pendiente';

  if (esFriend) {
    openFriendProfile(profile.id, profile.username);
  } else {
    // Mostrar mini modal con opción de solicitar amistad
    const msg = esPendiente
      ? 'Ya tienes una solicitud pendiente con @' + username
      : '¿Enviar solicitud de amistad a @' + username + '?';
    if (!esPendiente && confirm(msg)) {
      await sendFriendRequest(profile.id, profile.username);
    } else if (esPendiente) {
      alert(msg);
    }
  }
}

// FIX 3: Filtros del feed — Descubriendo / Eventos / Rutas
let feedFilter = 'descubriendo';

function setFeedFilter(filter) {
  feedFilter = filter;
  document.querySelectorAll('.feed-filter-btn').forEach(b => {
    const active = b.dataset.filter === filter;
    b.style.backgroundColor = active ? '#2272e8' : 'rgba(255,255,255,0.08)';
    b.style.color = active ? '#fff' : 'rgba(255,255,255,0.5)';
  });
  // Esperar a que el DOM esté listo
  setTimeout(applyFeedFilter, 100);
}

function applyFeedFilter() {
  const posts = document.querySelectorAll('.feed-post');
  if (!posts.length) {
    // Feed aún cargando, reintentar
    setTimeout(applyFeedFilter, 500);
    return;
  }

  posts.forEach(post => {
    // Buscar el municipio en post-location o post-muni
    const locEl  = post.querySelector('.post-location');
    const muniEl = post.querySelector('.post-muni');
    const muni   = (locEl?.textContent || muniEl?.textContent || '').trim();
    const isEvento = muni.includes('🎉');

    if (feedFilter === 'descubriendo') {
      post.style.display = isEvento ? 'none' : '';
    } else if (feedFilter === 'eventos') {
      post.style.display = isEvento ? '' : 'none';
    } else if (feedFilter === 'rutas') {
      post.style.display = 'none';
    }
  });

  // Mensaje si no hay posts visibles
  const feedPosts  = document.getElementById('feed-posts');
  const visible    = [...posts].filter(p => p.style.display !== 'none');
  let emptyMsg     = feedPosts?.querySelector('.feed-empty-msg');

  if (!visible.length && feedPosts && feedFilter !== 'descubriendo') {
    if (!emptyMsg) {
      emptyMsg = document.createElement('div');
      emptyMsg.className = 'feed-empty-msg';
      emptyMsg.style.cssText = 'text-align:center;padding:30px 20px;color:rgba(255,255,255,0.3);font-size:13px';
      feedPosts.appendChild(emptyMsg);
    }
    emptyMsg.textContent = feedFilter === 'rutas'
      ? '🥾 Las rutas están en camino...'
      : 'Sin publicaciones de eventos';
    emptyMsg.style.display = 'block';
  } else if (emptyMsg) {
    emptyMsg.style.display = 'none';
  }
}

// FIX 4: Corrales de Buelna NO es de costa
// Sobrescribir isCoast para excluirlo
const _origIsCoast = window.isCoast;
function isCoast(n) {
  if (!n) return false;
  if (n.toLowerCase().includes('corrales de buelna') || 
      n.toLowerCase().includes('los corrales')) return false;
  if (typeof _origIsCoast === 'function') return _origIsCoast(n);
  const COAST = ['Santander','Castro-Urdiales','Santoña','Laredo','Comillas',
    'San Vicente de la Barquera','Suances','Miengo','Piélagos','Camargo',
    'El Astillero','Noja','Bareyo','Arnuero','Colindres','Limpias',
    'Marina de Cudeyo','Ribamontán al Mar','Escalante','Argoños','Meruelo','Voto'];
  return COAST.some(c => n && n.toLowerCase().includes(c.toLowerCase()));
}

// Aplicar filtros del feed cuando se carga
const _origRenderFeedPosts = window.renderFeedPosts;
if (typeof _origRenderFeedPosts === 'function') {
  window.renderFeedPosts = function(...args) {
    _origRenderFeedPosts.apply(this, args);
    setTimeout(applyFeedFilter, 100);
  };
}

console.log('✅ Patches cargados');
