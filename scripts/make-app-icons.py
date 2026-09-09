"""Generate Scripta's app-icon set from the white-on-transparent source mark.

    python3 scripts/make-app-icons.py mobile/assets/images/amsicon-source.png \
        mobile/assets/images

Writes icon.png (opaque, for iOS/base), adaptive-foreground.png and
adaptive-monochrome.png (transparent, inset to Android's safe circle), and the
two splash marks. See mobile/app.json for where each is wired up.

Pure stdlib on purpose: this machine has neither Pillow nor ImageMagick, and
installing one for an occasional asset build isn't worth it. Re-run this rather
than editing the outputs by hand — the padding and the alpha handling differ per
target, and getting them wrong is a store rejection (iOS icons must not carry an
alpha channel) or a cropped mark (Android masks the foreground to a circle).
"""
import os, struct, sys, zlib


# ---------- PNG I/O ----------

def read_rgba(path):
    d = open(path, "rb").read()
    pos, idat, w = 8, b"", None
    while pos < len(d):
        ln = struct.unpack(">I", d[pos:pos + 4])[0]
        typ = d[pos + 4:pos + 8]
        data = d[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, bd, ct = struct.unpack(">IIBB", data[:10])
            assert (bd, ct) == (8, 6), f"expected 8-bit RGBA, got bitdepth={bd} colortype={ct}"
        elif typ == b"IDAT":
            idat += data
        pos += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * 4
    out = bytearray()
    prev = bytearray(stride)
    i = 0
    for _ in range(h):
        f = raw[i]; i += 1
        line = bytearray(raw[i:i + stride]); i += stride
        for x in range(stride):
            a = line[x - 4] if x >= 4 else 0
            b = prev[x]
            c = prev[x - 4] if x >= 4 else 0
            if f == 1:   line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out += line
        prev = line
    return w, h, out


def write_png(path, w, h, px, alpha=True):
    ct = 6 if alpha else 2
    n = 4 if alpha else 3
    raw = bytearray()
    stride = w * n
    for y in range(h):
        raw.append(0)                      # filter: none — these are small files
        raw += px[y * stride:(y + 1) * stride]
    def chunk(t, data):
        return struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ct, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))
    open(path, "wb").write(png)


# ---------- ops ----------

def bbox(w, h, px):
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        row = y * w * 4
        for x in range(w):
            if px[row + x * 4 + 3] > 8:
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    return minx, miny, maxx, maxy


def resample(sw, sh, src, dw, dh):
    """Area-average resample. Premultiplies alpha so edge pixels don't pick up
    colour from fully transparent neighbours."""
    dst = bytearray(dw * dh * 4)
    for dy in range(dh):
        y0, y1 = dy * sh // dh, max(dy * sh // dh + 1, (dy + 1) * sh // dh)
        for dx in range(dw):
            x0, x1 = dx * sw // dw, max(dx * sw // dw + 1, (dx + 1) * sw // dw)
            r = g = b = a = n = 0
            for y in range(y0, y1):
                base = y * sw * 4
                for x in range(x0, x1):
                    i = base + x * 4
                    pa = src[i + 3]
                    r += src[i] * pa; g += src[i + 1] * pa; b += src[i + 2] * pa
                    a += pa; n += 1
            o = (dy * dw + dx) * 4
            if a:
                dst[o] = min(255, r // a); dst[o + 1] = min(255, g // a); dst[o + 2] = min(255, b // a)
            dst[o + 3] = a // n
    return dst


def canvas(size, mark_w, mark_h, mark, scale, rgba_bg=None):
    """Centre `mark` (already sized mark_w x mark_h) on a `size` square,
    occupying `scale` of the shorter edge."""
    target = int(size * scale)
    ratio = min(target / mark_w, target / mark_h)
    mw, mh = max(1, int(mark_w * ratio)), max(1, int(mark_h * ratio))
    scaled = resample(mark_w, mark_h, mark, mw, mh)
    out = bytearray(size * size * 4)
    if rgba_bg:
        for i in range(0, len(out), 4):
            out[i:i + 4] = bytes(rgba_bg)
    ox, oy = (size - mw) // 2, (size - mh) // 2
    for y in range(mh):
        for x in range(mw):
            s = (y * mw + x) * 4
            a = scaled[s + 3]
            if not a:
                continue
            d = ((y + oy) * size + (x + ox)) * 4
            for c in range(3):
                out[d + c] = (scaled[s + c] * a + out[d + c] * (255 - a)) // 255
            out[d + 3] = min(255, a + out[d + 3] * (255 - a) // 255)
    return out


def recolour(px, rgb):
    out = bytearray(px)
    for i in range(0, len(out), 4):
        if out[i + 3]:
            out[i], out[i + 1], out[i + 2] = rgb
    return out


def drop_alpha(px):
    return bytes(b for i in range(0, len(px), 4) for b in px[i:i + 3])


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(f"usage: {sys.argv[0]} <source.png> <output-dir>")
    src, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    w, h, px = read_rgba(src)
    x0, y0, x1, y1 = bbox(w, h, px)
    print(f"source {w}x{h}; mark bbox {x1-x0+1}x{y1-y0+1} at ({x0},{y0}) "
          f"= {(x1-x0+1)/w:.0%} x {(y1-y0+1)/h:.0%} of canvas")

    # crop to the mark so every output controls its own padding
    mw, mh = x1 - x0 + 1, y1 - y0 + 1
    mark = bytearray(mw * mh * 4)
    for y in range(mh):
        s = ((y + y0) * w + x0) * 4
        mark[y * mw * 4:(y + 1) * mw * 4] = px[s:s + mw * 4]

    DARK = (0x1a, 0x18, 0x15, 255)   # theme dark background
    INK  = (0x20, 0x1e, 0x1c)        # theme light text
    WHITE = (0xff, 0xff, 0xff)

    # iOS / base icon: opaque, no alpha — Apple rejects icons with alpha.
    icon = canvas(1024, mw, mh, recolour(mark, WHITE), 0.68, DARK)
    write_png(f"{outdir}/icon.png", 1024, 1024, drop_alpha(icon), alpha=False)
    print("wrote icon.png            1024x1024 opaque, mark at 68%")

    # Android adaptive foreground: transparent, and inside the 66% safe circle
    # the launcher mask can crop to.
    fg = canvas(1024, mw, mh, recolour(mark, WHITE), 0.60)
    write_png(f"{outdir}/adaptive-foreground.png", 1024, 1024, fg)
    print("wrote adaptive-foreground 1024x1024 transparent, mark at 60% (safe zone)")

    mono = canvas(1024, mw, mh, recolour(mark, WHITE), 0.60)
    write_png(f"{outdir}/adaptive-monochrome.png", 1024, 1024, mono)
    print("wrote adaptive-monochrome 1024x1024 silhouette for themed icons")

    # Splash marks: the source is white, which would vanish on the light
    # theme's #f5f4f2 ground, so light mode gets an ink version.
    write_png(f"{outdir}/splash-icon.png", 512, 512, canvas(512, mw, mh, recolour(mark, INK), 0.86))
    print("wrote splash-icon.png     512x512 ink mark, for the light splash")
    write_png(f"{outdir}/splash-icon-dark.png", 512, 512, canvas(512, mw, mh, recolour(mark, WHITE), 0.86))
    print("wrote splash-icon-dark    512x512 white mark, for the dark splash")
