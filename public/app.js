// ==================== STATE ====================
let currentUser = null;

// ==================== DOM ELEMENTS ====================
const loginPage = document.getElementById('login-page');
const app = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const toggleRegister = document.getElementById('toggle-register');
const toggleLogin = document.getElementById('toggle-login');
const errorMessage = document.getElementById('error-message');
const logoutBtn = document.getElementById('logout-btn');
const userName = document.getElementById('user-name');
const adminTab = document.getElementById('admin-tab');
const navTabs = document.querySelectorAll('.nav-tab');
const tabContents = document.querySelectorAll('.tab-content');

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
  setupEventListeners();
});

async function checkAuth() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      currentUser = await res.json();
      showApp();
    }
  } catch (err) {
    console.log('No authenticated');
  }
}

function setupEventListeners() {
  // Login/Register toggle
  toggleRegister.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
    toggleRegister.style.display = 'none';
    toggleLogin.style.display = 'block';
    hideError();
  });

  toggleLogin.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    toggleRegister.style.display = 'block';
    toggleLogin.style.display = 'none';
    hideError();
  });

  // Login form
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (res.ok) {
        currentUser = data.user;
        showApp();
      } else {
        showError(data.error);
      }
    } catch (err) {
      showError('Error de conexión');
    }
  });

  // Register form
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = document.getElementById('register-name').value;
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, displayName })
      });

      const data = await res.json();

      if (res.ok) {
        currentUser = data.user;
        showApp();
        showToast('¡Bienvenido a Bolilla Garras!', 'success');
      } else {
        showError(data.error);
      }
    } catch (err) {
      showError('Error de conexión');
    }
  });

  // Logout
  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    currentUser = null;
    loginPage.style.display = 'flex';
    app.classList.remove('active');
    loginForm.reset();
    registerForm.reset();
  });

  // Change Password Modal
  const passwordModal = document.getElementById('password-modal');
  const changePasswordBtn = document.getElementById('change-password-btn');
  const cancelPasswordBtn = document.getElementById('cancel-password-btn');
  const changePasswordForm = document.getElementById('change-password-form');

  changePasswordBtn.addEventListener('click', () => {
    passwordModal.style.display = 'flex';
  });

  cancelPasswordBtn.addEventListener('click', () => {
    passwordModal.style.display = 'none';
    changePasswordForm.reset();
  });

  // Close modal on backdrop click
  passwordModal.querySelector('.modal-backdrop').addEventListener('click', () => {
    passwordModal.style.display = 'none';
    changePasswordForm.reset();
  });

  changePasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    if (newPassword !== confirmPassword) {
      showToast('Las contraseñas no coinciden', 'error');
      return;
    }

    try {
      const res = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      const data = await res.json();

      if (res.ok) {
        showToast('Contraseña actualizada correctamente', 'success');
        passwordModal.style.display = 'none';
        changePasswordForm.reset();
      } else {
        showToast(data.error, 'error');
      }
    } catch (err) {
      showToast('Error al cambiar contraseña', 'error');
    }
  });

  // Tab navigation
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;

      navTabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(`tab-${tabId}`).classList.add('active');

      // Load tab content
      loadTabContent(tabId);
    });
  });

  // Add match form
  document.getElementById('add-match-form').addEventListener('submit', async (e) => {
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
        body: JSON.stringify({ team, opponent, isHome, matchDate, deadline })
      });

      if (res.ok) {
        showToast('Partido añadido correctamente', 'success');
        e.target.reset();
        loadAdminMatches();
        loadMatches();
      } else {
        const data = await res.json();
        showToast(data.error, 'error');
      }
    } catch (err) {
      showToast('Error al añadir partido', 'error');
    }
  });
}

// ==================== APP ====================

function showApp() {
  loginPage.style.display = 'none';
  app.classList.add('active');
  userName.textContent = currentUser.displayName;

  // Show admin tabs only for admin users
  const matchHistoryTab = document.getElementById('match-history-tab');
  if (currentUser.isAdmin) {
    adminTab.style.display = 'block';
    matchHistoryTab.style.display = 'block';
  } else {
    adminTab.style.display = 'none';
    matchHistoryTab.style.display = 'none';
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
      loadAdminUsers();
      break;
    case 'match-history':
      loadMatchHistory();
      break;
  }
}

// ==================== MATCHES ====================

