# QUICK_WINS - index.html (Frontend HTML)

## 🔴 CRÍTICOS (Arreglar ya)

| # | Línea | Problema | Fix |
|---|-------|----------|-----|
| 1 | 59,83,88 | Contraseña mínima solo 4 caracteres | Cambiar a minlength="8" |
| 2 | 6-7 | CSP tiene 'unsafe-inline' | Eliminar unsafe-inline |
| 3 | - | Service Worker no usa caché (always network) | Implementar estrategia caché |

## 🟠 MEDIOS

| # | Problema |
|---|----------|
| 4 | Inline styles en líneas 67, 142, 267 |
| 5 | Sin validación fecha límite > fecha partido |
| 6 | SVGs embebidos en manifest (no óptimo) |
| 7 | Múltiples versiones CSS (styles.css, backup, new) |

## ✅ MEJORAS RÁPIDAS

```html
<!-- 1. Contraseña más segura -->
<input type="password" id="register-password" minlength="8" ...>
<input type="password" id="login-password" minlength="8" ...>

<!-- 2. CSP más estricto -->
<meta http-equiv="Content-Security-Policy"
    content="default-src 'self';
    script-src 'self' 'nonce-{RANDOM}';
    style-src 'self' https://fonts.googleapis.com;
    ...">

<!-- 3. Service Worker con caché -->
// En sw.js: cambiar fetch strategy
const CACHE_NAME = 'bolilla-v1';
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});
```

## 🧹 LIMPIEZA

- Eliminar styles_backup.css
- Eliminar styles_new.css
- Usar solo un styles.css
- Usar icons PNG/WebP en manifest.json
