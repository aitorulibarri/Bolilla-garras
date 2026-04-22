// Bolilla Garras App v4.0 (FORCED REFRESH)
console.log('📱 Bolilla Garras App v4.0 loaded - CACHE BUSTED');
// ==================== STATE ====================
let currentUser = null;

// ==================== DOM ELEMENTS ====================
const authPage = document.getElementById('auth-page');
const app = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const authError = document.getElementById('auth-error');
const changeNameBtn = document.getElementById('change-name-btn');
const userName = document.getElementById('user-name');
const adminTab = document.getElementById('admin-tab');
const navTabs = document.querySelectorAll('.nav-tab');
const tabContents = document.querySelectorAll('.tab-content');
const authTabs = document.querySelectorAll('.auth-tab');

// ==================== FETCH WITH RETRY (for cold starts) ====================
async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
  // Get JWT token from localStorage
  const token = localStorage.getItem('bolilla_token') || '';

  // Add Authorization header with JWT token
  const defaultOptions = {
    headers: {
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  };
  const mergedOptions = { ...defaultOptions, ...options, headers: defaultOptions.headers };

  // Remove credentials: 'include' since we're using JWT now
  delete mergedOptions.credentials;

  // CACHE BUSTING: Force unique request
  const sep = url.includes('?') ? '&' : '?';
  const finalUrl = `${url}${sep}_cb=${Date.now()}`;

  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(finalUrl, mergedOptions);

      // AUTO-LOGOUT on 401 (Session Expired) - only if not already on login page
      if (res.status === 401) {
        const isLoginPage = !document.getElementById('matches-container');
        if (!isLoginPage) {
          console.warn("Sesión caducada (401). Recargando...");
          // Don't logout immediately, try to continue
        }
        return res;
      }

      if (res.ok || res.status < 500) return res;
      // Server error, retry
      if (i < retries - 1) await new Promise(r => setTimeout(r, delay));
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return fetch(finalUrl, mergedOptions); // Final attempt
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
  // FORCE UNREGISTER OLD SERVICE WORKERS
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
        console.log("🧹 Service Worker antiguo eliminado");
      }

      // Register NEW SW (Reset logic)
      await navigator.serviceWorker.register('/sw.js');
      console.log('✅ Service Worker v4 (RESET) registered');
    } catch (err) {
      console.error('Service Worker error:', err);
    }
  }

  checkSavedUser();
  setupEventListeners();
});

function checkSavedUser() {
  const savedUser = localStorage.getItem('bolilla_user');
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      showApp();
    } catch {
      localStorage.removeItem('bolilla_user');
      localStorage.removeItem('bolilla_token');
    }
  }
}

function setupEventListeners() {
  // Auth tab switching
  authTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabType = tab.dataset.authTab;

      authTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      if (tabType === 'login') {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
      } else {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
      }

      hideAuthError();
    });
  });

  // Login form submit
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (username.length < 3) {
      showAuthError('Usuario debe tener al menos 3 caracteres');
      return;
    }

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        currentUser = data.user;
        // Save token and user to localStorage
        localStorage.setItem('bolilla_token', data.token || '');
        localStorage.setItem('bolilla_user', JSON.stringify(currentUser));
        showApp();
        showToast(`¡Bienvenido, ${currentUser.displayName}!`, 'success');
      } else {
        const msg = data.detail ? `${data.error}: ${data.detail}` : (data.error || 'Error al iniciar sesión');
        console.error('Login error:', data);
        showAuthError(msg);
      }
    } catch (err) {
      console.error('Login fetch error:', err);
      showAuthError('Error de conexión. Inténtalo de nuevo.');
    }
  });

  // Register form submit
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('register-username').value.trim();
    const displayName = document.getElementById('register-displayname').value.trim();
    const password = document.getElementById('register-password').value;
    const passwordConfirm = document.getElementById('register-password-confirm').value;

    // Validations
    if (username.length < 3) {
      showAuthError('Usuario debe tener al menos 3 caracteres');
      return;
    }
    if (!/^[a-zA-Z0-9_ ]+$/.test(username)) {
      showAuthError('Usuario solo puede contener letras, números, espacios y guión bajo');
      return;
    }
    if (displayName.length < 2) {
      showAuthError('Nombre debe tener al menos 2 caracteres');
      return;
    }
    if (password.length < 4) {
      showAuthError('Contraseña debe tener al menos 4 caracteres');
      return;
    }
    if (password !== passwordConfirm) {
      showAuthError('Las contraseñas no coinciden');
      return;
    }

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, displayName, password })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        currentUser = data.user;
        // Save token and user to localStorage
        localStorage.setItem('bolilla_token', data.token || '');
        localStorage.setItem('bolilla_user', JSON.stringify(currentUser));
        showApp();
        showToast(`¡Bienvenido, ${currentUser.displayName}! Tu cuenta ha sido creada.`, 'success');
      } else {
        const msg = data.detail ? `${data.error}: ${data.detail}` : (data.error || 'Error al registrar');
        console.error('Register error:', data);
        showAuthError(msg);
      }
    } catch (err) {
      console.error('Register fetch error:', err);
      showAuthError('Error de conexión. Inténtalo de nuevo.');
    }
  });

  // Change name button (logout)
  changeNameBtn.addEventListener('click', async () => {
    const token = localStorage.getItem('bolilla_token') || '';
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
    } catch (e) {
      // Ignore errors
    }
    localStorage.removeItem('bolilla_user');
    localStorage.removeItem('bolilla_token');
    // Limpieza total del estado
    window.location.reload();
  });

  // Rules modal
  const rulesBtn = document.getElementById('rules-btn');
  const rulesModal = document.getElementById('rules-modal');
  const closeRules = document.getElementById('close-rules');
  const modalOverlay = rulesModal?.querySelector('.modal-overlay');

  if (rulesBtn && rulesModal) {
    rulesBtn.addEventListener('click', () => {
      rulesModal.style.display = 'flex';
      setTimeout(() => rulesModal.classList.add('show'), 10);
    });

    const closeModal = () => {
      rulesModal.classList.remove('show');
      setTimeout(() => rulesModal.style.display = 'none', 300);
    };

    closeRules?.addEventListener('click', closeModal);
    modalOverlay?.addEventListener('click', closeModal);
  }


  // Tab navigation
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;

      navTabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(`tab-${tabId}`).classList.add('active');

      loadTabContent(tabId);
    });
  });

  // Refresh button
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.classList.add('spinning');
      await loadMatches();
      refreshBtn.classList.remove('spinning');
      showToast('Datos actualizados', 'success');
    });
  }


  // Add match form
  const addMatchForm = document.getElementById('add-match-form');
  if (addMatchForm) {
    // Lógica dinámica de rivales
    const teamSelect = document.getElementById('match-team');
    const opponentSelect = document.getElementById('match-opponent');

    if (teamSelect && opponentSelect) {
      const updateRivals = () => {
        const selectedTeam = teamSelect.value;
        // Accedemos a LEAGUE_TEAMS globalmente
        const rivals = (typeof LEAGUE_TEAMS !== 'undefined' && LEAGUE_TEAMS[selectedTeam]) ? LEAGUE_TEAMS[selectedTeam] : [];

        opponentSelect.innerHTML = '<option value="" disabled selected>Selecciona rival...</option>' +
          rivals.slice().sort().map(team => `<option value="${team}">${team}</option>`).join('');
      };

      teamSelect.addEventListener('change', updateRivals);
      // Pequeño delay para asegurar que LEAGUE_TEAMS esté listo si hay problemas de carga
      setTimeout(updateRivals, 0);
    }

    addMatchForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const team = document.getElementById('match-team').value;
      const opponent = document.getElementById('match-opponent').value;
      const isHome = document.getElementById('match-home').value === '1';
      const matchDate = document.getElementById('match-date').value;
      const deadline = document.getElementById('match-deadline').value;

      try {
        const token = localStorage.getItem('bolilla_token') || '';
        const res = await fetch('/api/matches', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ team, opponent, isHome, matchDate, deadline })
        });

        const data = await res.json(); // Leemos siempre el body para ver el mensaje

        if (res.ok) {
          showToast('Partido añadido correctamente', 'success');
          e.target.reset();
          loadAdminMatches();
          loadAdminStats();
          loadMatches();
        } else {
          // Mostramos explícitamente el error devuelto
          const msg = data.detail ? `${data.error}: ${data.detail}` : (data.error || 'Error desconocido');
          showToast(msg, 'error');
        }
      } catch (err) {
        showToast('Error de conexión al añadir partido', 'error');
        console.error(err);
      }
    });
  }
}

