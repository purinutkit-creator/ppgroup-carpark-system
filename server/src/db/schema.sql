-- Smart Parking Management System — central database schema (SQLite).
-- All timestamps are ISO-8601 UTC strings. Money is THB with 2 decimals.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- settings ---
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_by  INTEGER,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Versioned configuration for every settings module (design, lpr, validation,
-- ticket template, receipt template, kiosk, payment ...). Rollback = new version
-- whose data is a copy of an older one.
CREATE TABLE IF NOT EXISTS config_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  module        TEXT NOT NULL,
  version_no    INTEGER NOT NULL,
  data_json     TEXT NOT NULL,
  prev_json     TEXT,
  applied_to    TEXT,              -- JSON array of systems / targets
  note          TEXT,
  rolled_back_from INTEGER,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(module, version_no)
);

CREATE TABLE IF NOT EXISTS config_deliveries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id  INTEGER NOT NULL REFERENCES config_versions(id),
  client_id   TEXT NOT NULL,
  system      TEXT,
  device_id   INTEGER,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(version_id, client_id)
);

-- ------------------------------------------------------------ sites & gear ---
CREATE TABLE IF NOT EXISTS sites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  address     TEXT,
  tz_offset   INTEGER NOT NULL DEFAULT 420,
  capacity    INTEGER NOT NULL DEFAULT 0,
  settings_json TEXT NOT NULL DEFAULT '{}',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS zones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     INTEGER NOT NULL REFERENCES sites(id),
  name        TEXT NOT NULL,
  capacity    INTEGER NOT NULL DEFAULT 0,
  vehicle_types TEXT,               -- JSON array or NULL = all
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS gates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     INTEGER NOT NULL REFERENCES sites(id),
  zone_id     INTEGER REFERENCES zones(id),
  name        TEXT NOT NULL,
  direction   TEXT NOT NULL CHECK (direction IN ('ENTRY','EXIT')),
  settings_json TEXT NOT NULL DEFAULT '{}', -- autoIssueTicket, allowUnreadTicket, ...
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS devices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     INTEGER REFERENCES sites(id),
  gate_id     INTEGER REFERENCES gates(id),
  type        TEXT NOT NULL CHECK (type IN ('CAMERA','PRINTER','BARRIER','ENTRY_KIOSK','EXIT_KIOSK','PAYMENT_KIOSK','COUNTER','EDGE','DISPLAY','POS')),
  name        TEXT NOT NULL,
  model       TEXT,
  connection_json TEXT NOT NULL DEFAULT '{}', -- protocol, host, port, rtspUrl, onvif, bridgeUrl ...
  settings_json   TEXT NOT NULL DEFAULT '{}', -- detection zones, paper size ...
  api_key_hash TEXT UNIQUE,
  status      TEXT NOT NULL DEFAULT 'UNKNOWN', -- ONLINE / OFFLINE / UNKNOWN / ERROR
  last_seen_at TEXT,
  last_error  TEXT,
  merchant_id INTEGER,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS device_status_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   INTEGER NOT NULL REFERENCES devices(id),
  status      TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ----------------------------------------------------------------- users -----
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  pin_hash      TEXT,
  role          TEXT NOT NULL,
  site_ids      TEXT,               -- JSON array, NULL = all sites
  merchant_id   INTEGER,
  branch_id     INTEGER,
  active        INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role        TEXT PRIMARY KEY,
  permissions TEXT NOT NULL          -- JSON array (overrides built-in defaults)
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ip          TEXT,
  user_agent  TEXT
);

-- ------------------------------------------------------ members & lists -----
CREATE TABLE IF NOT EXISTS member_tiers (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0,
  benefits_json TEXT NOT NULL DEFAULT '{}' -- extraFreeMinutes, discountPercent, ticketless
);

