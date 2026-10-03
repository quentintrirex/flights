<?php
/* App shell. Everything else is drawn by assets/app.js from api.php. */
declare(strict_types=1);
header('Cache-Control: no-store');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');
$v = static fn(string $f) => $f . '?v=' . (@filemtime(__DIR__ . '/' . $f) ?: 1);
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#ffffff">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Flights">
<title>Flights</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="assets/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/icon-180.png">
<link rel="stylesheet" href="<?= $v('assets/app.css') ?>">
</head>
<body>
<header class="top">
  <a class="brand" href="#/" aria-label="Home">
    <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="currentColor"/><path d="M8 20.5c4.5-1.2 9.7-4.6 14.6-9.4" stroke="#fff" stroke-width="2.2" stroke-linecap="round" fill="none" stroke-dasharray="0.1 4.2"/><circle cx="23.2" cy="10.4" r="2.6" fill="#18c37e"/></svg>
    <span>Flights</span>
  </a>
  <div class="top-actions">
    <button class="icon-btn" id="bell" aria-label="Alerts">
      <svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>
      <i class="dot" hidden></i>
    </button>
  </div>
</header>
<main id="view" class="view"></main>
<div id="sheet-root"></div>
<div id="toasts" aria-live="polite"></div>
<script src="<?= $v('places.php') ?>"></script>
<script src="<?= $v('assets/app.js') ?>"></script>
</body>
</html>