// ==================== APP ====================

function showApp() {
  authPage.style.display = 'none';
  app.classList.add('active');
  userName.textContent = currentUser.displayName;

  // Show admin tab only for admin users
  if (currentUser.isAdmin) {
    adminTab.style.display = 'block';
  } else {
    adminTab.style.display = 'none';
  }

  loadMatches();
  loadLeaderboardWidget();
}

function loadTabContent(tabId) {
  switch (tabId) {
    case 'predictions':
      loadMatches();
      loadLeaderboardWidget();
      break;
    case 'leaderboard':
      loadLeaderboard();
      break;
    case 'history':
      loadHistory();
      break;
    case 'admin':
      loadAdminMatches();
      loadAdminStats();
      break;
  }
}

// ==================== MATCHES ====================

async function loadMatches() {
  const container = document.getElementById('matches-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res = await fetchWithRetry('/api/matches/upcoming');
    const matches = await res.json();

    // Guard: if the API returned an error object (e.g. 401), show a message instead of crashing
    if (!Array.isArray(matches)) {
      if (res.status === 401) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔒</div><h3>Sesión expirada</h3><p>Cierra sesión y vuelve a entrar</p></div>`;
      } else {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3>Error al cargar partidos</h3><p>${matches.error || 'Error desconocido'}</p></div>`;
      }
      return;
    }

    // Update last refresh timestamp
    const lastUpdate = document.getElementById('last-update');
    if (lastUpdate) {
      const now = new Date();
      lastUpdate.textContent = `Última actualización: ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    }

    if (matches.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📭</div>
          <h3>No hay partidos pendientes</h3>
          <p>Cuando el admin añada partidos, aparecerán aquí</p>
        </div>
      `;
      return;
    }

    // Get user predictions directly from match object (Backend includes it securely)
    container.innerHTML = matches.map(match => renderMatchCard(match, match.userPrediction)).join('');

    // Add event listeners for save buttons
    document.querySelectorAll('.save-prediction-btn').forEach(btn => {
      btn.addEventListener('click', () => savePrediction(btn.dataset.matchId));
    });
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3>Error al cargar partidos</h3><p>Inténtalo de nuevo</p></div>';
  }
}

// ==================== TEAMS DATA (Temporada 2025/26) ====================
const LEAGUE_TEAMS = {
  'Athletic Club': [ // LaLiga EA Sports 2025/26
    'Atlético de Madrid', 'FC Barcelona', 'Real Madrid', 'Real Betis', 'Real Sociedad',
    'Sevilla FC', 'Valencia CF', 'Villarreal CF', 'Celta de Vigo', 'CA Osasuna',
    'Girona FC', 'Rayo Vallecano', 'Getafe CF', 'RCD Espanyol', 'RCD Mallorca',
    'Real Oviedo', 'Deportivo Alavés', 'Elche CF', 'Levante UD', 'UD Las Palmas'
  ],
  'Athletic Femenino': [ // Liga F Moeve 2025/26
    'Atlético de Madrid', 'FC Barcelona', 'Alhama CF ElPozo', 'Badalona Femenino',
    'Deportivo de La Coruña Femenino', 'DUX Logroño', 'Eibar Femenino', 'RCD Espanyol',
    'Granada CF', 'Levante UD', 'Madrid CFF', 'Real Madrid', 'Real Sociedad',
    'Sevilla FC', 'Tenerife Femenino'
  ],
  'Bilbao Athletic': [ // 1ª RFEF Grupo 1 2025/26
    'CD Tenerife', 'Racing de Ferrol', 'CD Lugo', 'CA Osasuna B',
    'SD Ponferradina', 'Pontevedra CF', 'RC Celta Fortuna', 'Ourense CF',
    'Unionistas CF', 'CP Mérida', 'Zamora CF', 'Real Avilés CF',
    'CD Guadalajara', 'Barakaldo CF', 'CF Talavera de la Reina',
    'CP Cacereño', 'CD Arenteiro', 'Real Madrid Castilla', 'Arenas Club'
  ]
};

