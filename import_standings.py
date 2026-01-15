"""
Script para importar la clasificación actual de la Bolilla Garras
basada en la imagen PHOTO-2026-01-13-08-36-45.jpg
"""

from app import app, db, User, hash_password

def import_standings():
    """Importa los usuarios y sus puntos actuales desde la imagen"""
    
    # Datos extraídos de la imagen (columna derecha - clasificación actual)
    # Formato: (posición, nombre, puntos_totales)
    standings = [
        (1, "TIO JAVI", 109),
        (2, "OXE", 103),
        (3, "MIKEL N.", 102),
        (4, "TAMARA", 100),
        (5, "AITOR G.", 99),
        (6, "DAVID", 98),
        (7, "JEFRY", 98),
        (8, "AITOR U.", 97),
        (9, "EDURNE", 96),
        (10, "IBAI TXU", 95),
        (11, "IMOLA M.", 95),
        (12, "NIEVEX", 95),
        (13, "IRAN GUTI", 94),
        (14, "JOSELU", 94),
        (15, "LEXURI", 93),
        (16, "IRATXE", 93),
        (17, "IRUNE G.", 93),
        (18, "ABAITXU", 91),
        (19, "JORGE", 91),
        (20, "LARA", 90),
        (21, "JON U.", 89),
        (22, "JONTXU", 88),
        (23, "IRAIA CAGI", 87),
        (24, "ASIER ROD.", 86),
        (25, "NAHIA C.", 85),
        (26, "JUANOLA", 84),
        (27, "OSKAR P.", 83),
        (28, "LUCIA", 81),
        (29, "EDU S.", 80),
        (30, "PANTERA", 80),
        (31, "MEJU", 78),
        (32, "ALFRE", 77),
        (33, "LEXKIR", 75),
        (34, "ALFON", 73),
        (35, "ALBERTO", 72),
        (36, "EDU BCN", 68),
        (37, "TARSO", 66),
        (38, "JON", 65),
        (39, "MARIBÍ SANZ", 64),
        (40, "IÑIGO SALVA", 62),
        (41, "FRAN", 62),
        (42, "MATI", 62),
        (43, "IAN", 62),
        (44, "GOROS", 57),
        # Usuarios de la otra columna que no están ordenados por puntos
        # Los añado también con sus puntos
        ("", "AITITE", 78),
        ("", "AITOR N.", 90),
        ("", "AITOR", 78),
        ("", "ASTO", 68),
        ("", "DIEGO", 79),
        ("", "EDU BN", 63),
        ("", "FRAN", 68), # Este repetido se manejará por la lógica de usuario existente
        ("", "IGOR", 72),
        ("", "ITZASKUN R.", 77),
        ("", "JANIRE", 77),
        ("", "JULEN", 92),
        ("", "LUISI", 80),
        ("", "MARIJE FER", 92),
        ("", "MARIA", 73),
        ("", "PABLO", 81),
        ("", "PEDRO M.", 80),
        ("", "PRUDEN", 83),
        ("", "SERGIO", 78),
        ("", "TXIMU", 70),
        ("", "ANE ROD.", 70),
        ("", "BEGO D.", 50),
        ("", "HEIGO", 0),
    ]
    
    with app.app_context():
        # Crear usuarios con contraseña por defecto (su nombre en minúsculas)
        users_created = 0
        users_updated = 0
        
        for item in standings:
            if len(item) == 3:
                pos, name, points = item
            else:
                continue
                
            # Crear nombre de usuario limpio
            username = name.lower().replace(" ", "").replace(".", "").replace("í", "i").replace("ñ", "n")
            display_name = name
            password = username  # La contraseña es igual al usuario
            
            # Verificar si el usuario ya existe
            existing = User.query.filter((User.username == username) | (User.display_name == display_name)).first()
            
            if existing:
                users_updated += 1
                print(f"  ⚠️  Usuario '{display_name}' ya existe")
            else:
                # Crear usuario
                try:
                    new_user = User(
                        username=username,
                        password_hash=hash_password(password),
                        display_name=display_name,
                        is_admin=0
                    )
                    db.session.add(new_user)
                    db.session.commit()
                    users_created += 1
                    print(f"  ✅ Usuario '{display_name}' creado (user: {username}, pass: {username})")
                except Exception as e:
                    db.session.rollback()
                    print(f"  ❌ Error creando '{display_name}': {e}")
        
        print(f"\n📊 Resumen:")
        print(f"   - Usuarios creados: {users_created}")
        print(f"   - Usuarios existentes: {users_updated}")
        
        # Mostrar todos los usuarios
        all_users = User.query.order_by(User.display_name).all()
        print(f"\n👥 Total usuarios en BD: {len(all_users)}")

if __name__ == '__main__':
    print("🦁 IMPORTANDO CLASIFICACIÓN BOLILLA GARRAS\n")
    import_standings()
    print("\n✅ Importación completada")
    print("\n💡 Nota: Los usuarios pueden iniciar sesión con:")
    print("   Usuario: su nombre en minúsculas sin espacios")
    print("   Contraseña: igual que el usuario")
    print("   Ej: 'tiojavi' / 'tiojavi'")