CREATE TABLE IF NOT EXISTS members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT NOT NULL UNIQUE,
  first_name  TEXT NOT NULL,
  last_name   TEXT,
  email       TEXT,
  tier        TEXT NOT NULL DEFAULT 'REGULAR' REFERENCES member_tiers(code),
  consent_at  TEXT,                 -- PDPA consent timestamp
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS member_vehicles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  plate_prefix TEXT NOT NULL,
  plate_number TEXT NOT NULL,
  province    TEXT,
  plate_key   TEXT NOT NULL,
  vehicle_type TEXT NOT NULL DEFAULT 'CAR',
  UNIQUE(member_id, plate_key)
);
CREATE INDEX IF NOT EXISTS idx_member_vehicles_key ON member_vehicles(plate_key);

-- Monthly / yearly / staff passes and permitted ticketless vehicles.
CREATE TABLE IF NOT EXISTS passes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL CHECK (type IN ('MONTHLY','YEARLY','STAFF','PERMIT')),
  member_id   INTEGER REFERENCES members(id),
  holder_name TEXT,
  plate_key   TEXT NOT NULL,
  plate_text  TEXT NOT NULL,
  province    TEXT,
  site_id     INTEGER REFERENCES sites(id),
  valid_from  TEXT NOT NULL,
  valid_to    TEXT NOT NULL,
  ticketless  INTEGER NOT NULL DEFAULT 1,
  free_parking INTEGER NOT NULL DEFAULT 1,
  price       REAL NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_passes_key ON passes(plate_key);

CREATE TABLE IF NOT EXISTS plate_lists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  list_type   TEXT NOT NULL CHECK (list_type IN ('WHITELIST','BLACKLIST','EXEMPT','SPECIAL_RATE')),
  site_id     INTEGER REFERENCES sites(id),
  plate_key   TEXT NOT NULL,
  plate_text  TEXT NOT NULL,
  province    TEXT,
  reason      TEXT,
  rate_plan_id INTEGER,
  valid_from  TEXT,
  valid_to    TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_plate_lists_key ON plate_lists(plate_key, list_type);

-- ----------------------------------------------------------------- rates -----
CREATE TABLE IF NOT EXISTS rate_plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     INTEGER REFERENCES sites(id),   -- NULL = all sites
  zone_id     INTEGER REFERENCES zones(id),   -- NULL = all zones
  name        TEXT NOT NULL,
  vehicle_type TEXT NOT NULL DEFAULT 'CAR',   -- CAR, MOTORCYCLE, VAN, TRUCK, VIP, ...
  priority    INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Rate history: a session is always priced with the version in force at entry.
CREATE TABLE IF NOT EXISTS rate_plan_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id     INTEGER NOT NULL REFERENCES rate_plans(id),
  effective_from TEXT NOT NULL,
  config_json TEXT NOT NULL,
  note        TEXT,
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_rate_versions ON rate_plan_versions(plan_id, effective_from);

CREATE TABLE IF NOT EXISTS holidays (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,          -- YYYY-MM-DD
  name        TEXT NOT NULL,
  site_id     INTEGER REFERENCES sites(id),
  UNIQUE(date, site_id)
);

-- --------------------------------------------------------- LPR detections ----
CREATE TABLE IF NOT EXISTS detections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id       INTEGER REFERENCES sites(id),
  gate_id       INTEGER REFERENCES gates(id),
  camera_id     INTEGER REFERENCES devices(id),
  direction     TEXT NOT NULL,
  captured_at   TEXT NOT NULL,
  received_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  image_path    TEXT,                 -- full vehicle image
  candidates_json TEXT NOT NULL,      -- every evaluated candidate (raw OCR kept)
  selected_index INTEGER,
  decision      TEXT NOT NULL,        -- AUTO_CONFIRM / KIOSK_CONFIRM / MANUAL_REVIEW / NO_READ
  reasons       TEXT,                 -- JSON array
  conflict      INTEGER NOT NULL DEFAULT 0,
  -- final (possibly corrected) result
  plate_prefix  TEXT,
  plate_number  TEXT,
  province      TEXT,                 -- province code
  plate_key     TEXT,
  source_type   TEXT,
  plate_confidence REAL,
  province_confidence REAL,
  vehicle_type  TEXT,
  review_status TEXT NOT NULL DEFAULT 'NONE', -- NONE / PENDING / RESOLVED / DISMISSED
  original_json TEXT,                 -- result before staff correction
  corrected_json TEXT,
  corrected_by  INTEGER,
  corrected_at  TEXT,
  session_id    INTEGER,
  edge_event_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_detections_review ON detections(review_status, captured_at);