// ==================== LOGO MAP ====================
// Mapeo directo: nombre del equipo -> ruta al logo en public/logos/
// Carpetas: laliga, segunda, ligaf, rfef
const LOGO_MAP = {
  // ── ATHLETIC CLUB (equipo "raíz" - usa logo de LaLiga) ──
  'Athletic Club':                    'logos/laliga/athletic-bilbao-logo-vector.png',
  'Athletic Femenino':                'logos/laliga/athletic-bilbao-logo-vector.png',
  'Bilbao Athletic':                  'logos/rfef/BILBAO ATHLETIC.png',

  // ── LaLiga EA Sports 2025/26 ──
  'Atlético de Madrid':               'logos/laliga/ATLETICO.png',
  'FC Barcelona':                     'logos/laliga/FC-Barcelona.png',
  'Real Madrid':                      'logos/laliga/RMADRID.png',
  'Real Sociedad':                    'logos/laliga/REAL SOCIEDAD.png',
  'Real Betis':                       'logos/laliga/BETIS.png',
  'Sevilla FC':                       'logos/laliga/SEVILLA.png',
  'Valencia CF':                      'logos/laliga/Valencia.png',
  'Villarreal CF':                    'logos/laliga/VILLAREAL.png',
  'Celta de Vigo':                    'logos/laliga/CELTA.png',
  'RC Celta':                         'logos/laliga/CELTA.png',
  'CA Osasuna':                       'logos/laliga/OSASUNA.png',
  'Girona FC':                        'logos/laliga/Girona FC.png',
  'Rayo Vallecano':                   'logos/laliga/RAYO-VALLECANO-SAD.png',
  'Getafe CF':                        'logos/laliga/GETAFE.png',
  'RCD Espanyol':                     'logos/laliga/ESPAÑOL.png',
  'RCD Mallorca':                     'logos/laliga/MALLORCA.png',
  'Real Oviedo':                      'logos/laliga/OVIEDO.png',
  'Deportivo Alavés':                 'logos/laliga/DEPORTIVO ALAVES 2021.png',
  'Elche CF':                         'logos/laliga/Escudo_Elche_CF.png',
  'Levante UD':                       'logos/laliga/LEVANTE.png',
  'UD Las Palmas':                    'logos/segunda/UD LAS PALMAS.png',

  // ── Segunda División (equipos con logo) ──
  'Albacete Balompié':                'logos/segunda/ALBACETE.png',
  'UD Almería':                       'logos/segunda/ALMERIA.png',
  'Cádiz CF':                         'logos/segunda/CADIZ.png',
  'CD Castellón':                     'logos/segunda/CD Castellón.png',
  'Córdoba CF':                       'logos/segunda/CORDOBA.png',
  'Cultural Leonesa':                 'logos/segunda/CULTURAL LEONESA.png',
  'RC Deportivo':                     'logos/segunda/DEPORTIVO DE LA CORUÑA.PNG',
  'Deportivo de La Coruña':           'logos/segunda/DEPORTIVO DE LA CORUÑA.PNG',
  'SD Eibar':                         'logos/segunda/EIBAR.png',
  'FC Andorra':                       'logos/segunda/FC ANDORRA.png',
  'Granada CF':                       'logos/segunda/GRANADA.png',
  'SD Huesca':                        'logos/segunda/HUESCA.png',
  'CD Mirandés':                      'logos/segunda/MIRANDES.png',
  'Málaga CF':                        'logos/segunda/Málaga.png',
  'Racing de Santander':              'logos/segunda/RACING SANTANDER.png',
  'Real Sociedad B':                  'logos/segunda/REAL SOCIEDAD B.png',
  'Sporting de Gijón':                'logos/segunda/SPORTING GIJON.png',
  'Real Zaragoza':                    'logos/segunda/ZARAGOZA.png',
  'Burgos CF':                        'logos/segunda/burgos c.f..png',
  'AD Ceuta FC':                      'logos/segunda/AD CEUTA CF.jpg',
  'Real Valladolid':                  'logos/segunda/valladolid.png',
  'CD Leganés':                       'logos/segunda/LEGANES.png',

  // ── Liga F (Femenina) 2025/26 ──
  'Alhama CF ElPozo':                 'logos/ligaf/ALHAMA EL POZO FEM.png',
  'Alhama CF El Pozo':                'logos/ligaf/ALHAMA EL POZO FEM.png',
  'Badalona Femenino':                'logos/ligaf/Badalona_Women.png',
  'Levante Badalona':                 'logos/ligaf/Badalona_Women.png',
  'Deportivo de La Coruña Femenino':  'logos/ligaf/DEPOR.png',
  'Deportivo Abanca':                 'logos/ligaf/DEPOR.png',
  'DUX Logroño':                      'logos/ligaf/DUX LOGROÑO.png',
  'Eibar Femenino':                   'logos/ligaf/EIBAR.png',
  'Levante Las Planas':               'logos/ligaf/levante-femenino.png',
  'Madrid CFF':                       'logos/ligaf/images-Photoroom.png',
  'Tenerife Femenino':                'logos/ligaf/U.D.-Granadilla-Tenerife-Egatesa.png',
  'Costa Adeje Tenerife':             'logos/ligaf/U.D.-Granadilla-Tenerife-Egatesa.png',
  'UD Granadilla Tenerife':           'logos/ligaf/U.D.-Granadilla-Tenerife-Egatesa.png',

  // ── 1ª RFEF Grupo 1 2025/26 ──
  'Barakaldo CF':                     'logos/rfef/BARAKALDO.png',
  'CP Cacereño':                      'logos/rfef/CACEREÑO.png',
  'Cacereño':                         'logos/rfef/CACEREÑO.png',
  'CD Arenteiro':                     'logos/rfef/c.d. arenteiro.png',
  'CD Lugo':                          'logos/rfef/LUGO.png',
  'CP Mérida':                        'logos/rfef/MERIDA.png',
  'Mérida AD':                        'logos/rfef/MERIDA.png',
  'CA Osasuna B':                     'logos/rfef/OSASUNA-B.png',
  'Osasuna Promesas':                 'logos/rfef/OSASUNA-B.png',
  'Ourense CF':                       'logos/rfef/OURENSE.png',
  'Pontevedra CF':                    'logos/rfef/PONTEVEDRA CF.png',
  'Racing de Ferrol':                 'logos/rfef/RACING DE FERROL.png',
  'Real Madrid Castilla':             'logos/rfef/RMADRID CASTILLA.png',
  'Real Avilés CF':                   'logos/rfef/Real Avilés.png',
  'Real Avilés Industrial':           'logos/rfef/Real Avilés.png',
  'CF Talavera de la Reina':          'logos/rfef/TALAVERA DE LA REINA.png',
  'CD Tenerife':                      'logos/rfef/TENERIFE.png',
  'Unionistas CF':                    'logos/rfef/Unionistas_Salamanca.png',
  'Unionistas de Salamanca':          'logos/rfef/Unionistas_Salamanca.png',
  'Zamora CF':                        'logos/rfef/ZAMORA-CF.png',
  'Arenas Club':                      'logos/rfef/arenasclub.png',
  'CD Guadalajara':                   'logos/rfef/club deportivo guadalajara.png',
  'SD Ponferradina':                  'logos/rfef/sd_ponferradina.png',
  // Filiales - usan el logo del club padre desde laliga/
  'RC Celta Fortuna':                 'logos/laliga/CELTA.png',
};

