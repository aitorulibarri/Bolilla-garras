// Bolilla Garras App v8.5 — Excel con colores (clasificacion + seguimiento)
console.log('📱 Bolilla Garras App v8.5 loaded');
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
const garrasTab = document.getElementById('garras-tab');
const navTabs = document.querySelectorAll('.nav-tab');
const tabContents = document.querySelectorAll('.tab-content');
const authTabs = document.querySelectorAll('.auth-tab');

// ==================== FETCH WITH RETRY (for cold starts) ====================
async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
  // Get JWT token from sessionStorage
  const token = sessionStorage.getItem('bolilla_token') || '';

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
  const savedUser = sessionStorage.getItem('bolilla_user');
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      showApp();
    } catch {
      sessionStorage.removeItem('bolilla_user');
      sessionStorage.removeItem('bolilla_token');
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
    leaderboardPrintBtn.addEventListener('click', exportLeaderboardCSV);
  }

  // Botón de exportar solo la clasificación
  const leaderboardRankingBtn = document.getElementById('leaderboard-ranking-btn');
  if (leaderboardRankingBtn) {
    leaderboardRankingBtn.addEventListener('click', printRankingOnly);
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
        // Save token and user to sessionStorage
        sessionStorage.setItem('bolilla_token', data.token || '');
        sessionStorage.setItem('bolilla_user', JSON.stringify(currentUser));
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
        // Save token and user to sessionStorage
        sessionStorage.setItem('bolilla_token', data.token || '');
        sessionStorage.setItem('bolilla_user', JSON.stringify(currentUser));
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
    const token = sessionStorage.getItem('bolilla_token') || '';
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
    } catch (e) {
      // Ignore errors
    }
    sessionStorage.removeItem('bolilla_user');
    sessionStorage.removeItem('bolilla_token');
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

  // Reset full season modal
  const openResetBtn = document.getElementById('open-reset-season-btn');
  const resetModal = document.getElementById('reset-season-modal');
  const closeResetBtn = document.getElementById('close-reset-season');
  const cancelResetBtn = document.getElementById('cancel-reset-season');
  const confirmResetBtn = document.getElementById('confirm-reset-season');
  const resetInput = document.getElementById('reset-season-confirm-input');
  const resetOverlay = resetModal?.querySelector('.modal-overlay');

  if (openResetBtn && resetModal) {
    const closeResetModal = () => {
      resetModal.classList.remove('show');
      setTimeout(() => resetModal.style.display = 'none', 300);
      resetInput.value = '';
      confirmResetBtn.disabled = true;
    };

    openResetBtn.addEventListener('click', () => {
      resetModal.style.display = 'flex';
      setTimeout(() => resetModal.classList.add('show'), 10);
      resetInput.value = '';
      confirmResetBtn.disabled = true;
      resetInput.focus();
    });

    closeResetBtn?.addEventListener('click', closeResetModal);
    cancelResetBtn?.addEventListener('click', closeResetModal);
    resetOverlay?.addEventListener('click', closeResetModal);

    resetInput?.addEventListener('input', () => {
      confirmResetBtn.disabled = resetInput.value !== 'RESETEAR';
    });

    confirmResetBtn?.addEventListener('click', async () => {
      confirmResetBtn.disabled = true;
      confirmResetBtn.textContent = 'Reseteando...';
      await executeFullSeasonReset();
      confirmResetBtn.textContent = '🗑️ Resetear';
      closeResetModal();
    });
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
        const token = sessionStorage.getItem('bolilla_token') || '';
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
    case 'garras':
      loadGarrasSaria();
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

    // Single save-all button if there are pending predictions
    const pendingIds = matches
      .filter(m => new Date() < new Date(m.deadline))
      .map(m => m.id);

    if (pendingIds.length > 0) {
      const saveAllBtn = document.createElement('button');
      saveAllBtn.className = 'save-btn-gemini';
      saveAllBtn.style.cssText = 'width:100%; margin-top:16px;';
      saveAllBtn.textContent = 'GUARDAR PRONÓSTICOS';
      saveAllBtn.addEventListener('click', () => saveAllPredictions(pendingIds));
      container.appendChild(saveAllBtn);
    }
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3>Error al cargar partidos</h3><p>Inténtalo de nuevo</p></div>';
  }
}

