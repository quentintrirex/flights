<?php
/* Flights: core (database, settings, scanning, deal scoring). No framework, no Composer. */
declare(strict_types=1);

const APP_DIR  = __DIR__ . '/..';
const DATA_DIR = APP_DIR . '/data';
const TZ       = 'Europe/Amsterdam';

date_default_timezone_set(TZ);
require __DIR__ . '/providers.php';
require __DIR__ . '/webpush.php';

function config(): array
{
    static $c = null;
    if ($c === null) {
        $file = DATA_DIR . '/config.php';
        $c = array_merge([
            'travelpayouts_token'  => '',      // free token from travelpayouts.com (Profile > API token)
            'travelpayouts_marker' => '',      // optional partner id, appended to booking links
            'currency'             => 'eur',
            'scan_every_hours'     => 3,
            'push_subject'         => 'https://trirexio.com',
        ], is_file($file) ? (array) require $file : []);
    }
    return $c;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    if (!is_dir(DATA_DIR)) mkdir(DATA_DIR, 0770, true);
    $pdo = new PDO('sqlite:' . (getenv('FLIGHTS_DB') ?: DATA_DIR . '/flights.sqlite'));
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=8000; PRAGMA foreign_keys=ON;');
    $pdo->exec(<<<SQL
    CREATE TABLE IF NOT EXISTS watches (
        id INTEGER PRIMARY KEY, origins TEXT NOT NULL, dest TEXT NOT NULL, dest_city TEXT NOT NULL,
        dest_country TEXT NOT NULL DEFAULT '', trip TEXT NOT NULL DEFAULT 'return',
        months INTEGER NOT NULL DEFAULT 6, min_nights INTEGER NOT NULL DEFAULT 7, max_nights INTEGER NOT NULL DEFAULT 21,
        max_stops INTEGER NOT NULL DEFAULT 1, alert TEXT NOT NULL DEFAULT 'great', max_price INTEGER,
        paused INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, scanned_at INTEGER, scan_error TEXT,
        normal_price INTEGER, low_price INTEGER, scans INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS fares (
        id INTEGER PRIMARY KEY, watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
        k TEXT NOT NULL, origin TEXT NOT NULL, dest TEXT NOT NULL, depart TEXT NOT NULL, ret TEXT,
        nights INTEGER, price INTEGER NOT NULL, airline TEXT, stops INTEGER NOT NULL DEFAULT 0,
        duration INTEGER, link TEXT, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
        notified_price INTEGER, UNIQUE(watch_id, k));
    CREATE TABLE IF NOT EXISTS history (
        watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE, day TEXT NOT NULL,
        low INTEGER NOT NULL, normal INTEGER, PRIMARY KEY(watch_id, day));
    CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY, watch_id INTEGER REFERENCES watches(id) ON DELETE CASCADE, fare_id INTEGER,
        level TEXT NOT NULL, price INTEGER, title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER);
    CREATE TABLE IF NOT EXISTS push_subs (
        id INTEGER PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
        created_at INTEGER NOT NULL, fails INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    SQL);
    // Upgrades for databases made by an earlier version (never drops data).
    $add = [
        'watches' => ['kind' => "TEXT NOT NULL DEFAULT 'city'", 'date_from' => 'TEXT', 'date_to' => 'TEXT', 'airlines' => "TEXT NOT NULL DEFAULT ''"],
        'fares'   => ['dest_name' => 'TEXT', 'dep_time' => 'TEXT', 'ret_time' => 'TEXT', 'stops_out' => 'INTEGER', 'stops_back' => 'INTEGER',
                      'dur_out' => 'INTEGER', 'dur_back' => 'INTEGER', 'flight_no' => 'TEXT'],
        'history' => ['fares' => 'INTEGER'],
        'alerts'  => ['price' => 'INTEGER'],
    ];
    foreach ($add as $table => $cols) {
        $have = array_column($pdo->query("PRAGMA table_info($table)")->fetchAll(), 'name');
        foreach ($cols as $col => $type) if (!in_array($col, $have, true)) $pdo->exec("ALTER TABLE $table ADD COLUMN $col $type");
    }
    return $pdo;
}

function q(string $sql, array $args = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($args);
    return $st;
}

function kv(string $k, ?string $set = null): ?string
{
    if ($set !== null) { q('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', [$k, $set]); return $set; }
    $v = q('SELECT v FROM kv WHERE k=?', [$k])->fetchColumn();
    return $v === false ? null : $v;
}

function now(): int { return (int) (getenv('FLIGHTS_NOW') ?: time()); }
function today(): string { return date('Y-m-d', now()); }

/* ------------------------------------------------------------------ places */

/** Built-in places: [code, city, country, country code]. */
function places(): array
{
    static $p = null;
    return $p ??= require __DIR__ . '/places.php';
}

/**
 * City code -> [city name, country code], from Aviasales' public city list (cached 30 days),
 * with the built-in list as fallback. Used to keep "anywhere in <country>" fares inside that country.
 */
function city_info(string $code): ?array
{
    static $map = null;
    if ($map === null) {
        $map = [];
        foreach (places() as [$c, $city, , $cc]) $map[$c] = [$city, $cc];
        $file = DATA_DIR . '/cities.json';
        if (!getenv('FLIGHTS_OFFLINE') && (!is_file($file) || filemtime($file) < now() - 30 * 86400)) {
            $ch = curl_init('https://api.travelpayouts.com/data/en/cities.json');
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_ENCODING => '']);
            $raw = curl_exec($ch);
            $ok = curl_getinfo($ch, CURLINFO_RESPONSE_CODE) === 200;
            curl_close($ch);
            $list = $ok ? json_decode((string) $raw, true) : null;
            if (is_array($list) && count($list) > 1000) {
                $slim = [];
                foreach ($list as $r) if (!empty($r['code']) && !empty($r['country_code'])) $slim[$r['code']] = [$r['name'] ?? $r['code'], $r['country_code']];
                file_put_contents($file, json_encode($slim, JSON_UNESCAPED_UNICODE));
            } elseif (is_file($file)) {
                touch($file);            // keep the old copy, try again tomorrow-ish
            }
        }
        if (is_file($file)) $map = (json_decode((string) file_get_contents($file), true) ?: []) + $map;
    }
    return $map[$code] ?? null;
}

