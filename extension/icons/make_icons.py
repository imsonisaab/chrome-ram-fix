#!/usr/bin/env python3
"""Generate the Brave RAM Edition toolbar icons: a gold 'gauge' mark on a
dark rounded square. Pure stdlib PNG writer (zlib + struct), no Pillow."""
import struct, zlib, os, math

GOLD = (229, 169, 60)
GOLD_D = (176, 122, 34)
INK = (18, 18, 20)
WHITE = (245, 245, 245)


def png(path, size):
    # supersample 4x then box-downsample -> antialiased edges
    S = size * 4
    px = [[None] * S for _ in range(S)]
    for y in range(S):
        for x in range(S):
            # normalised coords, -1..1 with the square centred
            nx = (x / (S - 1)) * 2 - 1
            ny = (y / (S - 1)) * 2 - 1
            d = max(abs(nx), abs(ny))
            # rounded-square badge
            if d > 1.0:
                px[y][x] = (0, 0, 0, 0)
                continue
            # dark badge with a subtle vertical gradient
            t = (ny + 1) / 2
            bg = (int(INK[0] + (34 - INK[0]) * t),
                  int(INK[1] + (30 - INK[1]) * t),
                  int(INK[2] + (38 - INK[2]) * t), 255)
            # circular gauge dial, centred slightly high
            cx, cy, r = 0.0, -0.10, 0.62
            dx, dy = nx - cx, ny - cy
            dist = math.hypot(dx, dy)
            if dist > r + 0.06:
                px[y][x] = bg
                continue
            inside = dist <= r - 0.055
            ring = (not inside) and dist <= r + 0.055
            if ring:
                # gold ring
                px[y][x] = (GOLD[0], GOLD[1], GOLD[2], 255)
                continue
            if inside:
                # needle: sweeps from 200deg to 20deg across the dial
                ang = math.atan2(dy, dx)
                needle_ang = math.radians(-30)  # pointing up-right = "RAM reclaimed"
                delta = abs((ang - needle_ang + math.pi) % (2 * math.pi) - math.pi)
                needle = (delta < 0.075) or (dist < 0.11)
                if needle:
                    px[y][x] = (GOLD[0], GOLD[1], GOLD[2], 255)
                else:
                    # hub
                    px[y][x] = bg if dist > 0.16 else (GOLD_D[0], GOLD_D[1], GOLD_D[2], 255)
                continue
            px[y][x] = bg

    # box downsample
    rows = []
    for yy in range(size):
        row = bytearray()
        row.append(0)  # filter type none
        for xx in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(4):
                for sx in range(4):
                    p = px[yy * 4 + sy][xx * 4 + sx]
                    for i in range(4):
                        acc[i] += p[i]
            row += bytes((acc[0] // 16, acc[1] // 16, acc[2] // 16, acc[3] // 16))
        rows.append(bytes(row))

    raw = b''.join(rows)

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    out = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', ihdr)
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(out)
    return len(out)


if __name__ == '__main__':
    out = '/Users/apple/Documents/brave-cemetery/extension/icons'
    os.makedirs(out, exist_ok=True)
    for n in (16, 32, 48, 128):
        b = png(os.path.join(out, f'icon{n}.png'), n)
        print(f'icon{n}.png written ({b} bytes)')