// ==================== TEAMS DATA (Temporada 2026/27) ====================
const LEAGUE_TEAMS = {
  'Athletic Club': [ // LaLiga EA Sports 2026/27
    'Atlético de Madrid', 'FC Barcelona', 'Real Madrid', 'Real Betis', 'Real Sociedad',
    'Sevilla FC', 'Valencia CF', 'Villarreal CF', 'Celta de Vigo', 'CA Osasuna',
    'Rayo Vallecano', 'Getafe CF', 'RCD Espanyol', 'Deportivo Alavés', 'Elche CF',
    'Levante UD', 'RC Deportivo', 'Málaga CF', 'Racing de Santander'
  ],
  'Athletic Femenino': [ // Liga F Moeve 2026/27
    'Atlético de Madrid', 'FC Barcelona', 'Badalona Femenino',
    'Deportivo de La Coruña Femenino', 'Deportivo Alavés Femenino', 'Eibar Femenino',
    'RCD Espanyol', 'Granada CF', 'Logroño United', 'Madrid CFF', 'Real Madrid',
    'Real Sociedad', 'Sevilla FC', 'Tenerife Femenino', 'Valencia Féminas'
  ],
  'Bilbao Athletic': [ // Grupo 1 2026/27
    'Barakaldo CF', 'CP Cacereño', 'CD Coria', 'Cultural Leonesa', 'Extremadura CD',
    'UD Logroñés', 'CD Lugo', 'CP Mérida', 'CD Mirandés', 'Pontevedra CF',
    'Racing de Ferrol', 'RC Deportivo Fabril', 'Real Unión de Irún', 'Real Avilés CF',
    'UD Ourense', 'Unionistas CF', 'Zamora CF', 'Arenas Club', 'SD Ponferradina'
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

  // ── LaLiga EA Sports 2026/27 ──
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
  'Rayo Vallecano':                   'logos/laliga/RAYO-VALLECANO-SAD.png',
  'Getafe CF':                        'logos/laliga/GETAFE.png',
  'RCD Espanyol':                     'logos/laliga/ESPAÑOL.png',
  'Deportivo Alavés':                 'logos/laliga/DEPORTIVO ALAVES 2021.png',
  'Elche CF':                         'logos/laliga/Escudo_Elche_CF.png',
  'Levante UD':                       'logos/laliga/LEVANTE.png',
  'RC Deportivo':                     'logos/laliga/DEPORTIVO DE LA CORUÑA.PNG',
  'Deportivo de La Coruña':           'logos/laliga/DEPORTIVO DE LA CORUÑA.PNG',
  'Málaga CF':                        'logos/laliga/Málaga.png',
  'Racing de Santander':              'logos/laliga/RACING SANTANDER.png',

  // ── Segunda División (equipos con logo; ya no aparecen en el pronóstico de Athletic) ──
  'Albacete Balompié':                'logos/segunda/ALBACETE.png',
  'UD Almería':                       'logos/segunda/ALMERIA.png',
  'Cádiz CF':                         'logos/segunda/CADIZ.png',
  'CD Castellón':                     'logos/segunda/CD Castellón.png',
  'Córdoba CF':                       'logos/segunda/CORDOBA.png',
  'SD Eibar':                         'logos/segunda/EIBAR.png',
  'FC Andorra':                       'logos/segunda/FC ANDORRA.png',
  'Granada CF':                       'logos/segunda/GRANADA.png',
  'SD Huesca':                        'logos/segunda/HUESCA.png',
  'Real Sociedad B':                  'logos/segunda/REAL SOCIEDAD B.png',
  'Sporting de Gijón':                'logos/segunda/SPORTING GIJON.png',
  'Real Zaragoza':                    'logos/segunda/ZARAGOZA.png',
  'Burgos CF':                        'logos/segunda/burgos c.f..png',
  'AD Ceuta FC':                      'logos/segunda/AD CEUTA CF.jpg',
  'Real Valladolid':                  'logos/segunda/valladolid.png',
  'CD Leganés':                       'logos/segunda/LEGANES.png',

  // ── Liga F (Femenina) 2026/27 ──
  'Badalona Femenino':                'logos/ligaf/Badalona_Women.png',
  'Levante Badalona':                 'logos/ligaf/Badalona_Women.png',
  'Deportivo de La Coruña Femenino':  'logos/ligaf/DEPOR.png',
  'Deportivo Abanca':                 'logos/ligaf/DEPOR.png',
  'Deportivo Alavés Femenino':        'logos/ligaf/DEPORTIVO ALAVES.png',
  'Logroño United':                   'logos/ligaf/LOGROÑO UNITED.png',
  'Eibar Femenino':                   'logos/ligaf/EIBAR.png',
  'Levante Las Planas':               'logos/ligaf/levante-femenino.png',
  'Madrid CFF':                       'logos/ligaf/images-Photoroom.png',
  'Tenerife Femenino':                'logos/ligaf/U.D.-Granadilla-Tenerife-Egatesa.png',
  'Costa Adeje Tenerife':             'logos/ligaf/U.D.-Granadilla-Tenerife-Egatesa.png',
  'UD Granadilla Tenerife':           'logos/ligaf/U.D.-Granadilla-Tenerife-Egatesa.png',
  'Valencia Féminas':                 'logos/ligaf/Valencia Feminas.png',

  // ── Grupo 1 2026/27 ──
  'Barakaldo CF':                     'logos/rfef/BARAKALDO.png',
  'CP Cacereño':                      'logos/rfef/CACEREÑO.png',
  'Cacereño':                         'logos/rfef/CACEREÑO.png',
  'CD Coria':                         'logos/rfef/CORIA.png',
  'Cultural Leonesa':                 'logos/rfef/CULTURAL LEONESA.png',
  'Extremadura CD':                   'logos/rfef/Extremadura CD.png',
  'UD Logroñés':                      'logos/rfef/LOGROÑES.png',
  'CD Lugo':                          'logos/rfef/LUGO.png',
  'CP Mérida':                        'logos/rfef/MERIDA.png',
  'Mérida AD':                        'logos/rfef/MERIDA.png',
  'CD Mirandés':                      'logos/rfef/MIRANDES.png',
  'RC Deportivo Fabril':              'logos/rfef/RC_Deportivo_FABRIL.png',
  'Real Unión de Irún':               'logos/rfef/REAL UNION DE IRUN.png',
  'UD Ourense':                       'logos/rfef/UD OURENSE.png',
  'Ourense CF':                       'logos/rfef/OURENSE.png',
  'Pontevedra CF':                    'logos/rfef/PONTEVEDRA CF.png',
  'Racing de Ferrol':                 'logos/rfef/RACING DE FERROL.png',
  'Real Avilés CF':                   'logos/rfef/Real Avilés.png',
  'Real Avilés Industrial':           'logos/rfef/Real Avilés.png',
  'Unionistas CF':                    'logos/rfef/Unionistas_Salamanca.png',
  'Unionistas de Salamanca':          'logos/rfef/Unionistas_Salamanca.png',
  'Zamora CF':                        'logos/rfef/ZAMORA-CF.png',
  'Arenas Club':                      'logos/rfef/arenasclub.png',
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

// ==================== FOTOS DE JUGADORES (Garras Saria) ====================
// Mapeo directo: nombre EXACTO como está en garras_players.name -> foto en public/players/
// Jugadores del seed sin foto en el pendrive (masculino): Unai Vencedor, Iñigo Lekue,
//   Unai Gómez, Urko Izeta, Asier Hierro, Eder García.
// Jugadoras del seed sin foto en el pendrive (femenino): Olatz Santana Amado,
//   Nerea Nevado Gómez, Laida Balerdi Beloki, Irati Alfaro Nagore, Maite Zubieta Aranbarri,
//   Alejandra Estefanía Díaz, Ane Bordagaray Casado, Daniela Agote Helguera (el pendrive trae
//   "daniela-agote-aguirre.png", segundo apellido distinto: no se ha dado por buena la
//   coincidencia), Oihana Agirregomezkorta García.
// Estos jugadores/as caen al avatar de iniciales vía getPlayerPhotoUrl().
const PLAYER_PHOTO_MAP = {
  // ── Masculino ──
  'Unai Simón':              'players/masculino/unai-simon-mendibil_L.png',
  'Andoni Gorosabel':        'players/masculino/andoni-gorosabel-espinosa.png',
  'Dani Vivian':              'players/masculino/daniel-vivian-moreno.png',
  'Aitor Paredes':            'players/masculino/aitor-paredes-casamichana.png',
  'Yeray Álvarez':            'players/masculino/yeray-alvarez-lopez_L.png',
  'Mikel Vesga':              'players/masculino/mikel-vesga-arruti.png',
  'Alex Berenguer':           'players/masculino/alejandro-berenguer-remiro.png',
  'Oihan Sancet':             'players/masculino/oihan-sancet-tirapu.png',
  'Iñaki Williams':           'players/masculino/inaki-williams-arthuer_L.png',
  'Nico Williams':            'players/masculino/nico-williams-arthuer_L.png',
  'Gorka Guruzeta':           'players/masculino/gorka-guruzeta-rodriguez.png',
  'Jesús Areso':              'players/masculino/jesus-areso-blanco.png',
  'Aymeric Laporte':          'players/masculino/aymeric-laporte.png',
  'Iñigo R. De Galarreta':    'players/masculino/inigo-ruiz-de-galarreta-etxeberria.png',
  'Yuri Berchiche':           'players/masculino/yuri-berchiche-izeta.png',
  'Mikel Jauregizar':         'players/masculino/mikel-jauregizar-alboniga.png',
  'Adama Boiro':              'players/masculino/adama-boiro-boiro.png',
  'Maroan Sannadi':           'players/masculino/maroan-sannadi-harrouch.png',
  'Nico Serrano':             'players/masculino/nicolas-serrano-galdeano.png',
  'Robert Navarro':           'players/masculino/robert-navarro-munoz.png',
  'Beñat Prados':             'players/masculino/benat-prados-diaz.png',
  'Mikel Santos':             'players/masculino/mikel-santos-linares.png',
  'Alex Padilla':             'players/masculino/alex-padilla-perez.png',
  'Alejandro Rego':           'players/masculino/alejandro-rego-mora.png',
  'Selton Sánchez':           'players/masculino/selton-sued-sanchez-camilo.png',
  'Iker Monreal':             'players/masculino/iker-monreal-agundez.png',

  // ── Femenino ──
  'Adriana Nanclares Romero':     'players/femenino/1-adriana-nanclares-romero.png',
  'Ziara Vega Uribarri':          'players/femenino/ziara-vega-uribarri.png',
  'Maddi Torre Larrañaga':        'players/femenino/maddi-torre-larranaga.png',
  'Naia Landaluze Marquínez':     'players/femenino/naia-landaluze-marquinez.png',
  'Bibiane Schulze Solano':       'players/femenino/bibiane-schulze-solano.png',
  'Ane Elexpuru Añorga':          'players/femenino/ane-elexpuru-anorga.png',
  'Eider Arana Mugueta':          'players/femenino/eider-arana-mugueta.png',
  'Nerea Benito Zaldibar':        'players/femenino/nerea-benito-zaldibar.png',
  'Maite Valero Elía':            'players/femenino/maite-valero-elia.png',
  'Irene Oguiza Martínez':        'players/femenino/irene-oguiza-martinez.png',
  'Leire Baños Indakoetxea':      'players/femenino/leire-banos-indakoetxea.png',
  'Clara Pinedo Castresana':      'players/femenino/clara-pinedo-castresana.png',
  'Jone Amezaga Martínez':        'players/femenino/jone-amezaga-martinez.png',
  'Patricia Zugasti Oses':        'players/femenino/patricia-zugasti-oses.png',
  'Ane Azkona Fuente':            'players/femenino/ane-azkona-fuente.png',
  'Sara Ortega Ruiz':             'players/femenino/sara-ortega-ruiz.png',
  'Maitane Vilariño Mendinueta':  'players/femenino/maitane-vilarino-mendinueta.png',
  'Ane Campos Andueza':           'players/femenino/ane-campos-andueza.png',
  'Elene Gurtubay Loyo':          'players/femenino/elene-gurtubay-loyo.png',
};

function getPlayerPhotoUrl(name) {
  if (!name) return null;
  if (PLAYER_PHOTO_MAP[name]) return PLAYER_PHOTO_MAP[name];
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(PLAYER_PHOTO_MAP)) {
    if (key.toLowerCase() === lower) return val;
  }
  return null;
}

function getInitials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  const first = parts[0]?.[0] || '';
  const second = parts[1]?.[0] || '';
  return (first + second).toUpperCase();
}

function playerAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 45%, 32%)`;
}

// Devuelve el HTML de un avatar (frame recortado a pecho-arriba): <img> ampliada
// si hay foto, iniciales si no. sizeFrameClass: 'garras-avatar-frame-vote' | 'garras-avatar-frame-sm' | '' (base).
function renderPlayerAvatar(name, sizeFrameClass) {
  const photo = getPlayerPhotoUrl(name);
  const frameCls = `garras-avatar-frame ${sizeFrameClass || ''}`.trim();
  if (photo) {
    return `<div class="${frameCls}"><img class="garras-avatar" src="${photo}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'), {className:'garras-avatar-fallback', textContent:'${getInitials(name)}', style:'background:${playerAvatarColor(name)}'}))"></div>`;
  }
  return `<div class="${frameCls}"><div class="garras-avatar-fallback" style="background:${playerAvatarColor(name)}">${getInitials(name)}</div></div>`;
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
  const homeTeamSafe = escapeHtml(homeTeam);
  const awayTeamSafe = escapeHtml(awayTeam);

  const homeShield = getShieldUrl(homeTeam);
  const awayShield = getShieldUrl(awayTeam);

  const userHomeGoals = hasPrediction ? userPrediction.home_goals : '';
  const userAwayGoals = hasPrediction ? userPrediction.away_goals : '';

  // Determine League Badge
  const contextTeam = match.team;
  let leagueName = 'LaLiga';
  if (contextTeam === 'Athletic Femenino' || contextTeam.includes('Femenino')) leagueName = 'Liga F';
  if (contextTeam === 'Bilbao Athletic') leagueName = '1ª RFEF';

  const standingsUrls = {
    'Athletic Club':     'https://www.athletic-club.eus/equipos/athletic-club/2025-26/clasificacion/',
    'Athletic Femenino': 'https://www.athletic-club.eus/equipos/athletic-club-femenino/2025-26/clasificacion/',
    'Bilbao Athletic':   'https://www.athletic-club.eus/equipos/bilbao-athletic/2025-26/clasificacion/',
  };
  const standingsUrl = standingsUrls[contextTeam] || null;

  const homeShieldHtml = homeShield
    ? `<img src="${homeShield}" class="big-shield" alt="${homeTeamSafe}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'shield-fallback',textContent:'⚽'}));">`
    : `<span class="shield-fallback">⚽</span>`;
  const awayShieldHtml = awayShield
    ? `<img src="${awayShield}" class="big-shield" alt="${awayTeamSafe}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'shield-fallback',textContent:'⚽'}));">`
    : `<span class="shield-fallback">⚽</span>`;

  return `
    <div class="match-card ${canPredict ? '' : 'expired'}">
      <div class="match-header-gemini">
        <div class="badges-row">
          ${standingsUrl ? `<a href="${standingsUrl}" target="_blank" rel="noopener" style="font-size:11px; color:#94A3B8; text-decoration:none; background:rgba(255,255,255,0.05); padding:4px 10px; border-radius:20px;">📊 Clasificación</a>` : '<span></span>'}
          <span class="match-league-badge">⚽ ${leagueName} • ${dateStr} ${timeStr}</span>
        </div>
        <div class="match-title-large">
            ${homeTeamSafe} <span style="color:var(--neon-red); margin:0 5px;">vs</span> ${awayTeamSafe}
        </div>
      </div>
      
      <div class="match-content-grid">
        <!-- Home Team -->
        <div class="team-container">
            ${homeShieldHtml}
            <span class="team-name-label">${homeTeamSafe}</span>
        </div>

        <!-- Score / Inputs -->
        <div class="score-container">
            ${canPredict
      ? `<input type="number" id="home-${match.id}" class="score-box" min="0" max="15" placeholder="-" value="${userHomeGoals}">`
      : (hasPrediction
        ? `<div class="score-box" style="border-color: #00F5A0; color:#00F5A0;">${userHomeGoals}</div>`
        : `<div class="score-box" style="opacity:0.5">-</div>`)
    }

            <span class="score-separator">-</span>

            ${canPredict
      ? `<input type="number" id="away-${match.id}" class="score-box" min="0" max="15" placeholder="-" value="${userAwayGoals}">`
      : (hasPrediction
        ? `<div class="score-box" style="border-color: #00F5A0; color:#00F5A0;">${userAwayGoals}</div>`
        : `<div class="score-box" style="opacity:0.5">-</div>`)
    }
        </div>

        <!-- Away Team -->
        <div class="team-container">
            ${awayShieldHtml}
            <span class="team-name-label">${awayTeamSafe}</span>
        </div>
      </div>

      <!-- Action Button -->
      ${!canPredict
      ? (hasPrediction
        ? `<button class="save-btn-gemini" style="background: rgba(0, 245, 160, 0.1); border: 1px solid #00F5A0; color: #00F5A0; cursor: default;">
             ✅ PRONÓSTICO GUARDADO
           </button>`
        : `<button class="save-btn-gemini" style="background: #333; cursor: not-allowed; opacity: 0.7;">
                 PLAZO CERRADO
               </button>`)
      : ''
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
      if (index === 0) { rankClass = 'row-rank-1'; icon = '<img src="/assets/trofeo-v2.png" class="rank-crown-img" alt="Copa del Rey">'; }
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

async function saveAllPredictions(matchIds) {
  const predictions = [];
  for (const matchId of matchIds) {
    const homeInput = document.getElementById(`home-${matchId}`);
    const awayInput = document.getElementById(`away-${matchId}`);
    if (!homeInput || !awayInput) continue;
    const homeGoals = homeInput.value;
    const awayGoals = awayInput.value;
    if (homeGoals !== '' && awayGoals !== '') {
      predictions.push({ matchId, homeGoals, awayGoals });
    }
  }

  if (predictions.length === 0) {
    showToast('Introduce al menos un pronóstico', 'error');
    return;
  }

  let saved = 0;
  let errors = 0;
  const token = sessionStorage.getItem('bolilla_token') || '';

  for (const { matchId, homeGoals, awayGoals } of predictions) {
    try {
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
      if (res.ok) saved++;
      else errors++;
    } catch {
      errors++;
    }
  }

  if (saved > 0) showToast(`${saved} pronóstico${saved > 1 ? 's' : ''} guardado${saved > 1 ? 's' : ''}`, 'success');
  if (errors > 0) showToast(`Error guardando ${errors} pronóstico${errors > 1 ? 's' : ''}`, 'error');
  loadMatches();
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
      const rankEmoji = index === 0 ? '<img src="/assets/trofeo-v2.png" class="rank-crown-img" alt="Copa del Rey">' : (index === 1 ? '<img src="/assets/garras-lion.png" class="rank-crown-img" alt="🦁">' : (index === 2 ? '<img src="/assets/lion-paw.png" class="rank-crown-img" alt="🐾">' : `#${index + 1}`));
      return `
              <tr>
                <td class="rank">${rankEmoji}</td>
                <td>
                    <div style="font-weight: 700; color: var(--text-primary); font-size: 16px;">${escapeHtml(user.display_name || user.name)}</div>
                </td>
                <td>
                    <span style="font-family: 'Exo 2', sans-serif; font-size: 20px; color: var(--neon-red); font-weight: 700; text-shadow: 0 0 10px rgba(255, 51, 51, 0.3);">${user.total_points}</span>
                </td>
                <td style="color: #00F5A0; font-weight: 600; font-size: 15px;">${user.exact_predictions} 🎯</td>
              </tr>
              `;
    }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Mostrar botones PDF
    const printBtn = document.getElementById('leaderboard-print-btn');
    if (printBtn) printBtn.style.display = (leaderboard.length > 0 && currentUser?.isAdmin) ? 'inline-flex' : 'none';
    const rankingBtn = document.getElementById('leaderboard-ranking-btn');
    if (rankingBtn) rankingBtn.style.display = (leaderboard.length > 0 && currentUser?.isAdmin) ? 'inline-flex' : 'none';

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

    const teamOrder = ['Athletic Club', 'Athletic Femenino', 'Bilbao Athletic'];
    const presentTeams = teamOrder.filter(t => predictions.some(p => p.team === t));
    container.innerHTML = `
      <div class="history-subtabs" id="history-subtabs">
        <button class="history-subtab active" data-team="__jornada__">Por jornada</button>
        ${presentTeams.map(t => `
          <button class="history-subtab" data-team="${t}">${t === 'Athletic Femenino' ? 'Femenino' : t === 'Bilbao Athletic' ? 'Bilbao Ath.' : t}</button>
        `).join('')}
      </div>
      <div id="history-list"></div>
    `;

    const pointsBadge = (pred) => {
      if (!pred.is_finished) return `<span class="hist-pts hist-pts-pending">⏳</span>`;
      const p = pred.points;
      const cls = p === 5 ? 'hist-pts-5' : p >= 3 ? 'hist-pts-3' : p >= 1 ? 'hist-pts-1' : 'hist-pts-0';
      return `<span class="hist-pts ${cls}">${p} pts</span>`;
    };

    const renderByWeek = () => {
      const getMonday = (raw) => {
        const d = parseMatchDate(raw);
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        d.setHours(0, 0, 0, 0);
        return d.toISOString().split('T')[0];
      };

      const weeks = {};
      predictions.forEach(pred => {
        const key = getMonday(pred.match_date);
        if (!weeks[key]) weeks[key] = [];
        weeks[key].push(pred);
      });

      const sortedKeys = Object.keys(weeks).sort((a, b) => b.localeCompare(a));

      const allFinished = predictions.filter(p => p.is_finished);
      const grandTotal = allFinished.reduce((s, p) => s + (p.points || 0), 0);
      const grandPlenos = allFinished.filter(p => p.points === 5).length;

      const summaryHtml = allFinished.length ? `
        <div class="history-summary">
          <span>${allFinished.length} jugados · ${predictions.length - allFinished.length} pendientes</span>
          <span><strong>${grandTotal} pts total</strong> · ${grandPlenos} plenos 🎯</span>
        </div>` : '';

      const fmtShort = (d) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

      const weeksHtml = sortedKeys.map(key => {
        const teamRank = { 'Athletic Club': 0, 'Athletic Femenino': 1, 'Bilbao Athletic': 2 };
        const preds = weeks[key].slice().sort((a, b) => (teamRank[a.team] ?? 3) - (teamRank[b.team] ?? 3));
        const finished = preds.filter(p => p.is_finished);
        const weekPts = finished.reduce((s, p) => s + (p.points || 0), 0);
        const pending = preds.length - finished.length;

        const monday = new Date(key + 'T00:00:00');
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const weekLabel = `${fmtShort(monday)} – ${fmtShort(sunday)}`;

        const ptsCls = weekPts >= 10 ? 'jornada-pts-high' : weekPts >= 5 ? 'jornada-pts-mid' : 'jornada-pts-low';
        const ptsHtml = finished.length
          ? `<span class="hist-jornada-pts ${ptsCls}">${weekPts} pts</span>`
          : `<span class="hist-jornada-pts jornada-pts-pending">⏳ pendiente</span>`;

        const rows = preds.map(pred => {
          const matchDate = parseMatchDate(pred.match_date);
          const homeTeam = escapeHtml(pred.is_home ? pred.team : pred.opponent);
          const awayTeam = escapeHtml(pred.is_home ? pred.opponent : pred.team);
          const resultado = pred.is_finished ? `${pred.real_home}-${pred.real_away}` : `<span style="color:#64748b">—</span>`;
          return `
            <tr>
              <td class="hist-td-match">${homeTeam} <span class="hist-vs">vs</span> ${awayTeam}</td>
              <td class="hist-td-date">${matchDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</td>
              <td class="hist-td-score">${pred.home_goals}-${pred.away_goals}</td>
              <td class="hist-td-score">${resultado}</td>
              <td class="hist-td-pts">${pointsBadge(pred)}</td>
            </tr>`;
        }).join('');

        return `
          <div class="hist-jornada-block">
            <div class="hist-jornada-header">
              <span class="hist-jornada-label">${weekLabel}</span>
              <div class="hist-jornada-meta">
                ${pending ? `<span class="hist-jornada-pending">${pending} pend.</span>` : ''}
                ${ptsHtml}
              </div>
            </div>
            <div class="hist-table-wrap hist-jornada-table">
              <table class="hist-table">
                <thead><tr>
                  <th>Partido</th><th>Fecha</th><th>Pronóst.</th><th>Result.</th><th>Pts</th>
                </tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>`;
      }).join('');

      document.getElementById('history-list').innerHTML = summaryHtml + weeksHtml;
    };

    const renderList = (team) => {
      const filtered = predictions.filter(p => p.team === team);
      const finished = filtered.filter(p => p.is_finished);
      const totalPts = finished.reduce((s, p) => s + (p.points || 0), 0);
      const plenos = finished.filter(p => p.points === 5).length;

      const summaryHtml = finished.length ? `
        <div class="history-summary">
          <span>${finished.length} jugados · ${filtered.length - finished.length} pendientes</span>
          <span><strong>${totalPts} pts</strong> · ${plenos} plenos 🎯</span>
        </div>` : '';

      const rows = filtered.map(pred => {
        const matchDate = parseMatchDate(pred.match_date);
        const homeTeam = escapeHtml(pred.is_home ? pred.team : pred.opponent);
        const awayTeam = escapeHtml(pred.is_home ? pred.opponent : pred.team);
        const resultado = pred.is_finished ? `${pred.real_home}-${pred.real_away}` : `<span style="color:#64748b">—</span>`;
        return `
          <tr>
            <td class="hist-td-match">${homeTeam} <span class="hist-vs">vs</span> ${awayTeam}</td>
            <td class="hist-td-date">${matchDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</td>
            <td class="hist-td-score">${pred.home_goals}-${pred.away_goals}</td>
            <td class="hist-td-score">${resultado}</td>
            <td class="hist-td-pts">${pointsBadge(pred)}</td>
          </tr>`;
      }).join('');

      document.getElementById('history-list').innerHTML = summaryHtml + `
        <div class="hist-table-wrap">
          <table class="hist-table">
            <thead>
              <tr>
                <th>Partido</th>
                <th>Fecha</th>
                <th>Pronóst.</th>
                <th>Result.</th>
                <th>Pts</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    };

    renderByWeek();

    document.getElementById('history-subtabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.history-subtab');
      if (!btn) return;
      document.querySelectorAll('.history-subtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.team === '__jornada__') renderByWeek();
      else renderList(btn.dataset.team);
    });

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

// Formato de fecha para PDFs: evita conversión de zona horaria parseando el string directamente
function formatMatchDateForPDF(raw) {
  if (!raw) return '—';
  const s = String(raw).replace(/Z$/, '').replace(/\.\d+$/, '').replace('T', ' ');
  const [datePart = '', timePart = ''] = s.split(' ');
  const [, month = '', day = ''] = datePart.split('-');
  const [hour = '', min = ''] = timePart.split(':');
  return `${day}/${month} ${hour}:${min}`;
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
              <strong style="font-family: 'Exo 2', monospace; color: var(--neon-red, #ff3333);">${p.home_goals} - ${p.away_goals}</strong>
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

// Seguimiento: Excel con colores (filas=usuarios, columnas=partidos)
async function printTrackerReport() {
  showToast('Generando Excel...', 'info');

  let matches, totalUsers;
  try {
    const res = await fetchWithRetry('/api/admin/open-predictions');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');
    matches = data.matches || [];
    totalUsers = data.totalUsers || 0;
  } catch (err) {
    showToast('Error al cargar datos para el Excel', 'error');
    return;
  }

  if (matches.length === 0) {
    showToast('No hay partidos abiertos', 'error');
    return;
  }

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const teamRank = { 'Athletic Club': 1, 'Athletic Femenino': 2, 'Bilbao Athletic': 3 };
  matches.sort((a, b) =>
    (teamRank[a.team] || 9) - (teamRank[b.team] || 9) ||
    String(a.match_date).localeCompare(String(b.match_date))
  );

  // Recopilar usuarios y pronósticos
  const allUsers = new Map();
  const predMap = {};
  matches.forEach(m => {
    m.predictions.forEach(p => {
      const k = p.username.toLowerCase();
      if (!allUsers.has(k)) allUsers.set(k, p.display_name);
      if (!predMap[k]) predMap[k] = {};
      predMap[k][m.id] = { h: p.home_goals, a: p.away_goals };
    });
    m.missing.forEach(u => {
      const k = u.username.toLowerCase();
      if (!allUsers.has(k)) allUsers.set(k, u.display_name);
    });
  });

  const sortedUsers = [...allUsers.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));

  // Cabecera de partidos
  const matchHeaders = matches.map(m => {
    const homeTeam = m.is_home ? m.team : m.opponent;
    const awayTeam = m.is_home ? m.opponent : m.team;
    const fecha = formatMatchDateForPDF(m.match_date);
    const bg = m.deadline_passed ? '#555555' : '#cc0000';
    return `<th style="background:${bg};color:#fff;border:1px solid #888;padding:5px 8px;text-align:center;font-size:10px;">${esc(homeTeam)} vs ${esc(awayTeam)}<br><span style="font-weight:normal;font-size:8px;">${fecha}${m.deadline_passed ? ' · CERRADO' : ' · ABIERTO'}</span></th>`;
  }).join('');

  // Filas de usuarios
  const dataRows = sortedUsers.map(([ukey, displayName], idx) => {
    const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8f8f8';
    const cells = matches.map(m => {
      const p = predMap[ukey]?.[m.id];
      if (p !== undefined) {
        return `<td style="background:#c8f7c5;color:#155724;border:1px solid #ccc;text-align:center;font-weight:700;font-size:10px;font-family:monospace;">${p.h}-${p.a}</td>`;
      }
      if (m.deadline_passed) {
        return `<td style="background:#fecaca;color:#991b1b;border:1px solid #ccc;text-align:center;font-weight:700;font-size:11px;">✗</td>`;
      }
      return `<td style="background:#fff9e6;color:#92400e;border:1px solid #ccc;text-align:center;font-size:10px;">⏳</td>`;
    }).join('');
    return `<tr><td style="background:${rowBg};border:1px solid #ddd;padding:4px 8px;font-size:10px;font-weight:600;white-space:nowrap;">${esc(displayName)}</td>${cells}</tr>`;
  }).join('');

  // Fila totales
  const totalRow = matches.map(m =>
    `<td style="background:#e0e0e0;border:1px solid #aaa;text-align:center;font-weight:700;font-size:10px;">${m.predictions.length}/${totalUsers}</td>`
  ).join('');

  const reportDate = new Date().toLocaleString('es-ES', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>Seguimiento</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head><body>
<table>
  <thead>
    <tr>
      <th style="background:#1e1e2e;color:#fff;border:1px solid #555;padding:6px 10px;font-size:12px;text-align:left;">🦁 BOLILLA GARRAS — Seguimiento &nbsp;·&nbsp; <span style="font-size:9px;font-weight:normal;">${esc(reportDate)} · ${totalUsers} usuarios</span></th>
      ${matchHeaders}
    </tr>
    <tr>
      <th style="background:#333;color:#fff;border:1px solid #555;padding:4px 8px;font-size:10px;text-align:left;">Jugador</th>
      ${matches.map(m => `<th style="background:#eee;color:#333;border:1px solid #bbb;padding:3px 6px;font-size:9px;text-align:center;">${m.predictions.length} pronóst.</th>`).join('')}
    </tr>
  </thead>
  <tbody>
    ${dataRows}
    <tr>
      <td style="background:#d0d0d0;border:1px solid #aaa;padding:4px 8px;font-weight:700;font-size:10px;">TOTAL</td>
      ${totalRow}
    </tr>
  </tbody>
</table>
<br>
<table><tr>
  <td style="font-size:9px;color:#555;padding:3px 6px;">Leyenda:</td>
  <td style="background:#c8f7c5;color:#155724;font-size:9px;padding:3px 10px;border:1px solid #aaa;font-weight:700;">Verde — ha pronosticado</td>
  <td style="background:#fff9e6;color:#92400e;font-size:9px;padding:3px 10px;border:1px solid #aaa;font-weight:700;">⏳ — pendiente (plazo abierto)</td>
  <td style="background:#fecaca;color:#991b1b;font-size:9px;padding:3px 10px;border:1px solid #aaa;font-weight:700;">✗ — no pronosticó (plazo cerrado)</td>
</tr></table>
</body></html>`;

  const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bolilla-garras-seguimiento-${new Date().toISOString().split('T')[0]}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('✅ Descargado — ábrelo con Excel o Google Sheets', 'success');
}

// ==================== LEADERBOARD PDF ====================

async function printRankingOnly() {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const win = window.open('', '_blank');
  if (!win) { showToast('Permite ventanas emergentes para exportar el PDF', 'error'); return; }
  win.document.write('<p style="font-family:sans-serif;padding:20px">Cargando clasificación...</p>');

  let leaderboard;
  try {
    const res = await fetchWithRetry('/api/leaderboard');
    leaderboard = await res.json();
  } catch (err) {
    win.close();
    showToast('Error al cargar clasificación', 'error');
    return;
  }

  if (!leaderboard.length) {
    win.close();
    showToast('No hay datos de clasificación aún', 'error');
    return;
  }

  const reportDate = new Date().toLocaleString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const rows = leaderboard.map((user, i) => {
    const rank = i + 1;
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`;
    const cls = rank <= 3 ? `top${rank}` : '';
    return `<tr class="${cls}">
      <td class="center">${medal}</td>
      <td>${esc(user.display_name || user.name)}</td>
      <td class="center pts">${user.total_points}</td>
      <td class="center">${user.exact_predictions} 🎯</td>
    </tr>`;
  }).join('');

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Clasificación Bolilla Garras — ${esc(reportDate)}</title>
<style>
  @page { size: A4; margin: 20mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica','Arial',sans-serif; color: #111; background: #fff; margin: 0; padding: 20px; font-size: 13px; }
  header { text-align: center; border-bottom: 3px solid #c00; padding-bottom: 14px; margin-bottom: 24px; }
  header h1 { margin: 0 0 4px 0; font-size: 24px; color: #c00; letter-spacing: 1px; }
  header .sub { font-size: 11px; color: #555; }
  table { width: 100%; border-collapse: collapse; }
  thead th { background: #c00; color: #fff; padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  th.center, td.center { text-align: center; }
  tbody td { padding: 9px 12px; border-bottom: 1px solid #eee; font-size: 13px; }
  tbody tr:nth-child(even) { background: #fafafa; }
  tbody tr.top1 td { background: #fff8e1; font-weight: 700; font-size: 15px; }
  tbody tr.top2 td { background: #f5f5f5; font-weight: 600; font-size: 14px; }
  tbody tr.top3 td { background: #fef3e2; font-weight: 600; }
  td.pts { font-weight: 700; font-size: 15px; color: #c00; }
  footer { margin-top: 24px; text-align: center; font-size: 10px; color: #888; border-top: 1px solid #ddd; padding-top: 8px; }
  #print-btn { position: fixed; top: 12px; right: 12px; background: #c00; color: #fff; border: none; padding: 10px 16px; font-size: 13px; font-weight: 700; border-radius: 6px; cursor: pointer; z-index: 999; }
  @media print { #print-btn { display: none; } }
</style>
</head>
<body>
  <button id="print-btn">🖨️ Imprimir / Guardar como PDF</button>
  <header>
    <h1>🦁 BOLILLA GARRAS — Clasificación</h1>
    <div class="sub">Peña Garras Taldea Sestao · Generado ${esc(reportDate)}</div>
  </header>
  <table>
    <thead><tr><th class="center">Pos.</th><th>Jugador</th><th class="center">Puntos</th><th class="center">Plenos</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <footer>Bolilla Garras · ${leaderboard.length} participante${leaderboard.length === 1 ? '' : 's'}</footer>
  <script>
    document.getElementById('print-btn').addEventListener('click', function() { window.print(); });
    setTimeout(function() { window.print(); }, 400);
  </script>
</body>
</html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
}

async function exportLeaderboardCSV() {
  showToast('Generando Excel...', 'info');

  let leaderboard, detail;
  try {
    const [r1, r2] = await Promise.all([
      fetchWithRetry('/api/leaderboard'),
      fetchWithRetry('/api/leaderboard/detail')
    ]);
    leaderboard = await r1.json();
    detail = await r2.json();
  } catch (err) {
    showToast('Error al cargar datos', 'error');
    return;
  }

  if (!Array.isArray(leaderboard) || !leaderboard.length) {
    showToast('No hay datos de clasificación aún', 'error');
    return;
  }

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const teamRank = { 'Athletic Club': 1, 'Athletic Femenino': 2, 'Bilbao Athletic': 3 };

  // Collect all unique finished matches
  const matchMap = new Map();
  detail.forEach(row => {
    const mk = `${row.team}|${row.opponent}|${String(row.match_date).slice(0, 13)}`;
    if (!matchMap.has(mk)) {
      const homeTeam = row.is_home ? row.team : row.opponent;
      const awayTeam = row.is_home ? row.opponent : row.team;
      matchMap.set(mk, { mk, label: `${homeTeam} vs ${awayTeam}`, date: row.match_date, team: row.team });
    }
  });

  const sortedMatches = [...matchMap.values()].sort((a, b) =>
    (teamRank[a.team] || 9) - (teamRank[b.team] || 9) || a.date.localeCompare(b.date)
  );

  // Group detail by player
  const byPlayer = {};
  detail.forEach(row => {
    const key = row.player_name.toLowerCase();
    if (!byPlayer[key]) byPlayer[key] = {};
    const mk = `${row.team}|${row.opponent}|${String(row.match_date).slice(0, 13)}`;
    byPlayer[key][mk] = row;
  });

  // Color coding by points
  const ptsBg  = (pts) => { const n = Number(pts); if (n === 5) return '#b7e4b7'; if (n >= 3) return '#fde68a'; if (n >= 1) return '#fcd9a0'; return '#fecaca'; };
  const ptsFg  = (pts) => { const n = Number(pts); if (n === 5) return '#166534'; if (n >= 3) return '#78350f'; if (n >= 1) return '#92400e'; return '#991b1b'; };
  const rankBg = (i)   => i === 0 ? '#fef9c3' : i === 1 ? '#f3f4f6' : i === 2 ? '#fff7ed' : '#ffffff';
  const rankFg = (i)   => i === 0 ? '#854d0e' : i === 1 ? '#374151' : i === 2 ? '#9a3412' : '#111111';

  const th = (content, extra = '') => `<th style="background:#1e1e2e;color:#fff;border:1px solid #555;padding:5px 8px;font-size:10px;white-space:nowrap;${extra}">${content}</th>`;
  const thMatch = (content) => `<th colspan="3" style="background:#c00;color:#fff;border:1px solid #900;padding:5px 8px;font-size:10px;text-align:center;">${content}</th>`;
  const thSub   = (content) => `<th style="background:#eee;color:#333;border:1px solid #bbb;padding:3px 6px;font-size:9px;text-align:center;">${content}</th>`;

  // Match header rows
  const headerRow1 = sortedMatches.map(m => thMatch(`${esc(m.label)}<br><span style="font-weight:normal;font-size:8px;">${formatMatchDateForPDF(m.date)}</span>`)).join('');
  const headerRow2 = sortedMatches.map(() => thSub('Pron.') + thSub('Result.') + thSub('Pts')).join('');

  // Data rows
  const dataRows = leaderboard.map((user, i) => {
    const pkey = user.name.toLowerCase();
    const preds = byPlayer[pkey] || {};
    const bg = rankBg(i);
    const fg = rankFg(i);
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1;
    const baseTd = `border:1px solid #ddd;padding:4px 7px;`;

    const matchCells = sortedMatches.map(m => {
      const p = preds[m.mk];
      if (!p) return `<td style="background:#f0f0f0;color:#aaa;${baseTd}text-align:center;font-size:9px;">—</td><td style="background:#f0f0f0;color:#aaa;${baseTd}text-align:center;font-size:9px;">—</td><td style="background:#f0f0f0;color:#aaa;${baseTd}text-align:center;font-size:9px;">—</td>`;
      const cbg = ptsBg(p.points); const cfg = ptsFg(p.points);
      const s = `background:${cbg};color:${cfg};${baseTd}text-align:center;font-size:9px;font-weight:700;`;
      return `<td style="${s}">${p.pred_home}-${p.pred_away}</td><td style="${s}">${p.real_home}-${p.real_away}</td><td style="${s}">${p.points}</td>`;
    }).join('');

    return `<tr>
      <td style="background:${bg};color:${fg};${baseTd}text-align:center;font-weight:700;font-size:11px;">${medal}</td>
      <td style="background:${bg};color:${fg};${baseTd}font-weight:600;font-size:10px;white-space:nowrap;">${esc(user.display_name || user.name)}</td>
      <td style="background:${bg};color:#c00;${baseTd}text-align:center;font-weight:700;font-size:13px;">${user.total_points}</td>
      <td style="background:${bg};color:#166534;${baseTd}text-align:center;font-weight:600;font-size:10px;">${user.exact_predictions} 🎯</td>
      ${matchCells}
    </tr>`;
  }).join('');

  const reportDate = new Date().toLocaleString('es-ES', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>Clasificación</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head><body>
<table>
  <thead>
    <tr>
      <th colspan="4" style="background:#c00;color:#fff;font-size:13px;padding:8px 12px;border:1px solid #900;text-align:left;">🦁 BOLILLA GARRAS — Clasificación &nbsp;·&nbsp; <span style="font-size:10px;font-weight:normal;">${esc(reportDate)}</span></th>
      ${headerRow1}
    </tr>
    <tr>
      ${th('Pos', 'text-align:center;')}${th('Jugador')}${th('Pts', 'text-align:center;')}${th('Plenos', 'text-align:center;')}
      ${headerRow2}
    </tr>
  </thead>
  <tbody>${dataRows}</tbody>
</table>
<br>
<table><tr>
  <td style="font-size:9px;color:#555;padding:3px 6px;">Leyenda:</td>
  <td style="background:#b7e4b7;color:#166534;font-size:9px;padding:3px 10px;border:1px solid #aaa;font-weight:700;">5 pts — Pleno exacto 🎯</td>
  <td style="background:#fde68a;color:#78350f;font-size:9px;padding:3px 10px;border:1px solid #aaa;font-weight:700;">3 pts — Muy bien</td>
  <td style="background:#fcd9a0;color:#92400e;font-size:9px;padding:3px 10px;border:1px solid #aaa;font-weight:700;">1-2 pts — Parcial</td>
  <td style="background:#fecaca;color:#991b1b;font-size:9px;padding:3px 10px;border:1px solid #aaa;font-weight:700;">0 pts — Fallo</td>
  <td style="background:#f0f0f0;color:#888;font-size:9px;padding:3px 10px;border:1px solid #aaa;">— Sin pronóstico</td>
</tr></table>
</body></html>`;

  const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bolilla-garras-clasificacion-${new Date().toISOString().split('T')[0]}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('✅ Descargado — ábrelo con Excel o Google Sheets', 'success');
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
      const safeUsername = escapeHtml(String(u.username));
      const safeDisplay = escapeHtml(String(u.display_name));
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

  const token = sessionStorage.getItem('bolilla_token') || '';
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

async function executeFullSeasonReset() {
  try {
    const res = await fetchWithRetry('/api/admin/reset-full-season', { method: 'POST' });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.success) {
      const d = data.deleted || {};
      showToast(`Temporada reseteada: ${d.matches ?? 0} partidos, ${d.predictions ?? 0} pronósticos, ${d.mvp_votes ?? 0} votos MVP eliminados`, 'success');
      _mvpCacheClear('mvp_history', 'mvp_ranking');
      await Promise.all([
        loadAdminStats(),
        loadAdminMatches(),
        currentUser?.isAdmin ? loadGarrasSaria() : Promise.resolve()
      ]);
    } else {
      showToast(data.error || 'Error al resetear la temporada', 'error');
    }
  } catch (err) {
    showToast('Error al resetear la temporada', 'error');
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

  const token = sessionStorage.getItem('bolilla_token') || '';
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

  const token = sessionStorage.getItem('bolilla_token') || '';
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
      const homeTeam = escapeHtml(m.is_home ? m.team : m.opponent);
      const awayTeam = escapeHtml(m.is_home ? m.opponent : m.team);
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
          `<span style="padding: 6px 12px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 16px; font-size: 12px; color: var(--error);">${escapeHtml(u.display_name)}</span>`
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
              <td style="padding: 8px; text-align: center; font-family: 'Exo 2', sans-serif; color: #00F5A0;">${p.home_goals} - ${p.away_goals}</td>
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
    const token = sessionStorage.getItem('bolilla_token') || '';
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

// ==================== GARRAS SARIA — CACHE IN-MEMORY (TTL 5 min) ====================
const _mvpCache = {};
let _mvpHistoryMatches = [];
function _mvpCacheGet(key) {
  const e = _mvpCache[key];
  if (!e || Date.now() - e.ts > 5 * 60 * 1000) { delete _mvpCache[key]; return null; }
  return e.data;
}
function _mvpCacheSet(key, data) { _mvpCache[key] = { data, ts: Date.now() }; }
function _mvpCacheClear(...keys) { keys.forEach(k => delete _mvpCache[k]); }

// ==================== GARRAS SARIA (MVP por partido) ====================

async function loadGarrasSaria() {
  const adminSection = document.getElementById('garras-admin-section');
  if (adminSection) adminSection.style.display = currentUser?.isAdmin ? 'block' : 'none';

  if (currentUser?.isAdmin) await loadMvpAdmin();

  await Promise.all([
    loadMvpVoteSection(),
    loadMvpHistory(),
    loadMvpRanking()
  ]);
}

async function loadMvpVoteSection() {
  const section = document.getElementById('garras-vote-section');
  if (!section) return;
  section.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res = await fetchWithRetry('/api/mvp/active');
    if (!res.ok) throw new Error(`API ${res.status}`);
    const matches = await res.json();
    if (!Array.isArray(matches)) throw new Error('Respuesta inesperada');

    if (matches.length === 0) {
      section.innerHTML = `
        <div class="garras-no-vote card">
          <div class="garras-no-vote-icon">🔒</div>
          <h3>No hay votación activa</h3>
          <p>El admin abrirá la votación tras cada partido.</p>
        </div>`;
      return;
    }

    let html = '';
    for (const match of matches) {
      const homeTeam = match.is_home ? match.team : match.opponent;
      const awayTeam = match.is_home ? match.opponent : match.team;
      const label = `${escapeHtml(homeTeam)} vs ${escapeHtml(awayTeam)}`;
      const fecha = parseMatchDate(match.match_date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const categoryLabel = match.category === 'masculino' ? '⚽ Masculino' : '⚽ Femenino';
      html += `
        <div class="card mvp-match-card" data-match-id="${match.id}">
          <div class="mvp-match-header">
            <div class="mvp-match-title">${label}</div>
            <div class="mvp-match-meta">${categoryLabel} · ${fecha}</div>
          </div>
          ${renderMvpVoteBlock(match)}
        </div>`;
    }
    section.innerHTML = html;

    const pendingMatchIds = [];
    matches.forEach(match => {
      if (match.userVote) return;
      pendingMatchIds.push(match.id);
      const card = section.querySelector(`[data-match-id="${match.id}"]`);
      if (!card) return;
      card.querySelectorAll('.garras-player-card').forEach(playerCard => {
        playerCard.addEventListener('click', () => {
          card.querySelectorAll('.garras-player-card').forEach(c => c.classList.remove('selected'));
          playerCard.classList.add('selected');
        });
      });
    });

    if (pendingMatchIds.length > 0) {
      const voteAllBtn = document.createElement('button');
      voteAllBtn.className = 'garras-vote-btn';
      voteAllBtn.style.cssText = 'margin-top:16px;';
      voteAllBtn.textContent = 'VOTAR';
      voteAllBtn.addEventListener('click', () => submitAllMvpVotes(pendingMatchIds));
      section.appendChild(voteAllBtn);
    }

  } catch (err) {
    console.error('loadMvpVoteSection error:', err);
    section.innerHTML = `
      <div class="card" style="text-align:center; padding: 32px 20px;">
        <div style="font-size:48px; margin-bottom:12px;">⚠️</div>
        <h3 style="margin-bottom:8px;">Error al cargar la votación</h3>
        <p style="color:var(--text-secondary); margin-bottom:20px; font-size:14px;">
          La base de datos puede estar despertando. Inténtalo de nuevo en unos segundos.
        </p>
        <button class="btn btn-secondary" onclick="loadMvpVoteSection()" style="margin: 0 auto;">
          🔄 Reintentar
        </button>
      </div>`;
  }
}

function renderMvpVoteBlock(match) {
  const isLocked = !!match.userVote;
  const lockedMsg = isLocked
    ? `<div class="garras-voted-msg">
        ${renderPlayerAvatar(match.userVote.player_name, 'garras-avatar-frame-sm')}
        <span>✅ Has votado a <strong>${escapeHtml(match.userVote.player_name)}</strong></span>
      </div>`
    : '';
  const cards = match.players.map(p => {
    const isSelected = match.userVote?.player_id === p.id;
    const lockClass = isLocked ? 'voted-lock' : '';
    const selectedClass = isSelected ? 'selected voted-choice' : '';
    return `<div class="garras-player-card ${lockClass} ${selectedClass}" data-player-id="${p.id}">
      ${renderPlayerAvatar(p.name, 'garras-avatar-frame-vote')}
      <span class="garras-player-name">${escapeHtml(p.name)}</span>
    </div>`;
  }).join('');
  return `
    <div class="mvp-vote-block">
      ${lockedMsg}
      <div class="garras-players-grid">${cards}</div>
    </div>`;
}

async function submitMvpVote(matchId, playerId) {
  try {
    const res = await fetchWithRetry(`/api/mvp/${matchId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: playerId })
    });
    const data = await res.json();
    return data.success;
  } catch (err) {
    return false;
  }
}