/* ------------------------------------------------------------------ deal levels */

const LEVELS = ['good' => 0.85, 'great' => 0.70, 'extreme' => 0.55];   // price / normal price
const RANK   = ['none' => 0, 'good' => 1, 'great' => 2, 'extreme' => 3];

function level_for(int $price, ?int $normal): string
{
    if (!$normal) return 'none';
    $r = $price / $normal;
    foreach (array_reverse(LEVELS, true) as $name => $max) if ($r <= $max) return $name;
    return 'none';
}

function median(array $xs): ?int
{
    if (!$xs) return null;
    sort($xs);
    $n = count($xs);
    return (int) round($n % 2 ? $xs[intdiv($n, 2)] : ($xs[$n / 2 - 1] + $xs[$n / 2]) / 2);
}

/* ------------------------------------------------------------------ watches */

function watch(int $id): ?array
{
    return q('SELECT * FROM watches WHERE id=?', [$id])->fetch() ?: null;
}

function provider(): Provider
{
    if (getenv('FLIGHTS_PROVIDER') === 'demo') return new DemoProvider();
    $t = config()['travelpayouts_token'];
    return $t !== '' ? new TravelpayoutsProvider($t, config()['currency'], config()['travelpayouts_marker']) : new DemoProvider();
}

/** Departure window [from, to] (Y-m-d): custom dates, or today + N months. Never before today. */
function window_of(array $w): array
{
    $today = today();
    $from = max($today, (string) ($w['date_from'] ?: $today));
    $to = $w['date_to'] ?: date('Y-m-d', strtotime($today . ' +' . (int) $w['months'] . ' months'));
    return [$from, max($from, (string) $to)];
}

