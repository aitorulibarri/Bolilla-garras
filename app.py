from flask import Flask, request, jsonify, session, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func, case, desc
from werkzeug.security import generate_password_hash, check_password_hash
import os
from datetime import datetime
from functools import wraps

app = Flask(__name__, static_folder='public', static_url_path='')
app.secret_key = os.environ.get('SECRET_KEY', 'bolilla-garras-dev-key-change-in-prod')

# Database Config
# Vercel provides DATABASE_URL, local uses sqlite
db_url = os.environ.get('DATABASE_URL')
if not db_url:
    # Local SQLite
    db_path = os.path.join(os.path.dirname(__file__), 'bolilla.db')
    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
else:
    # Fix postgres:// to postgresql:// if needed (Render/Vercel legacy)
    app.config['SQLALCHEMY_DATABASE_URI'] = db_url.replace('postgres://', 'postgresql://')

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# ==================== MODELS ====================

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    display_name = db.Column(db.String(100), nullable=False)
    is_admin = db.Column(db.Integer, default=0) # 0=User, 1=Admin
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    predictions = db.relationship('Prediction', backref='user', lazy=True)

class Match(db.Model):
    __tablename__ = 'matches'
    id = db.Column(db.Integer, primary_key=True)
    team = db.Column(db.String(100), nullable=False)
    opponent = db.Column(db.String(100), nullable=False)
    is_home = db.Column(db.Integer, default=1) # 1=Home, 0=Away
    match_date = db.Column(db.DateTime, nullable=False)
    deadline = db.Column(db.DateTime, nullable=False)
    home_goals = db.Column(db.Integer, nullable=True)
    away_goals = db.Column(db.Integer, nullable=True)
    is_finished = db.Column(db.Integer, default=0) # 0=Pending, 1=Finished
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    predictions = db.relationship('Prediction', backref='match', lazy=True, cascade="all, delete-orphan")

class Prediction(db.Model):
    __tablename__ = 'predictions'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    match_id = db.Column(db.Integer, db.ForeignKey('matches.id'), nullable=False)
    home_goals = db.Column(db.Integer, nullable=False)
    away_goals = db.Column(db.Integer, nullable=False)
    points = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Ensure one prediction per user per match
    __table_args__ = (db.UniqueConstraint('user_id', 'match_id', name='_user_match_uc'),)
    

def init_db():
    with app.app_context():
        db.create_all()
        
        # Create admin user if not exists
        if not User.query.filter_by(username='GARRAS').first():
            admin = User(
                username='GARRAS',
                password_hash=generate_password_hash('GARRAS123'),
                display_name='Admin Garras',
                is_admin=1
            )
            db.session.add(admin)
            db.session.commit()
            print('✅ Usuario admin creado (user: GARRAS, pass: GARRAS123)')

# ==================== AUTH HELPERS ====================

def hash_password(password):
    return generate_password_hash(password)

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user' not in session:
            return jsonify({'error': 'No autenticado'}), 401
        return f(*args, **kwargs)
    return decorated

def require_admin(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user' not in session or not session['user'].get('isAdmin'):
            return jsonify({'error': 'Acceso denegado'}), 403
        return f(*args, **kwargs)
    return decorated

# ==================== SCORING ====================

def calculate_points(pred_home, pred_away, real_home, real_away):
    # Resultado exacto = 5 puntos
    if pred_home == real_home and pred_away == real_away:
        return 5
    
    points = 0
    
    # Acertar goles de un equipo = 2 puntos
    if pred_home == real_home or pred_away == real_away:
        points += 2
    
    # Acertar ganador/empate = 1 punto
    pred_result = 'H' if pred_home > pred_away else ('A' if pred_home < pred_away else 'D')
    real_result = 'H' if real_home > real_away else ('A' if real_home < real_away else 'D')
    if pred_result == real_result:
        points += 1
    
    # Acertar diferencia de goles = 1 punto
    if (pred_home - pred_away) == (real_home - real_away):
        points += 1
    
    return min(points, 3)  # Máximo 3 puntos si no es exacto

def calculate_points_for_match(match_id, home_goals, away_goals):
    predictions = Prediction.query.filter_by(match_id=match_id).all()
    
    for pred in predictions:
        pred.points = calculate_points(pred.home_goals, pred.away_goals, home_goals, away_goals)
    
    db.session.commit()

# ==================== AUTH ROUTES ====================

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    
    user = User.query.filter_by(username=username).first()
    
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({'error': 'Usuario o contraseña incorrectos'}), 401
    
    session['user'] = {
        'id': user.id,
        'username': user.username,
        'displayName': user.display_name,
        'isAdmin': user.is_admin == 1
    }
    
    return jsonify({'success': True, 'user': session['user']})

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    display_name = data.get('displayName')
    
    if not username or not password or not display_name:
        return jsonify({'error': 'Todos los campos son obligatorios'}), 400
    
    if len(password) < 4:
        return jsonify({'error': 'La contraseña debe tener al menos 4 caracteres'}), 400
    
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'El usuario ya existe'}), 400
    
    new_user = User(
        username=username,
        password_hash=hash_password(password),
        display_name=display_name,
        is_admin=0
    )
    
    try:
        db.session.add(new_user)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': 'Error al registrar usuario'}), 500
    
    session['user'] = {
        'id': new_user.id,
        'username': new_user.username,
        'displayName': new_user.display_name,
        'isAdmin': False
    }
    
    return jsonify({'success': True, 'user': session['user']})

