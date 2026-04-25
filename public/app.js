// Bolilla Garras App v4.0 (FORCED REFRESH)
console.log('📱 Bolilla Garras App v4.0 loaded - CACHE BUSTED');
// ==================== STATE ====================
let currentUser = null;

// ==================== PWA INSTALL PROMPT ====================
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showAndroidInstallBanner();
});

window.addEventListener('appinstalled', () => {
  hideInstallBanner();
  deferredInstallPrompt = null;
});

function showAndroidInstallBanner() {
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (document.getElementById('pwa-install-banner')) return;
  const banner = createInstallBanner(
    'Instala <strong>Bolilla Garras</strong> en tu móvil',
    'Instalar',
    async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') hideInstallBanner();
      deferredInstallPrompt = null;
    }
  );
  document.body.appendChild(banner);
}

function showIOSInstallBanner() {
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true;
  const dismissed = sessionStorage.getItem('pwa-ios-banner-dismissed');
  if (!isIOS || isStandalone || dismissed) return;
  if (document.getElementById('pwa-ios-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'pwa-ios-modal';
  modal.className = 'pwa-ios-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'pwa-ios-sheet';
  sheet.innerHTML = `
    <div class="pwa-ios-handle"></div>
    <img src="/icons/icon-192.png" class="pwa-ios-app-icon" alt="Bolilla Garras">
    <h3 class="pwa-ios-title">Instala Bolilla Garras</h3>
    <p class="pwa-ios-subtitle">Accede en un tap desde tu pantalla de inicio</p>
    <div class="pwa-ios-steps">
      <div class="pwa-ios-step">
        <div class="pwa-ios-step-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
            <polyline points="16 6 12 2 8 6"/>
            <line x1="12" y1="2" x2="12" y2="15"/>
          </svg>
        </div>
        <div class="pwa-ios-step-text">
          <strong>1.</strong> Pulsa el botón <strong>Compartir</strong>
          <span class="pwa-ios-hint">el de la flecha hacia arriba ↑</span>
        </div>
      </div>
      <div class="pwa-ios-step">
        <div class="pwa-ios-step-icon pwa-ios-step-add">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            <line x1="12" y1="8" x2="12" y2="16"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
        </div>
        <div class="pwa-ios-step-text">
          <strong>2.</strong> Toca <strong>"Añadir a pantalla<br>de inicio"</strong>
        </div>
      </div>
    </div>
    <div class="pwa-ios-arrow-hint">
      <span class="pwa-ios-arrow-bounce">▼</span>
      el botón Compartir está en la barra de Safari
    </div>
    <button class="pwa-ios-close-btn">Ahora no</button>
  `;

  const closeModal = () => {
    sessionStorage.setItem('pwa-ios-banner-dismissed', '1');
    modal.classList.add('pwa-ios-hiding');
    setTimeout(() => modal.remove(), 350);
  };

  sheet.querySelector('.pwa-ios-close-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  modal.appendChild(sheet);
  document.body.appendChild(modal);
}

function createInstallBanner(message, btnText, btnAction) {
  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.className = 'pwa-install-banner';
  const msg = document.createElement('span');
  msg.className = 'pwa-banner-msg';
  msg.innerHTML = message;
  const btn = document.createElement('button');
  btn.className = 'pwa-banner-btn';
  btn.textContent = btnText;
  btn.addEventListener('click', btnAction);
  banner.appendChild(msg);
  banner.appendChild(btn);
  return banner;
}

function hideInstallBanner() {
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.remove();
}

// ==================== DOM ELEMENTS ====================
const authPage = document.getElementById('auth-page');
const app = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const authError = document.getElementById('auth-error');
const changeNameBtn = document.getElementById('change-name-btn');
const userName = document.getElementById('user-name');
const adminTab = document.getElementById('admin-tab');
const usersTab = document.getElementById('users-tab');
const trackerTab = document.getElementById('tracker-tab');
const navTabs = document.querySelectorAll('.nav-tab');
const tabContents = document.querySelectorAll('.tab-content');
const authTabs = document.querySelectorAll('.auth-tab');

// ==================== FETCH WITH RETRY (for cold starts) ====================
async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
  // Get JWT token from localStorage
  const token = localStorage.getItem('bolilla_token') || '';

  // Merge headers: Authorization + caller's headers
  const mergedHeaders = {
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };
  const mergedOptions = { ...options, headers: mergedHeaders };

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
  showIOSInstallBanner();
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
  // Botón de imprimir/PDF de la pestaña Seguimiento
  const trackerPrintBtn = document.getElementById('tracker-print-btn');
  if (trackerPrintBtn) {
    trackerPrintBtn.addEventListener('click', printTrackerReport);
  }

  // Botón de exportar PDF de la Clasificación General
  const leaderboardPrintBtn = document.getElementById('leaderboard-print-btn');
  if (leaderboardPrintBtn) {
    leaderboardPrintBtn.addEventListener('click', printLeaderboardReport);
  }

  // Password visibility toggle (delegado, cubre login y registro).
  // mousedown + preventDefault para no robar el foco del input entre el press y el release;
  // así el toggle funciona igual tenga o no el foco en el campo.
  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      btn.classList.toggle('is-visible', isHidden);
      btn.setAttribute('aria-pressed', String(isHidden));
      btn.setAttribute('aria-label', isHidden ? 'Ocultar contraseña' : 'Mostrar contraseña');
    });
  });

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
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      showAuthError('Usuario solo puede contener letras, números y guión bajo');
      return;
    }
    if (displayName.length < 2) {
      showAuthError('Nombre debe tener al menos 2 caracteres');
      return;
    }
    if (password.length < 8) {
      showAuthError('Contraseña debe tener al menos 8 caracteres');
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

  // Show admin tabs only for admin users
  const adminVisible = currentUser.isAdmin ? 'block' : 'none';
  adminTab.style.display = adminVisible;
  if (usersTab) usersTab.style.display = adminVisible;
  if (trackerTab) trackerTab.style.display = adminVisible;

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
    case 'users':
      loadAdminUsers();
      break;
    case 'tracker':
      loadOpenPredictions();
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
      if (index === 0) { rankClass = 'row-rank-1'; icon = '<img src="/assets/copa-del-rey-v4.png" class="rank-crown-img" alt="Copa del Rey">'; }
      if (index === 1) { rankClass = 'row-rank-2'; icon = '<img src="/assets/garras-lion.png" class="rank-crown-img" alt="🦁">'; }
      if (index === 2) { rankClass = 'row-rank-3'; icon = '<img src="/assets/lion-paw.png" class="rank-crown-img" alt="🐾">'; }

      return `
            <div class="leaderboard-row ${rankClass}">
                <div class="rank-badge">${icon}</div>
                <div class="user-info">
                    <span class="user-name">${user.display_name || user.name}</span>
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
            </tr>
          </thead>
          <tbody>
            ${leaderboard.map((user, index) => {
      const rankEmoji = index === 0 ? '<img src="/assets/copa-del-rey-v4.png" class="rank-crown-img" alt="Copa del Rey">' : (index === 1 ? '<img src="/assets/garras-lion.png" class="rank-crown-img" alt="🦁">' : (index === 2 ? '<img src="/assets/lion-paw.png" class="rank-crown-img" alt="🐾">' : `#${index + 1}`));
      return `
              <tr>
                <td class="rank">${rankEmoji}</td>
                <td>
                    <div style="font-weight: 700; color: var(--text-primary); font-size: 16px;">${user.display_name || user.name}</div>
                </td>
                <td>
                    <span style="font-family: 'Orbitron', sans-serif; font-size: 20px; color: var(--neon-red); font-weight: 700; text-shadow: 0 0 10px rgba(255, 51, 51, 0.3);">${user.total_points}</span>
                </td>
                <td style="color: #00F5A0; font-weight: 600; font-size: 15px;">${user.exact_predictions} 🎯</td>
              </tr>
              `;
    }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Mostrar botón PDF
    const printBtn = document.getElementById('leaderboard-print-btn');
    if (printBtn) printBtn.style.display = (leaderboard.length > 0 && currentUser?.isAdmin) ? 'inline-flex' : 'none';

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

              ${!match.is_finished ? `<button id="btn-delete-${match.id}" class="btn btn-danger btn-sm" title="Eliminar partido">🗑️</button>` : ''}
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