CREATE INDEX IF NOT EXISTS idx_detections_key ON detections(plate_key);

-- -------------------------------------------------------- parking sessions ---
CREATE TABLE IF NOT EXISTS parking_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  parking_no    TEXT NOT NULL UNIQUE,  -- PK202610120001
  site_id       INTEGER NOT NULL REFERENCES sites(id),
  zone_id       INTEGER REFERENCES zones(id),
  entry_gate_id INTEGER REFERENCES gates(id),
  exit_gate_id  INTEGER REFERENCES gates(id),
  plate_prefix  TEXT,
  plate_number  TEXT,
  province      TEXT,
  plate_text    TEXT,                  -- "กข 1234"
  plate_key     TEXT,                  -- prefix|number|province
  plate_source  TEXT,
  vehicle_type  TEXT NOT NULL DEFAULT 'CAR',
  entry_at      TEXT NOT NULL,
  exit_at       TEXT,
  status        TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE / EXITED / CANCELLED
  payment_status TEXT NOT NULL DEFAULT 'UNPAID', -- UNPAID / PAID / WAIVED / FREE
  token_hash    TEXT UNIQUE,           -- customer QR token (sha256), cleared on exit
  token_version INTEGER NOT NULL DEFAULT 1,
  rate_plan_id  INTEGER REFERENCES rate_plans(id),
  rate_version_id INTEGER REFERENCES rate_plan_versions(id),
  member_id     INTEGER REFERENCES members(id),
  pass_id       INTEGER REFERENCES passes(id),
  reservation_id INTEGER,
  ticketless    INTEGER NOT NULL DEFAULT 0,
  unread_plate  INTEGER NOT NULL DEFAULT 0,
  lost_ticket   INTEGER NOT NULL DEFAULT 0,
  exempt        INTEGER NOT NULL DEFAULT 0,
  entry_detection_id INTEGER REFERENCES detections(id),
  exit_detection_id  INTEGER REFERENCES detections(id),
  last_paid_at  TEXT,
  exit_deadline_at TEXT,
  flags         TEXT,                  -- JSON array: PLATE_MISMATCH, LONG_STAY ...
  offline_origin INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_active_key ON parking_sessions(status, plate_key);
CREATE INDEX IF NOT EXISTS idx_sessions_entry ON parking_sessions(entry_at);
CREATE INDEX IF NOT EXISTS idx_sessions_site ON parking_sessions(site_id, status);

CREATE TABLE IF NOT EXISTS sequences (
  name        TEXT NOT NULL,
  period      TEXT NOT NULL,
  last_value  INTEGER NOT NULL,
  PRIMARY KEY (name, period)
);

-- Discounts: receipt validations, manual stamps, manual discounts, waivers.
CREATE TABLE IF NOT EXISTS parking_discounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES parking_sessions(id),
  type        TEXT NOT NULL CHECK (type IN ('RECEIPT_VALIDATION','MANUAL_STAMP','MANUAL_DISCOUNT','MEMBER','PROMOTION','WAIVER')),
  amount      REAL NOT NULL DEFAULT 0,
  free_minutes INTEGER NOT NULL DEFAULT 0,
  full_waiver INTEGER NOT NULL DEFAULT 0,
  total_spend REAL,
  rules_json  TEXT,                   -- rule snapshot(s) used
  source      TEXT,                   -- COUNTER / KIOSK / API / ADMIN
  device_id   INTEGER,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE / REVOKED / PENDING_REVIEW
  created_by  INTEGER,
  approved_by INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at  TEXT,
  revoked_by  INTEGER,
  revoked_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_discounts_session ON parking_discounts(session_id);

