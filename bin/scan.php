<?php
/* Cron entry: checks every active route that is due, sends alerts.
   Plesk > Scheduled Tasks: every hour,  php /var/www/vhosts/trirexio.com/httpdocs/private/flights/bin/scan.php */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/../src/app.php';

$lock = fopen(DATA_DIR . '/scan.lock', 'c');
if (!flock($lock, LOCK_EX | LOCK_NB)) { echo "Another scan is running.\n"; exit(0); }

$force = in_array('--all', $argv, true);
$due = now() - (int) (config()['scan_every_hours'] * 3600) + 300;   // 5 min slack so an hourly cron lands on time
$p = provider();
foreach (q('SELECT * FROM watches WHERE paused=0 ORDER BY COALESCE(scanned_at,0)')->fetchAll() as $w) {
    if (!$force && $w['scanned_at'] && $w['scanned_at'] > $due) continue;
    $r = scan_watch($w, $p);
    printf("%s %-14s %s\n", date('Y-m-d H:i'), $w['dest_city'],
        $r['ok'] ? "{$r['fares']} fares, low {$r['low']}, normal {$r['normal']}" . ($r['alert'] ? "  ALERT {$r['alert']['title']}" : '') : "ERROR {$r['error']}");
}
// Keep the database small: fares not seen for 30 days, alerts older than a year.
q('DELETE FROM fares WHERE last_seen < ?', [now() - 30 * 86400]);
q('DELETE FROM alerts WHERE created_at < ?', [now() - 365 * 86400]);
