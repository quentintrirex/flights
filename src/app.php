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
        'watches' => ['kind' => "TEXT NOT NULL DEFAULT 'city'", 'date_from' => 'TEXT', 'date_to' => 'TEXT', 'airlines' => "TEXT NOT NULL DEFAULT ''", 'via' => 'INTEGER NOT NULL DEFAULT 0'],
        'fares'   => ['dest_name' => 'TEXT', 'dep_time' => 'TEXT', 'ret_time' => 'TEXT', 'stops_out' => 'INTEGER', 'stops_back' => 'INTEGER',
                      'dur_out' => 'INTEGER', 'dur_back' => 'INTEGER', 'flight_no' => 'TEXT', 'ftype' => "TEXT NOT NULL DEFAULT 'rt'", 'legs' => 'TEXT'],
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
    $raw = [];   // everything the source had (also outside the settings), for "closest options" when nothing matches
    $add = function (array $f) use (&$found) {
        $f['ftype'] ??= 'rt';
        $k = ($f['ftype'] === 'rt' ? '' : $f['ftype'] . ':' . ($f['via'] ?? '') . ':') . $f['origin'] . $f['dest'] . $f['depart'] . ($f['ret'] ?? '') . $f['airline'];
        if (!isset($found[$k]) || $f['price'] < $found[$k]['price']) $found[$k] = $f + ['k' => $k];
    };
    foreach (explode(',', $w['origins']) as $origin) {
        foreach (months_between($from, $to) as $month) {
            try {
                $list = $country
                    ? $p->faresToCountry($origin, $w['dest'], $month, $w['trip'] === 'return', (int) $w['max_stops'] === 0)
                    : $p->fares($origin, $w['dest'], $month, $w['trip'] === 'return', (int) $w['max_stops'] === 0);
                foreach ($list as $f) {
                    if ($w['trip'] === 'oneway' && $f['ret']) continue;
                    if ($w['trip'] === 'return' && !$f['ret']) continue;
                    $raw[] = $f;
                    if (!misses($w, $f, $from, $to, $airlines)) $add($f);
                }
            } catch (Throwable $e) {
                $errors[] = $e->getMessage();
            }
        }
    }
    // Two one-way tickets (out and back separately): the price data has far more one-way fares, so this fills
    // the many dates without a cached return fare. Only kept when it beats a return ticket for the same dates.
    if ($w['trip'] === 'return') {
        try {
            foreach (split_trips($w, $p, $from, $to) as $f) {
                $raw[] = $f;
                if (misses($w, $f, $from, $to, $airlines)) continue;
                $same = $f['origin'] . $f['dest'] . $f['depart'] . $f['ret'];
                $rt = array_filter($found, fn($r) => $r['ftype'] === 'rt' && $r['origin'] . $r['dest'] . $r['depart'] . $r['ret'] === $same && $r['price'] <= $f['price']);
                if (!$rt) $add($f);
            }
        } catch (Throwable $e) { $errors[] = $e->getMessage(); }
    }
    // Advanced: via a cheaper city (a cheap flight to a hub such as Oslo or Istanbul, the long flight from there).
    if (!empty($w['via'])) {
        try {
            $std = array_column($found, 'price');
            $stdMin = $std ? min($std) : null;
            $viaAll = via_trips($w, $p, $from, $to, $airlines);
            foreach ($viaAll as $f) {
                if ($stdMin !== null && $f['price'] >= $stdMin) continue;          // only when it is cheaper
                $add($f);
            }
            // What the check found, also when no city was cheaper ("best via Istanbul €640, not cheaper").
            kv('via:' . $w['id'], json_encode(['at' => $t, 'hubs' => count(HUBS), 'best' => $viaAll ? ['hub' => $viaAll[0]['legs']['hub'], 'price' => $viaAll[0]['price']] : null,
                                              'cheaper' => count(array_filter($viaAll, fn($f) => $stdMin === null || $f['price'] < $stdMin))]));
        } catch (Throwable $e) { $errors[] = $e->getMessage(); }
    }
    // Nothing matches: keep the closest options (a few nights more, another airline, a few days later), each
    // with what differs, so the route never just says "nothing".
    kv('near:' . $w['id'], json_encode($found ? [] : near_matches($w, $raw, $from, $to, $airlines)));

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
        // "Normal" = the usual LOWEST fare: the median of the daily lowest fare on earlier days (last 30).
        // Comparing today's cheapest fare with the median of all dates (as before) made the cheapest
        // date look like a deal every single day; this only calls a drop in price a deal.
        // Until two earlier days are known the route is still learning (no deal levels yet).
        $hist = q('SELECT low FROM history WHERE watch_id=? AND day>=? AND day<?',
                  [$w['id'], date('Y-m-d', $t - 30 * 86400), $today])->fetchAll(PDO::FETCH_COLUMN);
        // A brand-new route has no earlier days yet: then compare with a typical CHEAP fare among the
        // other departure dates (the 25th percentile of the daily lows), so only a date that stands
        // out from the cheaper ones counts as a deal, and every route shows a verdict from day one.
        if (count($hist) >= 2) {
            $normal = median(array_map('intval', $hist));
        } else {
            $lows = array_values($perDay);
            sort($lows);
            $normal = count($lows) >= 8 ? (int) round($lows[(int) floor((count($lows) - 1) * 0.25)]) : null;
        }

        $up = $db->prepare('INSERT INTO fares(watch_id,k,origin,dest,dest_name,depart,ret,nights,price,airline,stops,duration,link,first_seen,last_seen,
                dep_time,ret_time,stops_out,stops_back,dur_out,dur_back,flight_no,ftype,legs)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(watch_id,k) DO UPDATE SET price=excluded.price, stops=excluded.stops, duration=excluded.duration,
            link=excluded.link, dest_name=excluded.dest_name, last_seen=excluded.last_seen,
            dep_time=excluded.dep_time, ret_time=excluded.ret_time, stops_out=excluded.stops_out, stops_back=excluded.stops_back,
            dur_out=excluded.dur_out, dur_back=excluded.dur_back, flight_no=excluded.flight_no, ftype=excluded.ftype, legs=excluded.legs');
        foreach ($found as $f) {
            $up->execute([$w['id'], $f['k'], $f['origin'], $f['dest'], $f['dest_name'] ?? null, $f['depart'], $f['ret'], $f['nights'],
                          $f['price'], $f['airline'], $f['stops'], $f['duration'], $f['link'], $t, $t,
                          $f['dep_time'] ?? null, $f['ret_time'] ?? null, $f['stops_out'] ?? null, $f['stops_back'] ?? null,
                          $f['dur_out'] ?? null, $f['dur_back'] ?? null, $f['flight_no'] ?? null,
                          $f['ftype'] ?? 'rt', isset($f['legs']) ? json_encode($f['legs'], JSON_UNESCAPED_UNICODE) : null]);
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

/**
 * What keeps a fare out of a route's settings, as short plain reasons (empty = it fits). Used to filter, and to
 * explain the closest options when nothing fits.
 * @return array<int, array{what:string, text:string, cost:int}> cost = how far off (for sorting)
 */
function misses(array $w, array $f, string $from, string $to, array $airlines): array
{
    $out = [];
    if ($f['depart'] < $from) $out[] = ['what' => 'dates', 'text' => 'leaves ' . days_between($f['depart'], $from) . ' days early', 'cost' => days_between($f['depart'], $from)];
    if ($f['depart'] > $to) $out[] = ['what' => 'dates', 'text' => 'leaves ' . days_between($to, $f['depart']) . ' days later', 'cost' => days_between($to, $f['depart'])];
    if ($w['trip'] === 'return' && $f['ret']) {
        $n = (int) $f['nights'];
        if ($n < $w['min_nights']) $out[] = ['what' => 'nights', 'text' => "$n nights (you want {$w['min_nights']}–{$w['max_nights']})", 'cost' => $w['min_nights'] - $n];
        if ($n > $w['max_nights']) $out[] = ['what' => 'nights', 'text' => "$n nights (you want {$w['min_nights']}–{$w['max_nights']})", 'cost' => $n - $w['max_nights']];
        // Picked dates are a travel window: a return trip has to be home by the last day too.
        if ($w['date_to'] && $f['ret'] > $w['date_to']) $out[] = ['what' => 'dates', 'text' => 'back ' . date('j M', strtotime($f['ret'])) . ', after ' . date('j M', strtotime($w['date_to'])), 'cost' => days_between($w['date_to'], $f['ret'])];
    }
    $maxStops = (int) $w['max_stops'];
    if ($maxStops >= 0 && $f['stops'] > $maxStops) $out[] = ['what' => 'stops', 'text' => stops_label((int) $f['stops']), 'cost' => 3 * ($f['stops'] - $maxStops)];
    // Two tickets: both have to be with one of your airlines.
    $other = $airlines ? array_values(array_diff(array_filter($f['airlines_all'] ?? [$f['airline']]), $airlines)) : [];
    if ($airlines && ($other || $f['airline'] === '')) $out[] = ['what' => 'airline', 'text' => (airline_name($other[0] ?? '') ?: 'another airline') . ' (not one of your airlines)', 'cost' => 2];
    return $out;
}

function days_between(string $a, string $b): int
{
    return (int) round(abs(strtotime($b) - strtotime($a)) / 86400);
}

/** The closest options when nothing fits: at most two things off, not too far, cheapest first. */
function near_matches(array $w, array $raw, string $from, string $to, array $airlines): array
{
    $airlines = array_values($airlines);
    $cands = [];
    foreach ($raw as $f) {
        $m = misses($w, $f, $from, $to, $airlines);
        if (!$m || count($m) > 2) continue;
        if (max(array_column($m, 'cost')) > 10) continue;
        $k = $f['origin'] . $f['dest'] . $f['depart'] . ($f['ret'] ?? '') . $f['airline'] . ($f['ftype'] ?? 'rt');
        if (isset($cands[$k]) && $cands[$k]['price'] <= $f['price']) continue;
        $cands[$k] = ['origin' => $f['origin'], 'dest' => $f['dest'], 'destName' => $f['dest_name'] ?? null, 'depart' => $f['depart'], 'ret' => $f['ret'],
                      'nights' => $f['nights'], 'price' => (int) $f['price'], 'airline' => $f['airline'], 'airlineName' => airline_name($f['airline']),
                      'stops' => (int) $f['stops'], 'type' => $f['ftype'] ?? 'rt', 'link' => $f['link'] ?? null,
                      'why' => array_column($m, 'text'), 'off' => count($m), 'cost' => array_sum(array_column($m, 'cost'))];
    }
    $cands = array_values($cands);
    usort($cands, fn($a, $b) => [$a['off'], $a['price']] <=> [$b['off'], $b['price']]);
    return array_slice($cands, 0, 6);
}

/** A parallel sample of fares, cached for a few hours (the same one-way flights serve many routes and scans). */
function sample_cached(Provider $p, array $origins, array $dests, array $months, bool $return, bool $direct, int $ttl): array
{
    $origins = array_values(array_unique($origins)); $dests = array_values(array_unique($dests));
    $key = 'smp:' . md5(json_encode([$p->name(), $origins, $dests, $months, $return, $direct]));
    $hit = kv($key);
    if ($hit !== null && ($c = json_decode($hit, true)) && ($c['at'] ?? 0) > now() - $ttl) return $c['f'];
    $f = $p->sample($origins, $dests, $months, $return, $direct);
    kv($key, json_encode(['at' => now(), 'f' => $f], JSON_UNESCAPED_UNICODE));
    if (random_int(1, 25) === 1) q("DELETE FROM kv WHERE k LIKE 'smp:%' AND json_extract(v, '$.at') < ?", [now() - 2 * 86400]);
    return $f;
}

/** One flight of a combined trip, for the trip details (each one booked separately). */
function leg(array $f, string $role): array
{
    return ['role' => $role, 'from' => $f['origin'], 'to' => $f['dest'], 'date' => $f['depart'], 'time' => $f['dep_time'] ?? null,
            'ret' => $f['ret'] ?? null, 'retTime' => $f['ret_time'] ?? null, 'airline' => $f['airline'], 'price' => (int) $f['price'],
            'stops' => (int) $f['stops'], 'dur' => $f['dur_out'] ?? null, 'link' => $f['link'] ?? null, 'flightNo' => $f['flight_no'] ?? null];
}

/**
 * Return trips made of two one-way tickets. Outbound to the destination (any of its cities for a country), back
 * home from there (any city of that country, any home airport). Nights may be a week outside the settings, so
 * the near-miss list can use them too; the caller filters.
 */
function split_trips(array $w, Provider $p, string $from, string $to): array
{
    $origins = explode(',', $w['origins']);
    $dests = $w['kind'] === 'country' ? country_cities($w['dest'], 3) : [$w['dest']];
    $direct = (int) $w['max_stops'] === 0;
    $lastBack = $w['date_to'] ?: date('Y-m-d', strtotime($to . ' +' . ((int) $w['max_nights'] + 7) . ' days'));
    $outs = sample_cached($p, $origins, $dests, months_between($from, $to), false, $direct, 3 * 3600);
    $backs = sample_cached($p, $dests, $origins, months_between($from, $lastBack), false, $direct, 3 * 3600);
    $outs = array_filter($outs, fn($o) => $o['depart'] >= date('Y-m-d', strtotime("$from -10 days")) && $o['depart'] <= $to && in_array($o['origin'], $origins, true));
    $backs = array_filter($backs, fn($b) => in_array($b['dest'], $origins, true));
    $lo = max(1, (int) $w['min_nights'] - 7); $hi = (int) $w['max_nights'] + 7;
    $best = [];
    foreach ($outs as $o) {
        foreach ($backs as $b) {
            $n = days_between($o['depart'], $b['depart']);
            if ($b['depart'] <= $o['depart'] || $n < $lo || $n > $hi) continue;
            $k = $o['origin'] . $o['dest'] . $o['depart'] . $b['depart'];
            $price = (int) $o['price'] + (int) $b['price'];
            if (isset($best[$k]) && $best[$k]['price'] <= $price) continue;
            $best[$k] = ['origin' => $o['origin'], 'dest' => $o['dest'], 'city' => $o['city'] ?? $o['dest'], 'dest_name' => $o['dest_name'] ?? null,
                'depart' => $o['depart'], 'ret' => $b['depart'], 'nights' => $n, 'price' => $price,
                // The airline that matters for a filter is the one you fly most with; a mix shows as the outbound one.
                'airline' => $o['airline'], 'stops' => max((int) $o['stops'], (int) $b['stops']),
                'duration' => ($o['dur_out'] ?? 0) + ($b['dur_out'] ?? 0) ?: null, 'link' => $o['link'],
                'dep_time' => $o['dep_time'] ?? null, 'ret_time' => $b['dep_time'] ?? null,
                'stops_out' => (int) $o['stops'], 'stops_back' => (int) $b['stops'], 'dur_out' => $o['dur_out'] ?? null, 'dur_back' => $b['dur_out'] ?? null,
                'flight_no' => $o['flight_no'] ?? null, 'ftype' => 'split', 'legs' => [leg($o, 'out'), leg($b, 'back')],
                'airlines_all' => [$o['airline'], $b['airline']]];
        }
    }
    // An airline filter must hold for both tickets.
    usort($best, fn($a, $b) => $a['price'] <=> $b['price']);
    return array_slice(array_values($best), 0, 150);
}

/** Hubs with many long-distance flights and cheap flights from the Netherlands, Belgium and Germany. */
const HUBS = ['OSL', 'CPH', 'ARN', 'HEL', 'IST', 'LON', 'FRA', 'MAD', 'ATH'];
const HUB_NAMES = ['OSL' => 'Oslo', 'CPH' => 'Copenhagen', 'ARN' => 'Stockholm', 'HEL' => 'Helsinki', 'IST' => 'Istanbul', 'LON' => 'London', 'FRA' => 'Frankfurt', 'MAD' => 'Madrid', 'ATH' => 'Athens'];

/**
 * Advanced: trips via a cheaper city, on separate tickets. A cheap flight from home to a hub, the long flight
 * from the hub (one ticket, there and back), and a cheap flight home. Safety margins, because a missed connection
 * on separate tickets is not covered: arrive at the hub the day before (or at least 4 hours before the long
 * flight on the same day); fly home the day after you land (not before 15:00) or the day after that.
 * A night at the hub is shown, never included in the price.
 */
function via_trips(array $w, Provider $p, string $from, string $to, array $airlines): array
{
    $origins = explode(',', $w['origins']);
    $return = $w['trip'] === 'return';
    $destCc = $w['kind'] === 'country' ? $w['dest'] : (city_info($w['dest'])[1] ?? '');
    $hubs = array_values(array_filter(HUBS, fn($h) => !in_array($h, $origins, true) && $h !== $w['dest'] && (city_info($h)[1] ?? '') !== $destCc));
    if (!$hubs) return [];
    $dests = $w['kind'] === 'country' ? country_cities($w['dest'], 3) : [$w['dest']];
    $direct = (int) $w['max_stops'] === 0;
    $lastHome = $w['date_to'] ?: date('Y-m-d', strtotime($to . ' +' . ((int) $w['max_nights'] + 3) . ' days'));
    $long = sample_cached($p, $hubs, $dests, months_between($from, $to), $return, $direct, 3 * 3600);
    $posOut = sample_cached($p, $origins, $hubs, months_between(date('Y-m-d', strtotime("$from -2 days")), $to), false, false, 6 * 3600);
    $posBack = $return ? sample_cached($p, $hubs, $origins, months_between($from, $lastHome), false, false, 6 * 3600) : [];

    // Cheapest positioning flight per [airport][date], with its time.
    $index = function (array $list, string $side) {
        $o = [];
        foreach ($list as $f) {
            $a = $side === 'to' ? $f['dest'] : $f['origin'];
            $k = $a . '|' . $f['depart'];
            $o[$k][] = $f;
        }
        return $o;
    };
    $outIdx = $index(array_filter($posOut, fn($f) => in_array($f['origin'], $origins, true)), 'to');
    $backIdx = $index(array_filter($posBack, fn($f) => in_array($f['dest'], $origins, true)), 'from');
    $mins = fn(?string $t) => $t !== null && preg_match('/^(\d{2}):(\d{2})$/', $t, $m) ? (int) $m[1] * 60 + (int) $m[2] : null;
    $shift = fn(string $d, int $n) => date('Y-m-d', strtotime("$d " . ($n >= 0 ? '+' : '') . "$n days"));

    $best = [];
    foreach ($long as $l) {
        if ($return !== ($l['ret'] !== null)) continue;
        $hubAp = $l['origin'];
        if ($return && ($l['nights'] < $w['min_nights'] || $l['nights'] > $w['max_nights'])) continue;
        if ((int) $w['max_stops'] >= 0 && $l['stops'] > (int) $w['max_stops']) continue;
        if ($airlines && !in_array($l['airline'], $airlines, true)) continue;
        // To the hub: the day before (or two), or the same day with 4 hours to spare.
        $out = null;
        foreach ([0, 1, 2] as $before) {
            foreach ($outIdx[$hubAp . '|' . $shift($l['depart'], -$before)] ?? [] as $po) {
                if ($before === 0) {
                    $arr = $mins($po['dep_time'] ?? null); $dep = $mins($l['dep_time'] ?? null);
                    if ($arr === null || $dep === null || $po['dur_out'] === null || $arr + (int) $po['dur_out'] + 240 > $dep) continue;
                }
                if ($out === null || $po['price'] < $out[0]['price']) $out = [$po, $before];
            }
        }
        if ($out === null) continue;
        // Home again: the day after landing (from 15:00) or the day after that.
        $back = null;
        if ($return) {
            foreach ([1, 2] as $after) {
                foreach ($backIdx[$hubAp . '|' . $shift($l['ret'], $after)] ?? [] as $pb) {
                    if ($after === 1 && (($mins($pb['dep_time'] ?? null) ?? 0) < 15 * 60)) continue;
                    if ($back === null || $pb['price'] < $back[0]['price']) $back = [$pb, $after];
                }
            }
            if ($back === null) continue;
        }
        $homeDep = $out[0]['depart']; $homeRet = $back ? $back[0]['depart'] : null;
        if ($homeDep < $from || $homeDep > $to || ($homeRet !== null && $w['date_to'] && $homeRet > $w['date_to'])) continue;
        $price = (int) $l['price'] + (int) $out[0]['price'] + ($back ? (int) $back[0]['price'] : 0);
        $hub = HUB_NAMES[city_of($hubAp)] ?? (city_info(city_of($hubAp))[0] ?? $hubAp);
        $k = $out[0]['origin'] . $l['dest'] . $homeDep . ($homeRet ?? '') . $hubAp;
        if (isset($best[$k]) && $best[$k]['price'] <= $price) continue;
        $legs = [leg($out[0], 'to_hub'), leg($l, 'main')];
        if ($back) $legs[] = leg($back[0], 'from_hub');
        $best[$k] = ['origin' => $out[0]['origin'], 'dest' => $l['dest'], 'city' => $l['city'] ?? $l['dest'], 'dest_name' => $l['dest_name'] ?? null,
            'depart' => $homeDep, 'ret' => $homeRet, 'nights' => $l['nights'], 'price' => $price, 'airline' => $l['airline'],
            'stops' => (int) $l['stops'] + 1, 'duration' => null, 'link' => $l['link'],
            'dep_time' => $out[0]['dep_time'] ?? null, 'ret_time' => $back[0]['dep_time'] ?? null,
            'stops_out' => (int) ($l['stops_out'] ?? $l['stops']) + 1, 'stops_back' => $return ? (int) ($l['stops_back'] ?? $l['stops']) + 1 : null,
            'dur_out' => null, 'dur_back' => null, 'flight_no' => $l['flight_no'] ?? null,
            'ftype' => 'via', 'via' => $hubAp, 'legs' => ['hub' => $hub, 'hubCode' => $hubAp, 'nightsBefore' => $out[1], 'nightsAfter' => $back ? $back[1] - 1 : 0, 'flights' => $legs]];
    }
    usort($best, fn($a, $b) => $a['price'] <=> $b['price']);
    return array_slice(array_values($best), 0, 40);
}

/** A readable city name for an airport or city code ("OSL" -> "Oslo"), else the code. */
function city_name(string $code): string
{
    return HUB_NAMES[city_of($code)] ?? (city_info(city_of($code))[0] ?? $code);
}

/** City code of an airport when we know it (LHR -> LON), else the code itself. */
function city_of(string $airport): string
{
    static $map = ['LHR' => 'LON', 'LGW' => 'LON', 'STN' => 'LON', 'LTN' => 'LON', 'LCY' => 'LON', 'SAW' => 'IST', 'TRF' => 'OSL', 'NYO' => 'ARN', 'BMA' => 'ARN', 'HHN' => 'FRA'];
    return $map[$airport] ?? $airport;
}

/**
 * Which airlines fly a route, cheapest first: [code, name, price, count]. A quick sample of the next
 * two months from up to 4 departure airports (and 3 cities for a country). Cached for 6 hours.
 */
function route_airlines(array $origins, string $kind, string $dest, bool $return, int $maxStops, ?Provider $p = null): array
{
    $p ??= provider();
    $origins = array_slice($origins, 0, 4);
    $key = 'air:' . md5(json_encode([$p->name(), $origins, $kind, $dest, $return, $maxStops, today()]));
    $hit = kv($key);
    if ($hit !== null && ($c = json_decode($hit, true)) && $c['at'] > now() - 6 * 3600) return $c['list'];

    $dests = $kind === 'country' ? country_cities($dest, 3) : [$dest];
    $m0 = date('Y-m', now());
    $months = [$m0, date('Y-m', strtotime("$m0-01 +1 month"))];
    $seen = [];
    foreach ($p->sample($origins, $dests, $months, $return, $maxStops === 0) as $f) {
        if ($f['airline'] === '' || $f['depart'] < today() || ($maxStops >= 0 && $f['stops'] > $maxStops)) continue;
        if ($return !== ($f['ret'] !== null)) continue;
        $a = &$seen[$f['airline']];
        $a ??= ['code' => $f['airline'], 'name' => airline_name($f['airline']), 'price' => PHP_INT_MAX, 'count' => 0];
        $a['price'] = min($a['price'], $f['price']);
        $a['count']++;
        unset($a);
    }
    $list = array_values($seen);
    usort($list, fn($a, $b) => $a['price'] <=> $b['price']);
    kv($key, json_encode(['at' => now(), 'list' => $list]));
    // Old cache rows: drop them now and then.
    if (random_int(1, 20) === 1) q("DELETE FROM kv WHERE k LIKE 'air:%' AND k<>?", [$key]);
    return $list;
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
          . ($best['ret'] ? ' · ' . $best['nights'] . ' nights' : '') . ' · ' . stops_label((int) $best['stops'])
          . (($best['ftype'] ?? 'rt') === 'via' ? ' · via ' . (json_decode((string) $best['legs'], true)['hub'] ?? 'another city') . ', separate tickets'
            : (($best['ftype'] ?? 'rt') === 'split' ? ' · 2 one-way tickets' : ''));
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
    'VF' => 'AJet', 'FH' => 'Freebird Airlines', 'EC' => 'easyJet Europe', 'DS' => 'easyJet Switzerland', 'MK' => 'Air Mauritius', 'HM' => 'Air Seychelles', 'TC' => 'Air Tanzania', 'ER' => 'SereneAir', '8M' => 'Myanmar Airways', 'K6' => 'Cambodia Angkor Air',
];

function airline_name(?string $code): string { return $code ? (AIRLINES[$code] ?? $code) : ''; }