/** The calendar months (Y-m) that cover a window. */
function months_between(string $from, string $to): array
{
    $out = [];
    for ($m = substr($from, 0, 7); $m <= substr($to, 0, 7) && count($out) < 13; $m = date('Y-m', strtotime("$m-01 +1 month"))) $out[] = $m;
    return $out;
}

/** Fetch fresh prices for one route, store them, update its normal price and raise alerts. */
function scan_watch(array $w, ?Provider $p = null): array
{
    $p ??= provider();
    @set_time_limit(180);
    $t = now();
    [$from, $to] = window_of($w);
    $country = $w['kind'] === 'country';
    $airlines = array_filter(explode(',', (string) ($w['airlines'] ?? '')));   // empty = any airline
    $found = [];
    $errors = [];
    foreach (explode(',', $w['origins']) as $origin) {
        foreach (months_between($from, $to) as $month) {
            try {
                $list = $country
                    ? $p->faresToCountry($origin, $w['dest'], $month, $w['trip'] === 'return', (int) $w['max_stops'] === 0)
                    : $p->fares($origin, $w['dest'], $month, $w['trip'] === 'return', (int) $w['max_stops'] === 0);
                foreach ($list as $f) {
                    if ($f['depart'] < $from || $f['depart'] > $to) continue;
                    if ($w['max_stops'] >= 0 && $f['stops'] > $w['max_stops']) continue;
                    if ($w['trip'] === 'return' && (!$f['ret'] || $f['nights'] < $w['min_nights'] || $f['nights'] > $w['max_nights'])) continue;
                    if ($w['trip'] === 'oneway' && $f['ret']) continue;
                    if ($airlines && !in_array($f['airline'], $airlines, true)) continue;
                    $k = $f['origin'] . $f['dest'] . $f['depart'] . ($f['ret'] ?? '') . $f['airline'];
                    if (!isset($found[$k]) || $f['price'] < $found[$k]['price']) $found[$k] = $f + ['k' => $k];
                }
            } catch (Throwable $e) {
                $errors[] = $e->getMessage();
            }
        }
    }

    if (!$found && $errors) {
        q('UPDATE watches SET scanned_at=?, scan_error=? WHERE id=?', [$t, $errors[0], $w['id']]);
        return ['ok' => false, 'error' => $errors[0]];
    }

    // Normal price = median of the cheapest fare per departure day; once there is history,
    // the median of the last 30 days of those values (so one cheap week doesn't move it).
    $perDay = [];
    foreach ($found as $f) $perDay[$f['depart']] = min($perDay[$f['depart']] ?? PHP_INT_MAX, $f['price']);
    $scanNormal = count($perDay) >= 5 ? median(array_values($perDay)) : null;
    $low = $found ? min(array_column($found, 'price')) : null;
    $today = date('Y-m-d', $t);

    $db = db();
    $db->beginTransaction();
    try {
        if ($low !== null) {
            q('INSERT INTO history(watch_id,day,low,normal,fares) VALUES(?,?,?,?,?)
               ON CONFLICT(watch_id,day) DO UPDATE SET low=MIN(low,excluded.low), normal=COALESCE(excluded.normal,normal), fares=excluded.fares',
              [$w['id'], $today, $low, $scanNormal, count($found)]);
        }
        $hist = q('SELECT normal FROM history WHERE watch_id=? AND day>=? AND normal IS NOT NULL',
                  [$w['id'], date('Y-m-d', $t - 30 * 86400)])->fetchAll(PDO::FETCH_COLUMN);
        $normal = count($hist) >= 3 ? median(array_map('intval', $hist)) : ($scanNormal ?? ($w['normal_price'] ? (int) $w['normal_price'] : null));

        $up = $db->prepare('INSERT INTO fares(watch_id,k,origin,dest,dest_name,depart,ret,nights,price,airline,stops,duration,link,first_seen,last_seen,
                dep_time,ret_time,stops_out,stops_back,dur_out,dur_back,flight_no)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(watch_id,k) DO UPDATE SET price=excluded.price, stops=excluded.stops, duration=excluded.duration,
            link=excluded.link, dest_name=excluded.dest_name, last_seen=excluded.last_seen,
            dep_time=excluded.dep_time, ret_time=excluded.ret_time, stops_out=excluded.stops_out, stops_back=excluded.stops_back,
            dur_out=excluded.dur_out, dur_back=excluded.dur_back, flight_no=excluded.flight_no');
        foreach ($found as $f) {
            $up->execute([$w['id'], $f['k'], $f['origin'], $f['dest'], $f['dest_name'] ?? null, $f['depart'], $f['ret'], $f['nights'],
                          $f['price'], $f['airline'], $f['stops'], $f['duration'], $f['link'], $t, $t,
                          $f['dep_time'] ?? null, $f['ret_time'] ?? null, $f['stops_out'] ?? null, $f['stops_back'] ?? null,
                          $f['dur_out'] ?? null, $f['dur_back'] ?? null, $f['flight_no'] ?? null]);
        }
        q('UPDATE watches SET scanned_at=?, scan_error=?, normal_price=?, low_price=?, scans=scans+1 WHERE id=?',
          [$t, $errors ? $errors[0] : null, $normal, $low, $w['id']]);

        $alert = raise_alerts(watch((int) $w['id']), $t, (int) $w['scans'] === 0);
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }

    if ($alert) push_all(['title' => $alert['title'], 'body' => $alert['body'], 'url' => './#/route/' . $w['id'], 'tag' => 'route-' . $w['id']]);
    return ['ok' => true, 'fares' => count($found), 'low' => $low, 'normal' => $normal, 'alert' => $alert];
}