@app.route('/api/logout', methods=['POST'])
def logout():
    session.pop('user', None)
    return jsonify({'success': True})

@app.route('/api/change-password', methods=['POST'])
@require_auth
def change_password():
    data = request.get_json()
    current_password = data.get('currentPassword')
    new_password = data.get('newPassword')
    
    if not current_password or not new_password:
        return jsonify({'error': 'Todos los campos son obligatorios'}), 400
    
    if len(new_password) < 4:
        return jsonify({'error': 'La nueva contraseña debe tener al menos 4 caracteres'}), 400
    
    user_id = session['user']['id']
    user = User.query.get(user_id)
    
    if not user or not check_password_hash(user.password_hash, current_password):
        return jsonify({'error': 'La contraseña actual es incorrecta'}), 400
    
    user.password_hash = hash_password(new_password)
    db.session.commit()
    
    return jsonify({'success': True, 'message': 'Contraseña actualizada correctamente'})

@app.route('/api/me')
def me():
    if 'user' not in session:
        return jsonify({'error': 'No autenticado'}), 401
    return jsonify(session['user'])

# ==================== ADMIN USER MANAGEMENT ====================

@app.route('/api/admin/users')
@require_admin
def get_all_users():
    """Get all users (admin only)"""
    results = db.session.query(
        User.id, User.username, User.display_name, User.is_admin,
        func.coalesce(func.sum(Prediction.points), 0).label('total_points'),
        func.count(case((Prediction.points == 5, 1))).label('exact_predictions')
    ).outerjoin(Prediction).group_by(User.id).order_by(User.display_name).all()
    
    users = [
        {
            'id': r.id, 
            'username': r.username, 
            'displayName': r.display_name, # Note: JS expects displayName (camelCase) or snake_case depending on usage. Original SQL returned display_name.
            'display_name': r.display_name, # Keeping both to match previous SQL return dict
            'is_admin': r.is_admin,
            'total_points': int(r.total_points),
            'exact_predictions': r.exact_predictions
        } 
        for r in results
    ]
    
    return jsonify(users)

@app.route('/api/admin/users/<int:user_id>/reset-password', methods=['POST'])
@require_admin
def admin_reset_password(user_id):
    """Reset a user's password to their username (admin only)"""
    user = User.query.get(user_id)
    
    if not user:
        return jsonify({'error': 'Usuario no encontrado'}), 404
    
    # Reset password to username
    new_password = user.username.lower().replace(" ", "").replace(".", "")
    user.password_hash = hash_password(new_password)
    db.session.commit()
    
    return jsonify({'success': True, 'message': f'Contraseña reseteada a: {new_password}'})

# ==================== MATCHES ROUTES ====================

@app.route('/api/matches')
@require_auth
def get_all_matches():
    matches = Match.query.order_by(Match.match_date.desc()).all()
    
    matches_list = []
    for m in matches:
        matches_list.append({
            'id': m.id,
            'team': m.team,
            'opponent': m.opponent,
            'is_home': m.is_home,
            'match_date': m.match_date.isoformat(),
            'deadline': m.deadline.isoformat(),
            'home_goals': m.home_goals,
            'away_goals': m.away_goals,
            'is_finished': m.is_finished,
            'created_at': m.created_at.isoformat()
        })
    
    return jsonify(matches_list)

