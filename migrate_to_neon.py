
import os
import sqlite3
import psycopg2
from urllib.parse import urlparse
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

# Configuración
SQLITE_DB = 'bolilla.db'
POSTGRES_URL = os.getenv('DATABASE_URL')

if not POSTGRES_URL:
    print("❌ ERROR: No se encontró DATABASE_URL en el archivo .env")
    exit(1)

def get_sqlite_connection():
    return sqlite3.connect(SQLITE_DB)

def get_postgres_connection():
    return psycopg2.connect(POSTGRES_URL)

def migrate_users(sqlite_conn, pg_conn):
    print("\n👥 Migrando usuarios...")
    sqlite_cursor = sqlite_conn.cursor()
    pg_cursor = pg_conn.cursor()
    
    # Obtener usuarios de SQLite
    sqlite_cursor.execute("SELECT id, username, display_name, password_hash, is_admin FROM users")
    users = sqlite_cursor.fetchall()
    
    migrated_count = 0
    for user_row in users:
        user_id, username, display_name, password_hash, is_admin = user_row
        
        # Insertar en Postgres (ON CONFLICT DO NOTHING para evitar duplicados)
        try:
            pg_cursor.execute("""
                INSERT INTO users (id, username, display_name, password_hash, is_admin)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (username) DO UPDATE 
                SET display_name = EXCLUDED.display_name, 
                    password_hash = EXCLUDED.password_hash,
                    is_admin = EXCLUDED.is_admin
                RETURNING id;
            """, (user_id, username, display_name, password_hash, is_admin)) # Mantenemos el ID original si es posible, aunque Postgres usa SERIAL
            
            # Si el ID insertado es diferente (o si ya existía), necesitamos mapear el ID viejo al nuevo
            # NOTA: Simplificado para este caso. Si los IDs divergen, las relaciones se romperán.
            # Lo ideal es forzar el ID si la tabla destino está vacía.
            
            migrated_count += 1
            print(f"   ✅ Usuario migrado: {username}")
        except Exception as e:
            print(f"   ❌ Error migrando usuario {username}: {e}")
            
    pg_conn.commit()
    print(f"   ✨ {migrated_count} usuarios migrados.")

