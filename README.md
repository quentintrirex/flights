# Flights

Personal cheap-flight tracker and iPhone web app. Lives at `https://trirexio.com/private/flights/`, behind the `/private/` gate (PIN 1939, same as Beer and Movies).

- Track a city, an airport or a whole country (e.g. "anywhere in Thailand") from one or more home airports.
- Departure window: within 1, 2, 3, 6 or 12 months from today, or your own dates.
- Every few hours the server checks prices, learns the **normal price** of each route and flags deals:
  good = 15% under normal, great = 30% under, extreme = 45% under (or below your own price).
- Alerts: in the app (bell, live banner, app-icon badge) and as push notifications on the iPhone home-screen app.
- Tap a route: lowest now, normal price, lowest ever, 7-day trend, price-history graph, price calendar
  (tap a day to see its fares), cheapest per city / airport / weekday / airline / stops, alert history.
- Every fare has **Book this fare** (Aviasales) and **Check on Google Flights**.

Prices come from the free Travelpayouts / Aviasales Data API: the cheapest fares Aviasales users found in the last
48 hours. Good for spotting deals; always confirm the live price before booking. Without a token the app runs on
clearly labelled demo prices.

## Files

```
index.php            app shell (CSP: scripts only from this folder)
api.php              JSON API (changes need the X-Flights header)
places.php           built-in places list as a script
sw.js                service worker: push notifications, offline shell
manifest.webmanifest home-screen app
assets/              app.js, app.css, icons
src/app.php          database, scanning, deal levels, alerts
src/providers.php    Aviasales + demo price sources
src/webpush.php      Web Push (RFC 8291/8292) with plain OpenSSL
src/places.php       built-in cities/countries
bin/scan.php         cron: checks routes that are due
bin/check-api.php    checks the token and live data
data/                database, push key, config.php (never served)
tests/run.php        tests (incl. the RFC 8291 test vector)
dev/                 local preview tools (not uploaded)
```

## Setup on the server

1. Upload everything except `dev/` and `tests/` to `httpdocs/private/flights/`.
2. Make `data/config.php` from `data/config.example.php` with the Travelpayouts token.
3. Plesk > Scheduled Tasks > Run a command, **every hour**:
   `/opt/plesk/php/8.4/bin/php /var/www/vhosts/trirexio.com/httpdocs/private/flights/bin/scan.php`
   (each route is checked every 3 hours; change `scan_every_hours` in the config).
4. Check: `php bin/check-api.php AMS BKK` prints live fares.
5. iPhone: open the URL in Safari, enter the PIN, Share > Add to Home Screen, open it from the home screen,
   bell > Turn on notifications.

The gate (`/private/_gate/lib.php`) treats `flights/` like Beer and Movies: owner password or PIN 1939.
`/private/.htaccess` already blocks `data/`, `src/` and `bin/` (404), and the folders have their own
`Require all denied` as a second lock.

## Local

```
powershell -File dev/start.ps1        # http://localhost:8782, demo prices
php -c dev/php.ini dev/seed.php       # fresh demo data with 30 days of history
php -c dev/php.ini tests/run.php      # tests (set OPENSSL_CONF on Windows, see dev/start.ps1)
```
