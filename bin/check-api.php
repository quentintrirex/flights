<?php
/* Checks the Aviasales token and the live price data, without touching your routes.
   php bin/check-api.php [ORIGIN] [DEST]      e.g. php bin/check-api.php AMS BKK */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__ . '/../src/app.php';

$origin = strtoupper($argv[1] ?? 'AMS');
$dest = strtoupper($argv[2] ?? 'BKK');
$token = config()['travelpayouts_token'];
if ($token === '') exit("No token yet: put it in data/config.php ('travelpayouts_token' => '...').\n");

$p = new TravelpayoutsProvider($token, config()['currency'], config()['travelpayouts_marker']);
$fail = 0;
foreach ([true, false] as $return) {
    $month = date('Y-m', strtotime('first day of next month'));
    $label = ($return ? 'return' : 'one way') . " $origin → $dest, departures in $month";
    try {
        $t = microtime(true);
        $fares = $p->fares($origin, $dest, $month, $return, false);
        $ms = round((microtime(true) - $t) * 1000);
        if (!$fares) { echo "?  $label: token OK, but no fares cached for this route/month ({$ms} ms)\n"; continue; }
        usort($fares, fn($a, $b) => $a['price'] <=> $b['price']);
        $f = $fares[0];
        $bad = array_filter($fares, fn($x) => !$x['depart'] || $x['price'] < 20 || ($return && !$x['ret']));
        printf("%s  %s: %d fares in %d ms, cheapest €%d on %s%s, %s, %s%s\n", $bad ? 'X' : 'OK', $label, count($fares), $ms, $f['price'], $f['depart'],
            $f['ret'] ? " back {$f['ret']} ({$f['nights']} nights)" : '', stops_label($f['stops']), airline_name($f['airline']) ?: '?', $f['link'] ? '' : ' (no booking link)');
        if ($f['link']) echo "    booking link: {$f['link']}\n";
        if ($bad) { $fail++; echo '    ' . count($bad) . " fares look wrong\n"; }
    } catch (Throwable $e) {
        $fail++;
        echo "X  $label: {$e->getMessage()}\n";
    }
}
try {
    $c = city_info($dest)[1] ?? null;
    if ($c) {
        $fares = $p->faresToCountry($origin, $c, date('Y-m', strtotime('first day of next month')), true, false);
        $cities = array_unique(array_map(fn($f) => $f['dest_name'] ?? $f['dest'], $fares));
        printf("%s  anywhere in %s: %d fares to %s\n", $fares ? 'OK' : '?', $c, count($fares), implode(', ', $cities) ?: '-');
    }
} catch (Throwable $e) {
    $fail++;
    echo "X  country search: {$e->getMessage()}\n";
}
exit($fail ? 1 : 0);
