// ═══════════════════════════════════════════════════════
//  app.patch.js — parches sobre app.min.js
// ═══════════════════════════════════════════════════════

// ── FIX 1: guardarNombre ────────────────────────────────
// El HTML llama a guardarNombre() al pulsar Guardar
// Esta función cierra el editor Y guarda en BD
async function guardarNombre() {
  const row = document.getElementById('u-edit-row');
  const v   = document.getElementById('u-inp').value.trim();

  // Cerrar SIEMPRE, aunque esté vacío
  row.style.display = 'none';
  row.setAttribute('data-open', '0');

  if (!v || !state?.user) return;

  await db.from('profiles').update({ username: v }).eq('id', state.user.id);
  if (state.profile) state.profile.username = v;
  document.getElementById('u-name').textContent  = v;
  document.getElementById('av-init').textContent =
    v.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
}

// ── FIX 2: @menciones en azul + perfil + solicitud ─────
function renderMentions(texto) {
  return texto.replace(/@(\w+)/g, function(match, user) {
    return '<span class="mention" onclick="openMentionProfile(\'' + user + '\')" ' +
           'style="cursor:pointer;color:#2272e8;font-weight:600">@' + user + '</span>';
  });
}

async function openMentionProfile(username) {
  if (!state?.user) return;
  const { data: profile } = await db
    .from('profiles').select('id, username, avatar_url')
    .ilike('username', username).single();
  if (!profile) { alert('@' + username + ' no encontrado'); return; }
  if (profile.id === state.user.id) return;

  // Comprobar amistad
  const { data: fs } = await db.from('friendships')
    .select('estado')
    .or('and(follower_id.eq.' + state.user.id + ',following_id.eq.' + profile.id + '),' +
        'and(follower_id.eq.' + profile.id + ',following_id.eq.' + state.user.id + ')')
    .limit(1);

  const rel = fs?.[0];
  if (rel?.estado === 'aceptado') {
    openFriendProfile(profile.id, profile.username);
  } else if (rel?.estado === 'pendiente') {
    alert('Ya tienes una solicitud pendiente con @' + username);
  } else {
    if (confirm('¿Enviar solicitud de amistad a @' + username + '?')) {
      await db.from('friendships').insert({
        follower_id: state.user.id, following_id: profile.id, estado: 'pendiente'
      });
      alert('Solicitud enviada a @' + username);
    }
  }
}

// ── FIX 3: Filtros del feed ─────────────────────────────
let feedFilter = 'descubriendo';

function setFeedFilter(filter) {
  feedFilter = filter;
  document.querySelectorAll('.feed-filter-btn').forEach(b => {
    const active = b.dataset.filter === filter;
    b.style.backgroundColor = active ? '#2272e8' : 'rgba(255,255,255,0.08)';
    b.style.color = active ? '#fff' : 'rgba(255,255,255,0.5)';
  });
  // Aplicar con pequeño delay para que el DOM esté listo
  setTimeout(applyFeedFilter, 150);
}

function applyFeedFilter() {
  const posts = document.querySelectorAll('.feed-post');
  if (!posts.length) return; // feed aún cargando

  let visibles = 0;
  posts.forEach(post => {
    const locEl  = post.querySelector('.post-location');
    const muniEl = post.querySelector('.post-muni');
    const muni   = (locEl?.textContent || muniEl?.textContent || '').trim();
    const isEvento = muni.includes('🎉');

    let show = true;
    if (feedFilter === 'descubriendo') show = !isEvento;
    else if (feedFilter === 'eventos')  show = isEvento;
    else if (feedFilter === 'rutas')    show = false;

    post.style.display = show ? '' : 'none';
    if (show) visibles++;
  });

  // Mensaje vacío
  const feedPosts = document.getElementById('feed-posts');
  let emptyMsg = feedPosts?.querySelector('.feed-empty-msg');
  if (!visibles && feedPosts) {
    if (!emptyMsg) {
      emptyMsg = document.createElement('div');
      emptyMsg.className = 'feed-empty-msg';
      emptyMsg.style.cssText = 'text-align:center;padding:30px 20px;color:rgba(255,255,255,0.3);font-size:13px';
      feedPosts.appendChild(emptyMsg);
    }
    emptyMsg.textContent = feedFilter === 'rutas'
      ? '🥾 Las rutas están en camino...'
      : feedFilter === 'eventos'
      ? '🎉 Aún no hay fotos de eventos'
      : '';
    emptyMsg.style.display = 'block';
  } else if (emptyMsg) {
    emptyMsg.style.display = 'none';
  }
}

// Interceptar renderFeedPosts para aplicar filtro después del render
const _origRenderFeedPosts = window.renderFeedPosts;
window.renderFeedPosts = async function(...args) {
  await _origRenderFeedPosts.apply(this, args);
  setTimeout(applyFeedFilter, 100);
};

// ── FIX 4: Corrales de Buelna NO es costa ──────────────
const _origIsCoast = window.isCoast;
window.isCoast = function(n) {
  if (!n) return false;
  const nl = n.toLowerCase();
  if (nl.includes('corrales de buelna') || nl.includes('los corrales')) return false;
  return _origIsCoast ? _origIsCoast(n) : false;
};

console.log('✅ app.patch.js cargado');
