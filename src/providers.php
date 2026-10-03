<?php
/* Where prices come from. Each provider returns normalised fares:
   origin, dest, dest_name, depart (Y-m-d), ret (Y-m-d|null), nights, price (EUR, whole), airline, stops, duration (min), link */
declare(strict_types=1);

interface Provider
{
    public function name(): string;
    /** Fares to one city or airport for departures in $month (Y-m). */
    public function fares(string $origin, string $dest, string $month, bool $return, bool $directOnly): array;
    /** Fares to anywhere in a country (ISO code, e.g. TH). */
    public function faresToCountry(string $origin, string $country, string $month, bool $return, bool $directOnly): array;
}

/** Biggest built-in cities of a country, used when a provider cannot search a whole country at once. */
function country_cities(string $cc, int $max = 5): array
{
    $out = [];
    foreach (places() as [$code, , , $c]) if ($c === $cc && count($out) < $max) $out[] = $code;
    return $out;
}

/** Travelpayouts / Aviasales Data API: cheapest fares Aviasales users found recently (usually the last few days). */
final class TravelpayoutsProvider implements Provider
{
    private const BASE = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';

    public function __construct(private string $token, private string $currency = 'eur', private string $marker = '') {}

    public function name(): string { return 'Aviasales'; }

    private function params(string $origin, string $month, bool $return, bool $directOnly): array
    {
        return [
            'origin' => $origin, 'departure_at' => $month,
            'one_way' => $return ? 'false' : 'true', 'direct' => $directOnly ? 'true' : 'false',
            'sorting' => 'price', 'unique' => 'false', 'limit' => 1000, 'page' => 1, 'currency' => $this->currency,
        ];
    }

    public function fares(string $origin, string $dest, string $month, bool $return, bool $directOnly): array
    {
        return $this->query($this->params($origin, $month, $return, $directOnly) + ['destination' => $dest]);
    }

    public function faresToCountry(string $origin, string $country, string $month, bool $return, bool $directOnly): array
    {
        // City by city for the country's main destinations (a search "to anywhere" is dominated by cheap
        // short hops, so far-away countries would rarely show up in it).
        $cities = country_cities($country, 6);
        if ($cities) {
            $out = [];
            $errors = 0;
            foreach ($cities as $city) {
                try { array_push($out, ...$this->fares($origin, $city, $month, $return, $directOnly)); } catch (Throwable $e) { $errors++; $last = $e; }
            }
            if (!$out && $errors === count($cities)) throw $last;
            return $out;
        }
        // Country without a built-in city list: one search to anywhere, keep this country's fares.
        $all = $this->query($this->params($origin, $month, $return, $directOnly));
        return array_values(array_filter($all, fn($f) => (city_info($f['city'])[1] ?? null) === $country));
    }

    private function query(array $params): array
    {
        $json = $this->get(self::BASE . '?' . http_build_query($params));
        if (empty($json['success'])) throw new RuntimeException('Aviasales: ' . (is_string($json['error'] ?? null) ? $json['error'] : 'no data'));
        $out = [];
        foreach ((array) ($json['data'] ?? []) as $r) {
            $f = is_array($r) ? self::normalise($r, $this->marker) : null;
            if ($f) $out[] = $f;
        }
        return $out;
    }

    public static function normalise(array $r, string $marker = ''): ?array
    {
        if (empty($r['price']) || empty($r['departure_at']) || !preg_match('/^\d{4}-\d{2}-\d{2}/', (string) $r['departure_at'])) return null;
        $dep = substr((string) $r['departure_at'], 0, 10);
        $ret = !empty($r['return_at']) && preg_match('/^\d{4}-\d{2}-\d{2}/', (string) $r['return_at']) ? substr((string) $r['return_at'], 0, 10) : null;
        $link = null;
        if (!empty($r['link']) && is_string($r['link']) && $r['link'][0] === '/') {
            $link = 'https://www.aviasales.com' . $r['link'];
            if ($marker !== '') $link .= (str_contains($link, '?') ? '&' : '?') . 'marker=' . rawurlencode($marker);
        }
        $city = strtoupper((string) ($r['destination'] ?? ''));
        $code = fn($v) => preg_match('/^[A-Z]{3}$/', strtoupper((string) $v)) ? strtoupper((string) $v) : '';
        $dest = $code($r['destination_airport'] ?? '') ?: $code($city);
        $origin = $code($r['origin_airport'] ?? '') ?: $code($r['origin'] ?? '');
        if ($dest === '' || $origin === '') return null;
        return [
            'origin'    => $origin,
            'dest'      => $dest,
            'city'      => $code($city) ?: $dest,
            'dest_name' => city_info($code($city) ?: $dest)[0] ?? null,
            'depart'    => $dep,
            'ret'       => $ret,
            'nights'    => $ret ? (int) round((strtotime($ret) - strtotime($dep)) / 86400) : null,
            'price'     => (int) round((float) $r['price']),
            'airline'   => substr(preg_replace('/[^A-Z0-9]/', '', strtoupper((string) ($r['airline'] ?? ''))), 0, 3),
            'stops'     => max(0, (int) ($r['transfers'] ?? 0), (int) ($r['return_transfers'] ?? 0)),
            'duration'  => isset($r['duration']) ? (int) $r['duration'] : null,
            'link'      => $link,
        ];
    }

