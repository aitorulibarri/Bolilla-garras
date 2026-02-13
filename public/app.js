// Bolilla Garras App v2.1
console.log('📱 Bolilla Garras App v2.1 loaded');
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
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || res.status < 500) return res;
      // Server error, retry
      if (i < retries - 1) await new Promise(r => setTimeout(r, delay));
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return fetch(url, options); // Final attempt
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
  // Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
      console.log('✅ Service Worker registered');
    } catch (err) {
      console.log('Service Worker registration failed:', err);
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
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        currentUser = data.user;
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
        body: JSON.stringify({ username, displayName, password })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        currentUser = data.user;
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
  changeNameBtn.addEventListener('click', () => {
    localStorage.removeItem('bolilla_user');
    currentUser = null;
    authPage.style.display = 'flex';
    app.classList.remove('active');
    // Reset forms
    loginForm.reset();
    registerForm.reset();
    hideAuthError();
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
    addMatchForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const team = document.getElementById('match-team').value;
      const opponent = document.getElementById('match-opponent').value;
      const isHome = document.getElementById('match-home').value === '1';
      const matchDate = document.getElementById('match-date').value;
      const deadline = document.getElementById('match-deadline').value;

      try {
        const res = await fetch('/api/matches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ team, opponent, isHome, matchDate, deadline, adminName: currentUser.username })
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
}

function loadTabContent(tabId) {
  switch (tabId) {
    case 'predictions':
      loadMatches();
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

    // Get user predictions
    const predictionsRes = await fetchWithRetry(`/api/predictions/${encodeURIComponent(currentUser.displayName)}`);
    const userPredictions = await predictionsRes.json();
    const predictionMap = {};
    userPredictions.forEach(p => { predictionMap[p.match_id] = p; });

    container.innerHTML = matches.map(match => renderMatchCard(match, predictionMap[match.id])).join('');

    // Add event listeners for save buttons
    document.querySelectorAll('.save-prediction-btn').forEach(btn => {
      btn.addEventListener('click', () => savePrediction(btn.dataset.matchId));
    });
  } catch (err) {
    container.innerHTML = '<p>Error al cargar partidos</p>';
  }
}

function renderMatchCard(match, userPrediction) {
  const matchDate = new Date(match.match_date);
  const deadline = new Date(match.deadline);
  const now = new Date();
  const canPredict = now < deadline;
  const hasPrediction = userPrediction !== undefined;
  const timeLeft = deadline - now;

  // Calculate countdown
  let countdownHtml = '';
  let urgencyClass = '';
  if (!hasPrediction && now < deadline) {
    const hours = Math.floor(timeLeft / (1000 * 60 * 60));
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

    if (hours < 2) {
      urgencyClass = 'urgent';
      countdownHtml = `<div class="countdown urgent">⚠️ ¡Solo quedan ${hours}h ${minutes}m!</div>`;
    } else if (hours < 24) {
      urgencyClass = 'warning';
      countdownHtml = `<div class="countdown warning">⏰ Quedan ${hours}h ${minutes}m</div>`;
    } else {
      const days = Math.floor(hours / 24);
      countdownHtml = `<div class="countdown">📅 Quedan ${days} día${days > 1 ? 's' : ''} y ${hours % 24}h</div>`;
    }
  }

  const homeTeam = match.is_home ? match.team : match.opponent;
  const awayTeam = match.is_home ? match.opponent : match.team;

  const userHomeGoals = hasPrediction ? userPrediction.home_goals : '';
  const userAwayGoals = hasPrediction ? userPrediction.away_goals : '';

  const cardClass = canPredict && !hasPrediction ? 'needs-prediction' : (!canPredict && !hasPrediction ? 'expired' : '');

  return `
    <div class="match-card ${cardClass} ${urgencyClass}">
      <div class="match-header">
        <span class="match-team-badge">${match.team}</span>
        <span class="match-date">
          📅 ${matchDate.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })} 
          ⏰ ${matchDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      
      ${countdownHtml}
      
      <div class="match-teams">
        <div class="match-team">
          <div class="match-team-name">${homeTeam}</div>
        </div>
        <span class="match-vs">vs</span>
        <div class="match-team">
          <div class="match-team-name">${awayTeam}</div>
        </div>
      </div>
      
      ${hasPrediction ? `
        <div class="match-prediction-form">
          <div class="goal-input" style="background: rgba(34, 197, 94, 0.2); border-color: rgba(34, 197, 94, 0.4);">${userHomeGoals}</div>
          <span class="prediction-separator">-</span>
          <div class="goal-input" style="background: rgba(34, 197, 94, 0.2); border-color: rgba(34, 197, 94, 0.4);">${userAwayGoals}</div>
        </div>
        <div class="match-saved">✅ Pronóstico enviado: ${userHomeGoals} - ${userAwayGoals}</div>
      ` : canPredict ? `
        <div class="match-prediction-form">
          <input type="number" class="goal-input" id="home-${match.id}" min="0" max="20" value="" placeholder="0">
          <span class="prediction-separator">-</span>
          <input type="number" class="goal-input" id="away-${match.id}" min="0" max="20" value="" placeholder="0">
        </div>
        <div class="match-actions">
          <button class="btn btn-primary save-prediction-btn" data-match-id="${match.id}">
            💾 Guardar Pronóstico
          </button>
        </div>
      ` : `
        <div class="match-deadline">
          ⏳ Plazo cerrado - No enviaste pronóstico
        </div>
      `}
    </div>
  `;
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
    const res = await fetch('/api/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerName: currentUser.displayName,
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

    container.innerHTML = `
      <div class="leaderboard">
        ${leaderboard.map((user, index) => `
          <div class="leaderboard-item ${index < 3 ? 'top-3' : ''}">
            <div class="leaderboard-rank">${index + 1}</div>
            <div class="leaderboard-name">${user.name || user.display_name}</div>
            <div class="leaderboard-stats">
              <div class="leaderboard-stat">
                <span class="leaderboard-stat-value">${user.total_points}</span>
                <span class="leaderboard-stat-label">Puntos</span>
              </div>
              <div class="leaderboard-stat">
                <span class="leaderboard-stat-value">${user.exact_predictions}</span>
                <span class="leaderboard-stat-label">Plenos</span>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = '<p>Error al cargar clasificación</p>';
  }
}

// ==================== HISTORY ====================

async function loadHistory() {
  const container = document.getElementById('history-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res = await fetchWithRetry(`/api/predictions/${encodeURIComponent(currentUser.displayName)}`);
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
              <button class="btn btn-success btn-sm" onclick="setResult(${match.id})">${match.is_finished ? '✏️' : '✓'}</button>
              ${!match.is_finished ? `<button class="btn btn-secondary btn-sm" onclick="toggleEditMatch(${match.id})" title="Editar partido">📝</button>` : ''}
              <button class="btn btn-danger btn-sm" onclick="deleteMatch(${match.id})">🗑️</button>
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
              <button class="btn btn-primary btn-sm" onclick="saveMatchEdit(${match.id})">💾 Guardar</button>
              <button class="btn btn-secondary btn-sm" onclick="toggleEditMatch(${match.id})">❌ Cancelar</button>
            </div>
          </div>
          ` : ''}
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = '<p>Error al cargar partidos</p>';
  }
}

async function setResult(matchId) {
  const homeGoals = document.getElementById(`result-home-${matchId}`).value;
  const awayGoals = document.getElementById(`result-away-${matchId}`).value;

  if (homeGoals === '' || awayGoals === '') {
    showToast('Introduce el resultado completo', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/matches/${matchId}/result`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        homeGoals: parseInt(homeGoals),
        awayGoals: parseInt(awayGoals),
        adminName: currentUser.username
      })
    });

    if (res.ok) {
      showToast('Resultado guardado y puntos calculados', 'success');
      loadAdminMatches();
    } else {
      showToast('Error al guardar resultado', 'error');
    }
  } catch (err) {
    showToast('Error al guardar resultado', 'error');
  }
}

async function deleteMatch(matchId) {
  if (!confirm('¿Seguro que quieres eliminar este partido?')) return;

  try {
    const res = await fetch(`/api/matches/${matchId}?adminName=${encodeURIComponent(currentUser.username)}`, { method: 'DELETE' });

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

  try {
    const res = await fetch(`/api/matches/${matchId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchDate,
        deadline,
        adminName: currentUser.username
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

  try {
    const res = await fetch('/api/admin/stats');
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
