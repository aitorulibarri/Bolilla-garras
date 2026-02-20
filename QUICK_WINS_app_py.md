# QUICK_WINS - app.py (Backend Python/Flask)

## 🔴 CRÍTICOS (Arreglar ya)

| # | Línea | Problema | Fix |
|---|-------|----------|-----|
| 1 | 10 | Secret key hardcodeada | Usar variable de entorno |
| 2 | 714 | debug=True en producción | Desactivar en prod |
| 3 | 452 | `@require_admin` ausente en /api/admin/stats | Añadir decorador |
| 4 | 281 | Endpoint emergencia con key hardcodeada | Mover a .env |
| 5 | 170 | Contraseña mínima solo 4 caracteres | Cambiar a 8 |

## 🟠 MEDIOS

| # | Línea | Problema |
|---|-------|----------|
| 6 | 362 | Comparación de timezone sin UTC |
| 7 | 199-202 | Sesiones sin cookies HttpOnly/Secure |
| 8 | 112-115 | No verifica expiración de sesión |
| 9 | 336, 353 | Debug prints en producción |
| 10 | 54, 64, 69 | Integer (0/1) en lugar de Boolean |

## ✅ MEJORAS RÁPIDAS

```python
# 1. Línea 10: SECRET_KEY
app.secret_key = os.environ.get('SECRET_KEY') or os.urandom(32)

# 2. Línea 714: Debug
if __name__ == '__main__':
    app.run(debug=False, port=5000)

# 3. Línea 452: Añadir @require_admin
@app.route('/api/admin/stats')
@require_admin
def get_admin_stats():

# 4. Línea 170: Contraseña más fuerte
if len(password) < 8:

# 5. Líneas 362: Timezone
from datetime import datetime, timezone
now = datetime.now(timezone.utc)
```
