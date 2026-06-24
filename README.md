# 🧾 Expense Tracker

A mobile-first group expense tracking web app for trips. Log shared costs, split bills among participants, track budgets, and generate PDF/JSON reports — all backed by a lightweight Flask + SQLite server.

---

## Features

- **Multi-trip support** — create and switch between separate trips, each with its own members, currency, and budget
- **Group expense splitting** — log who paid and divide costs among any subset of trip members
- **Settlement optimisation** — calculates the minimum number of transfers to settle debts within the group
- **Budget tracking** — set a trip budget and watch a live progress bar as you spend
- **Analytics** — daily spend breakdown, category metrics, and per-person totals
- **Custom categories** — add or remove main categories and sub-categories
- **Export** — download a full JSON snapshot or save a formatted PDF report
- **PWA-ready** — service worker registration and `manifest.json` support for home-screen install
- **Security-hardened backend** — rate limiting, input validation, and strict CSP headers

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML / CSS / JavaScript (no framework) |
| Backend | Python 3, Flask |
| Database | SQLite (WAL mode, foreign keys enabled) |
| Styling | Custom CSS with CSS variables |

---

## Project Structure

```
.
├── index.html                      # Single-page app shell (all views)
├── server.py                       # Flask REST API + SQLite database layer
├── migrate.py    # One-time DB migration script
├── assets/
│   ├── css/
│   │   └── style.css               # All styles and theme variables
│   └── js/
│       └── tracker.js              # Client-side logic, API calls, UI rendering
├── manifest.json                   # PWA manifest
├── sw.js                           # Service worker (offline support)
├── icon.png                        # App icon
└── tracker.db                      # SQLite database (auto-created on first run)
```

---

## Getting Started

### Prerequisites

- Python 3.9+
- pip

### Installation

```bash
# Clone the repository
git clone https://github.com/musowir/TripExpenseTracker.git
cd TripExpenseTracker

# Install dependencies
pip install flask

# Start the server
python server.py
```

The app will be available at **http://127.0.0.1:5000**.

The SQLite database (`tracker.db`) is created automatically on first launch, pre-seeded with a default trip and common expense categories.

### Migrating an existing database

If you have a `tracker.db` from a previous version (which may contain fund advance records), run the migration script once before starting the server:

```bash
python3 migrate.py path/to/tracker.db
```

This will remove all fund advance (`pre_allocation`) rows, clean up the virtual `System` person from trip members, and recreate the settlements table with the updated schema. A timestamped backup of the original DB is created automatically before any changes are made.

---

## API Reference

All endpoints are prefixed with `/api/`. Write operations use `POST` with a JSON body; reads use `GET`.

### Trips

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/trips` | List all trips |
| POST | `/api/trips/add` | Create a new trip |
| POST | `/api/trips/update` | Rename a trip or update currency/budget |
| POST | `/api/trips/delete` | Delete a trip and all its data |

### People

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/people?trip_id=` | List members for a trip |
| POST | `/api/people/add` | Add a member |
| POST | `/api/people/delete` | Soft-remove a member (historical data preserved) |

### Expenses

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/data?trip_id=` | Fetch all expenses, categories, and trip meta |
| POST | `/api/expense/add` | Log a new expense |
| POST | `/api/expense/edit` | Update an existing expense |
| POST | `/api/expense/delete` | Delete an expense |

### Settlements

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/pre-allocation-settlement/add` | Record a settlement between two members |
| POST | `/api/pre-allocation-settlement/delete` | Remove a settlement record |

### Categories

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/category/add_main` | Add a main category |
| POST | `/api/category/delete_main` | Delete a main category (blocked if in use) |
| POST | `/api/category/add_sub` | Add a sub-category |
| POST | `/api/category/delete_sub` | Delete a sub-category (blocked if in use) |

### Analytics & Utilities

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/analytics/daily?trip_id=` | Daily spend totals |
| POST | `/api/clear` | Wipe all expense logs for a trip |

---

## Supported Currencies

INR · USD · EUR · AED · GBP · SGD · AUD · JPY · CAD · THB

---

## Default Categories

The database is seeded with these categories on first run:

- **Food & Drinks** — Cafe, Restaurant, Groceries, Street Food
- **Transport** — Flights, Train, Uber/Cab, Auto, Fuel, Metro
- **Stays** — Hotel, Airbnb, Hostel
- **Entertainment** — Tickets, Shopping, Sightseeing, Activities
- **Health** — Pharmacy, Hospital, Insurance
- **Misc** — Tips, Gifts, Other

All categories are fully editable from the Setup tab.

---

## Security

- Rate limiting: 120 requests per IP per 60-second window
- Input validation on both client and server (name length, amount range, timestamp format)
- HTTP security headers: `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`, `Permissions-Policy`, `Referrer-Policy`
- SQLite foreign key constraints and `CHECK` constraints enforce data integrity
- No external CDN dependencies at runtime (scripts served from `self`)

---

## License

MIT
