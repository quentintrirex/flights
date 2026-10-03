<?php
// Dev only: fresh demo database with 30 days of history (checks every 6 hours). php dev/seed.php
putenv('FLIGHTS_PROVIDER=demo');
putenv('FLIGHTS_NO_PUSH=1');
foreach (glob(__DIR__ . '/../data/flights.sqlite*') as $f) unlink($f);
require __DIR__ . '/../src/app.php';

$start = time() - 30 * 86400;
$routes = [
    ['AMS,EIN,RTM', 'BKK', 'Bangkok', 'Thailand', 'city', 6, 7, 21, 1, 'great'],
    ['AMS,EIN,RTM', 'TH', 'Thailand', 'Thailand', 'country', 3, 10, 21, 1, 'great'],
    ['AMS', 'DPS', 'Bali', 'Indonesia', 'city', 6, 14, 28, 1, 'great'],
    ['AMS,BRU,DUS', 'TYO', 'Tokyo', 'Japan', 'city', 12, 10, 21, 1, 'extreme'],
];
foreach ($routes as $r) {
    q('INSERT INTO watches(origins,dest,dest_city,dest_country,kind,months,min_nights,max_nights,max_stops,alert,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', [...$r, $start]);
}
for ($t = $start; $t <= time(); $t += 6 * 3600) {
    putenv('FLIGHTS_NOW=' . $t);
    foreach (q('SELECT * FROM watches')->fetchAll() as $w) {
        $res = scan_watch($w);
        if ($res['alert']) echo date('j M', $t), '  ', $res['alert']['title'], "\n";
    }
}
q('UPDATE alerts SET read_at=? WHERE created_at < ?', [time(), time() - 2 * 86400]);
echo 'history rows: ', q('SELECT COUNT(*) FROM history')->fetchColumn(), "\n";