    private function get(string $url, int $attempt = 1): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_ENCODING => '',
            CURLOPT_HTTPHEADER => ['X-Access-Token: ' . $this->token, 'Accept: application/json'],
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if (($body === false || $code === 429 || $code >= 500) && $attempt < 3) {   // brief hiccup: retry
            usleep($attempt * 1500000);
            return $this->get($url, $attempt + 1);
        }
        if ($body === false) throw new RuntimeException('Aviasales unreachable: ' . $err);
        if ($code === 401 || $code === 403) throw new RuntimeException('Aviasales refused the API token');
        if ($code === 429) throw new RuntimeException('Aviasales rate limit, will retry next check');
        $json = json_decode((string) $body, true);
        if (!is_array($json)) throw new RuntimeException("Aviasales answered HTTP $code");
        usleep(200000);   // be gentle with the free API
        return $json;
    }
}

/** Made-up but realistic fares so the app works before a token is set. Clearly labelled in the UI. */
final class DemoProvider implements Provider
{
    private const AIRLINES = ['KL', 'TK', 'EK', 'QR', 'EY', 'LH', 'CX', 'SQ', 'AF', 'LX'];

    public function name(): string { return 'Demo data'; }

    public function faresToCountry(string $origin, string $country, string $month, bool $return, bool $directOnly): array
    {
        $out = [];
        foreach (country_cities($country, 4) as $i => $city) {
            foreach ($this->fares($origin, $city, $month, $return, $directOnly, 3 + $i) as $f) $out[] = $f;
        }
        return $out;
    }

    public function fares(string $origin, string $dest, string $month, bool $return, bool $directOnly, int $step = 2): array
    {
        $base = 380 + crc32($dest) % 520 + ($origin === 'AMS' ? 0 : 35);
        $slot = intdiv(now(), 3 * 3600);                        // prices move every check
        $days = (int) date('t', strtotime($month . '-01'));
        $out = [];
        for ($d = 1 + crc32($dest) % 2; $d <= $days; $d += $step) {
            $dep = sprintf('%s-%02d', $month, $d);
            $seed = crc32("$origin$dest$dep$slot");
            $stops = $directOnly ? 0 : $seed % 3;
            $season = 1 + 0.18 * sin(((int) substr($month, 5, 2)) / 12 * 2 * M_PI);
            $noise = 0.82 + ($seed % 1000) / 1000 * 0.4;
            $dip = $seed % 499 === 0 ? 0.5 : ($seed % 97 === 0 ? 0.68 : 1);   // the occasional steal
            $price = (int) round($base * $season * $noise * $dip * ($stops === 0 ? 1.25 : 1) * ($return ? 1 : 0.62));
            $nights = 6 + $seed % 18;
            $ret = $return ? date('Y-m-d', strtotime("$dep +$nights days")) : null;
            $out[] = [
                'origin' => $origin, 'dest' => $dest, 'city' => $dest, 'dest_name' => city_info($dest)[0] ?? $dest,
                'depart' => $dep, 'ret' => $ret, 'nights' => $return ? $nights : null,
                'price' => $price, 'airline' => self::AIRLINES[$seed % count(self::AIRLINES)], 'stops' => $stops,
                'duration' => 700 + $stops * 180 + $seed % 120, 'link' => null,
            ];
        }
        return $out;
    }
}
