<?php
/* Copy to data/config.php on the server and fill in. data/ is never served (404). */
return [
    // Free: travelpayouts.com -> sign up -> Profile -> API token
    'travelpayouts_token'  => '',
    // Optional partner id (same page), added to booking links
    'travelpayouts_marker' => '',
    'currency'             => 'eur',
    // How often each route is checked (the cron runs hourly and only checks routes that are due)
    'scan_every_hours'     => 3,
];