function getShieldUrl(teamName) {
  // 1. Búsqueda directa exacta
  if (LOGO_MAP[teamName]) return LOGO_MAP[teamName];

  // 2. Búsqueda insensible a mayúsculas/minúsculas
  const lower = teamName.toLowerCase();
  for (const [key, val] of Object.entries(LOGO_MAP)) {
    if (key.toLowerCase() === lower) return val;
  }

  // 3. Búsqueda parcial (si el nombre contiene o está contenido)
  for (const [key, val] of Object.entries(LOGO_MAP)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) return val;
  }

  // 4. Sin logo: devuelve null (la imagen se ocultará con onerror)
  return null;
}


function renderMatchCard(match, userPrediction) {
  const matchDate = new Date(match.match_date);
  const deadline = new Date(match.deadline);
  const now = new Date();
  const canPredict = now < deadline;
  const hasPrediction = !!userPrediction;

  // Format DateTime
  const dateStr = matchDate.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeStr = matchDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  const homeTeam = match.is_home ? match.team : match.opponent;
  const awayTeam = match.is_home ? match.opponent : match.team;

  const homeShield = getShieldUrl(homeTeam);
  const awayShield = getShieldUrl(awayTeam);

  const userHomeGoals = hasPrediction ? userPrediction.home_goals : '';
  const userAwayGoals = hasPrediction ? userPrediction.away_goals : '';

  // Determine League Badge
  const contextTeam = match.team;
  let leagueName = 'LaLiga';
  if (contextTeam === 'Athletic Femenino' || contextTeam.includes('Femenino')) leagueName = 'Liga F';
  if (contextTeam === 'Bilbao Athletic') leagueName = '1ª RFEF';

  const homeShieldHtml = homeShield
    ? `<img src="${homeShield}" class="big-shield" alt="${homeTeam}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'shield-fallback',textContent:'⚽'}));">`
    : `<span class="shield-fallback">⚽</span>`;
  const awayShieldHtml = awayShield
    ? `<img src="${awayShield}" class="big-shield" alt="${awayTeam}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'shield-fallback',textContent:'⚽'}));">`
    : `<span class="shield-fallback">⚽</span>`;

  return `
    <div class="match-card ${canPredict ? '' : 'expired'}">
      <div class="match-header-gemini">
        <span class="match-league-badge">⚽ ${leagueName} • ${dateStr} ${timeStr}</span>
        <div class="match-title-large">
            ${homeTeam} <span style="color:var(--neon-red); margin:0 5px;">vs</span> ${awayTeam}
        </div>
      </div>
      
      <div class="match-content-grid">
        <!-- Home Team -->
        <div class="team-container">
            ${homeShieldHtml}
            <span class="team-name-label">${homeTeam}</span>
        </div>

        <!-- Score / Inputs -->
        <div class="score-container">
            ${hasPrediction
      ? `<div class="score-box" style="border-color: #00F5A0; color:#00F5A0;">${userHomeGoals}</div>`
      : (canPredict
        ? `<input type="number" id="home-${match.id}" class="score-box" min="0" max="15" placeholder="-">`
        : `<div class="score-box" style="opacity:0.5">-</div>`)
    }
            
            <span class="score-separator">-</span>
            
            ${hasPrediction
      ? `<div class="score-box" style="border-color: #00F5A0; color:#00F5A0;">${userAwayGoals}</div>`
      : (canPredict
        ? `<input type="number" id="away-${match.id}" class="score-box" min="0" max="15" placeholder="-">`
        : `<div class="score-box" style="opacity:0.5">-</div>`)
    }
        </div>

        <!-- Away Team -->
        <div class="team-container">
            ${awayShieldHtml}
            <span class="team-name-label">${awayTeam}</span>
        </div>
      </div>

      <!-- Action Button -->
      ${hasPrediction
      ? `<button class="save-btn-gemini" style="background: rgba(0, 245, 160, 0.1); border: 1px solid #00F5A0; color: #00F5A0; cursor: default;">
             ✅ PRONÓSTICO GUARDADO
           </button>`
      : (canPredict
        ? `<button class="save-btn-gemini save-prediction-btn" data-match-id="${match.id}">
                 GUARDAR PRONÓSTICO
               </button>`
        : `<button class="save-btn-gemini" style="background: #333; cursor: not-allowed; opacity: 0.7;">
                 PLAZO CERRADO
               </button>`)
    }
    </div>
  `;
}

