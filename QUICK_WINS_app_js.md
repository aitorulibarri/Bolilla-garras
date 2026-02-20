# QUICK_WINS - app.js (Frontend)

## 🔴 CRÍTICOS (Arreglar ya)

| # | Línea | Problema | Fix |
|---|-------|----------|-----|
| 1 | 105-193 | Login/Register no usan fetchWithRetry | Cambiar a fetchWithRetry |
| 2 | 604-645 | savePrediction no usa fetchWithRetry | Usar fetchWithRetry |
| 3 | - | innerHTML sin sanitizar (XSS) | Sanitizar datos |
| 4 | 945 | DELETE envía adminName en query string | Mover a body |

## 🟠 MEDIOS

| # | Problema |
|---|----------|
| 5 | parseInt sin validación de NaN |
| 6 | No valida rango de goles (negativos/excesivos) |
| 7 | No hay protección double-submit |
| 8 | currentUser global sin validación |

## ✅ MEJORAS RÁPIDAS

```javascript
// 1. Usar fetchWithRetry en login
const res = await fetchWithRetry('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
});

// 2. Validar parseInt
const homeGoals = parseInt(document.getElementById(`home-${matchId}`).value);
if (isNaN(homeGoals) || homeGoals < 0 || homeGoals > 20) {
    showToast('Introduce un número válido (0-20)', 'error');
    return;
}

// 3. Sanitizar antes de innerHTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 4. Mover adminName de query a body en DELETE
const res = await fetch(`/api/matches/${matchId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminName: currentUser.username })
});
```