async function submitAllMvpVotes(matchIds) {
  const votes = matchIds
    .map(matchId => {
      const card = document.querySelector(`[data-match-id="${matchId}"]`);
      const selected = card?.querySelector('.garras-player-card.selected');
      return selected ? { matchId, playerId: parseInt(selected.dataset.playerId) } : null;
    })
    .filter(Boolean);

  if (votes.length === 0) {
    showToast('Selecciona al menos un jugador', 'error');
    return;
  }

  let saved = 0;
  let errors = 0;
  for (const { matchId, playerId } of votes) {
    if (await submitMvpVote(matchId, playerId)) saved++;
    else errors++;
  }

  if (saved > 0) showToast(`${saved} voto${saved > 1 ? 's' : ''} registrado${saved > 1 ? 's' : ''}`, 'success');
  if (errors > 0) showToast(`Error registrando ${errors} voto${errors > 1 ? 's' : ''}`, 'error');
  await loadMvpVoteSection();
}

async function loadMvpHistory() {
  const section = document.getElementById('garras-history-section');
  if (!section) return;
  try {
    let matches = _mvpCacheGet('mvp_history');
    if (!matches) {
      const res = await fetchWithRetry('/api/mvp/history');
      matches = await res.json();
      if (Array.isArray(matches)) _mvpCacheSet('mvp_history', matches);
    }
    if (!Array.isArray(matches) || matches.length === 0) { section.innerHTML = ''; return; }

    _mvpHistoryMatches = matches;
    const MEDALS = ['🥇', '🥈', '🥉'];

    const renderMatch = (match, idx) => {
      const homeTeam = match.is_home ? match.team : match.opponent;
      const awayTeam = match.is_home ? match.opponent : match.team;
      const label = `${escapeHtml(homeTeam)} vs ${escapeHtml(awayTeam)}`;
      const fecha = parseMatchDate(match.match_date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
      const isFem = match.team === 'Athletic Femenino';
      const catBadge = isFem
        ? '<span class="garras-badge-cat fem">👟 Femenino</span>'
        : '<span class="garras-badge-cat masc">⚽ Masculino</span>';
      const rows = (match.results || []).map((p, i) => {
        const medal = i < 3 ? MEDALS[i] : `${i + 1}.`;
        const rankClass = i === 0 ? 'rank-gold' : i === 1 ? 'rank-silver' : i === 2 ? 'rank-bronze' : 'rank-rest';
        return `<div class="garras-hrow ${rankClass}">
          <span class="garras-hrow-medal">${medal}</span>
          ${renderPlayerAvatar(p.name, 'garras-avatar-frame-sm')}
          <span class="garras-hrow-name">${escapeHtml(p.name)}</span>
          <span class="garras-hrow-votes">${p.votes} voto${parseInt(p.votes) === 1 ? '' : 's'}</span>
        </div>`;
      }).join('');
      const exportBtn = currentUser?.isAdmin
        ? `<button class="garras-history-export-btn" data-export-idx="${idx}">📥 Descargar imagen</button>`
        : '';
      return `<div class="card garras-history-match">
        <div class="garras-history-match-head">
          <div class="garras-history-match-title">${label}</div>
          <div class="garras-history-match-meta">${catBadge}<span>·</span><span>${fecha}</span></div>
        </div>
        <div class="garras-hrows">${rows || '<span style="color:var(--text-secondary);font-size:13px;">Sin votos registrados</span>'}</div>
        ${exportBtn}
      </div>`;
    };

    section.innerHTML = `<div class="garras-history-heading">📋 Historial de Partidos</div>${matches.map((m, i) => renderMatch(m, i)).join('')}`;
    section.addEventListener('click', e => {
      const btn = e.target.closest('.garras-history-export-btn');
      if (btn) exportMatchResult(_mvpHistoryMatches[parseInt(btn.dataset.exportIdx)]);
    });
  } catch (err) {
    section.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:16px;font-size:13px;">Error al cargar el historial. Recarga el tab.</p>';
    console.error(err);
  }
}

async function loadMvpRanking() {
  const section = document.getElementById('garras-ranking-section');
  if (!section) return;
  try {
    let rankData = _mvpCacheGet('mvp_ranking');
    if (!rankData) {
      const res = await fetchWithRetry('/api/mvp/ranking');
      rankData = await res.json();
      if (rankData?.masculino) _mvpCacheSet('mvp_ranking', rankData);
    }
    const { masculino, femenino } = rankData;
    if (masculino.length === 0 && femenino.length === 0) { section.innerHTML = ''; return; }

    const renderTable = (players, title) => {
      if (players.length === 0) return '';
      const rows = players.map((p, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        return `<tr>
          <td class="garras-rank-pos">${medal}</td>
          <td class="garras-rank-name">
            <div class="garras-rank-name-wrap">
              ${renderPlayerAvatar(p.name, 'garras-avatar-frame-sm')}
              <span>${escapeHtml(p.name)}</span>
            </div>
          </td>
          <td class="garras-rank-wins">${p.partidos_ganados}</td>
          <td class="garras-rank-votes">${p.total_votes}</td>
        </tr>`;
      }).join('');
      return `
        <div class="garras-ranking-block">
          <div class="garras-category-title">${title}</div>
          <table class="garras-rank-table">
            <thead><tr><th>#</th><th>Jugador/a</th><th>🏅 Partidos</th><th>Votos</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    };

    section.innerHTML = `
      <div class="card">
        <div class="card-header"><h3 class="card-title">🏆 Ranking Temporada 25/26</h3></div>
        <div class="garras-ranking-grid">
          ${renderTable(masculino, '⚽ Masculino')}
          ${renderTable(femenino, '⚽ Femenino')}
        </div>
      </div>`;
  } catch (err) {
    section.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:16px;font-size:13px;">Error al cargar el ranking. Recarga el tab.</p>';
    console.error(err);
  }
}

// ---- Export: tarjeta de resultados por partido ----

async function exportMatchResult(match) {
  if (!match) return;
  showToast('Generando imagen...', 'success');

  const homeTeam = match.is_home ? match.team : match.opponent;
  const awayTeam = match.is_home ? match.opponent : match.team;
  const matchLabel = `${homeTeam} vs ${awayTeam}`;
  const fecha = parseMatchDate(match.match_date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const isFem = match.team === 'Athletic Femenino';
  const catLabel = isFem ? '👟 Athletic Femenino' : '⚽ Athletic Club';
  const results = match.results || [];

  // Config del podio (tamaños fijos; se usan tanto para calcular el alto del
  // canvas como para dibujar, así no se pueden desincronizar)
  const PODIUM_CONFIG = [
    { idx: 1, col: 0, frameW: 150, frameH: 193, pedestalH: 70, color: '#cbd5e1', barBg: 'rgba(203,213,225,0.10)', barBorder: 'rgba(203,213,225,0.28)' },
    { idx: 0, col: 1, frameW: 190, frameH: 244, pedestalH: 104, color: '#fbbf24', barBg: 'rgba(251,191,36,0.12)', barBorder: 'rgba(251,191,36,0.32)' },
    { idx: 2, col: 2, frameW: 128, frameH: 164, pedestalH: 54, color: '#d97706', barBg: 'rgba(217,119,6,0.12)', barBorder: 'rgba(217,119,6,0.30)' },
  ];
  const TROPHY_H = 58, TROPHY_GAP = 18, TEXT_TO_PEDESTAL_GAP = 46, BADGE_OVERHANG = 16;
  const podiumBlockH = TROPHY_H + TROPHY_GAP
    + Math.max(...PODIUM_CONFIG.map(r => r.frameH)) + TEXT_TO_PEDESTAL_GAP + Math.max(...PODIUM_CONFIG.map(r => r.pedestalH))
    + BADGE_OVERHANG + 16;

  // Canvas dimensions — formato vertical (tipo post de móvil), solo podio, sin lista
  const W = 900;
  let H = 300 + (results.length > 0 ? podiumBlockH : 40) + 80;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0d0d18');
  bg.addColorStop(1, '#180808');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle red glow top-right
  const glow = ctx.createRadialGradient(W * 0.82, 0, 0, W * 0.82, 0, W * 0.55);
  glow.addColorStop(0, 'rgba(228,30,38,0.14)');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Marca de agua del garra/zarpa de la peña, muy sutil, detrás del podio
  if (results.length > 0) {
    try {
      const paw = await _loadImage('/assets/lion-paw.png');
      const pw = 360, ph = pw * (paw.naturalHeight / paw.naturalWidth);
      ctx.save();
      ctx.globalAlpha = 0.05;
      ctx.translate(W / 2, H - podiumBlockH / 2 - 20);
      ctx.rotate(-0.1);
      ctx.drawImage(paw, -pw / 2, -ph / 2, pw, ph);
      ctx.restore();
    } catch { /* decorativo, se omite si falla */ }
  }

  // Club logo
  let y = 42;
  try {
    const logo = await _loadImage('/assets/garras-logo.png');
    const sz = 72;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(logo, (W - sz) / 2, y, sz, sz);
    ctx.globalAlpha = 1;
    y += sz + 10;
  } catch { y += 16; }

  // Club name
  ctx.textAlign = 'center';
  ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';
  ctx.fillStyle = '#e41e26';
  ctx.fillText('PEÑA GARRAS TALDEA · SESTAO', W / 2, y);
  y += 15;
  ctx.font = '11px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';
  ctx.fillStyle = '#475569';
  ctx.fillText('GARRAS SARIA — MVP DEL PARTIDO', W / 2, y);
  y += 26;

  // Red divider
  const dg = ctx.createLinearGradient(60, 0, W - 60, 0);
  dg.addColorStop(0, 'transparent');
  dg.addColorStop(0.15, '#e41e26');
  dg.addColorStop(0.85, '#e41e26');
  dg.addColorStop(1, 'transparent');
  ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(W - 60, y);
  ctx.strokeStyle = dg; ctx.lineWidth = 2; ctx.stroke();
  y += 24;

  // Match title (auto-shrink)
  let mFont = 28;
  ctx.font = `bold ${mFont}px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif`;
  while (ctx.measureText(matchLabel).width > W - 80 && mFont > 14) {
    mFont--;
    ctx.font = `bold ${mFont}px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif`;
  }
  ctx.fillStyle = '#f1f5f9';
  ctx.fillText(matchLabel, W / 2, y);
  y += mFont + 10;

  // Category + date
  ctx.font = '14px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText(`${catLabel}  ·  ${fecha}`, W / 2, y);
  y += 36;

  const pad = 48;
  const rowW = W - pad * 2;

  if (results.length === 0) {
    ctx.font = '18px -apple-system, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('Sin votos registrados', W / 2, y + 40);
    y += 60;
  } else {
    // Podio (top 3, con foto) — plata izq, oro centro (más alto), bronce der.
    // Solo el podio: no se listan más jugadores (4º, 5º...).
    const PODIUM = PODIUM_CONFIG.filter(r => results[r.idx]);
    const colW = rowW / 3;

    // Trofeo sobre el ganador — toque visual de la peña
    const goldColX = pad + colW * 1.5;
    try {
      const trophy = await _loadImage('/assets/trofeo-v2.png');
      const tw = TROPHY_H * (trophy.naturalWidth / trophy.naturalHeight);
      ctx.drawImage(trophy, goldColX - tw / 2, y, tw, TROPHY_H);
    } catch { /* decorativo, se omite si falla */ }
    y += TROPHY_H + TROPHY_GAP;

    const baseY = y + BADGE_OVERHANG
      + Math.max(...PODIUM.map(r => r.frameH)) + TEXT_TO_PEDESTAL_GAP + Math.max(...PODIUM.map(r => r.pedestalH));

    for (const rank of PODIUM) {
      const p = results[rank.idx];
      const cx = pad + colW * (rank.col + 0.5);
      const pedestalTop = baseY - rank.pedestalH;
      const barW = colW - 20;

      // Pedestal
      ctx.fillStyle = rank.barBg;
      _rrPath(ctx, cx - barW / 2, pedestalTop, barW, rank.pedestalH, 10); ctx.fill();
      ctx.strokeStyle = rank.barBorder; ctx.lineWidth = 1.5;
      _rrPath(ctx, cx - barW / 2, pedestalTop, barW, rank.pedestalH, 10); ctx.stroke();

      // Número de puesto
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(rank.pedestalH * 0.46)}px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif`;
      ctx.fillStyle = rank.color;
      ctx.fillText(String(rank.idx + 1), cx, pedestalTop + rank.pedestalH / 2 + 2);
      ctx.textBaseline = 'alphabetic';

      // Votos
      ctx.font = '13px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(`${p.votes} voto${parseInt(p.votes) === 1 ? '' : 's'}`, cx, pedestalTop - 8);

      // Nombre (auto-shrink)
      let pFont = rank.idx === 0 ? 20 : 15;
      ctx.font = `bold ${pFont}px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif`;
      const maxNameW = colW - 8;
      while (ctx.measureText(p.name).width > maxNameW && pFont > 10) {
        pFont--; ctx.font = `bold ${pFont}px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif`;
      }
      ctx.fillStyle = rank.color;
      ctx.fillText(p.name, cx, pedestalTop - 28);

      // Foto (recorte "pecho arriba": centro del 50% del ancho, 0-64% del alto,
      // igual proporción que el frame para que no se deforme) o iniciales si no hay foto
      const fW = rank.frameW, fH = rank.frameH;
      const frameBottom = pedestalTop - TEXT_TO_PEDESTAL_GAP;
      const frameTop = frameBottom - fH;
      const frameLeft = cx - fW / 2;

      ctx.save();
      _rrPath(ctx, frameLeft, frameTop, fW, fH, 14);
      ctx.clip();
      let drewPhoto = false;
      const photoRel = getPlayerPhotoUrl(p.name);
      if (photoRel) {
        try {
          const img = await _loadImage('/' + photoRel);
          const iw = img.naturalWidth;
          const sWidth = iw * 0.5;
          const sHeight = sWidth * (fH / fW);
          ctx.drawImage(img, iw * 0.25, 0, sWidth, sHeight, frameLeft, frameTop, fW, fH);
          drewPhoto = true;
        } catch { /* si falla la carga, cae al fallback de iniciales */ }
      }
      if (!drewPhoto) {
        ctx.fillStyle = playerAvatarColor(p.name);
        ctx.fillRect(frameLeft, frameTop, fW, fH);
        ctx.font = `bold ${Math.round(fW * 0.34)}px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(getInitials(p.name), cx, frameTop + fH / 2 + 1);
        ctx.textBaseline = 'alphabetic';
      }
      ctx.restore();

      // Borde del marco
      ctx.strokeStyle = rank.color;
      ctx.lineWidth = 3;
      _rrPath(ctx, frameLeft, frameTop, fW, fH, 14); ctx.stroke();

      // Insignia de puesto (círculo sólido, no depende de fuente emoji del sistema)
      const badgeR = 19;
      const badgeCx = frameLeft + fW - 6;
      const badgeCy = frameTop + 6;
      ctx.beginPath();
      ctx.arc(badgeCx, badgeCy, badgeR, 0, Math.PI * 2);
      ctx.fillStyle = rank.color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#0d0d18';
      ctx.stroke();
      ctx.font = `bold ${Math.round(badgeR * 1.1)}px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif`;
      ctx.fillStyle = '#0d0d18';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(rank.idx + 1), badgeCx, badgeCy + 1);
      ctx.textBaseline = 'alphabetic';
    }

    ctx.textAlign = 'center';
    y = baseY + 16;
  }

  // Footer
  y += 18;
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y);
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1; ctx.stroke();
  y += 16;
  ctx.font = '11px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';
  ctx.fillStyle = '#1e293b';
  ctx.textAlign = 'center';
  ctx.fillText('bolilla-garras-kwz7.vercel.app', W / 2, y);

  // Download or open (iOS vs rest)
  const dataURL = canvas.toDataURL('image/png');
  const slug = `${homeTeam}-vs-${awayTeam}`.replace(/\s+/g, '-').replace(/[^a-zA-ZÀ-ÿ0-9-]/g, '').slice(0, 40);
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Garras Saria</title><style>body{margin:0;background:#000;display:flex;justify-content:center}img{max-width:100%;display:block}</style></head><body><img src="${dataURL}"></body></html>`);
      win.document.close();
      showToast('Mantén pulsada la imagen para guardarla', 'success');
    }
  } else {
    const a = document.createElement('a');
    a.download = `garras-saria-${slug}.png`;
    a.href = dataURL;
    a.click();
    showToast('Imagen descargada ✅', 'success');
  }
}

function _loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

function _rrPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ---- Admin: MVP voting panel ----

async function loadMvpAdmin() {
  const container = document.getElementById('garras-admin-container');
  if (!container) return;
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res = await fetchWithRetry('/api/mvp/admin/matches');
    if (!res.ok) throw new Error(`Error ${res.status}`);
    const matches = await res.json();
    if (!Array.isArray(matches)) throw new Error('Respuesta inesperada');

    if (matches.length === 0) {
      container.innerHTML = '<p class="garras-empty">No hay partidos del Athletic o Athletic Femenino registrados.</p>';
      return;
    }

    const renderAdminItem = m => {
      const homeTeam = m.is_home ? m.team : m.opponent;
      const awayTeam = m.is_home ? m.opponent : m.team;
      const label = `${escapeHtml(homeTeam)} vs ${escapeHtml(awayTeam)}`;
      const fecha = parseMatchDate(m.match_date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
      const isFem = m.team === 'Athletic Femenino';
      const statusBadge = m.mvp_voting_open
        ? '<span class="garras-badge open">Abierta</span>'
        : parseInt(m.vote_count) > 0
          ? '<span class="garras-badge closed">Cerrada</span>'
          : '<span class="garras-badge pending">Sin votación</span>';
      const openBtn = !m.mvp_voting_open
        ? `<button class="btn btn-primary btn-sm mvp-btn-abrir" data-match-id="${m.id}" data-is-fem="${isFem}">▶ Abrir</button>` : '';
      const closeBtn = m.mvp_voting_open
        ? `<button class="btn btn-danger btn-sm mvp-btn-cerrar" data-match-id="${m.id}">■ Cerrar</button>` : '';
      return `
        <div class="garras-admin-item" data-match-id="${m.id}">
          <div class="garras-admin-item-info">
            <span class="garras-admin-label">${label}</span>
            ${statusBadge}
            <span class="garras-admin-votes">${fecha} · ${m.vote_count} votos</span>
          </div>
          <div class="garras-admin-item-actions">${openBtn}${closeBtn}</div>
        </div>`;
    };

    const masc = matches.filter(m => m.team !== 'Athletic Femenino');
    const fem = matches.filter(m => m.team === 'Athletic Femenino');
    const renderGroup = (group, title) => group.length === 0 ? '' : `
      <div class="garras-admin-group">
        <div class="garras-admin-group-title">${title}</div>
        ${group.map(renderAdminItem).join('')}
      </div>`;

    container.innerHTML = `<div class="garras-admin-list">
      ${renderGroup(masc, '⚽ Masculino')}
      ${renderGroup(fem, '👟 Femenino')}
    </div>
    <div id="mvp-fem-panel" style="display:none;" class="mvp-fem-selector"></div>`;

    // Event delegation — un solo listener, no onclick en HTML
    container.addEventListener('click', _mvpAdminClick);

  } catch (err) {
    container.innerHTML = `<p class="garras-error">Error al cargar partidos: ${escapeHtml(err.message)}</p>`;
    console.error('loadMvpAdmin error:', err);
  }
}

async function _mvpAdminClick(e) {
  const btnAbrir = e.target.closest('.mvp-btn-abrir');
  const btnCerrar = e.target.closest('.mvp-btn-cerrar');
  const btnConfirmar = e.target.closest('.mvp-btn-confirmar');
  const btnCancelar = e.target.closest('.mvp-btn-cancelar');

  if (btnAbrir) {
    const matchId = parseInt(btnAbrir.dataset.matchId);
    const isFem = btnAbrir.dataset.isFem === 'true';
    if (!isFem) {
      btnAbrir.disabled = true;
      btnAbrir.textContent = '⏳ Abriendo...';
      try {
        const res = await fetchWithRetry(`/api/mvp/admin/${matchId}/open`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.success) { showToast('Votación abierta ✅', 'success'); await Promise.all([loadMvpAdmin(), loadMvpVoteSection()]); }
        else { btnAbrir.disabled = false; btnAbrir.textContent = '▶ Abrir'; showToast(data.error || 'Error al abrir', 'error'); }
      } catch { btnAbrir.disabled = false; btnAbrir.textContent = '▶ Abrir'; showToast('Error de conexión', 'error'); }
    } else {
      await _mvpMostrarSelectorFem(matchId);
    }
  }

  if (btnCerrar) {
    const matchId = parseInt(btnCerrar.dataset.matchId);
    if (!confirm('¿Cerrar la votación de este partido?')) return;
    btnCerrar.disabled = true;
    btnCerrar.textContent = '⏳ Cerrando...';
    try {
      const res = await fetchWithRetry(`/api/mvp/admin/${matchId}/close`, { method: 'PUT' });
      const data = await res.json();
      if (data.success) { _mvpCacheClear('mvp_history', 'mvp_ranking'); showToast('Votación cerrada ✅', 'success'); await Promise.all([loadMvpAdmin(), loadMvpVoteSection(), loadMvpHistory(), loadMvpRanking()]); }
      else { btnCerrar.disabled = false; btnCerrar.textContent = '■ Cerrar'; showToast(data.error || 'Error', 'error'); }
    } catch { btnCerrar.disabled = false; btnCerrar.textContent = '■ Cerrar'; showToast('Error de conexión', 'error'); }
  }

  if (btnConfirmar) {
    const matchId = parseInt(btnConfirmar.dataset.matchId);
    const panel = document.getElementById('mvp-fem-panel');
    const checked = [...panel.querySelectorAll('.mvp-player-check:checked')].map(el => parseInt(el.value));
    if (checked.length === 0) { showToast('Selecciona al menos una jugadora', 'error'); return; }
    btnConfirmar.disabled = true;
    btnConfirmar.textContent = '⏳ Abriendo...';
    try {
      const res = await fetchWithRetry(`/api/mvp/admin/${matchId}/open`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_ids: checked })
      });
      const data = await res.json();
      if (data.success) { showToast('Votación abierta ✅', 'success'); await Promise.all([loadMvpAdmin(), loadMvpVoteSection()]); }
      else { btnConfirmar.disabled = false; btnConfirmar.textContent = '✅ Abrir votación'; showToast(data.error || 'Error', 'error'); }
    } catch { btnConfirmar.disabled = false; btnConfirmar.textContent = '✅ Abrir votación'; showToast('Error de conexión', 'error'); }
  }

  if (btnCancelar) {
    const panel = document.getElementById('mvp-fem-panel');
    if (panel) panel.style.display = 'none';
  }
}