// Widget de Clasificación (Gemini Style)
async function loadLeaderboardWidget() {
  const container = document.getElementById('leaderboard-widget-container');
  if (!container) return;

  try {
    const res = await fetchWithRetry('/api/leaderboard');
    const leaderboard = await res.json();

    if (leaderboard.length === 0) {
      container.innerHTML = '<div style="padding:20px; text-align:center; color:#666;">Sin datos</div>';
      return;
    }

    const top5 = leaderboard.slice(0, 5);

    container.innerHTML = top5.map((user, index) => {
      let rankClass = '';
      let icon = `#${index + 1}`;
      if (index === 0) { rankClass = 'row-rank-1'; icon = '<span class="rank-crown">👑</span>'; }
      if (index === 1) { rankClass = 'row-rank-2'; icon = '<span class="rank-crown">🥈</span>'; }
      if (index === 2) { rankClass = 'row-rank-3'; icon = '<span class="rank-crown">🥉</span>'; }

      return `
            <div class="leaderboard-row ${rankClass}">
                <div class="rank-badge">${icon}</div>
                <div class="user-info">
                    <span class="user-name">${user.name || user.display_name}</span>
                    <span class="user-team">${user.exact_predictions} plenos</span>
                </div>
                <div class="user-points">${user.total_points} pts</div>
            </div>
            `;
    }).join('');

  } catch (err) {
    console.error("Error widget leaderboard", err);
  }
}

async function savePrediction(matchId) {
  const homeGoals = document.getElementById(`home-${matchId}`).value;
  const awayGoals = document.getElementById(`away-${matchId}`).value;

  if (homeGoals === '' || awayGoals === '') {
    showToast('Introduce los goles de ambos equipos', 'error');
    return;
  }

  // Confirmación antes de guardar (no se puede cambiar después)
  const confirmed = confirm(
    `⚠️ ¿Confirmas tu pronóstico: ${homeGoals} - ${awayGoals}?\n\nUna vez guardado NO podrás modificarlo.`
  );

  if (!confirmed) {
    return; // Usuario canceló
  }

  try {
    const token = localStorage.getItem('bolilla_token') || '';
    const res = await fetch('/api/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        matchId: parseInt(matchId),
        homeGoals: parseInt(homeGoals),
        awayGoals: parseInt(awayGoals)
      })
    });

    const data = await res.json();

    if (res.ok) {
      showToast('¡Pronóstico guardado!', 'success');
      loadMatches();
    } else {
      showToast(data.error, 'error');
    }
  } catch (err) {
    showToast('Error al guardar pronóstico', 'error');
  }
}

// ==================== LEADERBOARD ====================