/** Fares currently on offer (seen in the latest scan). */
function live_fares(array $w, int $limit = 2000): array
{
    return q('SELECT * FROM fares WHERE watch_id=? AND last_seen=? ORDER BY price, depart LIMIT ' . $limit,
             [$w['id'], (int) $w['scanned_at']])->fetchAll();
}

/**
 * One grouped alert per route when cheap fares appear that we have not told you about yet
 * (or that dropped another 3% since). The first scan of a new route only sets the baseline.
 */
function raise_alerts(array $w, int $t, bool $firstScan): ?array
{
    $want = RANK[$w['alert']] ?? 2;
    $hits = [];
    foreach (live_fares($w, 300) as $f) {
        $lvl = level_for((int) $f['price'], $w['normal_price'] ? (int) $w['normal_price'] : null);
        $target = $w['max_price'] && $f['price'] <= $w['max_price'];
        if (RANK[$lvl] < $want && !$target) continue;
        if ($f['notified_price'] !== null && $f['price'] > $f['notified_price'] * 0.97) continue;
        $hits[] = $f + ['level' => $lvl];
    }
    if (!$hits) return null;
    $mark = db()->prepare('UPDATE fares SET notified_price=? WHERE id=?');
    foreach ($hits as $h) $mark->execute([$h['price'], $h['id']]);
    if ($firstScan) return null;

    // Quiet rule: within 7 days of an alert, only a clearly better fare (5% cheaper or a higher level) alerts again.
    $best = $hits[0];
    $prev = q('SELECT price, level FROM alerts WHERE watch_id=? AND created_at>? ORDER BY price LIMIT 1', [$w['id'], $t - 7 * 86400])->fetch();
    if ($prev && $best['price'] > $prev['price'] * 0.95 && RANK[$best['level']] <= RANK[$prev['level']]) return null;

    $lvlName = ['extreme' => 'Extreme deal', 'great' => 'Great deal', 'good' => 'Good deal', 'none' => 'Below your price'][$best['level']];
    $place = $w['kind'] === 'country' && $best['dest_name'] ? $best['dest_name'] . ', ' . $w['dest_city'] : $w['dest_city'];
    $title = $place . ' for ' . money((int) $best['price']) . ' · ' . $lvlName;
    $body = $best['origin'] . ' → ' . $best['dest'] . ' · ' . date_range($best['depart'], $best['ret'])
          . ($best['ret'] ? ' · ' . $best['nights'] . ' nights' : '') . ' · ' . stops_label((int) $best['stops']);
    if ($w['normal_price']) $body .= '. ' . round((1 - $best['price'] / $w['normal_price']) * 100) . '% below normal';
    if (count($hits) > 1) $body .= ' (+' . (count($hits) - 1) . ' more cheap ' . (count($hits) > 2 ? 'dates' : 'date') . ')';
    q('INSERT INTO alerts(watch_id,fare_id,level,price,title,body,created_at) VALUES(?,?,?,?,?,?,?)',
      [$w['id'], $best['id'], $best['level'], $best['price'], $title, $body, $t]);
    return ['title' => $title, 'body' => $body];
}

