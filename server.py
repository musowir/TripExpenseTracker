import os
import json
import sqlite3
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__)

# CRITICAL FOR CLOUD: Map absolute path for SQLite to prevent empty db initialization
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "tracker.db")

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    cursor.execute("CREATE TABLE IF NOT EXISTS categories (main_cat TEXT PRIMARY KEY, subs_csv TEXT)")
    cursor.execute("CREATE TABLE IF NOT EXISTS trips (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE)")
    
    # Ensure baseline trip exists
    cursor.execute("SELECT COUNT(*) FROM trips")
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO trips (name) VALUES ('ChaloMumbai')")
        trip_id = cursor.lastrowid
    else:
        cursor.execute("SELECT id FROM trips LIMIT 1")
        trip_id = cursor.fetchone()[0]
    
    # Trip Roster Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS trip_people (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            UNIQUE(trip_id, name),
            FOREIGN KEY(trip_id) REFERENCES trips(id) ON DELETE CASCADE
        )
    """)
    
    # Ensure "me" exists for the default trip
    cursor.execute("SELECT COUNT(*) FROM trip_people WHERE trip_id = ? AND name = 'me'", (trip_id,))
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO trip_people (trip_id, name) VALUES (?, 'me')", (trip_id,))
    
    # Core Expense Logs Registry
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            description TEXT NOT NULL, 
            amount REAL NOT NULL, 
            main_cat TEXT NOT NULL, 
            sub_cat TEXT NOT NULL, 
            timestamp TEXT NOT NULL,
            paid_by TEXT NOT NULL,
            trip_id INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY(trip_id) REFERENCES trips(id) ON DELETE CASCADE
        )
    """)
    
    # Junction Matrix Split Table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS expense_splits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            expense_id INTEGER NOT NULL,
            person_name TEXT NOT NULL,
            FOREIGN KEY(expense_id) REFERENCES expenses(id) ON DELETE CASCADE
        )
    """)
    
    conn.commit()
    conn.close()

# Use safe absolute directory layouts for serving static content
@app.route('/')
def serve_index():
    return send_from_directory(BASE_DIR, 'index.html')

@app.route('/assets/<path:path>')
def serve_assets(path):
    return send_from_directory(os.path.join(BASE_DIR, 'assets'), path)

# --- NEW PWA HOOK ROUTES FOR NATIVE ANDROID SYSTEM INTERACTION ---

@app.route('/manifest.json')
def serve_manifest():
    return send_from_directory(BASE_DIR, 'manifest.json', mimetype='application/json')

@app.route('/sw.js')
def serve_sw():
    return send_from_directory(BASE_DIR, 'sw.js', mimetype='application/javascript')

@app.route('/icon.png')
def serve_icon():
    return send_from_directory(BASE_DIR, 'icon.png', mimetype='image/png')

# --- WORKSPACE REGISTRY ROUTERS ---

@app.route('/api/trips', methods=['GET'])
def get_trips():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT id, name FROM trips")
    trips = [{"id": row[0], "name": row[1]} for row in cursor.fetchall()]
    conn.close()
    return jsonify(trips)

@app.route('/api/trips/add', methods=['POST'])
def add_trip():
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({"error": "Missing trip name"}), 400
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("INSERT INTO trips (name) VALUES (?)", (name,))
        new_id = cursor.lastrowid
        cursor.execute("INSERT INTO trip_people (trip_id, name) VALUES (?, 'me')", (new_id,))
        conn.commit()
        return jsonify({"success": True, "id": new_id})
    except sqlite3.IntegrityError:
        return jsonify({"error": "Trip name already exists"}), 400
    finally:
        conn.close()

@app.route('/api/trips/delete', methods=['POST'])
def delete_trip():
    data = request.get_json() or {}
    trip_id = data.get('id')
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM trips")
    if cursor.fetchone()[0] <= 1:
        conn.close()
        return jsonify({"error": "Cannot delete the only remaining trip."}), 400
        
    cursor.execute("DELETE FROM expenses WHERE trip_id = ?", (trip_id,))
    cursor.execute("DELETE FROM trip_people WHERE trip_id = ?", (trip_id,))
    cursor.execute("DELETE FROM trips WHERE id = ?", (trip_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

# --- ROSTER WORKSPACE MEMBERS ROUTERS ---

@app.route('/api/people', methods=['GET'])
def get_people():
    trip_id = request.args.get('trip_id', type=int)
    if not trip_id:
        return jsonify([])
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT id, name FROM trip_people WHERE trip_id = ?", (trip_id,))
    people = [{"id": row[0], "name": row[1]} for row in cursor.fetchall()]
    
    if not any(p['name'] == 'me' for p in people):
        people.insert(0, {"id": 0, "name": "me"})
        
    conn.close()
    return jsonify(people)

@app.route('/api/people/add', methods=['POST'])
def add_person():
    data = request.get_json() or {}
    trip_id = data.get('trip_id')
    name = data.get('name', '').strip()
    if not trip_id or not name:
        return jsonify({"error": "Missing parameters"}), 400
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("INSERT INTO trip_people (trip_id, name) VALUES (?, ?)", (trip_id, name))
        conn.commit()
        return jsonify({"success": True})
    except sqlite3.IntegrityError:
        return jsonify({"error": "This person is already registered."}), 400
    finally:
        conn.close()

@app.route('/api/people/delete', methods=['POST'])
def delete_person():
    data = request.get_json() or {}
    person_id = data.get('id')
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM trip_people WHERE id = ?", (person_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

# --- TRANSACTION OPERATIONS & ANALYSIS PIPELINE ROUTERS ---

@app.route('/api/data', methods=['GET'])
def get_data():
    trip_id = request.args.get('trip_id', type=int)
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    if trip_id:
        cursor.execute("SELECT id, description, amount, main_cat, sub_cat, timestamp, paid_by FROM expenses WHERE trip_id = ?", (trip_id,))
    else:
        cursor.execute("SELECT id, description, amount, main_cat, sub_cat, timestamp, paid_by FROM expenses")
        
    raw_expenses = cursor.fetchall()
    expenses = []
    
    for r in raw_expenses:
        exp_id = r[0]
        cursor.execute("SELECT person_name FROM expense_splits WHERE expense_id = ?", (exp_id,))
        split_with = [row[0] for row in cursor.fetchall()]
        
        expenses.append({
            "id": exp_id, "description": r[1], "amount": r[2], 
            "main_cat": r[3], "sub_cat": r[4], "timestamp": r[5], "paid_by": r[6],
            "split_with": split_with
        })
    
    cursor.execute("SELECT main_cat, subs_csv FROM categories")
    categories = [{"mainCat": r[0], "subs": r[1].split(',') if r[1] else []} for r in cursor.fetchall()]
    
    conn.close()
    return jsonify({"expenses": expenses, "categories": categories})

@app.route('/api/expense/add', methods=['POST'])
def add_expense():
    data = request.get_json() or {}
    trip_id = data.get('trip_id', 1)
    split_with = data.get('splitWith', [])
    
    if not split_with:
        split_with = ["me"]
        
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    cursor.execute("""
        INSERT INTO expenses (description, amount, main_cat, sub_cat, timestamp, paid_by, trip_id) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (data['desc'], float(data['amount']), data['mainCat'], data['subCat'], data['timestamp'], data['paidBy'], trip_id))
    
    expense_id = cursor.lastrowid
    
    for name in split_with:
        cursor.execute("INSERT INTO expense_splits (expense_id, person_name) VALUES (?, ?)", (expense_id, name))
        
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route('/api/expense/delete', methods=['POST'])
def delete_expense():
    data = request.get_json() or {}
    exp_id = data.get('id')
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM expense_splits WHERE expense_id = ?", (exp_id,))
    cursor.execute("DELETE FROM expenses WHERE id = ?", (exp_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route('/api/category/add_main', methods=['POST'])
def add_main_cat():
    data = request.get_json() or {}
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO categories (main_cat, subs_csv) VALUES (?, ?)", (data['mainCat'], ''))
        conn.commit()
    except sqlite3.IntegrityError:
        pass
    conn.close()
    return jsonify({"success": True})

@app.route('/api/category/add_sub', methods=['POST'])
def add_sub_cat():
    data = request.get_json() or {}
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT subs_csv FROM categories WHERE main_cat = ?", (data['mainCat'],))
    row = cursor.fetchone()
    if row:
        current_subs = row[0].split(',') if row[0] else []
        if data['subCat'] not in current_subs:
            current_subs.append(data['subCat'])
            new_csv = ','.join(current_subs)
            cursor.execute("UPDATE categories SET subs_csv = ? WHERE main_cat = ?", (new_csv, data['mainCat']))
            conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route('/api/clear', methods=['POST'])
def clear_all():
    trip_id = request.get_json().get('trip_id')
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    if trip_id:
        cursor.execute("DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE trip_id = ?)", (trip_id,))
        cursor.execute("DELETE FROM expenses WHERE trip_id = ?", (trip_id,))
    else:
        cursor.execute("DELETE FROM expense_splits")
        cursor.execute("DELETE FROM expenses")
    conn.commit()
    conn.close()
    return jsonify({"success": True})

# Ensure the DB runs its setup script if executed directly
init_db()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
