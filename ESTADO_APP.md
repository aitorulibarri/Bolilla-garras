# Estado de la app — Bolilla Garras
**Última actualización:** Mayo 2026  
**Producción:** https://bolilla-garras-kwz7.vercel.app

---

## Verificaciones realizadas y resultados

### Stress test bajo carga
- **200 requests concurrentes** (10 jobs paralelos × 20 requests)
- Endpoints probados: `/`, `/api/leaderboard`, `/api/matches/upcoming`, `/api/predictions`, `/app.js`
- **Resultado: 200/200 exitosas (100%)**
- Avg: 439ms · P95: 2s · P99: 2.7s · Max: 2.8s · 0 errores

### Seguridad verificada
- Todos los endpoints protegidos requieren JWT válido
- Endpoints de admin requieren `isAdmin = true`
- Sin SQL injection: todas las queries usan parámetros `$1, $2...`
- Sin XSS en ningún punto que muestre datos de usuario/partido

---

## Fixes aplicados en esta sesión

### Seguridad crítica
| Fix | Descripción |
|---|---|
| Backdoor eliminado | `GET /api/admin/emergency-reset-garras` eliminado (clave era pública en GitHub) |
| Leaderboard protegido | `/api/leaderboard` ahora requiere `requireAuth` |
| Rate limit aumentado | 100 → 300 req/15min (usuarios detrás de NAT compartido) |

### Bugs funcionales
| Bug | Fix |
|---|---|
| Timezone deadline | `NOW() AT TIME ZONE 'Europe/Madrid' > deadline` en lugar de comparación JS — ya no acepta pronósticos 1-2h tarde |
| Timezone tracker | Mismo fix para `deadline_passed` en `/api/admin/open-predictions` |
| Garras Saria cold-start | `dbInit()` reintenta 3 veces (2s/4s backoff) + warm-up proactivo al arrancar |
| Garras Saria error UI | Muestra botón "Reintentar" en vez de mensaje de error roto |
| `display_name` sin límite | Añadida validación máx 30 chars en registro |
| Admin tracker LIMIT 10 | Aumentado a 200 para soportar cientos de usuarios |

### XSS corregidos (7 puntos)
| Ubicación | Dato afectado |
|---|---|
| Leaderboard (visible a todos) | `user.display_name` |
| Historial renderByWeek | `homeTeam` / `awayTeam` |
| Historial renderList | `homeTeam` / `awayTeam` |
| Admin stats tracker | `homeTeam` / `awayTeam` |
| Admin stats tracker | `u.display_name` (usuarios sin pronóstico) |
| Match cards | `homeTeam` / `awayTeam` |
| Tabla de usuarios admin | Atributo injection en `data-display` |

### Escalabilidad
| Mejora | Descripción |
|---|---|
| Pool PostgreSQL | `max: 3`, `idleTimeoutMillis: 10s`, `connectionTimeoutMillis: 15s` |
| DB warm-up | `dbInit()` se llama al arrancar (no solo en primera petición) |
| Export clasificación | Solo visible para admins (antes era para todos) |

---

## Pendiente — requiere acción manual

### 1. JWT_SECRET en Vercel (recomendado)
La app funciona con el fallback hardcodeado, pero es más seguro usar una variable de entorno real.

**Pasos:**
1. Vercel Dashboard → bolilla-garras → Settings → Environment Variables
2. Añadir `JWT_SECRET` con un valor aleatorio fuerte (mínimo 64 caracteres hex)
3. Guardar → Deployments → último deploy → kebab menu → Redeploy

**Valor sugerido:**
```
FB6C3EDDD13CB5F1A1C21AC1163E3C7DC861A585F973196A385E2FA4D637692454F21C652739A622D1F3A2C66E0E91CCF48005177018F6537FE603CDCBA5C881
```

### 2. Neon Connection Pooler (recomendado para alta carga)
Para cientos de usuarios simultáneos, usar la URL pooled evita agotar conexiones directas.

**Pasos:**
1. Neon Dashboard → tu proyecto → Connection Details → selecciona "Pooled connection"
2. Copia la URL (contiene `-pooler.` en el hostname)
3. Vercel → Settings → Environment Variables → actualizar `DATABASE_URL` con esa URL
4. Redeploy

### 3. Pestaña Garras Saria (pendiente de lanzar)
El código está completo y funciona. El tab está oculto hasta que decidas lanzarlo.

**Para activar:**
En `public/index.html`:
- Descomentar el botón de la pestaña (línea ~186)
- Quitar `style="display:none;"` de `<section id="tab-garras">`
- Incrementar versión `?v=8.x` del script `app.js`
- Commit + push

---

## Estado actual en producción

```
Frontend (/)              ✅ OK
API autenticada           ✅ OK (requiere login)  
Base de datos             ✅ OK (PostgreSQL Neon)
Garras Saria              🔒 Oculto (funcional, pendiente de lanzar)
JWT_SECRET                ⚠️  Usando fallback (funcional pero recomendable configurar)
Neon Pooler               ⚠️  Usando conexión directa (estable para uso normal)
```
