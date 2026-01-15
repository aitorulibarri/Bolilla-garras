"""
Script para importar los puntos históricos de la Bolilla Garras
Crea un "partido histórico" y asigna los puntos a cada usuario
"""

from app import app, db, User, Match, Prediction
from datetime import datetime

def import_historical_points():
    """Crea un partido histórico y asigna los puntos actuales a cada usuario"""
    
    # Datos de la clasificación actual (extraídos de la imagen)
    standings = {
        "TIO JAVI": 109,
        "OXE": 103,
        "MIKEL N.": 102,
        "TAMARA": 100,
        "AITOR G.": 99,
        "DAVID": 98,
        "JEFRY": 98,
        "AITOR U.": 97,
        "EDURNE": 96,
        "IBAI TXU": 95,
        "IMOLA M.": 95,
        "NIEVEX": 95,
        "IRAN GUTI": 94,
        "JOSELU": 94,
        "LEXURI": 93,
        "IRATXE": 93,
        "IRUNE G.": 93,
        "JULEN": 92,
        "MARIJE FER": 92,
        "ABAITXU": 91,
        "JORGE": 91,
        "AITOR N.": 90,
        "LARA": 90,
        "JON U.": 89,
        "JONTXU": 88,
        "IRAIA CAGI": 87,
        "ASIER ROD.": 86,
        "NAHIA C.": 85,
        "JUANOLA": 84,
        "PRUDEN": 83,
        "OSKAR P.": 83,
        "PABLO": 81,
        "LUCIA": 81,
        "LUISI": 80,
        "EDU S.": 80,
        "PANTERA": 80,
        "PEDRO M.": 80,
        "DIEGO": 79,
        "AITITE": 78,
        "AITOR": 78,
        "SERGIO": 78,
        "MEJU": 78,
        "ITZASKUN R.": 77,
        "JANIRE": 77,
        "ALFRE": 77,
        "LEXKIR": 75,
        "MARIA": 73,
        "ALFON": 73,
        "ALBERTO": 72,
        "IGOR": 72,
        "TXIMU": 70,
        "ANE ROD.": 70,
        "ASTO": 68,
        "FRAN": 68,
        "EDU BCN": 68,
        "TARSO": 66,
        "JON": 65,
        "MARIBÍ SANZ": 64,
        "EDU BN": 63,
        "IÑIGO SALVA": 62,
        "MATI": 62,
        "IAN": 62,
        "GOROS": 57,
        "BEGO D.": 50,
        "HEIGO": 0,
    }
    
    with app.app_context():
        # Crear un partido histórico para representar los puntos acumulados
        print("📅 Creando partido histórico...")
        
        # Eliminar si ya existe para evitar duplicados en pruebas
        existing = Match.query.filter_by(team="Histórico", opponent="Jornadas 1-19").first()
        if existing:
            print("   ⚠️ Partido histórico ya existe, eliminando anterior...")
            db.session.delete(existing)
            db.session.commit()

        historical_match = Match(
            team="Histórico",
            opponent="Jornadas 1-19",
            is_home=1,
            match_date=datetime(2026, 1, 13),
            deadline=datetime(2026, 1, 13),
            home_goals=0,
            away_goals=0,
            is_finished=1
        )
        db.session.add(historical_match)
        db.session.commit()
        
        print(f"   ✅ Partido histórico creado (ID: {historical_match.id})")
        
        # Asignar puntos a cada usuario
        print("\n👥 Asignando puntos históricos...")
        points_assigned = 0
        
        for display_name, points in standings.items():
            user = User.query.filter_by(display_name=display_name).first()
            
            if user:
                # Crear una predicción con los puntos directamente
                pred = Prediction(
                    user_id=user.id,
                    match_id=historical_match.id,
                    home_goals=0,
                    away_goals=0,
                    points=points
                )
                db.session.add(pred)
                points_assigned += 1
                print(f"   ✅ {display_name}: {points} pts")
            else:
                print(f"   ⚠️  Usuario '{display_name}' no encontrado")
        
        db.session.commit()
        
        print(f"\n📊 Resumen:")
        print(f"   - Puntos asignados a {points_assigned} usuarios")

if __name__ == '__main__':
    print("🦁 IMPORTANDO PUNTOS HISTÓRICOS BOLILLA GARRAS\n")
    import_historical_points()
    print("\n✅ Importación de puntos completada")

