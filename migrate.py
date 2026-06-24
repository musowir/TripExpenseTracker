#!/usr/bin/env python3
"""
migrate_remove_prefunding.py
────────────────────────────
One-time migration: removes all prefunding (fund advance) data and
tightens the DB schema now that the feature is held.

What this does:
  1. Deletes all pre_allocation rows from pre_allocations_settlements.
  2. Removes 'System' person rows from trip_people (injected by old code).
  3. Recreates pre_allocations_settlements with a clean schema:
       - Drops legacy `person_name` column
       - from_person / to_person are now NOT NULL
       - CHECK constraint on `type` tightened to only 'settle_up'
  4. Leaves all expenses, trips, categories, and settle_up rows untouched.

Usage:
    python3 migrate_remove_prefunding.py [path/to/tracker.db]

Default DB path is ./tracker.db (same directory as the script).
"""

import os
import sys
import shutil
import sqlite3
from datetime import datetime

DB_PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "tracker.db")

if not os.path.exists(DB_PATH):
    print(f"[ERROR] DB not found: {DB_PATH}")
    sys.exit(1)

# ── Backup first ──────────────────────────────────────────────────────────────
ts     = datetime.now().strftime("%Y%m%d_%H%M%S")
backup = DB_PATH + f".backup_{ts}"
shutil.copy2(DB_PATH, backup)
print(f"[backup]  {backup}")

# ── Migrate ───────────────────────────────────────────────────────────────────
con = sqlite3.connect(DB_PATH)
con.execute("PRAGMA journal_mode=WAL")
con.execute("PRAGMA foreign_keys=OFF")   # off during table recreation

try:
    c = con.cursor()

    # ── 1. Delete all pre_allocation rows ─────────────────────────────────────
    c.execute("SELECT COUNT(*) FROM pre_allocations_settlements WHERE type='pre_allocation'")
    n_pre = c.fetchone()[0]
    c.execute("DELETE FROM pre_allocations_settlements WHERE type='pre_allocation'")
    print(f"[deleted] {n_pre} pre_allocation row(s)")

    # ── 2. Remove 'System' person rows injected by old JS ─────────────────────
    c.execute("SELECT COUNT(*) FROM trip_people WHERE name='System'")
    n_sys = c.fetchone()[0]
    c.execute("DELETE FROM trip_people WHERE name='System'")
    print(f"[deleted] {n_sys} 'System' trip_people row(s)")

    # ── 3. Recreate pre_allocations_settlements with clean schema ─────────────
    #
    # Old schema had:
    #   person_name TEXT NOT NULL   ← legacy alias for from_person, now redundant
    #   type CHECK IN ('pre_allocation','settle_up')
    #   from_person / to_person nullable
    #
    # New schema:
    #   person_name removed
    #   type CHECK IN ('settle_up') only
    #   from_person / to_person NOT NULL

    c.execute("""
        CREATE TABLE pre_allocations_settlements_new (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id     INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
            amount      REAL    NOT NULL CHECK(amount > 0 AND amount <= 10000000),
            type        TEXT    NOT NULL CHECK(type IN ('settle_up')),
            timestamp   TEXT    NOT NULL,
            created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
            notes       TEXT    DEFAULT NULL CHECK(length(notes) <= 255),
            from_person TEXT    NOT NULL CHECK(length(from_person) <= 80),
            to_person   TEXT    NOT NULL CHECK(length(to_person)   <= 80)
        )
    """)

    # Copy surviving settle_up rows (from_person / to_person must be non-null;
    # any edge-case rows missing them are skipped with a warning)
    c.execute("""
        INSERT INTO pre_allocations_settlements_new
               (id, trip_id, amount, type, timestamp, created_at, notes, from_person, to_person)
        SELECT  id, trip_id, amount, type, timestamp, created_at, notes,
                COALESCE(from_person, person_name),   -- fall back for very old rows
                to_person
        FROM pre_allocations_settlements
        WHERE type = 'settle_up'
          AND to_person IS NOT NULL
          AND COALESCE(from_person, person_name) IS NOT NULL
    """)

    c.execute("SELECT COUNT(*) FROM pre_allocations_settlements_new")
    n_kept = c.fetchone()[0]

    # Check for any rows that couldn't be migrated
    c.execute("""
        SELECT COUNT(*) FROM pre_allocations_settlements
        WHERE type = 'settle_up'
          AND (to_person IS NULL OR COALESCE(from_person, person_name) IS NULL)
    """)
    n_skipped = c.fetchone()[0]
    if n_skipped:
        print(f"[warning] {n_skipped} settle_up row(s) had NULL from/to and were SKIPPED")

    c.execute("DROP TABLE pre_allocations_settlements")
    c.execute("ALTER TABLE pre_allocations_settlements_new RENAME TO pre_allocations_settlements")

    # Recreate the index
    c.execute("""
        CREATE INDEX IF NOT EXISTS idx_pas_trip_id
        ON pre_allocations_settlements(trip_id)
    """)

    print(f"[kept]    {n_kept} settle_up row(s) migrated to clean schema")

    con.commit()
    print("[done]    Migration complete. Original DB backed up at:")
    print(f"          {backup}")

except Exception as e:
    con.rollback()
    print(f"[ERROR]   Migration failed, rolled back. Reason: {e}")
    print(f"          Your original DB is untouched (backup also at {backup})")
    sys.exit(1)

finally:
    con.execute("PRAGMA foreign_keys=ON")
    con.close()