async function loadLeaderboard() {
  const container = document.getElementById('leaderboard-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res = await fetchWithRetry('/api/leaderboard');
    const leaderboard = await res.json();

    if (leaderboard.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🏆</div>
          <h3>Sin clasificación aún</h3>
          <p>La clasificación aparecerá cuando se jueguen los primeros partidos</p>
        </div>
      `;
      return;
    }

    // Generate Podium HTML
    let podiumHtml = '';
    // Call global function from podium.js if available
    if (typeof createPodium === 'function' && leaderboard.length >= 3) {
      podiumHtml = createPodium(leaderboard);
    }

    // Generate Table HTML
    const tableHtml = `
      <div class="card" style="overflow-x: auto; padding: 0;">
        <table class="leaderboard-table">
          <thead>
            <tr>
              <th>Rango</th>
              <th>Jugador</th>
              <th>Puntos</th>
              <th>Plenos</th>
              <th>Predicciones</th>
            </tr>
          </thead>
          <tbody>
            ${leaderboard.map((user, index) => {
      // Highlight top 3 if needed, though podium handles that visual
      const rankEmoji = index === 0 ? '👑' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : `#${index + 1}`));

      return `
              <tr>
                <td class="rank">${rankEmoji}</td>
                <td>
                    <div style="font-weight: 700; color: var(--text-primary); font-size: 16px;">${user.name || user.display_name}</div>
                </td>
                <td>
                    <span style="font-family: 'Orbitron', sans-serif; font-size: 20px; color: var(--neon-red); font-weight: 700; text-shadow: 0 0 10px rgba(255, 51, 51, 0.3);">${user.total_points}</span>
                </td>
                <td style="color: #00F5A0; font-weight: 600; font-size: 15px;">${user.exact_predictions} 🎯</td>
                <td style="color: var(--text-secondary); font-size: 14px;">${user.total_predictions}</td>
              </tr>
              `;
    }).join('')}
          </tbody>
        </table>
      </div>
    `;

    container.innerHTML = podiumHtml + tableHtml;

  } catch (err) {
    console.error(err);
    container.innerHTML = '<p>Error al cargar clasificación</p>';
  }
}

// ==================== HISTORY ====================

async function loadHistory() {
  const container = document.getElementById('history-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res = await fetchWithRetry('/api/predictions');
    const predictions = await res.json();

    if (predictions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <h3>Sin pronósticos aún</h3>
          <p>Tus pronósticos aparecerán aquí cuando los envíes</p>
        </div>
      `;
      return;
    }

    container.innerHTML = predictions.map(pred => {
      const matchDate = new Date(pred.match_date);
      const homeTeam = pred.is_home ? pred.team : pred.opponent;
      const awayTeam = pred.is_home ? pred.opponent : pred.team;

      const pointsClass = pred.points !== null ? `points-${pred.points}` : '';

      return `
        <div class="history-item">
          <div class="history-match">
            <div class="history-match-teams">${homeTeam} vs ${awayTeam}</div>
            <div class="history-match-date">${matchDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</div>
          </div>
          <div class="history-result">
            <div class="history-result-label">Tu pronóstico</div>
            <div class="history-result-score">${pred.home_goals} - ${pred.away_goals}</div>
          </div>
          ${pred.is_finished ? `
            <div class="history-result">
              <div class="history-result-label">Resultado real</div>
              <div class="history-result-score">${pred.real_home} - ${pred.real_away}</div>
            </div>
            <div class="history-points ${pointsClass}">
              <span class="history-points-value">${pred.points}</span>
              <span class="history-points-label">pts</span>
            </div>
          ` : `
            <div class="history-points">
              <span class="history-points-value">⏳</span>
              <span class="history-points-label">pendiente</span>
            </div>
          `}
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = '<p>Error al cargar historial</p>';
  }
}

// ==================== ADMIN ====================

async function loadAdminMatches() {
  const container = document.getElementById('admin-matches-container');
  if (!container) return;

  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res = await fetchWithRetry('/api/matches');
    const matches = await res.json();

    // Guard: if the API returned an error object (e.g. 401), show a message instead of crashing
    if (!Array.isArray(matches)) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔒</div><h3>${res.status === 401 ? 'Sin permisos de admin' : 'Error al cargar'}</h3><p>${matches.error || ''}</p></div>`;
      return;
    }

    if (matches.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📭</div>
          <h3>No hay partidos</h3>
          <p>Añade el primer partido usando el formulario de arriba</p>
        </div>
      `;
      return;
    }

    container.innerHTML = matches.map(match => {
      const matchDate = new Date(match.match_date);
      const homeTeam = match.is_home ? match.team : match.opponent;
      const awayTeam = match.is_home ? match.opponent : match.team;

      return `
        <div class="admin-match-item" style="flex-direction: column; align-items: stretch;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div class="admin-match-info">
              <h4>${homeTeam} vs ${awayTeam}</h4>
              <p>${matchDate.toLocaleDateString('es-ES')} - ${match.is_finished ? `<span style="color: #10B981;">✓ Finalizado</span>` : '<span style="color: #F59E0B;">⏳ Pendiente</span>'}</p>
            </div>
            <div class="admin-result-form">
              <input type="number" id="result-home-${match.id}" min="0" max="20" placeholder="0" value="${match.is_finished ? match.home_goals : ''}">
              <span>-</span>
              <input type="number" id="result-away-${match.id}" min="0" max="20" placeholder="0" value="${match.is_finished ? match.away_goals : ''}">
              
              <button id="btn-save-${match.id}" class="btn btn-success btn-sm">${match.is_finished ? '✏️' : '✓'}</button>
              
              ${!match.is_finished ? `<button id="btn-edit-${match.id}" class="btn btn-secondary btn-sm" title="Editar partido">📝</button>` : ''}
              
              <button id="btn-preds-${match.id}" class="btn btn-sm" style="background: rgba(255,165,0,0.15); border: 1px solid rgba(255,165,0,0.4); color: #FFA500;" title="Ver/ocultar pronósticos">👁️ Pronósticos</button>
              
              <button id="btn-delete-${match.id}" class="btn btn-danger btn-sm">🗑️</button>
            </div>
          </div>
          
          ${!match.is_finished ? `
          <div id="edit-form-${match.id}" style="display: none; margin-top: 16px; padding: 16px; background: rgba(255,255,255,0.03); border-radius: 12px; border: 1px solid rgba(255,255,255,0.06);">
            <h5 style="margin-bottom: 12px; color: var(--text-secondary); font-size: 14px;">📝 Editar Partido</h5>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="form-group" style="margin-bottom: 0;">
                <label style="font-size: 12px; margin-bottom: 6px; display: block;">Fecha Partido</label>
                <input type="datetime-local" id="edit-date-${match.id}" value="${match.match_date.slice(0, 16)}" style="width: 100%; padding: 8px; background: var(--bg-tertiary); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: var(--text-primary); font-size: 13px;">
              </div>
              <div class="form-group" style="margin-bottom: 0;">
                <label style="font-size: 12px; margin-bottom: 6px; display: block;">Fecha Límite</label>
                <input type="datetime-local" id="edit-deadline-${match.id}" value="${match.deadline.slice(0, 16)}" style="width: 100%; padding: 8px; background: var(--bg-tertiary); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: var(--text-primary); font-size: 13px;">
              </div>
            </div>
            <div style="margin-top: 12px; display: flex; gap: 8px;">
              <button id="btn-save-edit-${match.id}" class="btn btn-primary btn-sm">💾 Guardar</button>
              <button id="btn-cancel-edit-${match.id}" class="btn btn-secondary btn-sm">❌ Cancelar</button>
            </div>
          </div>
          ` : ''}

          <!-- Panel de pronósticos (siempre presente, oculto por defecto) -->
          <div id="preds-panel-${match.id}" style="display: none; margin-top: 16px;">
            <div style="padding: 14px; background: rgba(255,255,255,0.03); border-radius: 12px; border: 1px solid rgba(255,165,0,0.2);">
              <h5 style="margin-bottom: 10px; color: #FFA500; font-size: 13px;">📝 Pronósticos del partido</h5>
              <div id="preds-list-${match.id}"><div class="loading"><div class="spinner"></div></div></div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // ATTACH EVENT LISTENERS (Much safer than onclick)
    matches.forEach(match => {
      // Save Result
      const saveBtn = document.getElementById(`btn-save-${match.id}`);
      if (saveBtn) saveBtn.addEventListener('click', () => setResult(match.id));

      // Delete Match
      const deleteBtn = document.getElementById(`btn-delete-${match.id}`);
      if (deleteBtn) deleteBtn.addEventListener('click', () => deleteMatch(match.id));

      // Toggle predictions panel
      const predsBtn = document.getElementById(`btn-preds-${match.id}`);
      if (predsBtn) predsBtn.addEventListener('click', () => togglePredictions(match.id));

      if (!match.is_finished) {
        // Toggle Edit Form
        const editBtn = document.getElementById(`btn-edit-${match.id}`);
        if (editBtn) editBtn.addEventListener('click', () => toggleEditMatch(match.id));

        // Save Edit (inside form)
        const saveEditBtn = document.getElementById(`btn-save-edit-${match.id}`);
        if (saveEditBtn) saveEditBtn.addEventListener('click', () => saveMatchEdit(match.id));

        // Cancel Edit
        const cancelEditBtn = document.getElementById(`btn-cancel-edit-${match.id}`);
        if (cancelEditBtn) cancelEditBtn.addEventListener('click', () => toggleEditMatch(match.id));
      }
    });

  } catch (err) {
    console.error(err);
    container.innerHTML = '<p>Error al cargar partidos</p>';
  }
}

