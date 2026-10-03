<?php
// Dev only: run price checks as if time has passed (3 h per step, up to 12 steps, stops after an alert).
putenv('FLIGHTS_PROVIDER=demo');
putenv('FLIGHTS_NO_PUSH=1');
require __DIR__ . '/../src/app.php';
$shift = (int) (kv('sim_shift') ?? 0);
for ($i = 0; $i < 12; $i++) {
    $shift += 3 * 3600;
    putenv('FLIGHTS_NOW=' . (time() + $shift));
    $hit = false;
    foreach (q('SELECT * FROM watches WHERE paused=0')->fetchAll() as $w) {
        $r = scan_watch($w);
        if ($r['alert']) { echo $r['alert']['title'], "\n"; $hit = true; }
    }
    if ($hit) break;
}
kv('sim_shift', (string) $shift);
// keep "checked" times believable in the UI
q('UPDATE fares SET last_seen=? WHERE last_seen=(SELECT scanned_at FROM watches WHERE watches.id=fares.watch_id)', [time()]);
q('UPDATE watches SET scanned_at=?', [time()]);
q('UPDATE alerts SET created_at=? WHERE created_at>?', [time(), time()]);
