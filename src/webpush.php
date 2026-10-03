<?php
/* Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) with plain OpenSSL, no libraries.
   Works for iPhone home-screen web apps (iOS 16.4+), Chrome, Firefox, Edge. */
declare(strict_types=1);

const P256_SPKI_PREFIX = "\x30\x59\x30\x13\x06\x07\x2a\x86\x48\xce\x3d\x02\x01\x06\x08\x2a\x86\x48\xce\x3d\x03\x01\x07\x03\x42\x00";

function b64u(string $bin): string { return rtrim(strtr(base64_encode($bin), '+/', '-_'), '='); }
function b64u_dec(string $s): string { return (string) base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4)); }

/** Raw uncompressed public point (65 bytes) of an EC key. */
function ec_public_raw($key): string
{
    $d = openssl_pkey_get_details($key)['ec'];
    return "\x04" . str_pad($d['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['y'], 32, "\0", STR_PAD_LEFT);
}

function ec_public_from_raw(string $raw)
{
    if (strlen($raw) !== 65 || $raw[0] !== "\x04") throw new InvalidArgumentException('bad public key');
    $pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode(P256_SPKI_PREFIX . $raw), 64, "\n") . "-----END PUBLIC KEY-----\n";
    $k = openssl_pkey_get_public($pem);
    if (!$k) throw new InvalidArgumentException('public key not on P-256');
    return $k;
}

/** Private key from raw 32-byte scalar + its public point (used for the RFC test vector). */
function ec_private_from_raw(string $d, string $pub)
{
    $der = "\x30\x77\x02\x01\x01\x04\x20" . $d . "\xa0\x0a\x06\x08\x2a\x86\x48\xce\x3d\x03\x01\x07\xa1\x44\x03\x42\x00" . $pub;
    return openssl_pkey_get_private("-----BEGIN EC PRIVATE KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END EC PRIVATE KEY-----\n");
}

function ec_new()
{
    return openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
}

/** Encrypt a payload for one subscription. $eph and $salt are only passed in by tests. */
function webpush_encrypt(string $payload, string $uaPublic, string $authSecret, $eph = null, ?string $salt = null): string
{
    $eph ??= ec_new();
    $salt ??= random_bytes(16);
    $asPublic = ec_public_raw($eph);
    $shared = openssl_pkey_derive(ec_public_from_raw($uaPublic), $eph, 32);
    if ($shared === false) throw new RuntimeException('ECDH failed');
    $ikm = hash_hkdf('sha256', $shared, 32, "WebPush: info\0" . $uaPublic . $asPublic, $authSecret);
    $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
    $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);
    $ct = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
    return $salt . pack('N', 4096) . chr(65) . $asPublic . $ct . $tag;
}

/** VAPID key pair, created once and kept in data/vapid.pem. */
function vapid_key()
{
    $file = DATA_DIR . '/vapid.pem';
    if (!is_file($file) || filesize($file) === 0) {
        $k = ec_new();
        if (!$k || !openssl_pkey_export($k, $pem)) throw new RuntimeException('Could not create the push key (OpenSSL)');
        file_put_contents($file, $pem);
        @chmod($file, 0600);
    }
    return openssl_pkey_get_private((string) file_get_contents($file));
}

function vapid_public(): string { return b64u(ec_public_raw(vapid_key())); }

/** DER ECDSA signature -> raw r||s (64 bytes) as JWS ES256 wants. */
function der_to_raw(string $der): string
{
    $o = 3;                                            // 30 len 02
    $rl = ord($der[$o]); $r = substr($der, $o + 1, $rl); $o += 1 + $rl + 1;
    $sl = ord($der[$o]); $s = substr($der, $o + 1, $sl);
    $fix = fn($v) => str_pad(ltrim($v, "\0"), 32, "\0", STR_PAD_LEFT);
    return $fix($r) . $fix($s);
}

function vapid_header(string $endpoint): string
{
    $u = parse_url($endpoint);
    $aud = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
    $h = b64u('{"typ":"JWT","alg":"ES256"}');
    $p = b64u(json_encode(['aud' => $aud, 'exp' => time() + 12 * 3600, 'sub' => config()['push_subject']], JSON_UNESCAPED_SLASHES));
    openssl_sign("$h.$p", $sig, vapid_key(), OPENSSL_ALGO_SHA256);
    return 'vapid t=' . "$h.$p." . b64u(der_to_raw($sig)) . ', k=' . vapid_public();
}

/** Send to one subscription. Returns the HTTP status (0 = network error). */
function push_one(array $sub, array $msg): int
{
    $body = webpush_encrypt(json_encode($msg, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), b64u_dec($sub['p256dh']), b64u_dec($sub['auth']));
    $ch = curl_init($sub['endpoint']);
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => [
            'Authorization: ' . vapid_header($sub['endpoint']), 'Content-Encoding: aes128gcm',
            'Content-Type: application/octet-stream', 'TTL: 86400', 'Urgency: high',
        ],
    ]);
    curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return $code;
}

/** Push to every registered device; forget devices that unsubscribed. */
function push_all(array $msg): int
{
    if (getenv('FLIGHTS_NO_PUSH')) return 0;
    $sent = 0;
    foreach (q('SELECT * FROM push_subs')->fetchAll() as $s) {
        try { $code = push_one($s, $msg); } catch (Throwable) { $code = 0; }
        if ($code >= 200 && $code < 300) { $sent++; q('UPDATE push_subs SET fails=0 WHERE id=?', [$s['id']]); }
        elseif ($code === 404 || $code === 410 || $s['fails'] >= 9) q('DELETE FROM push_subs WHERE id=?', [$s['id']]);
        else q('UPDATE push_subs SET fails=fails+1 WHERE id=?', [$s['id']]);
    }
    return $sent;
}

/** Push services we deliver to (a subscription pointing anywhere else is refused: no server-side requests to random hosts). */
function push_host_ok(string $endpoint): bool
{
    $h = strtolower((string) parse_url($endpoint, PHP_URL_HOST));
    foreach (['push.apple.com', 'fcm.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com', 'push.mozilla.com'] as $ok) {
        if ($h === $ok || str_ends_with($h, '.' . $ok)) return true;
    }
    return false;
}
