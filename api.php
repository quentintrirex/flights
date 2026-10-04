<?php
/* JSON API for the app. On trirexio.com the /private/ gate (PIN) runs before this file. */
declare(strict_types=1);
require __DIR__ . '/src/app.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");

function out($data, int $code = 200): never
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

$a = (string) ($_GET['a'] ?? '');
$post = $_SERVER['REQUEST_METHOD'] === 'POST';
// Changes need our own header: other sites cannot send it without a CORS preflight we never allow.
if ($post && ($_SERVER['HTTP_X_FLIGHTS'] ?? '') !== '1') out(['error' => 'forbidden'], 403);
if ($post && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 20000) out(['error' => 'Too large'], 413);
$in = $post ? json_decode((string) file_get_contents('php://input'), true) : [];
if (!is_array($in)) $in = [];
$writes = ['save', 'scan', 'pause', 'delete', 'read', 'push.subscribe', 'push.test'];
if (in_array($a, $writes, true) && !$post) out(['error' => 'POST only'], 405);

/* ------------------------------------------------------------------ views */

function watch_view(array $w): array
{
    $hist = q('SELECT low FROM history WHERE watch_id=? ORDER BY day DESC LIMIT 30', [$w['id']])->fetchAll(PDO::FETCH_COLUMN);
    [$from, $to] = window_of($w);
    $prev = q('SELECT low FROM history WHERE watch_id=? AND day<? ORDER BY day DESC LIMIT 1', [$w['id'], today()])->fetchColumn();
    return [
        'id' => $w['id'], 'kind' => $w['kind'], 'origins' => explode(',', $w['origins']), 'dest' => $w['dest'], 'city' => $w['dest_city'],
        'country' => $w['dest_country'], 'trip' => $w['trip'], 'months' => $w['months'],
        'dateFrom' => $w['date_from'], 'dateTo' => $w['date_to'], 'from' => $from, 'to' => $to,
        'minNights' => $w['min_nights'], 'maxNights' => $w['max_nights'], 'maxStops' => $w['max_stops'],
        'alert' => $w['alert'], 'maxPrice' => $w['max_price'], 'paused' => (bool) $w['paused'],
        'airlines' => array_values(array_filter(explode(',', (string) $w['airlines']))),
        'scannedAt' => $w['scanned_at'], 'error' => $w['scan_error'], 'normal' => $w['normal_price'],
        'low' => $w['low_price'], 'level' => $w['low_price'] ? level_for((int) $w['low_price'], $w['normal_price']) : 'none',
        'change' => $prev && $w['low_price'] ? round(($w['low_price'] - $prev) / $prev * 100) : null,
        'cities' => $w['kind'] === 'country' ? array_map(fn($c) => city_info($c)[0] ?? $c, country_cities($w['dest'], 6)) : [],
        'history' => array_reverse(array_map('intval', $hist)),
    ];
}

function fare_view(array $f, array $w): array
{
    return [
        'id' => $f['id'], 'origin' => $f['origin'], 'dest' => $f['dest'], 'destName' => $f['dest_name'],
        'depart' => $f['depart'], 'ret' => $f['ret'], 'nights' => $f['nights'], 'price' => $f['price'],
        'airline' => $f['airline'], 'airlineName' => airline_name($f['airline']), 'stops' => $f['stops'],
        'duration' => $f['duration'], 'book' => $f['link'], 'google' => google_flights_url($f),
        'depTime' => $f['dep_time'], 'retTime' => $f['ret_time'], 'flightNo' => $f['flight_no'],
        'stopsOut' => $f['stops_out'], 'stopsBack' => $f['stops_back'], 'durOut' => $f['dur_out'], 'durBack' => $f['dur_back'],
        'level' => level_for((int) $f['price'], $w['normal_price']),
        'isNew' => $w['scans'] > 1 && $f['first_seen'] >= now() - 86400 && $f['first_seen'] > $w['created_at'] + 3600,
    ];
}

/** Airline codes from a request (?air=KL,HV), for a quick filter on the route screen. */
function air_param(): array
{
    $codes = array_map('strtoupper', explode(',', (string) ($_GET['air'] ?? '')));
    return array_slice(array_values(array_unique(array_filter($codes, fn($c) => preg_match('/^[A-Z0-9]{2,3}$/', $c)))), 0, 20);
}