/* ------------------------------------------------------------------ formatting */

function money(int $eur): string { return '€' . number_format($eur, 0, ',', '.'); }

function stops_label(int $s): string { return $s === 0 ? 'direct' : ($s === 1 ? '1 stop' : "$s stops"); }

function date_range(string $a, ?string $b): string
{
    $fa = date('j M', strtotime($a));
    return $b ? $fa . ' – ' . date('j M', strtotime($b)) : $fa;
}

function google_flights_url(array $f): string
{
    $q = 'Flights from ' . $f['origin'] . ' to ' . $f['dest'] . ' on ' . $f['depart'] . ($f['ret'] ? ' through ' . $f['ret'] : ' one way');
    return 'https://www.google.com/travel/flights?hl=en&curr=EUR&q=' . rawurlencode($q);
}

const AIRLINES = [
    'KL' => 'KLM', 'HV' => 'Transavia', 'TK' => 'Turkish Airlines', 'EK' => 'Emirates', 'QR' => 'Qatar Airways', 'EY' => 'Etihad',
    'LH' => 'Lufthansa', 'LX' => 'Swiss', 'OS' => 'Austrian', 'AF' => 'Air France', 'BA' => 'British Airways', 'IB' => 'Iberia',
    'CX' => 'Cathay Pacific', 'SQ' => 'Singapore Airlines', 'TG' => 'Thai Airways', 'MH' => 'Malaysia Airlines', 'GA' => 'Garuda',
    'VN' => 'Vietnam Airlines', 'CI' => 'China Airlines', 'BR' => 'EVA Air', 'JL' => 'Japan Airlines', 'NH' => 'ANA',
    'KE' => 'Korean Air', 'OZ' => 'Asiana', 'AI' => 'Air India', 'UL' => 'SriLankan', 'WY' => 'Oman Air', 'GF' => 'Gulf Air',
    'SV' => 'Saudia', 'MS' => 'EgyptAir', 'ET' => 'Ethiopian', 'KQ' => 'Kenya Airways', 'DL' => 'Delta', 'UA' => 'United',
    'AA' => 'American', 'AC' => 'Air Canada', 'WS' => 'WestJet', 'TP' => 'TAP Portugal', 'AZ' => 'ITA Airways', 'SK' => 'SAS',
    'AY' => 'Finnair', 'LO' => 'LOT', 'FR' => 'Ryanair', 'U2' => 'easyJet', 'W6' => 'Wizz Air', 'VY' => 'Vueling', 'PC' => 'Pegasus',
    'XQ' => 'SunExpress', 'OR' => 'TUI fly', 'CA' => 'Air China', 'MU' => 'China Eastern', 'CZ' => 'China Southern',
    'PR' => 'Philippine Airlines', 'FD' => 'Thai AirAsia', 'AK' => 'AirAsia', 'D7' => 'AirAsia X', 'TR' => 'Scoot', 'VS' => 'Virgin Atlantic',
    'PY' => 'Surinam Airways', 'LA' => 'LATAM', 'AV' => 'Avianca', 'CM' => 'Copa', 'AM' => 'Aeroméxico', 'G3' => 'GOL', 'AD' => 'Azul',
    'MF' => 'Xiamen Airlines', '6E' => 'IndiGo', 'HU' => 'Hainan Airlines', '3U' => 'Sichuan Airlines', 'ZH' => 'Shenzhen Airlines',
    'HX' => 'Hong Kong Airlines', 'UO' => 'HK Express', 'FZ' => 'flydubai', 'G9' => 'Air Arabia', 'J9' => 'Jazeera Airways',
    'KU' => 'Kuwait Airways', 'RJ' => 'Royal Jordanian', 'ME' => 'Middle East Airlines', 'PK' => 'PIA', 'BG' => 'Biman',
    'QF' => 'Qantas', 'NZ' => 'Air New Zealand', 'VA' => 'Virgin Australia', 'JQ' => 'Jetstar', '5J' => 'Cebu Pacific',
    'VJ' => 'VietJet', 'QH' => 'Bamboo Airways', 'PG' => 'Bangkok Airways', 'SL' => 'Thai Lion Air', 'DD' => 'Nok Air',
    'OD' => 'Batik Air Malaysia', 'ID' => 'Batik Air', 'JT' => 'Lion Air', 'BI' => 'Royal Brunei', 'KC' => 'Air Astana',
    'HY' => 'Uzbekistan Airways', 'J2' => 'AZAL', 'PS' => 'UIA', 'A9' => 'Georgian Airways', 'A3' => 'Aegean', 'OA' => 'Olympic Air',
    'RO' => 'TAROM', 'FB' => 'Bulgaria Air', 'JU' => 'Air Serbia', 'OU' => 'Croatia Airlines', 'BT' => 'airBaltic', 'EW' => 'Eurowings',
    'DE' => 'Condor', 'X3' => 'TUIfly', 'BY' => 'TUI Airways', 'LS' => 'Jet2', 'EI' => 'Aer Lingus', 'DY' => 'Norwegian',
    'D8' => 'Norwegian', 'FI' => 'Icelandair', 'UX' => 'Air Europa', 'I2' => 'Iberia Express', 'V7' => 'Volotea', 'NT' => 'Binter',
    'TO' => 'Transavia France', 'AT' => 'Royal Air Maroc', 'TU' => 'Tunisair', 'AH' => 'Air Algérie', 'SA' => 'South African',
    'WB' => 'RwandAir', 'B6' => 'JetBlue', 'AS' => 'Alaska Airlines', 'WN' => 'Southwest', 'TS' => 'Air Transat', 'LG' => 'Luxair',
    'SN' => 'Brussels Airlines', 'EN' => 'Air Dolomiti', 'WK' => 'Edelweiss', '4Y' => 'Discover Airlines', 'GQ' => 'Sky Express',
    'TB' => 'TUI fly Belgium', 'HO' => 'Juneyao Air', 'FM' => 'Shanghai Airlines', 'SC' => 'Shandong Airlines', 'MM' => 'Peach',
    'GK' => 'Jetstar Japan', '7C' => 'Jeju Air', 'TW' => "T'way Air", 'LJ' => 'Jin Air', 'IT' => 'Tigerair Taiwan', 'Z2' => 'AirAsia Philippines',
    'QZ' => 'Indonesia AirAsia', 'IX' => 'Air India Express', 'SG' => 'SpiceJet', 'QP' => 'Akasa Air', 'XY' => 'flynas', 'F3' => 'flyadeal',
    'MK' => 'Air Mauritius', 'HM' => 'Air Seychelles', 'TC' => 'Air Tanzania', 'ER' => 'SereneAir', '8M' => 'Myanmar Airways', 'K6' => 'Cambodia Angkor Air',
];

function airline_name(?string $code): string { return $code ? (AIRLINES[$code] ?? $code) : ''; }