def migrate_matches(sqlite_conn, pg_conn):
    print("\n⚽ Migrando partidos...")
    sqlite_cursor = sqlite_conn.cursor()
    pg_cursor = pg_conn.cursor()
    
    # Obtener partidos de SQLite
    sqlite_cursor.execute("SELECT id, team, opponent, is_home, match_date, deadline, home_goals, away_goals, is_finished FROM matches")
    matches = sqlite_cursor.fetchall()
    
    migrated_count = 0
    for match_row in matches:
        match_id, team, opponent, is_home, match_date, deadline, home_goals, away_goals, is_finished = match_row
        
        try:
            # Buscar si el partido ya existe (por fecha y equipos)
            pg_cursor.execute("""
                SELECT id FROM matches 
                WHERE team = %s AND opponent = %s AND match_date = %s
            """, (team, opponent, match_date))
            
            existing = pg_cursor.fetchone()
            
            if existing:
                # Actualizar
                pg_cursor.execute("""
                    UPDATE matches 
                    SET home_goals = %s, away_goals = %s, is_finished = %s
                    WHERE id = %s
                """, (home_goals, away_goals, is_finished, existing[0]))
                print(f"   🔄 Partido actualizado: {team} vs {opponent}")
            else:
                # Insertar
                pg_cursor.execute("""
                    INSERT INTO matches (id, team, opponent, is_home, match_date, deadline, home_goals, away_goals, is_finished)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (match_id, team, opponent, is_home, match_date, deadline, home_goals, away_goals, is_finished))
                migrated_count += 1
                print(f"   ✅ Partido migrado: {team} vs {opponent}")
                
        except Exception as e:
            print(f"   ❌ Error migrando partido {team} vs {opponent}: {e}")
            
    pg_conn.commit()
    print(f"   ✨ {migrated_count} partidos nuevos migrados.")

def migrate_predictions(sqlite_conn, pg_conn):
    print("\n🔮 Migrando predicciones...")
    sqlite_cursor = sqlite_conn.cursor()
    pg_cursor = pg_conn.cursor()
    
    # Obtener predicciones de SQLite con usernames para mapear
    sqlite_cursor.execute("""
        SELECT u.username, m.team, m.opponent, m.match_date, p.home_goals, p.away_goals, p.points
        FROM predictions p
        JOIN users u ON p.user_id = u.id
        JOIN matches m ON p.match_id = m.id
    """)
    predictions = sqlite_cursor.fetchall()
    
    migrated_count = 0
    for row in predictions:
        username, team, opponent, match_date, home_goals, away_goals, points = row
        
        try:
            # Encontrar ID de usuario y partico en Postgres
            pg_cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
            pg_user = pg_cursor.fetchone()
            
            pg_cursor.execute("SELECT id FROM matches WHERE team = %s AND opponent = %s AND match_date = %s", (team, opponent, match_date))
            pg_match = pg_cursor.fetchone()
            
            if pg_user and pg_match:
                user_id = pg_user[0]
                match_id = pg_match[0]
                
                # Insertar o actualizar predicción
                pg_cursor.execute("""
                    INSERT INTO predictions (user_id, match_id, home_goals, away_goals, points)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (user_id, match_id) DO UPDATE
                    SET home_goals = EXCLUDED.home_goals, 
                        away_goals = EXCLUDED.away_goals,
                        points = EXCLUDED.points
                """, (user_id, match_id, home_goals, away_goals, points))
                
                migrated_count += 1
                # print(f"   ✅ Predicción migrada para {username}") # Demasiado spam
            else:
                print(f"   ⚠️ No se pudo migrar predicción de {username} (Usuario/Partido no encontrado en destino)")
                
        except Exception as e:
            print(f"   ❌ Error migrando predicción de {username}: {e}")
            
    pg_conn.commit()
    print(f"   ✨ {migrated_count} predicciones migradas.")

def init_postgres_scema(pg_conn):
    print("🏗️  Inicializando esquema en PostgreSQL...")
    cursor = pg_conn.cursor()
    
    # Crear tablas si no existen (copia del esquema de Flask-SQLAlchemy)
    
    # Tabla Users
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(80) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            display_name VARCHAR(100) NOT NULL,
            is_admin INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    
    # Tabla Matches
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS matches (
            id SERIAL PRIMARY KEY,
            team VARCHAR(100) NOT NULL,
            opponent VARCHAR(100) NOT NULL,
            is_home INTEGER DEFAULT 1,
            match_date TIMESTAMP NOT NULL,
            deadline TIMESTAMP NOT NULL,
            home_goals INTEGER,
            away_goals INTEGER,
            is_finished INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    
    # Tabla Predictions
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS predictions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
            home_goals INTEGER NOT NULL,
            away_goals INTEGER NOT NULL,
            points INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, match_id)
        );
    """)
    
    pg_conn.commit()
    print("   ✅ Esquema verificado.")

def main():
    print("🚀 Iniciando migración a Neon PostgreSQL...")
    
    try:
        sqlite_conn = get_sqlite_connection()
        print("   ✅ Conectado a SQLite local")
    except Exception as e:
        print(f"   ❌ Error conectando a SQLite: {e}")
        return

    try:
        pg_conn = get_postgres_connection()
        print("   ✅ Conectado a PostgreSQL remoto")
    except Exception as e:
        print(f"   ❌ Error conectando a PostgreSQL: {e}")
        return
        
    # Inicializar esquema remoto
    init_postgres_scema(pg_conn)
    
    # Migrar datos en orden
    migrate_users(sqlite_conn, pg_conn)
    migrate_matches(sqlite_conn, pg_conn)
    migrate_predictions(sqlite_conn, pg_conn)
    
    # Cerrar conexiones
    sqlite_conn.close()
    pg_conn.close()
    
    print("\n🎉 MIGRACIÓN COMPLETADA CON ÉXITO")

if __name__ == '__main__':
    main()
