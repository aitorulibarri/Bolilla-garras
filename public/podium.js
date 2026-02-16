// Función para crear el podio en la clasificación
function createPodium(leaderboardData) {
    if (!leaderboardData || leaderboardData.length < 3) return '';

    const top3 = leaderboardData.slice(0, 3);
    const [first, second, third] = top3;

    return `
        <div class="leaderboard-podium">
            <!-- Segundo Lugar -->
            <div class="podium-place second">
                <div class="podium-crown">👑</div>
                <div class="podium-rank">#2</div>
                <div class="podium-name">${second.display_name}</div>
                <div class="podium-points">${second.total_points} pts</div>
                <div class="podium-exact">${second.exact_predictions} ⚽ exactos</div>
            </div>
            
            <!-- Primer Lugar -->
            <div class="podium-place first">
                <div class="podium-crown">👑</div>
                <div class="podium-rank">#1</div>
                <div class="podium-name">${first.display_name}</div>
                <div class="podium-points">${first.total_points} pts</div>
                <div class="podium-exact">${first.exact_predictions} ⚽ exactos</div>
            </div>
            
            <!-- Tercer Lugar -->
            <div class="podium-place third">
                <div class="podium-crown">👑</div>
                <div class="podium-rank">#3</div>
                <div class="podium-name">${third.display_name}</div>
                <div class="podium-points">${third.total_points} pts</div>
                <div class="podium-exact">${third.exact_predictions} ⚽ exactos</div>
            </div>
        </div>
    `;
}

// Exportar para uso global
if (typeof window !== 'undefined') {
    window.createPodium = createPodium;
}