async function loadMatches() {
  const container = document.getElementById('matches-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res = await fetch('/api/matches/upcoming');
    const matches = await res.json();

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

    container.innerHTML = matches.map(match => renderMatchCard(match)).join('');

    // Add event listeners for save buttons
    document.querySelectorAll('.save-prediction-btn').forEach(btn => {
      btn.addEventListener('click', () => savePrediction(btn.dataset.matchId));
    });
  } catch (err) {
    container.innerHTML = '<p>Error al cargar partidos</p>';
  }
}

function renderMatchCard(match) {
  const matchDate = new Date(match.match_date);
  const deadline = new Date(match.deadline);
  const now = new Date();
  const canPredict = now < deadline && !match.userPrediction;
  const hasPrediction = match.userPrediction !== null;
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

  const userHomeGoals = match.userPrediction ? match.userPrediction.home_goals : '';
  const userAwayGoals = match.userPrediction ? match.userPrediction.away_goals : '';

  // Add warning class if no prediction and can still predict
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
        <!-- Already submitted - LOCKED -->
        <div class="match-prediction-form">
          <div class="goal-input" style="background: rgba(34, 197, 94, 0.2); border-color: rgba(34, 197, 94, 0.4);">${userHomeGoals}</div>
          <span class="prediction-separator">-</span>
          <div class="goal-input" style="background: rgba(34, 197, 94, 0.2); border-color: rgba(34, 197, 94, 0.4);">${userAwayGoals}</div>
        </div>
        <div class="match-saved">✅ Pronóstico enviado: ${userHomeGoals} - ${userAwayGoals} (no modificable)</div>
      ` : canPredict ? `
        <!-- Can still predict -->
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
        <!-- Deadline passed without prediction -->
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

  try {
    const res = await fetch('/api/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const res = await fetch('/api/leaderboard');
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
            <div class="leaderboard-name">${user.display_name}</div>
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
    const res = await fetch('/api/predictions');
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

// Helper to populate dropdowns - REMOVED (User preferred hardcoded HTML)
// function populateTeamDropdowns() { ... }

async function loadAdminMatches() {
  const container = document.getElementById('admin-matches-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res = await fetch('/api/matches');
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

    container.innerHTML = await Promise.all(matches.map(async match => {
      const matchDate = new Date(match.match_date);
      const homeTeam = match.is_home ? match.team : match.opponent;
      const awayTeam = match.is_home ? match.opponent : match.team;

      // Get predictions info for this match
      let predictionsInfo = '';
      if (!match.is_finished) {
        try {
          const predRes = await fetch(`/api/matches/${match.id}/predictions`);
          const data = await predRes.json();
          const submitted = data.predictions.length;
          const missing = data.missing.length;
          const missingNames = data.missing.map(u => u.display_name).join(', ');

          predictionsInfo = `
                      <div style="margin-top: 12px; font-size: 12px;">
                        <div style="margin-bottom: 8px;">
                          <span style="color: #86EFAC;">✅ Enviados: ${submitted}</span> | 
                          <span style="color: #FCA5A5;">❌ Faltan: ${missing}</span>
                        </div>
                        ${submitted > 0 ? `
                          <div style="background: rgba(34, 197, 94, 0.1); padding: 8px; border-radius: 8px; margin-bottom: 8px;">
                            <div style="color: #86EFAC; font-weight: 500; margin-bottom: 4px;">Han enviado:</div>
                            ${data.predictions.map(p => `<div style="color: #D1D5DB;">• ${p.display_name}: <strong>${p.home_goals}-${p.away_goals}</strong></div>`).join('')}
                          </div>
                        ` : ''}
                        ${missing > 0 ? `
                          <div style="background: rgba(239, 68, 68, 0.1); padding: 8px; border-radius: 8px;">
                            <div style="color: #FCA5A5; font-weight: 500; margin-bottom: 4px;">Faltan por enviar:</div>
                            <div style="color: #9CA3AF;">${missingNames}</div>
                          </div>
                        ` : ''}
                      </div>
                    `;
        } catch (e) {
          console.error(e);
        }
      }

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
              <button class="btn btn-danger btn-sm" onclick="deleteMatch(${match.id})">🗑️</button>
            </div>
          </div>
          ${predictionsInfo}
        </div>
      `;
    })).then(results => results.join(''));
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
        awayGoals: parseInt(awayGoals)
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
    const res = await fetch(`/api/matches/${matchId}`, { method: 'DELETE' });

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

// ==================== MATCH HISTORY (Admin) ====================

async function loadMatchHistory() {
  const teams = ['Athletic Club', 'Athletic Femenino', 'Bilbao Athletic'];
  const containerIds = ['history-athletic-club', 'history-athletic-femenino', 'history-bilbao-athletic'];

  try {
    const res = await fetch('/api/matches');
    const matches = await res.json();

    teams.forEach((team, index) => {
      const container = document.getElementById(containerIds[index]);
      const teamMatches = matches.filter(m => m.team === team);

      if (teamMatches.length === 0) {
        container.innerHTML = `
          <div class="empty-state" style="padding: 20px;">
            <p style="color: var(--text-muted);">No hay partidos registrados para ${team}</p>
          </div>
        `;
        return;
      }

      // Sort by date descending (most recent first)
      teamMatches.sort((a, b) => new Date(b.match_date) - new Date(a.match_date));

      container.innerHTML = teamMatches.map(match => {
        const matchDate = new Date(match.match_date);
        const homeTeam = match.is_home ? match.team : match.opponent;
        const awayTeam = match.is_home ? match.opponent : match.team;

        return `
          <div class="history-item" style="margin-bottom: 8px;">
            <div class="history-match" style="flex: 1;">
              <div class="history-match-teams">${homeTeam} vs ${awayTeam}</div>
              <div class="history-match-date">${matchDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
            </div>
            <div class="history-result" style="padding: 0 20px;">
              ${match.is_finished ? `
                <div class="history-result-score" style="font-size: 24px; font-weight: 800;">
                  ${match.home_goals} - ${match.away_goals}
                </div>
              ` : `
                <span style="color: var(--warning);">⏳ Pendiente</span>
              `}
            </div>
          </div>
        `;
      }).join('');
    });
  } catch (err) {
    console.error(err);
    containerIds.forEach(id => {
      document.getElementById(id).innerHTML = '<p>Error al cargar historial</p>';
    });
  }
}

// ==================== ADMIN USERS ====================

async function loadAdminUsers() {
  const container = document.getElementById('admin-users-container');

  try {
    const res = await fetch('/api/admin/users');
    const users = await res.json();

    if (users.length === 0) {
      container.innerHTML = '<p style="color: var(--text-muted);">No hay usuarios registrados</p>';
      return;
    }

    container.innerHTML = `
      <div style="max-height: 400px; overflow-y: auto;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
              <th style="text-align: left; padding: 12px 8px; font-size: 12px; color: var(--text-muted); text-transform: uppercase;">Usuario</th>
              <th style="text-align: center; padding: 12px 8px; font-size: 12px; color: var(--text-muted);">Puntos</th>
              <th style="text-align: center; padding: 12px 8px; font-size: 12px; color: var(--text-muted);">Plenos</th>
              <th style="text-align: right; padding: 12px 8px; font-size: 12px; color: var(--text-muted);">Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${users.map(user => `
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td style="padding: 12px 8px;">
                  <div style="font-weight: 600;">${user.display_name}</div>
                  <div style="font-size: 12px; color: var(--text-muted);">@${user.username}${user.is_admin ? ' 👑' : ''}</div>
                </td>
                <td style="text-align: center; padding: 12px 8px; font-weight: 700; color: var(--athletic-red-light);">${user.total_points}</td>
                <td style="text-align: center; padding: 12px 8px; color: var(--success-light);">${user.exact_predictions}</td>
                <td style="text-align: right; padding: 12px 8px;">
                  ${!user.is_admin ? `
                    <button class="btn btn-secondary btn-sm" onclick="resetUserPassword(${user.id}, '${user.display_name}')" title="Resetear contraseña">
                      🔑 Reset
                    </button>
                  ` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top: 16px; padding: 12px; background: rgba(59, 130, 246, 0.1); border-radius: var(--radius-md); border: 1px solid rgba(59, 130, 246, 0.2);">
        <p style="font-size: 13px; color: #93C5FD;">
          💡 <strong>Tip:</strong> Al resetear, la contraseña se establece igual que el nombre de usuario (en minúsculas, sin espacios).
        </p>
      </div>
    `;
  } catch (err) {
    container.innerHTML = '<p>Error al cargar usuarios</p>';
  }
}

async function resetUserPassword(userId, displayName) {
  if (!confirm(`¿Resetear la contraseña de ${displayName}?`)) return;

  try {
    const res = await fetch(`/api/admin/users/${userId}/reset-password`, { method: 'POST' });
    const data = await res.json();

    if (res.ok) {
      showToast(data.message, 'success');
    } else {
      showToast(data.error, 'error');
    }
  } catch (err) {
    showToast('Error al resetear contraseña', 'error');
  }
}

// ==================== UTILS ====================

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');
}

function hideError() {
  errorMessage.classList.remove('show');
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${type === 'success' ? '✓' : '✗'} ${message}`;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}
