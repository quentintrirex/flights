<?php
// Draws the app icon as PNG (full-bleed for iOS; iOS rounds the corners itself).
foreach ([180, 192, 512] as $s) {
    $k = 4; $S = $s * $k;                       // supersample for smooth edges
    $im = imagecreatetruecolor($S, $S);
    imagefill($im, 0, 0, imagecolorallocate($im, 13, 15, 20));
    $white = imagecolorallocate($im, 255, 255, 255);
    $green = imagecolorallocate($im, 24, 195, 126);
    $u = $S / 32;
    // dotted arc: quadratic curve from (8,20.5) bending to (22.6,11.1)
    for ($t = 0.0; $t <= 1.0; $t += 0.115) {
        $x = (1-$t)**2*8 + 2*(1-$t)*$t*15 + $t**2*21.6;
        $y = (1-$t)**2*21.5 + 2*(1-$t)*$t*19.5 + $t**2*12.2;
        imagefilledellipse($im, (int)($x*$u), (int)($y*$u), (int)(2.0*$u), (int)(2.0*$u), $white);
    }
    imagefilledellipse($im, (int)(23.6*$u), (int)(10.2*$u), (int)(5.6*$u), (int)(5.6*$u), $green);
    $out = imagecreatetruecolor($s, $s);
    imagecopyresampled($out, $im, 0, 0, 0, 0, $s, $s, $S, $S);
    imagepng($out, __DIR__ . "/../assets/icon-$s.png", 9);
}
echo "ok\n";
