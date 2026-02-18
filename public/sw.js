const CACHE_NAME = 'bolilla-garras-cache-RESET-V5';

// INSTALACIÓN: Forzar limpieza inmediata
self.addEventListener('install', (event) => {
    self.skipWaiting(); // Activar inmediatamente
});

// ACTIVACIÓN: Borrar TODAS las cachés antiguas
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    console.log('Borrando caché antigua:', cacheName);
                    return caches.delete(cacheName);
                })
            );
        }).then(() => {
            return self.clients.claim(); // Tomar control de todas las pestañas abiertas
        })
    );
});

// FETCH: NO USAR CACHÉ, SIEMPRE RED
self.addEventListener('fetch', (event) => {
    // Ignorar peticiones que no sean GET
    if (event.request.method !== 'GET') return;

    // Responder siempre desde la red, NUNCA desde caché del SW.
    // Si falla, deja fallar (mejor que texto "desconectado" que rompe JS).
    event.respondWith(fetch(event.request));
});