// ==================== ADMIN: SEGUIMIENTO DE PRONÓSTICOS ====================

// Las match_date / deadline vienen como "2026-04-27T21:00:00.000Z" desde el
// driver de pg, pero el valor almacenado no tiene zona horaria real (el admin
// escribió "21:00" local). Si dejamos la Z, JS lo trata como UTC y al mostrar
// en Madrid añade +1/+2h. Quitando la Z se parsea como hora local → sale igual
// que lo que escribió el admin.
function parseMatchDate(raw) {
  if (!raw) return new Date(NaN);
  const s = String(raw).replace(/Z$/, '').replace(/\.\d+$/, '');
  return new Date(s);
}

let _trackerData = null; // cache para el botón de imprimir

async function loadOpenPredictions() {
  const container = document.getElementById('admin-tracker-container');
  if (!container) return;
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res = await fetchWithRetry('/api/admin/open-predictions');
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔒</div><h3>${res.status === 401 ? 'Sin permisos de admin' : 'Error al cargar'}</h3><p>${data.error || ''}</p></div>`;
      return;
    }

    const matches = data.matches || [];
    const totalUsers = data.totalUsers || 0;
    _trackerData = { matches, totalUsers };

    // Botón de imprimir/PDF
    const printBtn = document.getElementById('tracker-print-btn');
    if (printBtn) printBtn.style.display = matches.length > 0 ? 'inline-flex' : 'none';

    if (matches.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><h3>No hay partidos abiertos</h3><p>Todos los partidos tienen resultado.</p></div>';
      return;
    }

    const esc = (s) => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');

    container.innerHTML = matches.map(m => {
      const homeTeam = m.is_home ? m.team : m.opponent;
      const awayTeam = m.is_home ? m.opponent : m.team;
      const fecha = parseMatchDate(m.match_date).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const deadlineLabel = m.deadline_passed
        ? '<span style="background: rgba(255,51,51,0.2); color: #ff3333; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;">⏰ PLAZO CERRADO</span>'
        : '<span style="background: rgba(16,185,129,0.2); color: #10B981; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;">✅ PLAZO ABIERTO</span>';

      const predsList = m.predictions.length === 0
        ? '<li style="color: var(--text-muted); font-style: italic;">Nadie ha pronosticado todavía</li>'
        : m.predictions.map(p => `
            <li style="padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between;">
              <span>${esc(p.display_name)}</span>
              <strong style="font-family: 'Orbitron', monospace; color: var(--neon-red, #ff3333);">${p.home_goals} - ${p.away_goals}</strong>
            </li>`).join('');

      const missingList = m.missing.length === 0
        ? '<li style="color: #10B981;">🎉 ¡Todos han pronosticado!</li>'
        : m.missing.map(u => `<li style="padding: 4px 0; color: var(--text-secondary);">${esc(u.display_name)}</li>`).join('');

      return `
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <h3 class="card-title" style="margin: 0;">${esc(homeTeam)} vs ${esc(awayTeam)}</h3>
            ${deadlineLabel}
          </div>
          <p style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">📅 ${fecha}</p>

          <div class="tracker-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 14px;">
            <div>
              <h4 style="font-size: 13px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">
                ✅ Han pronosticado (${m.predictions.length}/${totalUsers})
              </h4>
              <ul style="list-style: none; padding: 0; margin: 0;">${predsList}</ul>
            </div>
            <div>
              <h4 style="font-size: 13px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">
                ⏳ Faltan (${m.missing.length})
              </h4>
              <ul style="list-style: none; padding: 0; margin: 0;">${missingList}</ul>
            </div>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p>Error al cargar seguimiento</p>';
  }
}