/** Everything the route screen shows: stats, history, calendar and breakdowns. $air narrows it to some airlines. */
function route_detail(array $w, array $air = []): array
{
    $all = live_fares($w);
    $fares = $air ? array_values(array_filter($all, fn($f) => in_array($f['airline'], $air, true))) : $all;
    $min = function (array $rows, callable $key): array {
        $o = [];
        foreach ($rows as $f) {
            $k = $key($f);
            if ($k === null || $k === '') continue;
            $o[$k] ??= ['key' => $k, 'price' => PHP_INT_MAX, 'count' => 0];
            $o[$k]['price'] = min($o[$k]['price'], (int) $f['price']);
            $o[$k]['count']++;
        }
        usort($o, fn($a, $b) => $a['price'] <=> $b['price']);
        return array_values($o);
    };
    $calendar = [];
    foreach ($fares as $f) $calendar[$f['depart']] = min($calendar[$f['depart']] ?? PHP_INT_MAX, (int) $f['price']);
    ksort($calendar);

    $history = q('SELECT day, low, normal, fares FROM history WHERE watch_id=? ORDER BY day DESC LIMIT 120', [$w['id']])->fetchAll();
    $history = array_reverse($history);
    $ever = q('SELECT low, day FROM history WHERE watch_id=? ORDER BY low, day LIMIT 1', [$w['id']])->fetch();
    $weekAgo = q('SELECT low FROM history WHERE watch_id=? AND day<=? ORDER BY day DESC LIMIT 1', [$w['id'], date('Y-m-d', now() - 7 * 86400)])->fetchColumn();

    $wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    $byWeekday = $min($fares, fn($f) => $wd[(int) date('N', strtotime($f['depart'])) - 1]);
    usort($byWeekday, fn($a, $b) => array_search($a['key'], $wd) <=> array_search($b['key'], $wd));

    return [
        'watch' => watch_view($w),
        'fares' => array_map(fn($f) => fare_view($f, $w), array_slice($fares, 0, 40)),
        'total' => count($fares),
        'stats' => [
            'lowestEver' => $ever ? (int) $ever['low'] : null, 'lowestEverDay' => $ever['day'] ?? null,
            'week' => $weekAgo && $w['low_price'] ? round(($w['low_price'] - $weekAgo) / $weekAgo * 100) : null,
            'days' => count($history), 'cheapestDirect' => ($d = array_filter($fares, fn($f) => (int) $f['stops'] === 0)) ? (int) min(array_column($d, 'price')) : null,
        ],
        'history' => array_map(fn($h) => ['day' => $h['day'], 'low' => (int) $h['low'], 'normal' => $h['normal'] ? (int) $h['normal'] : null], $history),
        'calendar' => $calendar,
        'byOrigin' => $min($fares, fn($f) => $f['origin']),
        'byAirline' => array_map(fn($r) => $r + ['name' => airline_name($r['key'])], array_slice($min($fares, fn($f) => $f['airline']), 0, 6)),
        // Every airline on this route (before the quick filter), cheapest first: the filter chips.
        'airlines' => array_map(fn($r) => $r + ['name' => airline_name($r['key'])], $min($all, fn($f) => $f['airline'])),
        'air' => $air,
        'byWeekday' => $byWeekday,
        'byCity' => $w['kind'] === 'country' ? $min($fares, fn($f) => $f['dest_name'] ?: $f['dest']) : [],
        'byStops' => $min($fares, fn($f) => stops_label((int) $f['stops'])),
        // How the price moves with the length of the trip (return routes), shortest first.
        'byNights' => (function () use ($fares, $min) {
            $buckets = [4 => 'Up to 4 nights', 7 => '5–7 nights', 10 => '8–10 nights', 14 => '11–14 nights', 21 => '15–21 nights', 999 => '22+ nights'];
            $label = function ($n) use ($buckets) { if (!$n) return null; foreach ($buckets as $max => $l) if ($n <= $max) return $l; return null; };
            $rows = $min($fares, fn($f) => $label((int) $f['nights']));
            $order = array_flip(array_values($buckets));
            usort($rows, fn($a, $b) => $order[$a['key']] <=> $order[$b['key']]);
            return $rows;
        })(),
        'alerts' => q('SELECT title, body, level, created_at AS at FROM alerts WHERE watch_id=? ORDER BY id DESC LIMIT 8', [$w['id']])->fetchAll(),
    ];
}