async function setResult(matchId) {
  console.log('Intentando guardar resultado para partido:', matchId);
  const homeInput = document.getElementById(`result-home-${matchId}`);
  const awayInput = document.getElementById(`result-away-${matchId}`);
  const btn = document.getElementById(`btn-save-${matchId}`);

  if (!homeInput || !awayInput) {
    console.error('Inputs no encontrados en el DOM');
    showToast('Error interno: Inputs no encontrados', 'error');
    return;
  }

  const homeGoals = homeInput.value;
  const awayGoals = awayInput.value;

  if (homeGoals === '' || awayGoals === '') {
    showToast('Introduce el resultado completo', 'warning');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳';
  }

  try {
    const res = await fetchWithRetry(`/api/matches/${matchId}/result`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        homeGoals: parseInt(homeGoals),
        awayGoals: parseInt(awayGoals)
      })
    });

    const data = await res.json();

    if (res.ok) {
      showToast('✅ Resultado guardado y puntos calculados', 'success');
      await Promise.all([loadAdminMatches(), loadMatches()]);
    } else {
      console.error('Error backend:', data);
      showToast(data.error || 'Error al guardar resultado', 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '✓';
      }
    }
  } catch (err) {
    console.error('Error red:', err);
    showToast('Error de conexión al servidor', 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '✓';
    }
  }
}

async function deleteMatch(matchId) {
  if (!confirm('¿Seguro que quieres eliminar este partido?')) return;

  const token = localStorage.getItem('bolilla_token') || '';
  try {
    const res = await fetch(`/api/matches/${matchId}`, {
      method: 'DELETE',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });

    if (res.ok) {
      showToast('Partido eliminado', 'success');
      loadAdminMatches();
      loadMatches();
    } else {
      showToast('Error al eliminar partido', 'error');
    }
  } catch (err) {
    showToast('Error al eliminar partido', 'error');
  }
}

// ==================== UTILS ====================

function showAuthError(message) {
  const authErrorEl = document.getElementById('auth-error');
  if (!authErrorEl) {
    console.error('auth-error element not found');
    showToast(message, 'error');
    return;
  }
  authErrorEl.textContent = message;
  authErrorEl.style.display = 'block';
  authErrorEl.classList.add('show');
  setTimeout(() => {
    authErrorEl.classList.remove('show');
    authErrorEl.style.display = 'none';
  }, 5000);
}

function hideAuthError() {
  const authErrorEl = document.getElementById('auth-error');
  if (authErrorEl) {
    authErrorEl.classList.remove('show');
    authErrorEl.style.display = 'none';
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  // Add icon based on type
  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('show');
  }, 10);

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==================== MATCH EDITING (ADMIN) ====================

function toggleEditMatch(matchId) {
  const editForm = document.getElementById(`edit-form-${matchId}`);
  if (!editForm) return;

  editForm.style.display = editForm.style.display === 'none' ? 'block' : 'none';
}