@app.route('/api/matches/upcoming')
@require_auth
def get_upcoming_matches():
    matches = Match.query.filter_by(is_finished=0).order_by(Match.match_date.asc()).all()
    
    matches_data = []
    user_id = session['user']['id']
    
    for match in matches:
        match_dict = {
            'id': match.id,
            'team': match.team,
            'opponent': match.opponent,
            'is_home': match.is_home,
            'match_date': match.match_date.isoformat(),
            'deadline': match.deadline.isoformat(),
            'home_goals': match.home_goals,
            'away_goals': match.away_goals,
            'is_finished': match.is_finished
        }
        
        # User prediction
        pred = Prediction.query.filter_by(user_id=user_id, match_id=match.id).first()
        match_dict['userPrediction'] = {
            'id': pred.id,
            'home_goals': pred.home_goals,
            'away_goals': pred.away_goals,
            'points': pred.points
        } if pred else None
        
        now = datetime.now()
        match_dict['canPredict'] = now < match.deadline
        
        matches_data.append(match_dict)
    
    return jsonify(matches_data)

@app.route('/api/matches/<int:match_id>')
@require_auth
def get_match(match_id):
    match = Match.query.get(match_id)
    
    if not match:
        return jsonify({'error': 'Partido no encontrado'}), 404
    
    match_dict = {
        'id': match.id,
        'team': match.team,
        'opponent': match.opponent,
        'is_home': match.is_home,
        'match_date': match.match_date.isoformat(),
        'deadline': match.deadline.isoformat(),
        'home_goals': match.home_goals,
        'away_goals': match.away_goals,
        'is_finished': match.is_finished
    }
    
    return jsonify(match_dict)

@app.route('/api/matches', methods=['POST'])
@require_admin
def create_match():
    data = request.get_json()
    team = data.get('team')
    opponent = data.get('opponent')
    is_home = data.get('isHome', True)
    match_date = data.get('matchDate')
    deadline = data.get('deadline')
    
    if not team or not opponent or not match_date or not deadline:
        return jsonify({'error': 'Faltan campos obligatorios'}), 400
    
    new_match = Match(
        team=team,
        opponent=opponent,
        is_home=1 if is_home else 0,
        match_date=datetime.fromisoformat(match_date),
        deadline=datetime.fromisoformat(deadline)
    )
    
    db.session.add(new_match)
    db.session.commit()
    
    return jsonify({'success': True, 'id': new_match.id})

@app.route('/api/matches/<int:match_id>/result', methods=['PUT'])
@require_admin
def set_match_result(match_id):
    data = request.get_json()
    home_goals = data.get('homeGoals')
    away_goals = data.get('awayGoals')
    
    if home_goals is None or away_goals is None:
        return jsonify({'error': 'Faltan los goles'}), 400
    
    match = Match.query.get(match_id)
    if not match:
         return jsonify({'error': 'Partido no encontrado'}), 404

    match.home_goals = home_goals
    match.away_goals = away_goals
    match.is_finished = 1
    
    db.session.commit()
    
    # Calculate points
    calculate_points_for_match(match_id, home_goals, away_goals)
    
    return jsonify({'success': True})

@app.route('/api/matches/<int:match_id>', methods=['DELETE'])
@require_admin
def delete_match(match_id):
    match = Match.query.get(match_id)
    if match:
        # Cascade delete handles predictions deletion automatically via relationship
        db.session.delete(match)
        db.session.commit()
    
    return jsonify({'success': True})

@app.route('/api/matches/<int:match_id>/predictions')
@require_admin
def get_match_predictions(match_id):
    # Get all predictions for this match with user info
    predictions_results = db.session.query(Prediction, User.display_name)\
        .join(User).filter(Prediction.match_id == match_id)\
        .order_by(User.display_name).all()
        
    predictions_list = []
    submitted_user_ids = []
    
    for pred, display_name in predictions_results:
        submitted_user_ids.append(pred.user_id)
        predictions_list.append({
            'id': pred.id,
            'user_id': pred.user_id,
            'match_id': pred.match_id,
            'home_goals': pred.home_goals,
            'away_goals': pred.away_goals,
            'points': pred.points,
            'display_name': display_name
        })
    
    # Get users who haven't submitted predictions
    missing_users = User.query.filter(User.is_admin == 0)\
        .filter(~User.id.in_(submitted_user_ids) if submitted_user_ids else True)\
        .order_by(User.display_name).all()
        
    missing_list = [{'id': u.id, 'display_name': u.display_name} for u in missing_users]
    
    return jsonify({'predictions': predictions_list, 'missing': missing_list})