async function _mvpMostrarSelectorFem(matchId) {
  const panel = document.getElementById('mvp-fem-panel');
  if (!panel) { showToast('Error interno: panel no encontrado', 'error'); return; }

  panel.style.display = 'block';
  panel.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    const res = await fetchWithRetry('/api/garras/players?category=femenino');
    if (!res.ok) throw new Error(`Error ${res.status}`);
    const players = await res.json();
    if (!Array.isArray(players) || players.length === 0) throw new Error('No hay jugadoras disponibles');

    panel.innerHTML = `
      <div class="mvp-selector-title">¿Qué jugadoras pueden ser votadas? (partido ${matchId})</div>
      <div class="mvp-player-checkboxes">
        ${players.map(p => `
          <label class="mvp-checkbox-label">
            <input type="checkbox" class="mvp-player-check" value="${p.id}">
            ${escapeHtml(p.name)}${p.dorsal ? ` <span class="mvp-dorsal">#${p.dorsal}</span>` : ''}
          </label>`).join('')}
      </div>
      <div class="mvp-selector-actions">
        <button class="btn btn-primary btn-sm mvp-btn-confirmar" data-match-id="${matchId}">✅ Abrir votación</button>
        <button class="btn btn-secondary btn-sm mvp-btn-cancelar">Cancelar</button>
      </div>`;
  } catch (err) {
    panel.innerHTML = `<p class="garras-error">❌ ${escapeHtml(err.message)}</p>`;
    showToast('Error al cargar jugadoras', 'error');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
