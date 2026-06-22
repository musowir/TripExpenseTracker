"""
Migration v3 — Add from_person / to_person to pre_allocations_settlements
==========================================================================
Run once against an existing tracker.db that was created before this change.

Usage:
    python migrate_v3.py [path/to/tracker.db]

If no path is given, looks for tracker.db in the same directory as this script.
"""

import os
import sys
import sqlite3
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("migrate_v3")


def run_migration(db_path: str) -> None:
    if not os.path.exists(db_path):
        log.error("Database not found: %s", db_path)
        sys.exit(1)

    log.info("Opening database: %s", db_path)
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")

    with con:
        cur = con.cursor()

        # 1. Check the table exists at all
        cur.execute("""
            SELECT name FROM sqlite_master
            WHERE type='table' AND name='pre_allocations_settlements'
        """)
        if not cur.fetchone():
            log.warning("Table pre_allocations_settlements does not exist — nothing to migrate.")
            return

        # 2. Introspect existing columns
        cur.execute("PRAGMA table_info(pre_allocations_settlements)")
        existing_cols = {row["name"] for row in cur.fetchall()}
        log.info("Existing columns: %s", sorted(existing_cols))

        # 3. Add from_person if missing
        if "from_person" not in existing_cols:
            log.info("Adding column: from_person")
            con.execute("""
                ALTER TABLE pre_allocations_settlements
                ADD COLUMN from_person TEXT DEFAULT NULL
                CHECK(from_person IS NULL OR length(from_person) <= 80)
            """)
        else:
            log.info("Column from_person already exists — skipping.")

        # 4. Add to_person if missing
        if "to_person" not in existing_cols:
            log.info("Adding column: to_person")
            con.execute("""
                ALTER TABLE pre_allocations_settlements
                ADD COLUMN to_person TEXT DEFAULT NULL
                CHECK(to_person IS NULL OR length(to_person) <= 80)
            """)
        else:
            log.info("Column to_person already exists — skipping.")

        # 5. Back-fill legacy rows:
        #    person_name was the "from" side in all historical records.
        result = con.execute("""
            UPDATE pre_allocations_settlements
               SET from_person = person_name
             WHERE from_person IS NULL
        """)
        log.info("Back-filled from_person for %d row(s).", result.rowcount)

        # 6. Verify
        cur.execute("SELECT COUNT(*) as total FROM pre_allocations_settlements")
        total = cur.fetchone()["total"]
        cur.execute("""
            SELECT COUNT(*) as missing
              FROM pre_allocations_settlements
             WHERE from_person IS NULL
        """)
        missing = cur.fetchone()["missing"]

        if missing:
            log.error("%d row(s) still have NULL from_person — investigate manually.", missing)
            sys.exit(1)

        log.info("Migration complete. %d total row(s), 0 with NULL from_person.", total)


if __name__ == "__main__":
    base = os.path.dirname(os.path.abspath(__file__))
    db_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(base, "tracker.db")
    run_migration(db_path)

