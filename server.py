import os
import re
import json
import logging
import sqlite3
import time
from collections import defaultdict
from functools import wraps
from flask import Flask, jsonify, request, send_from_directory, make_response, g

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("tracker")

app = Flask(__name__)

BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
DB_FILE      = os.path.join(BASE_DIR, "tracker.db")
MAX_NAME_LEN = 80
MAX_DESC_LEN = 255
MAX_AMOUNT   = 10_000_000
RATE_LIMIT   = 120
RATE_WINDOW  = 60

SUPPORTED_CURRENCIES = {"INR", "USD", "EUR", "AED", "GBP", "SGD", "AUD", "JPY", "CAD", "THB"}

# ── Security headers ──────────────────────────────────────────────────────
@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"]   = "nosniff"
    response.headers["X-Frame-Options"]           = "DENY"
    response.headers["Referrer-Policy"]           = "same-origin"
    response.headers["Permissions-Policy"]        = "geolocation=(), camera=(), microphone=()"
    response.headers["Cache-Control"]             = "no-store"
    response.headers["Content-Security-Policy"]  = (
        "default-src 'self'; "
        "script-src 'self' https://cdnjs.cloudflare.com; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "object-src 'none'; "
        "base-uri 'self';"
    )
    return response

# ── Rate limiter ──────────────────────────────────────────────────────────
_rate_store: dict[str, list] = defaultdict(list)