# ==================== PREDICTIONS ROUTES ====================

@app.route('/api/predictions', methods=['POST'])
@require_auth
def save_prediction():
    data = request.get_json()
    match_id = data.get('matchId')
    home_goals = data.get('homeGoals')
    away_goals = data.get('awayGoals')
    
    if match_id is None or home_goals is None or away_goals is None:
        return jsonify({'error': 'Faltan campos obligatorios'}), 400
    
    user_id = session['user']['id']
    
    # Check if prediction already exists (users cannot modify once submitted)
    existing = Prediction.query.filter_by(user_id=user_id, match_id=match_id).first()
    if existing:
        return jsonify({'error': 'Ya has enviado un pronóstico para este partido. No se puede modificar.'}), 400
    
    # Check deadline
    match = Match.query.get(match_id)
    
    if not match:
        return jsonify({'error': 'Partido no encontrado'}), 404
    
    if datetime.now() > match.deadline:
        return jsonify({'error': 'El plazo para enviar pronósticos ha terminado'}), 400
    
    # Save prediction
    try:
        new_pred = Prediction(
            user_id=user_id,
            match_id=match_id,
            home_goals=home_goals,
            away_goals=away_goals
        )
        db.session.add(new_pred)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    
    return jsonify({'success': True})

@app.route('/api/predictions')
@require_auth
def get_user_predictions():
    user_id = session['user']['id']
    
    # Join Prediction and Match
    results = db.session.query(Prediction, Match)\
        .join(Match).filter(Prediction.user_id == user_id)\
        .order_by(Match.match_date.desc()).all()
        
    predictions_list = []
    
    for pred, match in results:
        predictions_list.append({
            'id': pred.id,
            'user_id': pred.user_id,
            'match_id': pred.match_id,
            'home_goals': pred.home_goals,
            'away_goals': pred.away_goals,
            'points': pred.points,
            'team': match.team,
            'opponent': match.opponent,
            'is_home': match.is_home,
            'match_date': match.match_date.isoformat(),
            'real_home': match.home_goals,
            'real_away': match.away_goals,
            'is_finished': match.is_finished
        })
    
    return jsonify(predictions_list)

# ==================== LEADERBOARD ====================

@app.route('/api/leaderboard')
@require_auth
def get_leaderboard():
    results = db.session.query(
        User.id,
        User.display_name,
        func.coalesce(func.sum(Prediction.points), 0).label('total_points'),
        func.count(case((Prediction.points == 5, 1))).label('exact_predictions'),
        func.count(Prediction.points).label('total_predictions')
    ).outerjoin(Prediction)\
    .filter(User.is_admin == 0)\
    .group_by(User.id)\
    .order_by(desc('total_points'), desc('exact_predictions')).all()
    
    leaderboard = [
        {
            'id': r.id,
            'display_name': r.display_name,
            'total_points': int(r.total_points),
            'exact_predictions': r.exact_predictions,
            'total_predictions': r.total_predictions
        }
        for r in results
    ]
    
    return jsonify(leaderboard)

# ==================== STATIC FILES ====================

@app.route('/')
def index():
    return send_from_directory('public', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('public', path)

# ==================== MAIN ====================

if __name__ == '__main__':
    init_db()
    print('''
╔═══════════════════════════════════════════════════════════╗
║                   🦁 BOLILLA GARRAS 🦁                    ║
║                  Peña Garras Taldea Sestao                ║
╠═══════════════════════════════════════════════════════════╣
║  Servidor iniciado en: http://localhost:5000              ║
║                                                           ║
║  Admin:                                                   ║
║    Usuario: GARRAS                                        ║
║    Contraseña: GARRAS123                                  ║
╚═══════════════════════════════════════════════════════════╝
    ''')
    app.run(debug=True, port=5000)