-- One row per receipt ever used for parking validation (anti re-use).
CREATE TABLE IF NOT EXISTS receipt_usages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_ref TEXT NOT NULL UNIQUE,   -- POS Receipt ID or external POS reference
  sale_id     INTEGER,                -- pos_sales.id when internal
  external    INTEGER NOT NULL DEFAULT 0,
  merchant_id INTEGER,
  amount      REAL NOT NULL,
  session_id  INTEGER NOT NULL REFERENCES parking_sessions(id),
  discount_id INTEGER REFERENCES parking_discounts(id),
  status      TEXT NOT NULL DEFAULT 'VALIDATED', -- VALIDATED / REFUNDED_AFTER_VALIDATION / REVOKED
  counter     TEXT,
  device_id   INTEGER,
  scanned_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS validation_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  scope       TEXT NOT NULL CHECK (scope IN ('GLOBAL','MERCHANT','CAMPAIGN')),
  config_json TEXT NOT NULL,           -- shared ValidationRule shape (minus id/name/scope)
  priority    INTEGER NOT NULL DEFAULT 0,
  combinable  INTEGER NOT NULL DEFAULT 1,
  active      INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------- payments ---
CREATE TABLE IF NOT EXISTS payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES parking_sessions(id),
  amount      REAL NOT NULL,
  method      TEXT NOT NULL,          -- PROMPTPAY / CARD / CASH / WAIVER / EWALLET
  gateway     TEXT NOT NULL,          -- mock / omise / cash / internal
  gateway_ref TEXT UNIQUE,            -- gateway charge / transaction id
  status      TEXT NOT NULL DEFAULT 'PENDING', -- PENDING / PAID / FAILED / EXPIRED / CANCELLED / REFUNDED / PARTIALLY_REFUNDED
  quote_json  TEXT NOT NULL,          -- server fee snapshot used for the amount
  qr_payload  TEXT,
  qr_image_url TEXT,
  idempotency_key TEXT UNIQUE,
  channel     TEXT,                   -- WEB / PAYMENT_KIOSK / EXIT_KIOSK / COUNTER
  device_id   INTEGER,
  created_by  INTEGER,
  cash_received REAL,
  change_given REAL,
  failure_reason TEXT,
  refunded_amount REAL NOT NULL DEFAULT 0,
  needs_refund INTEGER NOT NULL DEFAULT 0, -- duplicate payment detected
  expires_at  TEXT,
  paid_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_session ON payments(session_id, status);

CREATE TABLE IF NOT EXISTS payment_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id  INTEGER,
  gateway     TEXT NOT NULL,
  event_type  TEXT,
  external_id TEXT,
  verified    INTEGER NOT NULL DEFAULT 0,
  payload     TEXT NOT NULL,
  result      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(gateway, external_id)
);

CREATE TABLE IF NOT EXISTS refunds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id  INTEGER NOT NULL REFERENCES payments(id),
  amount      REAL NOT NULL,
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'COMPLETED', -- PENDING / COMPLETED / FAILED
  requested_by INTEGER,
  approved_by INTEGER,
  gateway_ref TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS tax_documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no      TEXT NOT NULL UNIQUE,
  doc_type    TEXT NOT NULL CHECK (doc_type IN ('RECEIPT','TAX_INVOICE_ABB','TAX_INVOICE_FULL')),
  payment_id  INTEGER NOT NULL REFERENCES payments(id),
  buyer_name  TEXT,
  buyer_tax_id TEXT,
  buyer_address TEXT,
  buyer_branch TEXT,
  amount      REAL NOT NULL,
  vat         REAL NOT NULL,
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ------------------------------------------------------------ reservations ---
CREATE TABLE IF NOT EXISTS reservations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  site_id     INTEGER NOT NULL REFERENCES sites(id),
  zone_id     INTEGER REFERENCES zones(id),
  plate_key   TEXT NOT NULL,
  plate_text  TEXT NOT NULL,
  province    TEXT,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  start_at    TEXT NOT NULL,
  end_at      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'BOOKED', -- BOOKED / CHECKED_IN / COMPLETED / CANCELLED / NO_SHOW
  fee         REAL NOT NULL DEFAULT 0,
  session_id  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- --------------------------------------------------------------- merchants ---
