<?php
/*
 * Airline logo, e.g. logo.php?c=KL. Fetched once from Aviasales' logo service (the same company whose
 * prices we use) and kept in data/logos, so the phone never talks to another site and the page's
 * strict CSP (img-src 'self') stays as it is. Unknown or failed: 404, and the app shows the code badge.
 * On trirexio.com the /private/ gate (PIN) runs before this file.
 */
declare(strict_types=1);

$c = strtoupper((string) ($_GET['c'] ?? ''));
header('X-Content-Type-Options: nosniff');
if (!preg_match('/^[A-Z0-9]{2}$/', $c)) { http_response_code(400); exit; }

$dir = __DIR__ . '/data/logos';
if (!is_dir($dir)) @mkdir($dir, 0770, true);
$file = "$dir/$c.png";
$none = "$dir/$c.none";

if (!is_file($file) && !(is_file($none) && filemtime($none) > time() - 7 * 86400) && !getenv('FLIGHTS_OFFLINE')) {
    $ch = curl_init("https://pics.avs.io/al_square/64/64/$c@2x.png");
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_FOLLOWLOCATION => false]);
    $png = curl_exec($ch);
    $ok = curl_getinfo($ch, CURLINFO_RESPONSE_CODE) === 200 && str_starts_with((string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE), 'image/png');
    curl_close($ch);
    // Only a real, small PNG is kept.
    if ($ok && is_string($png) && strlen($png) > 200 && strlen($png) < 200000 && str_starts_with($png, "\x89PNG")) {
        file_put_contents("$file.tmp", $png);
        rename("$file.tmp", $file);
        @unlink($none);
    } else {
        @touch($none);
    }
}

if (!is_file($file)) {
    http_response_code(404);
    header('Cache-Control: private, max-age=86400');
    exit;
}
header('Content-Type: image/png');
header('Cache-Control: private, max-age=2592000, immutable');
header('Content-Length: ' . filesize($file));
readfile($file);