def rate_limited(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        ip  = request.remote_addr or "unknown"
        now = time.monotonic()
        _rate_store[ip] = [t for t in _rate_store[ip] if now - t < RATE_WINDOW]
        if len(_rate_store[ip]) >= RATE_LIMIT:
            return jsonify({"error": "Too many requests. Slow down."}), 429
        _rate_store[ip].append(now)
        return f(*args, **kwargs)
    return wrapper

# ── Validation ────────────────────────────────────────────────────────────
_SAFE_NAME = re.compile(r"^[\w\s\-'\.,&\(\)/]{1,80}$")

def valid_name(v) -> bool:
    return bool(v and isinstance(v, str) and _SAFE_NAME.match(v.strip()))

def valid_amount(v) -> bool:
    try:
        f = float(v)
        return 0 < f <= MAX_AMOUNT
    except (TypeError, ValueError):
        return False

def valid_timestamp(v) -> bool:
    return bool(v and isinstance(v, str) and re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", v))

def valid_id(v) -> bool:
    try:
        return int(v) > 0
    except (TypeError, ValueError):
        return False

def valid_currency(v) -> bool:
    return isinstance(v, str) and v.upper() in SUPPORTED_CURRENCIES

# ── DB ────────────────────────────────────────────────────────────────────
def get_db() -> sqlite3.Connection:
    if "db" not in g:
        con = sqlite3.connect(DB_FILE)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("PRAGMA foreign_keys=ON")
        con.execute("PRAGMA busy_timeout=5000")
        g.db = con
    return g.db

@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()

def init_db():
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        c = conn.cursor()

        c.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                main_cat TEXT PRIMARY KEY CHECK(length(main_cat) <= 80),
                subs_csv TEXT NOT NULL DEFAULT ''
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS trips (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL UNIQUE CHECK(length(name) <= 80),
                currency    TEXT NOT NULL DEFAULT 'INR',
                budget      REAL DEFAULT NULL,
                created_at  TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        c.execute("SELECT COUNT(*) FROM categories")
        if c.fetchone()[0] == 0:
            c.executemany("INSERT INTO categories (main_cat, subs_csv) VALUES (?, ?)", [
                ("Food & Drinks", "Cafe,Restaurant,Groceries,Street Food"),
                ("Transport",     "Flights,Train,Uber/Cab,Auto,Fuel,Metro"),
                ("Stays",         "Hotel,Airbnb,Hostel"),
                ("Entertainment", "Tickets,Shopping,Sightseeing,Activities"),
                ("Health",        "Pharmacy,Hospital,Insurance"),
                ("Misc",          "Tips,Gifts,Other"),
            ])

        c.execute("SELECT COUNT(*) FROM trips")
        if c.fetchone()[0] == 0:
            c.execute("INSERT INTO trips (name, currency) VALUES ('ChaloMumbai', 'INR')")
            trip_id = c.lastrowid
        else:
            c.execute("SELECT id FROM trips LIMIT 1")
            trip_id = c.fetchone()[0]

        c.execute("""
            CREATE TABLE IF NOT EXISTS trip_people (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                trip_id    INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                name       TEXT NOT NULL CHECK(length(name) <= 80),
                is_active  INTEGER NOT NULL DEFAULT 1,
                UNIQUE(trip_id, name)
            )
        """)

        c.execute("SELECT COUNT(*) FROM trip_people WHERE trip_id=? AND name='me'", (trip_id,))
        if c.fetchone()[0] == 0:
            c.execute("INSERT INTO trip_people (trip_id, name) VALUES (?, 'me')", (trip_id,))

        c.execute("""
            CREATE TABLE IF NOT EXISTS expenses (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                description TEXT NOT NULL CHECK(length(description) <= 255),
                amount      REAL NOT NULL CHECK(amount > 0 AND amount <= 10000000),
                main_cat    TEXT NOT NULL CHECK(length(main_cat) <= 80),
                sub_cat     TEXT NOT NULL CHECK(length(sub_cat) <= 80),
                timestamp   TEXT NOT NULL,
                paid_by     TEXT NOT NULL CHECK(length(paid_by) <= 80),
                trip_id     INTEGER NOT NULL DEFAULT 1 REFERENCES trips(id) ON DELETE CASCADE
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS expense_splits (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                expense_id  INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
                person_name TEXT NOT NULL CHECK(length(person_name) <= 80)
            )
        """)

        # Add new columns to existing tables if upgrading
        for col, defn in [
            ("currency",   "TEXT NOT NULL DEFAULT 'INR'"),
            ("budget",     "REAL DEFAULT NULL"),
            ("created_at", "TEXT NOT NULL DEFAULT (datetime('now'))"),
        ]:
            try:
                conn.execute(f"ALTER TABLE trips ADD COLUMN {col} {defn}")
            except sqlite3.OperationalError:
                pass  # column already exists

        try:
            conn.execute("ALTER TABLE trip_people ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")
        except sqlite3.OperationalError:
            pass
        
        # Create pre-allocations and settlements table (v2 migration)
        c.execute("""
            CREATE TABLE IF NOT EXISTS pre_allocations_settlements (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                trip_id     INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                person_name TEXT NOT NULL CHECK(length(person_name) <= 80),
                amount      REAL NOT NULL CHECK(amount > 0 AND amount <= 10000000),
                type        TEXT NOT NULL CHECK(type IN ('pre_allocation', 'settle_up')),
                timestamp   TEXT NOT NULL,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                notes       TEXT DEFAULT NULL CHECK(length(notes) <= 255),
                from_person TEXT DEFAULT NULL CHECK(from_person IS NULL OR length(from_person) <= 80),
                to_person   TEXT DEFAULT NULL CHECK(to_person IS NULL OR length(to_person) <= 80)
            )
        """)

        # v3 migration: add from_person / to_person columns if upgrading from older schema
        for col, defn in [
            ("from_person", "TEXT DEFAULT NULL CHECK(from_person IS NULL OR length(from_person) <= 80)"),
            ("to_person",   "TEXT DEFAULT NULL CHECK(to_person IS NULL OR length(to_person) <= 80)"),
        ]:
            try:
                conn.execute(f"ALTER TABLE pre_allocations_settlements ADD COLUMN {col} {defn}")
            except sqlite3.OperationalError:
                pass  # column already exists

        # Back-fill legacy rows: person_name was the "from" side for both types
        conn.execute("""
            UPDATE pre_allocations_settlements
               SET from_person = person_name
             WHERE from_person IS NULL
        """)

        try:
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_pas_trip_id 
                ON pre_allocations_settlements(trip_id)
            """)
        except sqlite3.OperationalError:
            pass

        conn.commit()
    log.info("Database ready: %s", DB_FILE)

# ── Static ────────────────────────────────────────────────────────────────
@app.route("/")
def serve_index():
    return send_from_directory(BASE_DIR, "index.html")

@app.route("/assets/<path:path>")
def serve_assets(path):
    safe = os.path.normpath(path)
    if safe.startswith(".."):
        return jsonify({"error": "Forbidden"}), 403
    return send_from_directory(os.path.join(BASE_DIR, "assets"), safe)

@app.route("/manifest.json")
def serve_manifest():
    return send_from_directory(BASE_DIR, "manifest.json", mimetype="application/json")

@app.route("/sw.js")
def serve_sw():
    resp = make_response(send_from_directory(BASE_DIR, "sw.js"))
    resp.headers["Content-Type"]           = "application/javascript"
    resp.headers["Service-Worker-Allowed"] = "/"
    return resp

@app.route("/icon.png")
def serve_icon():
    return send_from_directory(BASE_DIR, "icon.png", mimetype="image/png")

# ── Trip routes ───────────────────────────────────────────────────────────
@app.route("/api/trips", methods=["GET"])
@rate_limited
def get_trips():
    db   = get_db()
    rows = db.execute("SELECT id, name, currency, budget, created_at FROM trips ORDER BY id").fetchall()
    result = []
    for r in rows:
        total = db.execute(
            "SELECT COALESCE(SUM(amount),0) FROM expenses WHERE trip_id=?", (r["id"],)
        ).fetchone()[0]
        result.append({
            "id": r["id"], "name": r["name"],
            "currency": r["currency"], "budget": r["budget"],
            "created_at": r["created_at"], "total_spend": total,
        })
    return jsonify(result)

@app.route("/api/trips/add", methods=["POST"])
@rate_limited
def add_trip():
    data     = request.get_json(silent=True) or {}
    name     = str(data.get("name", "")).strip()
    currency = str(data.get("currency", "INR")).strip().upper()
    budget   = data.get("budget")

    if not valid_name(name):
        return jsonify({"error": "Invalid trip name (1–80 characters)."}), 400
    if not valid_currency(currency):
        return jsonify({"error": f"Unsupported currency. Choose from: {', '.join(sorted(SUPPORTED_CURRENCIES))}."}), 400
    if budget is not None and not valid_amount(budget):
        return jsonify({"error": "Invalid budget amount."}), 400

    try:
        db  = get_db()
        cur = db.execute(
            "INSERT INTO trips (name, currency, budget) VALUES (?, ?, ?)",
            (name, currency, float(budget) if budget else None)
        )
        new_id = cur.lastrowid
        db.execute("INSERT INTO trip_people (trip_id, name) VALUES (?, 'me')", (new_id,))
        db.commit()
        return jsonify({"success": True, "id": new_id})
    except sqlite3.IntegrityError:
        return jsonify({"error": "Trip name already exists."}), 409

@app.route("/api/trips/update", methods=["POST"])
@rate_limited
def update_trip():
    data     = request.get_json(silent=True) or {}
    trip_id  = data.get("id")
    name     = str(data.get("name", "")).strip()
    currency = str(data.get("currency", "INR")).strip().upper()
    budget   = data.get("budget")

    if not valid_id(trip_id):
        return jsonify({"error": "Invalid id."}), 400
    if not valid_name(name):
        return jsonify({"error": "Invalid trip name."}), 400
    if not valid_currency(currency):
        return jsonify({"error": "Unsupported currency."}), 400
    if budget is not None and budget != "" and not valid_amount(budget):
        return jsonify({"error": "Invalid budget."}), 400

    db = get_db()
    db.execute(
        "UPDATE trips SET name=?, currency=?, budget=? WHERE id=?",
        (name, currency, float(budget) if budget else None, int(trip_id))
    )
    db.commit()
    return jsonify({"success": True})

@app.route("/api/trips/delete", methods=["POST"])
@rate_limited
def delete_trip():
    data    = request.get_json(silent=True) or {}
    trip_id = data.get("id")
    if not valid_id(trip_id):
        return jsonify({"error": "Invalid id."}), 400
    db    = get_db()
    count = db.execute("SELECT COUNT(*) FROM trips").fetchone()[0]
    if count <= 1:
        return jsonify({"error": "Cannot delete the only remaining trip."}), 400
    db.execute("DELETE FROM trips WHERE id=?", (int(trip_id),))
    db.commit()
    return jsonify({"success": True})

# ── People routes ─────────────────────────────────────────────────────────
@app.route("/api/people", methods=["GET"])
@rate_limited
def get_people():
    trip_id     = request.args.get("trip_id", type=int)
    include_all = request.args.get("include_inactive", "0") == "1"
    if not trip_id or not valid_id(trip_id):
        return jsonify([])
    db  = get_db()
    sql = "SELECT id, name, is_active FROM trip_people WHERE trip_id=?"
    if not include_all:
        sql += " AND is_active=1"
    sql += " ORDER BY name"
    rows   = db.execute(sql, (trip_id,)).fetchall()
    people = [dict(r) for r in rows]
    if not any(p["name"] == "me" for p in people):
        people.insert(0, {"id": 0, "name": "me", "is_active": 1})
    return jsonify(people)

@app.route("/api/people/add", methods=["POST"])
@rate_limited
def add_person():
    data    = request.get_json(silent=True) or {}
    trip_id = data.get("trip_id")
    name    = str(data.get("name", "")).strip()
    if not valid_id(trip_id):
        return jsonify({"error": "Invalid trip_id."}), 400
    if not valid_name(name):
        return jsonify({"error": "Invalid name."}), 400
    if name.lower() == "me":
        return jsonify({"error": "'me' is reserved."}), 400
    try:
        db = get_db()
        # If soft-deleted previously, reactivate instead of inserting
        existing = db.execute(
            "SELECT id, is_active FROM trip_people WHERE trip_id=? AND name=?",
            (int(trip_id), name)
        ).fetchone()
        if existing:
            if existing["is_active"]:
                return jsonify({"error": "Already registered."}), 409
            db.execute("UPDATE trip_people SET is_active=1 WHERE id=?", (existing["id"],))
        else:
            db.execute("INSERT INTO trip_people (trip_id, name) VALUES (?, ?)", (int(trip_id), name))
        db.commit()
        return jsonify({"success": True})
    except sqlite3.IntegrityError:
        return jsonify({"error": "Already registered."}), 409

@app.route("/api/people/delete", methods=["POST"])
@rate_limited
def delete_person():
    """Soft-delete: marks inactive, preserves historical expense references.
    Blocked if the person has any expense history (paid or split) on this trip,
    so balances/settlements never silently lose a participant."""
    data      = request.get_json(silent=True) or {}
    person_id = data.get("id")
    if not valid_id(person_id):
        return jsonify({"error": "Invalid id."}), 400
    db = get_db()
    row = db.execute("SELECT name, trip_id FROM trip_people WHERE id=?", (int(person_id),)).fetchone()
    if not row:
        return jsonify({"error": "Person not found."}), 404
    if row["name"] == "me":
        return jsonify({"error": "'me' cannot be removed."}), 400

    name, trip_id = row["name"], row["trip_id"]
    has_spend = db.execute(
        "SELECT 1 FROM expenses WHERE trip_id=? AND paid_by=? LIMIT 1",
        (trip_id, name)
    ).fetchone()
    has_split = db.execute(
        "SELECT 1 FROM expense_splits es JOIN expenses e ON e.id = es.expense_id "
        "WHERE e.trip_id=? AND es.person_name=? LIMIT 1",
        (trip_id, name)
    ).fetchone()
    if has_spend or has_split:
        return jsonify({
            "error": f"\"{name}\" has expense history on this trip (paid for or was part of a split). "
                     "Remove or reassign those entries first, or just leave them as an inactive member."
        }), 409

    db.execute("UPDATE trip_people SET is_active=0 WHERE id=?", (int(person_id),))
    db.commit()
    return jsonify({"success": True})

# ── Expense routes ────────────────────────────────────────────────────────
@app.route("/api/data", methods=["GET"])
@rate_limited
def get_data():
    trip_id = request.args.get("trip_id", type=int)
    db      = get_db()

    if trip_id and valid_id(trip_id):
        rows = db.execute(
            "SELECT id, description, amount, main_cat, sub_cat, timestamp, paid_by "
            "FROM expenses WHERE trip_id=? ORDER BY timestamp DESC", (trip_id,)
        ).fetchall()
        trip_row = db.execute(
            "SELECT currency, budget FROM trips WHERE id=?", (trip_id,)
        ).fetchone()
        currency = trip_row["currency"] if trip_row else "INR"
        budget   = trip_row["budget"]   if trip_row else None
        
        # Fetch pre-allocations and settlements
        prealloc_rows = db.execute(
            "SELECT id, person_name, amount, type, timestamp, notes, from_person, to_person "
            "FROM pre_allocations_settlements WHERE trip_id=? ORDER BY timestamp DESC",
            (trip_id,)
        ).fetchall()
    else:
        rows     = db.execute(
            "SELECT id, description, amount, main_cat, sub_cat, timestamp, paid_by "
            "FROM expenses ORDER BY timestamp DESC"
        ).fetchall()
        prealloc_rows = db.execute(
            "SELECT id, person_name, amount, type, timestamp, notes, from_person, to_person "
            "FROM pre_allocations_settlements ORDER BY timestamp DESC"
        ).fetchall()
        currency = "INR"
        budget   = None

    expenses = []
    for r in rows:
        splits = db.execute(
            "SELECT person_name FROM expense_splits WHERE expense_id=?", (r["id"],)
        ).fetchall()
        expenses.append({
            "id": r["id"], "description": r["description"], "amount": r["amount"],
            "main_cat": r["main_cat"], "sub_cat": r["sub_cat"],
            "timestamp": r["timestamp"], "paid_by": r["paid_by"],
            "split_with": [s["person_name"] for s in splits],
        })

    # Format pre-allocations and settlements
    prealloc_settlements = [
        {
            "id":          r["id"],
            "person_name": r["person_name"],
            "from_person": r["from_person"] or r["person_name"],  # fall back to person_name for legacy rows
            "to_person":   r["to_person"],
            "amount":      r["amount"],
            "type":        r["type"],
            "timestamp":   r["timestamp"],
            "notes":       r["notes"],
        }
        for r in prealloc_rows
    ]

    cat_rows   = db.execute("SELECT main_cat, subs_csv FROM categories ORDER BY main_cat").fetchall()
    categories = [
        {"mainCat": r["main_cat"], "subs": [s for s in r["subs_csv"].split(",") if s]}
        for r in cat_rows
    ]

    return jsonify({
        "expenses": expenses, "categories": categories,
        "currency": currency, "budget": budget,
        "preAllocationSettlements": prealloc_settlements,
    })

@app.route("/api/expense/add", methods=["POST"])
@rate_limited
def add_expense():
    data       = request.get_json(silent=True) or {}
    trip_id    = data.get("trip_id", 1)
    desc       = str(data.get("desc",      "")).strip()
    amount     = data.get("amount")
    main_cat   = str(data.get("mainCat",   "")).strip()
    sub_cat    = str(data.get("subCat",    "")).strip()
    timestamp  = str(data.get("timestamp", "")).strip()
    paid_by    = str(data.get("paidBy",    "")).strip()
    split_with = data.get("splitWith", [])

    if not valid_id(trip_id):        return jsonify({"error": "Invalid trip_id."}), 400
    if not desc or len(desc) > MAX_DESC_LEN:
        return jsonify({"error": f"Description must be 1–{MAX_DESC_LEN} chars."}), 400
    if not valid_amount(amount):     return jsonify({"error": "Invalid amount."}), 400
    if not valid_name(main_cat):     return jsonify({"error": "Invalid category."}), 400
    if not valid_name(sub_cat):      return jsonify({"error": "Invalid sub-category."}), 400
    if not valid_timestamp(timestamp): return jsonify({"error": "Invalid timestamp."}), 400
    if not valid_name(paid_by):      return jsonify({"error": "Invalid payer."}), 400
    if not isinstance(split_with, list): return jsonify({"error": "splitWith must be array."}), 400

    clean_splits = [str(s).strip() for s in split_with if isinstance(s, str) and valid_name(str(s).strip())][:50]
    if not clean_splits:
        clean_splits = ["me"]

    try:
        db  = get_db()
        cur = db.execute(
            "INSERT INTO expenses (description, amount, main_cat, sub_cat, timestamp, paid_by, trip_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (desc, float(amount), main_cat, sub_cat, timestamp, paid_by, int(trip_id))
        )
        exp_id = cur.lastrowid
        db.executemany(
            "INSERT INTO expense_splits (expense_id, person_name) VALUES (?, ?)",
            [(exp_id, n) for n in clean_splits]
        )
        db.commit()
        return jsonify({"success": True, "id": exp_id})
    except sqlite3.IntegrityError as e:
        log.warning("add_expense error: %s", e)
        return jsonify({"error": "Database error."}), 409

@app.route("/api/expense/edit", methods=["POST"])
@rate_limited
def edit_expense():
    data       = request.get_json(silent=True) or {}
    exp_id     = data.get("id")
    desc       = str(data.get("desc",      "")).strip()
    amount     = data.get("amount")
    main_cat   = str(data.get("mainCat",   "")).strip()
    sub_cat    = str(data.get("subCat",    "")).strip()
    timestamp  = str(data.get("timestamp", "")).strip()
    paid_by    = str(data.get("paidBy",    "")).strip()
    split_with = data.get("splitWith", [])

    if not valid_id(exp_id):         return jsonify({"error": "Invalid id."}), 400
    if not desc or len(desc) > MAX_DESC_LEN:
        return jsonify({"error": "Invalid description."}), 400
    if not valid_amount(amount):     return jsonify({"error": "Invalid amount."}), 400
    if not valid_name(main_cat):     return jsonify({"error": "Invalid category."}), 400
    if not valid_name(sub_cat):      return jsonify({"error": "Invalid sub-category."}), 400
    if not valid_timestamp(timestamp): return jsonify({"error": "Invalid timestamp."}), 400
    if not valid_name(paid_by):      return jsonify({"error": "Invalid payer."}), 400

    clean_splits = [str(s).strip() for s in split_with if isinstance(s, str) and valid_name(str(s).strip())][:50]
    if not clean_splits:
        clean_splits = ["me"]

    db = get_db()
    db.execute(
        "UPDATE expenses SET description=?, amount=?, main_cat=?, sub_cat=?, timestamp=?, paid_by=? WHERE id=?",
        (desc, float(amount), main_cat, sub_cat, timestamp, paid_by, int(exp_id))
    )
    db.execute("DELETE FROM expense_splits WHERE expense_id=?", (int(exp_id),))
    db.executemany(
        "INSERT INTO expense_splits (expense_id, person_name) VALUES (?, ?)",
        [(int(exp_id), n) for n in clean_splits]
    )
    db.commit()
    return jsonify({"success": True})

@app.route("/api/expense/delete", methods=["POST"])
@rate_limited
def delete_expense():
    data   = request.get_json(silent=True) or {}
    exp_id = data.get("id")
    if not valid_id(exp_id):
        return jsonify({"error": "Invalid id."}), 400
    db = get_db()
    db.execute("DELETE FROM expenses WHERE id=?", (int(exp_id),))
    db.commit()
    return jsonify({"success": True})

# ── Pre-allocation & Settlement routes ────────────────────────────────────────
@app.route("/api/pre-allocation-settlement/add", methods=["POST"])
@rate_limited
def add_pre_alloc_settlement():
    data        = request.get_json(silent=True) or {}
    trip_id     = data.get("trip_id")
    entry_type  = str(data.get("type", "")).strip()
    amount      = data.get("amount")
    timestamp   = str(data.get("timestamp", "")).strip()
    notes       = str(data.get("notes", "")).strip() if data.get("notes") else None

    # Support both old-style (personName) and new-style (from_person / to_person)
    from_person = str(data.get("from_person", data.get("personName", ""))).strip()
    to_person   = str(data.get("to_person",   "")).strip() or None

    # Validation
    if not valid_id(trip_id):
        return jsonify({"error": "Invalid trip_id."}), 400
    if entry_type not in ("pre_allocation", "settle_up"):
        return jsonify({"error": "Type must be 'pre_allocation' or 'settle_up'."}), 400
    if not valid_amount(amount):
        return jsonify({"error": "Invalid amount."}), 400
    if not valid_timestamp(timestamp):
        return jsonify({"error": "Invalid timestamp."}), 400
    if notes and len(notes) > MAX_DESC_LEN:
        return jsonify({"error": "Notes too long."}), 400
    if not from_person or not valid_name(from_person):
        return jsonify({"error": "Invalid from_person."}), 400

    # to_person is optional for pre_allocation but required for settle_up
    if entry_type == "settle_up":
        if not to_person or not valid_name(to_person):
            return jsonify({"error": "Invalid to_person for settlement."}), 400
        if from_person == to_person:
            return jsonify({"error": "from_person and to_person must differ."}), 400

    # person_name = the primary person involved (from_person for both types)
    person_name = from_person

    db = get_db()

    # Verify trip exists
    trip_row = db.execute("SELECT id FROM trips WHERE id=?", (int(trip_id),)).fetchone()
    if not trip_row:
        return jsonify({"error": "Trip not found."}), 404

    # For settle_up: verify both participants exist in the trip.
    # "System" is a virtual person — skip DB check for it.
    VIRTUAL = {"System"}

    people_to_check = [from_person]
    if to_person and to_person not in VIRTUAL:
        people_to_check.append(to_person)

    for name in people_to_check:
        if name in VIRTUAL:
            continue
        person = db.execute(
            "SELECT id FROM trip_people WHERE trip_id=? AND name=?",
            (int(trip_id), name)
        ).fetchone()
        if not person:
            return jsonify({"error": f"Person '{name}' not found in this trip."}), 404

    try:
        db.execute(
            """INSERT INTO pre_allocations_settlements
               (trip_id, person_name, amount, type, timestamp, notes, from_person, to_person)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (int(trip_id), person_name, float(amount), entry_type,
             timestamp, notes, from_person, to_person)
        )
        db.commit()
        return jsonify({"success": True})
    except sqlite3.IntegrityError as e:
        log.warning("add_pre_alloc_settlement error: %s", e)
        return jsonify({"error": "Database error."}), 409

@app.route("/api/pre-allocation-settlement/delete", methods=["POST"])
@rate_limited
def delete_pre_alloc_settlement():
    data = request.get_json(silent=True) or {}
    entry_id = data.get("id")
    
    if not valid_id(entry_id):
        return jsonify({"error": "Invalid id."}), 400
    
    db = get_db()
    db.execute("DELETE FROM pre_allocations_settlements WHERE id=?", (int(entry_id),))
    db.commit()
    return jsonify({"success": True})

# ── Category routes ───────────────────────────────────────────────────────
@app.route("/api/category/add_main", methods=["POST"])
@rate_limited
def add_main_cat():
    data     = request.get_json(silent=True) or {}
    main_cat = str(data.get("mainCat", "")).strip()
    if not valid_name(main_cat):
        return jsonify({"error": "Invalid category name."}), 400
    try:
        db = get_db()
        db.execute("INSERT INTO categories (main_cat, subs_csv) VALUES (?, '')", (main_cat,))
        db.commit()
    except sqlite3.IntegrityError:
        pass
    return jsonify({"success": True})

@app.route("/api/category/delete_main", methods=["POST"])
@rate_limited
def delete_main_cat():
    data     = request.get_json(silent=True) or {}
    main_cat = str(data.get("mainCat", "")).strip()
    if not valid_name(main_cat):
        return jsonify({"error": "Invalid category name."}), 400
    db = get_db()
    # Check if any expenses reference this category
    count = db.execute(
        "SELECT COUNT(*) FROM expenses WHERE main_cat=?", (main_cat,)
    ).fetchone()[0]
    if count > 0:
        return jsonify({
            "error": f"Cannot delete — {count} expense(s) use this category. "
                     "Reassign or delete those expenses first."
        }), 409
    db.execute("DELETE FROM categories WHERE main_cat=?", (main_cat,))
    db.commit()
    return jsonify({"success": True})

@app.route("/api/category/add_sub", methods=["POST"])
@rate_limited
def add_sub_cat():
    data     = request.get_json(silent=True) or {}
    main_cat = str(data.get("mainCat", "")).strip()
    sub_cat  = str(data.get("subCat",  "")).strip()
    if not valid_name(main_cat) or not valid_name(sub_cat):
        return jsonify({"error": "Invalid name."}), 400
    db  = get_db()
    row = db.execute("SELECT subs_csv FROM categories WHERE main_cat=?", (main_cat,)).fetchone()
    if not row:
        return jsonify({"error": "Main category not found."}), 404
    subs = [s for s in row["subs_csv"].split(",") if s]
    if sub_cat not in subs:
        subs.append(sub_cat)
        subs.sort()
        db.execute("UPDATE categories SET subs_csv=? WHERE main_cat=?", (",".join(subs), main_cat))
        db.commit()
    return jsonify({"success": True})

@app.route("/api/category/delete_sub", methods=["POST"])
@rate_limited
def delete_sub_cat():
    data     = request.get_json(silent=True) or {}
    main_cat = str(data.get("mainCat", "")).strip()
    sub_cat  = str(data.get("subCat",  "")).strip()
    if not valid_name(main_cat) or not valid_name(sub_cat):
        return jsonify({"error": "Invalid name."}), 400
    db  = get_db()
    # Check if any expenses reference this sub-category
    count = db.execute(
        "SELECT COUNT(*) FROM expenses WHERE main_cat=? AND sub_cat=?", (main_cat, sub_cat)
    ).fetchone()[0]
    if count > 0:
        return jsonify({
            "error": f"Cannot delete — {count} expense(s) use this sub-category."
        }), 409
    row = db.execute("SELECT subs_csv FROM categories WHERE main_cat=?", (main_cat,)).fetchone()
    if not row:
        return jsonify({"error": "Category not found."}), 404
    subs = [s for s in row["subs_csv"].split(",") if s and s != sub_cat]
    db.execute("UPDATE categories SET subs_csv=? WHERE main_cat=?", (",".join(subs), main_cat))
    db.commit()
    return jsonify({"success": True})

# ── Analytics route ───────────────────────────────────────────────────────
@app.route("/api/analytics/daily", methods=["GET"])
@rate_limited
def daily_analytics():
    trip_id = request.args.get("trip_id", type=int)
    if not trip_id or not valid_id(trip_id):
        return jsonify({"error": "Invalid trip_id."}), 400
    db   = get_db()
    rows = db.execute(
        "SELECT substr(timestamp,1,10) as day, SUM(amount) as total, COUNT(*) as count "
        "FROM expenses WHERE trip_id=? GROUP BY day ORDER BY day",
        (trip_id,)
    ).fetchall()
    days = [{"day": r["day"], "total": r["total"], "count": r["count"]} for r in rows]
    if not days:
        return jsonify({"days": [], "highest_day": None, "average_daily": 0})
    highest = max(days, key=lambda d: d["total"])
    average = sum(d["total"] for d in days) / len(days)
    return jsonify({"days": days, "highest_day": highest, "average_daily": round(average, 2)})

# ── Clear route ───────────────────────────────────────────────────────────
@app.route("/api/clear", methods=["POST"])
@rate_limited
def clear_all():
    data    = request.get_json(silent=True) or {}
    trip_id = data.get("trip_id")
    db      = get_db()
    if trip_id and valid_id(trip_id):
        db.execute("DELETE FROM expenses WHERE trip_id=?", (int(trip_id),))
    else:
        db.execute("DELETE FROM expense_splits")
        db.execute("DELETE FROM expenses")
    db.commit()
    return jsonify({"success": True})

# ── Error handlers ────────────────────────────────────────────────────────
@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found."}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed."}), 405

@app.errorhandler(500)
def internal_error(e):
    log.exception("Unhandled error")
    return jsonify({"error": "Internal server error."}), 500

# ── Boot ──────────────────────────────────────────────────────────────────
init_db()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