// Construye un HTML imprimible agrupado POR USUARIO (una sección por persona,
// con todos sus pronósticos debajo) y lo abre en una ventana nueva.
function printTrackerReport() {
  if (!_trackerData || !_trackerData.matches || _trackerData.matches.length === 0) {
    showToast('Carga primero la pestaña Seguimiento', 'error');
    return;
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const { matches, totalUsers } = _trackerData;
  const reportDate = new Date().toLocaleString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  // Pivotar: { username: { displayName, rows: [{matchLabel, date, score, missing}] } }
  // Mantenemos el orden de los partidos tal como viene del backend.
  const byUser = {};
  matches.forEach(m => {
    const homeTeam = m.is_home ? m.team : m.opponent;
    const awayTeam = m.is_home ? m.opponent : m.team;
    const matchLabel = `${homeTeam} vs ${awayTeam}`;
    const dateShort = parseMatchDate(m.match_date).toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    m.predictions.forEach(p => {
      const key = p.username.toLowerCase();
      if (!byUser[key]) byUser[key] = { displayName: p.display_name, rows: [] };
      byUser[key].rows.push({
        matchLabel, dateShort,
        score: `${p.home_goals} - ${p.away_goals}`,
        missing: false
      });
    });
    m.missing.forEach(u => {
      const key = u.username.toLowerCase();
      if (!byUser[key]) byUser[key] = { displayName: u.display_name, rows: [] };
      byUser[key].rows.push({ matchLabel, dateShort, score: '—', missing: true });
    });
  });

  // Ordenar usuarios alfabéticamente por nombre visible
  const users = Object.values(byUser).sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));

  const sections = users.map(u => {
    const predCount = u.rows.filter(r => !r.missing).length;
    const tableRows = u.rows.map(r => `
      <tr class="${r.missing ? 'missing' : ''}">
        <td>${esc(r.matchLabel)}</td>
        <td class="date">${esc(r.dateShort)}</td>
        <td class="score">${esc(r.score)}</td>
      </tr>`).join('');

    return `
      <section class="user-block">
        <div class="user-header">
          <h2>${esc(u.displayName)}</h2>
          <div class="counts">Pronosticó <strong>${predCount}</strong> de ${u.rows.length} partido${u.rows.length === 1 ? '' : 's'} abierto${u.rows.length === 1 ? '' : 's'}</div>
        </div>
        <table>
          <thead><tr><th>Partido</th><th class="date">Fecha</th><th class="score">Pronóstico</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </section>`;
  }).join('');

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Pronósticos Bolilla Garras — ${esc(reportDate)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Helvetica', 'Arial', sans-serif;
    color: #111;
    background: #fff;
    margin: 0;
    padding: 20px;
    font-size: 12px;
    line-height: 1.4;
  }
  header {
    text-align: center;
    border-bottom: 3px solid #c00;
    padding-bottom: 12px;
    margin-bottom: 20px;
  }
  header h1 {
    margin: 0 0 4px 0;
    font-size: 22px;
    color: #c00;
    letter-spacing: 1px;
  }
  header .sub {
    font-size: 11px;
    color: #555;
  }
  .user-block {
    page-break-inside: avoid;
    margin-bottom: 18px;
    border-left: 3px solid #c00;
    padding-left: 10px;
  }
  .user-header h2 {
    margin: 0 0 2px 0;
    font-size: 15px;
    color: #000;
  }
  .counts {
    font-size: 11px;
    color: #555;
    margin-bottom: 6px;
  }
  th.date, td.date {
    text-align: center;
    font-size: 10px;
    color: #555;
    white-space: nowrap;
    width: 1%;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 4px;
  }
  thead th {
    text-align: left;
    background: #f4f4f4;
    border-bottom: 2px solid #999;
    padding: 6px 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  th.score, td.score {
    text-align: right;
    font-family: 'Courier New', monospace;
  }
  tbody td {
    padding: 5px 8px;
    border-bottom: 1px solid #ddd;
  }
  tbody tr.missing td { color: #999; font-style: italic; }
  footer {
    margin-top: 20px;
    text-align: center;
    font-size: 10px;
    color: #888;
    border-top: 1px solid #ccc;
    padding-top: 8px;
  }
  .print-btn {
    position: fixed;
    top: 10px;
    right: 10px;
    background: #c00;
    color: white;
    border: none;
    padding: 10px 16px;
    font-size: 14px;
    font-weight: 700;
    border-radius: 6px;
    cursor: pointer;
  }
  @media print {
    .print-btn { display: none; }
  }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>
  <header>
    <h1>🦁 BOLILLA GARRAS — Pronósticos</h1>
    <div class="sub">Peña Garras Taldea Sestao · Generado ${esc(reportDate)}</div>
  </header>
  ${sections}
  <footer>Bolilla Garras · ${users.length} usuario${users.length === 1 ? '' : 's'} · ${matches.length} partido${matches.length === 1 ? '' : 's'} abierto${matches.length === 1 ? '' : 's'}</footer>
  <script>setTimeout(() => window.print(), 400);</script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    showToast('Permite ventanas emergentes para imprimir', 'error');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ==================== LEADERBOARD PDF ====================

async function printLeaderboardReport() {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let leaderboard, detail;
  try {
    const [r1, r2] = await Promise.all([
      fetchWithRetry('/api/leaderboard'),
      fetchWithRetry('/api/leaderboard/detail')
    ]);
    leaderboard = await r1.json();
    detail = await r2.json();
  } catch (err) {
    showToast('Error al cargar datos para el PDF', 'error');
    return;
  }

  if (!leaderboard.length) {
    showToast('No hay datos de clasificación aún', 'error');
    return;
  }

  const reportDate = new Date().toLocaleString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  // Agrupar detalle por player_name (lower)
  const byPlayer = {};
  detail.forEach(row => {
    const key = row.player_name.toLowerCase();
    if (!byPlayer[key]) byPlayer[key] = [];
    byPlayer[key].push(row);
  });

  // Secciones por usuario en orden de clasificación
  const sections = leaderboard.map((user, index) => {
    const rank = index + 1;
    const rankLabel = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
    const key = user.name.toLowerCase();
    const preds = byPlayer[key] || [];

    const rows = preds.map(p => {
      const homeTeam = p.is_home ? p.team : p.opponent;
      const awayTeam = p.is_home ? p.opponent : p.team;
      const predScore = p.is_home
        ? `${p.pred_home} - ${p.pred_away}`
        : `${p.pred_away} - ${p.pred_home}`;
      const realScore = p.is_home
        ? `${p.real_home} - ${p.real_away}`
        : `${p.real_away} - ${p.real_home}`;
      const pts = Number(p.points);
      const ptsClass = pts === 5 ? 'pts-exact' : pts > 0 ? 'pts-partial' : 'pts-zero';
      const ptsLabel = pts === 5 ? `5 🎯` : String(pts);
      const dateShort = parseMatchDate(p.match_date).toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      return `
        <tr>
          <td>${esc(homeTeam)} vs ${esc(awayTeam)}</td>
          <td class="center">${esc(dateShort)}</td>
          <td class="center mono">${esc(predScore)}</td>
          <td class="center mono">${esc(realScore)}</td>
          <td class="center ${ptsClass}">${ptsLabel}</td>
        </tr>`;
    }).join('');

    const emptyRow = preds.length === 0
      ? `<tr><td colspan="5" class="empty">Sin pronósticos en partidos disputados</td></tr>`
      : '';

    return `
      <section class="user-block">
        <div class="user-header">
          <span class="rank-badge">${rankLabel}</span>
          <h2>${esc(user.display_name || user.name)}</h2>
          <div class="user-meta">
            <span class="total-pts">${user.total_points} pts</span>
            <span class="exact-badge">${user.exact_predictions} 🎯 plenos</span>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Partido</th>
              <th class="center">Fecha</th>
              <th class="center">Pronóstico</th>
              <th class="center">Resultado</th>
              <th class="center">Pts</th>
            </tr>
          </thead>
          <tbody>
            ${rows}${emptyRow}
            <tr class="total-row">
              <td colspan="4" style="text-align:right; font-weight:700;">TOTAL</td>
              <td class="center total-pts-cell">${user.total_points}</td>
            </tr>
          </tbody>
        </table>
      </section>`;
  }).join('');

  // Tabla final de clasificación general
  const rankingRows = leaderboard.map((user, index) => {
    const rank = index + 1;
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`;
    return `
      <tr class="${rank <= 3 ? 'top' + rank : ''}">
        <td class="center">${medal}</td>
        <td>${esc(user.display_name || user.name)}</td>
        <td class="center total-pts-cell">${user.total_points}</td>
        <td class="center">${user.exact_predictions} 🎯</td>
      </tr>`;
  }).join('');

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Clasificación Bolilla Garras — ${esc(reportDate)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica', 'Arial', sans-serif;
    color: #111;
    background: #fff;
    padding: 20px;
    font-size: 12px;
    line-height: 1.4;
  }
  header {
    text-align: center;
    border-bottom: 3px solid #c00;
    padding-bottom: 12px;
    margin-bottom: 24px;
  }
  header h1 { font-size: 22px; color: #c00; letter-spacing: 1px; margin-bottom: 4px; }
  header .sub { font-size: 11px; color: #555; }

  .user-block {
    page-break-inside: avoid;
    margin-bottom: 22px;
    border-left: 3px solid #c00;
    padding-left: 10px;
  }
  .user-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 6px;
    flex-wrap: wrap;
  }
  .rank-badge { font-size: 16px; }
  .user-header h2 { font-size: 15px; color: #000; }
  .user-meta { margin-left: auto; display: flex; gap: 12px; align-items: center; }
  .total-pts { font-size: 15px; font-weight: 700; color: #c00; }
  .exact-badge { font-size: 11px; color: #555; }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 4px;
    font-size: 11px;
  }
  thead th {
    background: #f4f4f4;
    border-bottom: 2px solid #bbb;
    padding: 5px 8px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  tbody td { padding: 4px 8px; border-bottom: 1px solid #e8e8e8; }
  .center { text-align: center; }
  .mono { font-family: 'Courier New', monospace; letter-spacing: 0.5px; }
  .pts-exact  { color: #007a3d; font-weight: 700; }
  .pts-partial { color: #b25000; font-weight: 600; }
  .pts-zero   { color: #999; }
  .empty { color: #aaa; font-style: italic; text-align: center; }
  .total-row td { background: #f9f9f9; border-top: 2px solid #bbb; padding: 6px 8px; }
  .total-pts-cell { font-size: 13px; font-weight: 700; color: #c00; font-family: 'Courier New', monospace; }

  .ranking-section {
    page-break-before: always;
    margin-top: 8px;
  }
  .ranking-section h2 {
    font-size: 16px;
    color: #c00;
    border-bottom: 2px solid #c00;
    padding-bottom: 6px;
    margin-bottom: 12px;
    letter-spacing: 0.5px;
  }
  .top1 td { background: #fffbe6; }
  .top2 td { background: #f6f6f6; }
  .top3 td { background: #fff5ee; }
  .ranking-section thead th { font-size: 11px; }
  .ranking-section tbody td { padding: 6px 8px; font-size: 12px; }

  footer {
    margin-top: 20px;
    text-align: center;
    font-size: 10px;
    color: #888;
    border-top: 1px solid #ccc;
    padding-top: 8px;
  }
  .print-btn {
    position: fixed; top: 10px; right: 10px;
    background: #c00; color: white; border: none;
    padding: 10px 16px; font-size: 14px; font-weight: 700;
    border-radius: 6px; cursor: pointer;
  }
  @media print { .print-btn { display: none; } }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>
  <header>
    <h1>🦁 BOLILLA GARRAS — Clasificación General</h1>
    <div class="sub">Peña Garras Taldea Sestao · Generado ${esc(reportDate)}</div>
  </header>

  ${sections}

  <section class="ranking-section">
    <h2>🏆 Clasificación General</h2>
    <table>
      <thead>
        <tr>
          <th class="center" style="width:50px;">Pos</th>
          <th>Jugador</th>
          <th class="center" style="width:70px;">Puntos</th>
          <th class="center" style="width:70px;">Plenos</th>
        </tr>
      </thead>
      <tbody>${rankingRows}</tbody>
    </table>
  </section>

  <footer>Bolilla Garras · ${leaderboard.length} jugador${leaderboard.length === 1 ? '' : 'es'} · ${esc(reportDate)}</footer>
  <script>setTimeout(() => window.print(), 400);</script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    showToast('Permite ventanas emergentes para exportar el PDF', 'error');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ==================== ADMIN: USERS ====================

async function loadAdminUsers() {
  const container = document.getElementById('admin-users-container');
  if (!container) return;
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res = await fetchWithRetry('/api/admin/users');
    const users = await res.json().catch(() => ({}));

    if (!res.ok || !Array.isArray(users)) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔒</div><h3>${res.status === 401 ? 'Sin permisos de admin' : 'Error al cargar usuarios'}</h3><p>${(users && users.error) || ''}</p></div>`;
      return;
    }

    if (users.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><h3>No hay usuarios registrados</h3></div>';
      return;
    }

    const rows = users.map(u => {
      const safeUsername = String(u.username).replace(/"/g, '&quot;');
      const safeDisplay = String(u.display_name).replace(/</g, '&lt;');
      const adminBadge = u.is_admin ? '<span class="user-badge-admin">ADMIN</span>' : '';
      return `
        <tr data-user-id="${u.id}">
          <td data-label="Usuario">
            <strong>${safeDisplay}</strong> ${adminBadge}
            <div class="user-username">@${safeUsername}</div>
          </td>
          <td data-label="Contraseña">
            <div id="pwd-view-${u.id}" class="user-pwd-view">••••••••</div>
          </td>
          <td data-label="Acciones" class="user-actions">
            <button class="btn btn-sm btn-view-pwd" data-action="view-pwd"
              data-user-id="${u.id}" data-display="${safeDisplay}">
              🔎 Ver
            </button>
            <button class="btn btn-secondary btn-sm" data-action="rename"
              data-user-id="${u.id}" data-display="${safeDisplay}">
              ✏️ Renombrar
            </button>
            <button class="btn btn-secondary btn-sm" data-action="reset-pwd"
              data-user-id="${u.id}" data-username="${safeUsername}" data-display="${safeDisplay}">
              🔑 Resetear
            </button>
            <button class="btn btn-danger btn-sm" data-action="delete-user"
              data-user-id="${u.id}" data-username="${safeUsername}" data-display="${safeDisplay}">
              🗑️ Borrar
            </button>
          </td>
        </tr>`;
    }).join('');

    container.innerHTML = `
      <div class="users-table-wrapper">
        <table class="users-table">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Contraseña</th>
              <th class="user-actions-col">Acciones</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    container.querySelectorAll('button[data-action="reset-pwd"]').forEach(btn => {
      btn.addEventListener('click', () => {
        resetUserPassword(
          parseInt(btn.dataset.userId),
          btn.dataset.username,
          btn.dataset.display
        );
      });
    });

    container.querySelectorAll('button[data-action="view-pwd"]').forEach(btn => {
      btn.addEventListener('click', () => {
        viewUserPassword(parseInt(btn.dataset.userId), btn.dataset.display, btn);
      });
    });

    container.querySelectorAll('button[data-action="rename"]').forEach(btn => {
      btn.addEventListener('click', () => {
        renameUser(parseInt(btn.dataset.userId), btn.dataset.display);
      });
    });

    container.querySelectorAll('button[data-action="delete-user"]').forEach(btn => {
      btn.addEventListener('click', () => {
        deleteUser(
          parseInt(btn.dataset.userId),
          btn.dataset.username,
          btn.dataset.display
        );
      });
    });
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p>Error al cargar usuarios</p>';
  }
}

async function deleteUser(userId, username, displayName) {
  const msg = `¿Seguro que quieres borrar a ${displayName} (@${username})?\n\n⚠️ Esto también borrará TODOS sus pronósticos y los puntos que haya acumulado en la clasificación. No se puede deshacer.`;
  if (!confirm(msg)) return;

  try {
    const res = await fetchWithRetry(`/api/admin/users/${userId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      const n = data.deletedPredictions || 0;
      showToast(`${displayName} borrado (${n} pronóstico${n === 1 ? '' : 's'} eliminados)`, 'success');
      loadAdminUsers();
    } else {
      showToast(data.error || 'Error al borrar usuario', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Error de conexión', 'error');
  }
}

async function renameUser(userId, currentDisplayName) {
  const newName = prompt(`Nuevo nombre visible para "${currentDisplayName}":`, currentDisplayName);
  if (newName === null) return;
  const trimmed = newName.trim();
  if (trimmed.length < 2) {
    showToast('El nombre debe tener al menos 2 caracteres', 'error');
    return;
  }
  if (trimmed === currentDisplayName) return;

  try {
    const res = await fetchWithRetry(`/api/admin/users/${userId}/display-name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: trimmed })
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      showToast(`Renombrado a "${trimmed}"`, 'success');
      loadAdminUsers();
    } else {
      showToast(data.error || 'Error al renombrar', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Error de conexión', 'error');
  }
}

async function viewUserPassword(userId, displayName, btn) {
  const view = document.getElementById(`pwd-view-${userId}`);
  if (!view) return;

  // Si ya está mostrada, ocultar (toggle)
  if (view.dataset.revealed === '1') {
    view.textContent = '••••••••';
    view.dataset.revealed = '0';
    if (btn) btn.textContent = '🔎 Ver';
    return;
  }

  view.textContent = '…';
  try {
    const res = await fetchWithRetry(`/api/admin/users/${userId}/password`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      view.textContent = '••••••••';
      showToast(data.error || 'Error al ver contraseña', 'error');
      return;
    }

    if (data.password === null || data.password === undefined) {
      view.textContent = '(no capturada)';
      view.title = data.message || 'Aún no disponible';
      showToast(data.message || 'Contraseña no disponible todavía', 'info');
      return;
    }

    view.textContent = data.password;
    view.dataset.revealed = '1';
    if (btn) btn.textContent = '🙈 Ocultar';
  } catch (err) {
    console.error(err);
    view.textContent = '••••••••';
    showToast('Error de conexión', 'error');
  }
}

async function resetUserPassword(userId, username, displayName) {
  const newPassword = prompt(`Nueva contraseña para ${displayName} (@${username}).\n\nSe la tendrás que comunicar tú (WhatsApp, etc.).`);
  if (newPassword === null) return;

  if (!newPassword) {
    showToast('La contraseña no puede estar vacía', 'error');
    return;
  }

  try {
    const res = await fetchWithRetry(`/api/admin/users/${userId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword })
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      showToast(`Contraseña de ${displayName} actualizada`, 'success');
    } else {
      showToast(data.error || 'Error al cambiar contraseña', 'error');
    }
  } catch (err) {
    console.error(err);
    showToast('Error de conexión', 'error');
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

  const confirmed = confirm(`¿Confirmas el resultado: ${homeGoals} - ${awayGoals}?\n\nSe calcularán los puntos de todos los pronósticos.`);
  if (!confirmed) return;

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
  if (!confirm('¿Seguro que quieres eliminar este partido? Solo se pueden borrar partidos sin resultado; los finalizados no se pueden borrar para no perder la clasificación.')) return;

  const token = localStorage.getItem('bolilla_token') || '';
  try {
    const res = await fetch(`/api/matches/${matchId}`, {
      method: 'DELETE',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      showToast('Partido eliminado', 'success');
      loadAdminMatches();
      loadMatches();
    } else {
      showToast(data.error || 'Error al eliminar partido', 'error');
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