async function saveMatchEdit(matchId) {
  const matchDate = document.getElementById(`edit-date-${matchId}`).value;
  const deadline = document.getElementById(`edit-deadline-${matchId}`).value;

  if (!matchDate || !deadline) {
    showToast('Completa todos los campos', 'error');
    return;
  }

  const token = localStorage.getItem('bolilla_token') || '';
  try {
    const res = await fetch(`/api/matches/${matchId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        matchDate,
        deadline
      })
    });

    const data = await res.json();

    if (res.ok) {
      showToast('Partido actualizado correctamente', 'success');
      toggleEditMatch(matchId);
      loadAdminMatches();
      loadMatches(); // Refresh predictions tab too
    } else {
      showToast(data.error || 'Error al actualizar partido', 'error');
    }
  } catch (err) {
    showToast('Error de conexión', 'error');
  }
}

// ==================== ADMIN STATISTICS ====================

async function loadAdminStats() {
  const container = document.getElementById('admin-stats-container');
  if (!container) return;

  container.innerHTML = '<div class="stats-loading"><div class="spinner"></div></div>';

  const token = localStorage.getItem('bolilla_token') || '';
  try {
    const res = await fetch('/api/admin/stats', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    const stats = await res.json();

    if (!res.ok) {
      container.innerHTML = '<p style="color: var(--error); text-align: center;">Error al cargar estadísticas</p>';
      return;
    }

    const { totalUsers, upcomingMatches, usersWithoutPredictions } = stats;

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px;">
        <!-- Total Users Card -->
        <div style="padding: 20px; background: var(--bg-tertiary); border-radius: var(--radius-lg); border: 1px solid rgba(255,255,255,0.06);">
          <h4 style="margin-bottom: 12px; color: var(--text-secondary); font-size: 14px;">👥 Usuarios Activos</h4>
          <div style="font-size: 48px; font-weight: 800; color: var(--neon-green);">${totalUsers}</div>
        </div>

        <!-- Upcoming Matches Participation -->
        <div style="padding: 20px; background: var(--bg-tertiary); border-radius: var(--radius-lg); border: 1px solid rgba(255,255,255,0.06); grid-column: span 2;">
          <h4 style="margin-bottom: 16px; color: var(--text-secondary); font-size: 14px;">📊 Participación en Próximos Partidos</h4>
          ${upcomingMatches.length === 0 ? '<p style="color: var(--text-muted);">No hay partidos próximos</p>' : upcomingMatches.map(m => {
      const homeTeam = m.is_home ? m.team : m.opponent;
      const awayTeam = m.is_home ? m.opponent : m.team;
      const barColor = m.participation >= 80 ? 'var(--success)' : m.participation >= 50 ? 'var(--warning)' : 'var(--error)';

      return `
              <div style="margin-bottom: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <span style="font-size: 13px; font-weight: 600;">${homeTeam} vs ${awayTeam}</span>
                  <span style="font-size: 12px; color: var(--text-secondary);">${m.predictions_count}/${totalUsers} (${m.participation}%)</span>
                </div>
                <div style="height: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden;">
                  <div style="height: 100%; width: ${m.participation}%; background: ${barColor}; transition: width 0.3s ease;"></div>
                </div>
              </div>
            `;
    }).join('')}
        </div>

        <!-- Users Without Predictions -->
        <div style="padding: 20px; background: var(--bg-tertiary); border-radius: var(--radius-lg); border: 1px solid rgba(255,255,255,0.06); grid-column: span 3;">
          <h4 style="margin-bottom: 12px; color: var(--text-secondary); font-size: 14px;">⚠️ Usuarios sin Pronósticos (Top 10)</h4>
          ${usersWithoutPredictions.length === 0
        ? '<p style="color: var(--success);">¡Todos los usuarios han pronosticado! 🎉</p>'
        : `<div style="display: flex; flex-wrap: wrap; gap: 8px;">${usersWithoutPredictions.map(u =>
          `<span style="padding: 6px 12px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 16px; font-size: 12px; color: var(--error);">${u.display_name}</span>`
        ).join('')}</div>`
      }
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = '<p style="color: var(--error); text-align: center;">Error de conexión</p>';
  }
}

// ==================== ADMIN: VER Y BORRAR PRONÓSTICOS ====================

async function togglePredictions(matchId) {
  const panel = document.getElementById(`preds-panel-${matchId}`);
  if (!panel) return;

  // Toggle: si ya está visible, lo ocultamos
  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    return;
  }

  // Mostrar y cargar
  panel.style.display = 'block';
  const listEl = document.getElementById(`preds-list-${matchId}`);
  listEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res = await fetchWithRetry(`/api/admin/matches/${matchId}/predictions`);
    const preds = await res.json();

    if (!Array.isArray(preds) || preds.length === 0) {
      listEl.innerHTML = '<p style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 12px;">Sin pronósticos todavía</p>';
      return;
    }

    listEl.innerHTML = `
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.08);">
            <th style="text-align: left; padding: 6px 8px; color: var(--text-secondary); font-weight: 600;">Jugador</th>
            <th style="text-align: center; padding: 6px 8px; color: var(--text-secondary); font-weight: 600;">Pronóstico</th>
            <th style="text-align: center; padding: 6px 8px; color: var(--text-secondary); font-weight: 600;">Puntos</th>
            <th style="text-align: center; padding: 6px 8px; color: var(--text-secondary); font-weight: 600;">Borrar</th>
          </tr>
        </thead>
        <tbody>
          ${preds.map(p => `
            <tr id="pred-row-${p.id}" style="border-bottom: 1px solid rgba(255,255,255,0.04);">
              <td style="padding: 8px; font-weight: 600; color: var(--text-primary);">${p.player_name}</td>
              <td style="padding: 8px; text-align: center; font-family: 'Orbitron', sans-serif; color: #00F5A0;">${p.home_goals} - ${p.away_goals}</td>
              <td style="padding: 8px; text-align: center; color: #FFD700;">${p.points !== null ? p.points + ' pts' : '—'}</td>
              <td style="padding: 8px; text-align: center;">
                <button id="del-pred-${p.id}" class="btn btn-danger btn-sm" style="padding: 4px 10px; font-size: 11px;">🗑️</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Attach delete listeners
    preds.forEach(p => {
      const delBtn = document.getElementById(`del-pred-${p.id}`);
      if (delBtn) delBtn.addEventListener('click', () => deletePrediction(p.id, p.player_name, matchId));
    });

  } catch (err) {
    listEl.innerHTML = '<p style="color: var(--error);">Error al cargar pronósticos</p>';
    console.error(err);
  }
}

async function deletePrediction(predId, playerName, matchId) {
  const confirmed = confirm(`⚠️ ¿Borrar el pronóstico de "${playerName}"?\n\nEl jugador podrá volver a pronosticar si el plazo no ha cerrado.`);
  if (!confirmed) return;

  try {
    const token = localStorage.getItem('bolilla_token') || '';
    const res = await fetch(`/api/admin/predictions/${predId}`, {
      method: 'DELETE',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });

    if (res.ok) {
      // Eliminar fila del DOM sin recargar
      const row = document.getElementById(`pred-row-${predId}`);
      if (row) {
        row.style.transition = 'opacity 0.3s ease';
        row.style.opacity = '0';
        setTimeout(() => row.remove(), 300);
      }
      showToast(`Pronóstico de ${playerName} borrado`, 'success');
    } else {
      const data = await res.json();
      showToast(data.error || 'Error al borrar pronóstico', 'error');
    }
  } catch (err) {
    showToast('Error de conexión', 'error');
    console.error(err);
  }
}
