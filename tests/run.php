<?php
/* php -c dev/php.ini tests/run.php */
declare(strict_types=1);

$tmp = sys_get_temp_dir() . '/flights-test-' . getmypid() . '.sqlite';
putenv("FLIGHTS_DB=$tmp");
putenv('FLIGHTS_PROVIDER=demo');
putenv('FLIGHTS_NO_PUSH=1');
require __DIR__ . '/../src/app.php';

$pass = 0; $fail = 0;
function check(string $name, bool $ok, string $info = ''): void
{
    global $pass, $fail;
    $ok ? $pass++ : $fail++;
    echo ($ok ? '  ok  ' : '  FAIL ') . $name . ($ok || $info === '' ? '' : "  ($info)") . "\n";
}

echo "Web Push (RFC 8291 test vector)\n";
$ua  = b64u_dec('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4');
$as  = ec_private_from_raw(b64u_dec('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
                           b64u_dec('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'));
$expected = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
$salt = substr(b64u_dec($expected), 0, 16);
$got = b64u(webpush_encrypt('When I grow up, I want to be a watermelon', $ua, b64u_dec('BTBZMqHH6r4Tts7J_aSIgg'), $as, $salt));
check('encrypted body matches RFC 8291 example byte for byte', $got === $expected, $got);

$h = vapid_header('https://web.push.apple.com/abc');
preg_match('/t=([^.]+)\.([^.]+)\.([^,]+), k=(\S+)/', $h, $m);
$claims = json_decode(b64u_dec($m[2]), true);
check('VAPID audience is the push origin', $claims['aud'] === 'https://web.push.apple.com');
check('VAPID has subject and expiry', !empty($claims['sub']) && $claims['exp'] > time());
$sig = b64u_dec($m[3]);
$derInt = fn($v) => "\x02" . chr(strlen($v = (ord($v[0]) > 127 ? "\0" : '') . ltrim($v, "\0") ?: "\0")) . $v;
$der = $derInt(substr($sig, 0, 32)) . $derInt(substr($sig, 32));
$der = "\x30" . chr(strlen($der)) . $der;
check('VAPID JWT signature verifies with the public key', openssl_verify("$m[1].$m[2]", $der, ec_public_from_raw(b64u_dec($m[4])), OPENSSL_ALGO_SHA256) === 1);
unlink(DATA_DIR . '/vapid.pem') ?: null;

echo "Deal levels\n";
check('55% of normal = extreme', level_for(550, 1000) === 'extreme');
check('70% = great', level_for(700, 1000) === 'great');
check('85% = good', level_for(850, 1000) === 'good');
check('86% = no deal', level_for(860, 1000) === 'none');
check('no normal price yet = no deal', level_for(100, null) === 'none');
check('median', median([5, 1, 3]) === 3 && median([1, 2, 3, 4]) === 3);

echo "Aviasales response mapping\n";
$f = TravelpayoutsProvider::normalise(['origin' => 'AMS', 'destination' => 'BKK', 'origin_airport' => 'AMS', 'destination_airport' => 'BKK',
    'price' => 412.6, 'airline' => 'EY', 'flight_number' => '38', 'departure_at' => '2027-01-12T21:30:00+01:00',
    'return_at' => '2027-01-26T09:10:00+07:00', 'transfers' => 1, 'return_transfers' => 2, 'duration' => 1650, 'duration_to' => 790, 'duration_back' => 860,
    'link' => '/search/AMS1201BKK26011?t=EY'], 'm123');
check('dates, nights, price', $f['depart'] === '2027-01-12' && $f['ret'] === '2027-01-26' && $f['nights'] === 14 && $f['price'] === 413);
check('stops = worst leg', $f['stops'] === 2);
check('booking link with marker', $f['link'] === 'https://www.aviasales.com/search/AMS1201BKK26011?t=EY&marker=m123');
check('trip details per leg', $f['dep_time'] === '21:30' && $f['ret_time'] === '09:10' && $f['stops_out'] === 1 && $f['stops_back'] === 2
    && $f['dur_out'] === 790 && $f['dur_back'] === 860 && $f['flight_no'] === 'EY 38', json_encode($f));
$o = TravelpayoutsProvider::normalise(['origin' => 'AMS', 'destination' => 'BCN', 'price' => 80, 'airline' => 'HV', 'flight_number' => '<b>5131</b>', 'departure_at' => '2027-02-01']);
check('one way without times: no leg 2, junk flight number dropped', $o['dep_time'] === null && $o['stops_back'] === null && $o['dur_back'] === null && $o['flight_no'] === null, json_encode($o));
check('rows without price are skipped', TravelpayoutsProvider::normalise(['departure_at' => '2027-01-01']) === null);

echo "Scanning and alerts (demo data)\n";
putenv('FLIGHTS_NOW=' . strtotime('2026-10-03 09:00'));
q('INSERT INTO watches(origins,dest,dest_city,trip,months,min_nights,max_nights,max_stops,alert,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
  ['AMS,EIN', 'BKK', 'Bangkok', 'return', 4, 7, 21, 1, 'good', now()]);
$w = watch(1);
$r = scan_watch($w);
$w = watch(1);
check('first scan finds fares', $r['ok'] && $r['fares'] > 20, json_encode($r));
check('normal price set', $w['normal_price'] > 0);
check('first scan raises no alert (baseline)', $r['alert'] === null && (int) q('SELECT COUNT(*) FROM alerts')->fetchColumn() === 0);
$bad = q('SELECT COUNT(*) FROM fares WHERE stops>1 OR nights<7 OR nights>21 OR depart<?', ['2026-10-03'])->fetchColumn();
check('filters: stops, nights, past dates', (int) $bad === 0);

$alerts = 0;
for ($i = 1; $i <= 16; $i++) {
    putenv('FLIGHTS_NOW=' . (strtotime('2026-10-03 09:00') + $i * 3 * 3600));
    $r = scan_watch(watch(1));
    if ($r['alert']) $alerts++;
}
$n = (int) q('SELECT COUNT(*) FROM alerts')->fetchColumn();
check('later scans raise grouped alerts', $alerts > 0 && $n === $alerts, "alerts=$alerts rows=$n");
$rows = q('SELECT price, level, created_at FROM alerts ORDER BY id')->fetchAll();
$quiet = true;
foreach ($rows as $i => $r) foreach (array_slice($rows, 0, $i) as $p)
    if ($r['created_at'] - $p['created_at'] < 7 * 86400 && $r['price'] > $p['price'] * 0.95 && RANK[$r['level']] <= RANK[$p['level']]) $quiet = false;
check('quiet rule: within 7 days only clearly better fares alert again', $quiet);
$a = q('SELECT * FROM alerts ORDER BY id LIMIT 1')->fetch();
check('alert text', str_contains($a['title'], 'Bangkok for €') && str_contains($a['body'], 'below normal'), $a['title'] . ' | ' . $a['body']);
$before = $n;
putenv('FLIGHTS_NOW=' . (strtotime('2026-10-03 09:00') + 16 * 3 * 3600 + 60));
scan_watch(watch(1));
check('same prices again = no duplicate alert', (int) q('SELECT COUNT(*) FROM alerts')->fetchColumn() === $before);
check('history kept per day', (int) q('SELECT COUNT(*) FROM history WHERE watch_id=1')->fetchColumn() >= 2);

q('DELETE FROM alerts');
q('UPDATE fares SET notified_price=NULL');
q('UPDATE watches SET max_price=99999, alert=? WHERE id=1', ['extreme']);
putenv('FLIGHTS_NOW=' . (strtotime('2026-10-03 09:00') + 20 * 3 * 3600));
$r = scan_watch(watch(1));
check('target price triggers alert', $r['alert'] !== null);

echo "Date windows\n";
putenv('FLIGHTS_NOW=' . strtotime('2026-10-03 09:00'));
check('rolling window: today + 3 months', window_of(['date_from' => null, 'date_to' => null, 'months' => 3]) === ['2026-10-03', '2027-01-03']);
check('custom window kept', window_of(['date_from' => '2026-12-01', 'date_to' => '2026-12-31', 'months' => 3]) === ['2026-12-01', '2026-12-31']);
check('custom window never starts in the past', window_of(['date_from' => '2026-09-01', 'date_to' => '2026-10-20', 'months' => 3])[0] === '2026-10-03');
check('months covering a window', months_between('2026-10-03', '2027-01-03') === ['2026-10', '2026-11', '2026-12', '2027-01']);
q('INSERT INTO watches(origins,dest,dest_city,trip,months,min_nights,max_nights,max_stops,alert,created_at,date_from,date_to) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
  ['AMS', 'DPS', 'Bali', 'return', 3, 7, 21, -1, 'great', now(), '2026-12-10', '2026-12-20']);
$r = scan_watch(watch(2));
$out = (int) q("SELECT COUNT(*) FROM fares WHERE watch_id=2 AND (depart<'2026-12-10' OR depart>'2026-12-20')")->fetchColumn();
check('custom dates: only departures inside the window', $r['ok'] && $r['fares'] > 0 && $out === 0, json_encode($r));

echo "Country routes\n";
q("INSERT INTO watches(origins,dest,dest_city,kind,trip,months,min_nights,max_nights,max_stops,alert,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  ['AMS', 'TH', 'Thailand', 'country', 'return', 2, 7, 21, 1, 'great', now()]);
$r = scan_watch(watch(3));
$cities = q('SELECT DISTINCT dest FROM fares WHERE watch_id=3')->fetchAll(PDO::FETCH_COLUMN);
check('anywhere in Thailand: several cities', $r['ok'] && count($cities) >= 3, implode(',', $cities));
check('all of them in Thailand', !array_filter($cities, fn($c) => (city_info($c)[1] ?? '') !== 'TH'));
check('fares carry the city name', (int) q("SELECT COUNT(*) FROM fares WHERE watch_id=3 AND (dest_name IS NULL OR dest_name='')")->fetchColumn() === 0);

echo "Airline filter\n";
q("INSERT INTO watches(origins,dest,dest_city,trip,months,min_nights,max_nights,max_stops,alert,created_at,airlines) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  ['AMS', 'BKK', 'Bangkok', 'return', 3, 7, 21, 1, 'great', now(), 'KL,TK']);
$r = scan_watch(watch(4));
$al = q('SELECT DISTINCT airline FROM fares WHERE watch_id=4')->fetchAll(PDO::FETCH_COLUMN);
check('route with airlines keeps only those', $r['ok'] && $al && !array_diff($al, ['KL', 'TK']), implode(',', $al));
check('fares store leg details', (int) q('SELECT COUNT(*) FROM fares WHERE watch_id=4 AND (dep_time IS NULL OR dur_out IS NULL OR flight_no IS NULL)')->fetchColumn() === 0);

echo "Security helpers\n";
check('push: Apple accepted', push_host_ok('https://web.push.apple.com/QK1'));
check('push: Google accepted', push_host_ok('https://fcm.googleapis.com/fcm/send/x'));
check('push: random host refused', !push_host_ok('https://evil.example.com/x') && !push_host_ok('https://push.apple.com.evil.com/x'));
check('push: internal address refused', !push_host_ok('https://127.0.0.1/x') && !push_host_ok('https://localhost/x'));
check('booking links only https aviasales', TravelpayoutsProvider::normalise(['price' => 1, 'departure_at' => '2027-01-01', 'origin' => 'AMS', 'destination' => 'BKK', 'link' => 'javascript:alert(1)'])['link'] === null);
check('junk codes are dropped', TravelpayoutsProvider::normalise(['price' => 1, 'departure_at' => '2027-01-01', 'origin' => '<x>', 'destination' => 'BKK']) === null);

q('DELETE FROM watches WHERE id=1');
check('deleting a route removes its fares', (int) q('SELECT COUNT(*) FROM fares WHERE watch_id=1')->fetchColumn() === 0 && (int) q('SELECT COUNT(*) FROM fares')->fetchColumn() > 0);

echo "\n$pass passed, $fail failed\n";
db(); $GLOBALS['pdo'] = null;
@unlink($tmp);
exit($fail ? 1 : 0);
