<?php
/* Built-in places and airline names for the app, as a script (one list shared with the server). */
declare(strict_types=1);
require __DIR__ . '/src/app.php';
header('Content-Type: text/javascript; charset=utf-8');
header('Cache-Control: private, max-age=86400');
header('X-Content-Type-Options: nosniff');
$places = places();
$origins = [['AMS', 'Amsterdam'], ['EIN', 'Eindhoven'], ['RTM', 'Rotterdam'], ['GRQ', 'Groningen'], ['MST', 'Maastricht'],
            ['BRU', 'Brussels'], ['CRL', 'Charleroi'], ['DUS', 'Düsseldorf'], ['CGN', 'Cologne'], ['NRN', 'Weeze']];
$flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG;
echo 'window.ORIGINS=', json_encode($origins, $flags), ";\nwindow.PLACES=", json_encode($places, $flags),
     ";\nwindow.AIRLINES=", json_encode(AIRLINES, $flags), ";\n";
