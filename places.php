<?php
/* Built-in places for the search box, as a script (one list shared with the server). */
declare(strict_types=1);
header('Content-Type: text/javascript; charset=utf-8');
header('Cache-Control: private, max-age=86400');
header('X-Content-Type-Options: nosniff');
$places = require __DIR__ . '/src/places.php';
$origins = [['AMS', 'Amsterdam'], ['EIN', 'Eindhoven'], ['RTM', 'Rotterdam'], ['GRQ', 'Groningen'], ['MST', 'Maastricht'],
            ['BRU', 'Brussels'], ['CRL', 'Charleroi'], ['DUS', 'Düsseldorf'], ['CGN', 'Cologne'], ['NRN', 'Weeze']];
$flags = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG;
echo 'window.ORIGINS=', json_encode($origins, $flags), ";\nwindow.PLACES=", json_encode($places, $flags), ";\n";