CREATE TABLE IF NOT EXISTS merchants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT UNIQUE,            -- M000124 (assigned on approval)
  name        TEXT NOT NULL,
  owner_first_name TEXT NOT NULL,
  owner_last_name  TEXT NOT NULL,
  phone       TEXT NOT NULL,
  email       TEXT NOT NULL,
  tax_id      TEXT,
  category    TEXT,
  unit_no     TEXT,
  zone        TEXT,
  floor       TEXT,
  address     TEXT,
  logo_url    TEXT,
  storefront_url TEXT,
  receipt_info_json TEXT NOT NULL DEFAULT '{}', -- header/footer, VAT reg, branch name
  contact_json TEXT NOT NULL DEFAULT '{}',
  site_id     INTEGER REFERENCES sites(id),
  status      TEXT NOT NULL DEFAULT 'PENDING', -- PENDING / APPROVED / ACTIVE / SUSPENDED / CLOSED / REJECTED
  validation_enabled INTEGER NOT NULL DEFAULT 1,
  validation_min_spend REAL NOT NULL DEFAULT 0,
  pos_enabled INTEGER NOT NULL DEFAULT 1,
  verification_key TEXT,              -- secret used to sign receipt tokens
  approved_by INTEGER,
  approved_at TEXT,
  status_reason TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS merchant_branches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id INTEGER NOT NULL REFERENCES merchants(id),
  code        TEXT NOT NULL,          -- B01
  name        TEXT NOT NULL,
  site_id     INTEGER REFERENCES sites(id),
  active      INTEGER NOT NULL DEFAULT 1,
  UNIQUE(merchant_id, code)
);

CREATE TABLE IF NOT EXISTS product_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id INTEGER NOT NULL REFERENCES merchants(id),
  name        TEXT NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id INTEGER NOT NULL REFERENCES merchants(id),
  category_id INTEGER REFERENCES product_categories(id),
  name        TEXT NOT NULL,
  sku         TEXT,
  barcode     TEXT,
  price       REAL NOT NULL,
  image_url   TEXT,
  variants_json  TEXT NOT NULL DEFAULT '[]', -- [{name, price}]
  modifiers_json TEXT NOT NULL DEFAULT '[]', -- [{group, options:[{name, price}], multi}]
  vat_applicable INTEGER NOT NULL DEFAULT 1,
  track_stock INTEGER NOT NULL DEFAULT 0,
  stock       REAL,
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_products_merchant ON products(merchant_id, active);