/* ------------------------------------------------------------------ saving */

function clean_date($v): ?string
{
    $v = (string) $v;
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) && strtotime($v) ? $v : null;
}

function save_watch(array $in, ?int $id = null): int
{
    $origins = array_values(array_unique(array_filter(array_map(fn($o) => strtoupper(trim((string) $o)), (array) ($in['origins'] ?? [])),
        fn($o) => preg_match('/^[A-Z]{3}$/', $o))));
    $kind = ($in['kind'] ?? 'city') === 'country' ? 'country' : 'city';
    $dest = strtoupper(trim((string) ($in['dest'] ?? '')));
    if (!$origins || count($origins) > 6) out(['error' => 'Pick 1 to 6 airports to fly from.'], 422);
    if (!preg_match($kind === 'country' ? '/^[A-Z]{2}$/' : '/^[A-Z]{3}$/', $dest)) out(['error' => 'Pick a destination from the list.'], 422);
    if (in_array($dest, $origins, true)) out(['error' => 'From and to are the same.'], 422);
    $min = max(1, min(60, (int) ($in['minNights'] ?? 7)));
    $max = max($min, min(90, (int) ($in['maxNights'] ?? 21)));
    $from = clean_date($in['dateFrom'] ?? null);
    $to = clean_date($in['dateTo'] ?? null);
    if ($from || $to) {
        if (!$from || !$to) out(['error' => 'Pick both dates.'], 422);
        if ($to < $from) [$from, $to] = [$to, $from];
        if ($to < today()) out(['error' => 'Those dates are in the past.'], 422);
        if ($to > date('Y-m-d', strtotime(today() . ' +12 months'))) out(['error' => 'Prices are only known up to a year ahead.'], 422);
    }
    $clip = fn($s, $n) => mb_substr(trim(preg_replace('/[\x00-\x1F\x7F]/u', '', (string) $s)), 0, $n);
    // Only these airlines (empty = any). Two or three letter codes, at most 12.
    $airlines = array_values(array_unique(array_filter(array_map(fn($a) => strtoupper(trim((string) $a)), (array) ($in['airlines'] ?? [])),
        fn($a) => preg_match('/^[A-Z0-9]{2,3}$/', $a))));
    if (count($airlines) > 12) out(['error' => 'Pick at most 12 airlines.'], 422);
    $airlines = implode(',', $airlines);
    $row = [
        implode(',', $origins), $dest, $clip($in['city'] ?? '', 60) ?: $dest, $clip($in['country'] ?? '', 60),
        ($in['trip'] ?? 'return') === 'oneway' ? 'oneway' : 'return', max(1, min(12, (int) ($in['months'] ?? 3))),
        $min, $max, max(-1, min(2, (int) ($in['maxStops'] ?? 1))),
        in_array($in['alert'] ?? '', ['good', 'great', 'extreme'], true) ? $in['alert'] : 'great',
        !empty($in['maxPrice']) ? max(1, min(100000, (int) $in['maxPrice'])) : null, $kind, $from, $to, $airlines,
    ];
    $cols = 'origins=?,dest=?,dest_city=?,dest_country=?,trip=?,months=?,min_nights=?,max_nights=?,max_stops=?,alert=?,max_price=?,kind=?,date_from=?,date_to=?,airlines=?';
    if ($id) {
        $old = watch($id) ?? out(['error' => 'Route not found.'], 404);
        // Different route or search: start over, so the first check sets a new baseline instead of alerting.
        $same = $old['origins'] === $row[0] && $old['dest'] === $row[1] && $old['trip'] === $row[4] && $old['kind'] === $kind
             && (int) $old['max_stops'] === $row[8] && (int) $old['min_nights'] === $min && (int) $old['max_nights'] === $max
             && (string) $old['airlines'] === $airlines;
        // Always check again after an edit (the dates or filters may have changed what matches).
        q("UPDATE watches SET $cols, scans=?, normal_price=?, scanned_at=NULL, scan_error=NULL WHERE id=?",
          [...$row, $same ? $old['scans'] : 0, $same ? $old['normal_price'] : null, $id]);
        if (!$same) { q('DELETE FROM history WHERE watch_id=?', [$id]); q('DELETE FROM fares WHERE watch_id=?', [$id]); }
        return $id;
    }
    if ((int) q('SELECT COUNT(*) FROM watches')->fetchColumn() >= 25) out(['error' => 'That is a lot of routes. Delete one first (max 25).'], 422);
    q("INSERT INTO watches(origins,dest,dest_city,dest_country,trip,months,min_nights,max_nights,max_stops,alert,max_price,kind,date_from,date_to,airlines,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [...$row, now()]);
    return (int) db()->lastInsertId();
}

/** Answer now, keep checking prices after the response (PHP-FPM); plain PHP just finishes first. */
function respond_then(array $data, callable $then): never
{
    if (function_exists('fastcgi_finish_request')) {
        ignore_user_abort(true);
        echo json_encode($data, JSON_UNESCAPED_SLASHES);
        fastcgi_finish_request();
        try { $then(); } catch (Throwable $e) { error_log('flights scan: ' . $e->getMessage()); }
        exit;
    }
    try { $then(); } catch (Throwable $e) { error_log('flights scan: ' . $e->getMessage()); }
    out($data);
}


/* ------------------------------------------------------------------ actions */

try {
    switch ($a) {
        case 'state':
            $watches = q('SELECT * FROM watches ORDER BY paused, COALESCE(low_price*1.0/normal_price, 9), id')->fetchAll();
            out([
                'watches' => array_map('watch_view', $watches),
                'unread' => (int) q('SELECT COUNT(*) FROM alerts WHERE read_at IS NULL')->fetchColumn(),
                'source' => provider()->name(),
                'everyHours' => (int) config()['scan_every_hours'],
                'vapid' => vapid_public(),
            ]);

        case 'route':
            $w = watch((int) ($_GET['id'] ?? 0)) ?? out(['error' => 'Route not found.'], 404);
            out(route_detail($w, air_param()));

        case 'fares':
            $w = watch((int) ($_GET['id'] ?? 0)) ?? out(['error' => 'Route not found.'], 404);
            $day = clean_date($_GET['day'] ?? '') ?? out(['error' => 'Bad date'], 422);
            $rows = q('SELECT * FROM fares WHERE watch_id=? AND last_seen=? AND depart=? ORDER BY price LIMIT 200', [$w['id'], (int) $w['scanned_at'], $day])->fetchAll();
            if ($air = air_param()) $rows = array_filter($rows, fn($f) => in_array($f['airline'], $air, true));
            $rows = array_slice(array_values($rows), 0, 20);
            out(['fares' => array_map(fn($f) => fare_view($f, $w), $rows)]);

        case 'save':
            $id = save_watch($in, isset($in['id']) ? (int) $in['id'] : null);
            $w = watch($id);
            if ($w['scanned_at']) out(['id' => $id]);
            respond_then(['id' => $id, 'scanning' => true], fn() => scan_watch($w));

        case 'scan':
            $w = watch((int) ($in['id'] ?? 0)) ?? out(['error' => 'Route not found.'], 404);
            if ($w['scanned_at'] && $w['scanned_at'] > now() - 60) out(['ok' => true, 'skipped' => true]);
            out(scan_watch($w));

        case 'pause':
            q('UPDATE watches SET paused=? WHERE id=?', [empty($in['paused']) ? 0 : 1, (int) ($in['id'] ?? 0)]);
            out(['ok' => true]);

        case 'delete':
            q('DELETE FROM watches WHERE id=?', [(int) ($in['id'] ?? 0)]);
            out(['ok' => true]);

        case 'alerts':
            out(['alerts' => q('SELECT a.id, a.watch_id AS route, a.level, a.title, a.body, a.created_at AS at, a.read_at IS NULL AS unread
                                FROM alerts a ORDER BY a.id DESC LIMIT 50')->fetchAll()]);

        case 'read':
            q('UPDATE alerts SET read_at=? WHERE read_at IS NULL', [now()]);
            out(['ok' => true]);

        case 'push.subscribe':
            $ep = (string) ($in['endpoint'] ?? '');
            $p = (string) ($in['keys']['p256dh'] ?? '');
            $au = (string) ($in['keys']['auth'] ?? '');
            if (!str_starts_with($ep, 'https://') || strlen($ep) > 1000 || !push_host_ok($ep)) out(['error' => 'Unknown push service'], 422);
            if (strlen(b64u_dec($p)) !== 65 || strlen(b64u_dec($au)) !== 16) out(['error' => 'Bad subscription'], 422);
            ec_public_from_raw(b64u_dec($p));
            if ((int) q('SELECT COUNT(*) FROM push_subs')->fetchColumn() >= 10) q('DELETE FROM push_subs WHERE id=(SELECT MIN(id) FROM push_subs)');
            q('INSERT INTO push_subs(endpoint,p256dh,auth,created_at) VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, fails=0',
              [$ep, $p, $au, now()]);
            out(['ok' => true]);

        case 'push.test':
            $n = push_all(['title' => 'Notifications are on', 'body' => 'You will hear from me when a fare gets really cheap.', 'url' => './', 'tag' => 'test']);
            out(['sent' => $n]);

        case 'airlines':
            // Which airlines fly this route (for the airline picker), before the route is saved.
            $origins = array_values(array_unique(array_filter(explode(',', strtoupper((string) ($_GET['origins'] ?? ''))), fn($o) => preg_match('/^[A-Z]{3}$/', $o))));
            $kind = ($_GET['kind'] ?? 'city') === 'country' ? 'country' : 'city';
            $dest = strtoupper((string) ($_GET['dest'] ?? ''));
            if (!$origins || !preg_match($kind === 'country' ? '/^[A-Z]{2}$/' : '/^[A-Z]{3}$/', $dest)) out(['airlines' => []]);
            out(['airlines' => route_airlines($origins, $kind, $dest, ($_GET['trip'] ?? 'return') !== 'oneway', max(-1, min(2, (int) ($_GET['stops'] ?? 1))))]);

        case 'places':
            // Destination search: built-in list first, then Aviasales' public autocomplete (no token needed).
            $term = mb_strtolower(trim(mb_substr((string) ($_GET['q'] ?? ''), 0, 40)));
            if (mb_strlen($term) < 2) out(['places' => []]);
            $res = [];
            $ch = curl_init('https://autocomplete.travelpayouts.com/places2?' . http_build_query(['term' => $term, 'locale' => 'en', 'types' => ['country', 'city', 'airport']]));
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5, CURLOPT_CONNECTTIMEOUT => 3]);
            $raw = json_decode((string) curl_exec($ch), true);
            curl_close($ch);
            foreach (is_array($raw) ? $raw : [] as $p) {
                if (!is_array($p) || empty($p['code']) || !preg_match('/^[A-Z]{2,3}$/', (string) $p['code'])) continue;
                if ($p['type'] === 'country') {
                    $res[] = ['kind' => 'country', 'code' => $p['code'], 'city' => (string) $p['name'], 'country' => (string) $p['name'], 'airport' => ''];
                } else {
                    $res[] = ['kind' => 'city', 'code' => $p['code'], 'city' => (string) ($p['type'] === 'airport' ? ($p['city_name'] ?? $p['name']) : $p['name']),
                              'country' => (string) ($p['country_name'] ?? ''), 'airport' => $p['type'] === 'airport' ? (string) $p['name'] : ''];
                }
            }
            $seen = [];
            $res = array_values(array_filter($res, function ($p) use (&$seen) { $k = $p['kind'] . $p['code']; if (isset($seen[$k])) return false; return $seen[$k] = true; }));
            out(['places' => array_slice($res, 0, 8)]);
    }
    out(['error' => 'Unknown action'], 404);
} catch (Throwable $e) {
    error_log('flights api: ' . $e->getMessage());
    out(['error' => 'Something went wrong. Try again in a moment.'], 500);
}