CREATE TABLE IF NOT EXISTS pos_shifts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id INTEGER NOT NULL REFERENCES merchants(id),
  branch_id   INTEGER NOT NULL REFERENCES merchant_branches(id),
  device_id   INTEGER,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  opened_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  opening_cash REAL NOT NULL DEFAULT 0,
  closed_at   TEXT,
  closing_cash REAL,
  expected_cash REAL,
  status      TEXT NOT NULL DEFAULT 'OPEN',
  note        TEXT
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id    INTEGER NOT NULL REFERENCES pos_shifts(id),
  type        TEXT NOT NULL CHECK (type IN ('IN','OUT','SALE','REFUND','OPEN_DRAWER')),
  amount      REAL NOT NULL,
  reason      TEXT,
  sale_id     INTEGER,
  user_id     INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS held_bills (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_id INTEGER NOT NULL REFERENCES merchants(id),
  branch_id   INTEGER NOT NULL,
  user_id     INTEGER,
  name        TEXT NOT NULL,
  cart_json   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Every POS receipt. receipt_no is immutable once issued.
CREATE TABLE IF NOT EXISTS pos_sales (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no  TEXT NOT NULL UNIQUE,   -- M000124-B01-20261012-000158
  merchant_id INTEGER NOT NULL REFERENCES merchants(id),
  branch_id   INTEGER NOT NULL REFERENCES merchant_branches(id),
  device_id   INTEGER,
  shift_id    INTEGER REFERENCES pos_shifts(id),
  cashier_id  INTEGER REFERENCES users(id),
  member_phone TEXT,
  items_json  TEXT NOT NULL,
  subtotal    REAL NOT NULL,
  discount    REAL NOT NULL DEFAULT 0,
  service_charge REAL NOT NULL DEFAULT 0,
  vat         REAL NOT NULL DEFAULT 0,
  vat_mode    TEXT NOT NULL DEFAULT 'INCLUDED',
  total       REAL NOT NULL,          -- amount actually paid
  payments_json TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'PAID', -- PAID / VOIDED / REFUNDED / PARTIALLY_REFUNDED
  refunded_amount REAL NOT NULL DEFAULT 0,
  verification_token TEXT NOT NULL UNIQUE,
  parking_validation_status TEXT NOT NULL DEFAULT 'NOT_USED', -- NOT_USED / USED / REFUNDED_AFTER_VALIDATION
  reprint_count INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  issued_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  voided_at   TEXT,
  voided_by   INTEGER,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_merchant ON pos_sales(merchant_id, issued_at);

CREATE TABLE IF NOT EXISTS pos_refunds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id     INTEGER NOT NULL REFERENCES pos_sales(id),
  amount      REAL NOT NULL,
  items_json  TEXT,
  reason      TEXT NOT NULL,
  method      TEXT,
  user_id     INTEGER,
  approved_by INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ------------------------------------------------------- kiosk content CMS ---
CREATE TABLE IF NOT EXISTS media (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT NOT NULL,
  kind        TEXT NOT NULL,          -- IMAGE / VIDEO / FONT / LOGO / DOC
  mime        TEXT,
  size        INTEGER,
  width       INTEGER,
  height      INTEGER,
  original_name TEXT,
  purpose     TEXT,
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS kiosk_content (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('IMAGE','VIDEO')),
  category    TEXT NOT NULL DEFAULT 'PROMOTION', -- PROMOTION / CAMPAIGN / BANNER / ADVERTISEMENT
  media_url   TEXT NOT NULL,
  layout      TEXT NOT NULL DEFAULT 'FULL', -- FULL / SPLIT
  duration_sec INTEGER NOT NULL DEFAULT 10,
  sort        INTEGER NOT NULL DEFAULT 0,
  start_at    TEXT,
  end_at      TEXT,
  daily_start TEXT,                    -- HH:mm
  daily_end   TEXT,
  site_ids    TEXT,                    -- JSON array or NULL = all
  device_ids  TEXT,                    -- JSON array or NULL = all kiosks
  kiosk_types TEXT,                    -- JSON array e.g. ["PAYMENT_KIOSK"]
  active      INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS fonts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family      TEXT NOT NULL UNIQUE,
  source      TEXT NOT NULL CHECK (source IN ('GOOGLE','UPLOAD','SYSTEM')),
  weights_json TEXT NOT NULL DEFAULT '[400]',
  files_json  TEXT NOT NULL DEFAULT '[]',
  license_name TEXT,
  license_note TEXT,
  license_confirmed_by INTEGER,
  license_confirmed_at TEXT,
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- --------------------------------------------------------- ops / security ---
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_id     INTEGER,
  username    TEXT,
  role        TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  site_id     INTEGER,
  device_id   INTEGER,
  merchant_id INTEGER,
  session_id  INTEGER,
  parking_no  TEXT,
  receipt_no  TEXT,
  before_json TEXT,
  after_json  TEXT,
  reason      TEXT,
  approved_by INTEGER,
  approved_by_name TEXT,
  ip          TEXT,
  meta_json   TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs(at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

CREATE TABLE IF NOT EXISTS alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,          -- DEVICE_OFFLINE, LONG_STAY, BLACKLIST, PLATE_MISMATCH, LPR_REVIEW, DUPLICATE_PAYMENT, LOT_FULL, RECEIPT_REFUND ...
  severity    TEXT NOT NULL DEFAULT 'WARNING',
  site_id     INTEGER,
  ref_type    TEXT,
  ref_id      TEXT,
  message     TEXT NOT NULL,
  data_json   TEXT,
  dedupe_key  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  acknowledged_by INTEGER,
  acknowledged_at TEXT,
  resolved_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_open_dedupe ON alerts(dedupe_key) WHERE resolved_at IS NULL AND dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key         TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,
  response_json TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS backups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file        TEXT NOT NULL,
  size        INTEGER,
  kind        TEXT NOT NULL DEFAULT 'MANUAL',
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
