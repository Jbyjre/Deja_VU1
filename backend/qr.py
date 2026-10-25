"""
qr.py
=====

A small QR code maker, so a phone can open this dashboard by pointing its
camera at the screen instead of typing an address. Typing is where phones
go wrong: "10.0.0.10.8000" (a dot instead of the colon) or an address
without "http://" becomes a web search, and the phone shows search results
about routers instead of the dashboard.

Standard library only, like the rest of the server. It makes byte-mode
codes at error-correction level M (about 15% of the code can be damaged or
covered and it still reads), versions 1 to 10: up to 213 characters, far
more than a home-network address with a pairing code needs.

The construction follows the QR code standard (ISO/IEC 18004): data bits,
Reed-Solomon error correction over GF(256), block interleaving, the fixed
patterns (finders, timing, alignment, format and version information), the
zigzag data placement and the eight masks, keeping the mask with the lowest
penalty score.

    matrix("http://10.0.0.10:8000/")  ->  list of rows, True = dark
    rows(...)                         ->  ["1010...", ...] for the browser
    terminal(...)                     ->  the code drawn with block characters
"""

# Level M, per version: (data codewords per block, number of blocks) groups,
# and error-correction codewords per block. ISO/IEC 18004 table 9.
_BLOCKS_M = {
    1: ([(16, 1)], 10), 2: ([(28, 1)], 16), 3: ([(44, 1)], 26), 4: ([(32, 2)], 18),
    5: ([(43, 2)], 24), 6: ([(27, 4)], 16), 7: ([(31, 4)], 18), 8: ([(38, 2), (39, 2)], 22),
    9: ([(36, 3), (37, 2)], 22), 10: ([(43, 4), (44, 1)], 26),
}
_ALIGN = {1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
          7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]}
_LEVEL_M_BITS = 0          # format bits for level M (L=1, M=0, Q=3, H=2)
MAX_VERSION = 10


# -- Reed-Solomon over GF(256), primitive polynomial x^8+x^4+x^3+x^2+1 --------

def _gf_mul(x, y):
    z = 0
    for i in reversed(range(8)):
        z = (z << 1) ^ ((z >> 7) * 0x11D)
        z ^= ((y >> i) & 1) * x
    return z


def _rs_divisor(degree):
    result = [0] * (degree - 1) + [1]
    root = 1
    for _ in range(degree):
        for j in range(degree):
            result[j] = _gf_mul(result[j], root)
            if j + 1 < degree:
                result[j] ^= result[j + 1]
        root = _gf_mul(root, 0x02)
    return result


def _rs_remainder(data, divisor):
    result = [0] * len(divisor)
    for b in data:
        factor = b ^ result.pop(0)
        result.append(0)
        for i, coef in enumerate(divisor):
            result[i] ^= _gf_mul(coef, factor)
    return result


# -- data codewords -------------------------------------------------------------

def _data_capacity(version):
    groups, _ = _BLOCKS_M[version]
    return sum(n * count for n, count in groups)


def _pick_version(length):
    for version in range(1, MAX_VERSION + 1):
        count_bits = 8 if version < 10 else 16
        if 4 + count_bits + 8 * length <= _data_capacity(version) * 8:
            return version
    raise ValueError(f"Too long for a QR code here ({length} bytes; at most 213)")


def _codewords(payload, version):
    capacity = _data_capacity(version)
    count_bits = 8 if version < 10 else 16
    bits = [0, 1, 0, 0]                                   # byte mode
    bits += [(len(payload) >> i) & 1 for i in reversed(range(count_bits))]
    for byte in payload:
        bits += [(byte >> i) & 1 for i in reversed(range(8))]
    bits += [0] * min(4, capacity * 8 - len(bits))        # terminator
    bits += [0] * (-len(bits) % 8)
    data = [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]
    pad = 0xEC
    while len(data) < capacity:
        data.append(pad)
        pad ^= 0xEC ^ 0x11
    # Split into blocks, add error correction, then interleave.
    groups, ecc_len = _BLOCKS_M[version]
    divisor = _rs_divisor(ecc_len)
    blocks, at = [], 0
    for n, count in groups:
        for _ in range(count):
            block = data[at:at + n]
            at += n
            blocks.append((block, _rs_remainder(block, divisor)))
    out = []
    for i in range(max(len(b) for b, _ in blocks)):
        out += [b[i] for b, _ in blocks if i < len(b)]
    for i in range(ecc_len):
        out += [e[i] for _, e in blocks]
    return out


# -- the symbol -------------------------------------------------------------------

class _Grid:
    def __init__(self, version):
        self.version = version
        self.size = version * 4 + 17
        self.dark = [[False] * self.size for _ in range(self.size)]
        self.fixed = [[False] * self.size for _ in range(self.size)]

    def put(self, x, y, dark):
        self.dark[y][x] = bool(dark)
        self.fixed[y][x] = True

    def draw_fixed(self):
        n = self.size
        for i in range(n):                                # timing patterns
            self.put(6, i, i % 2 == 0)
            self.put(i, 6, i % 2 == 0)
        for cx, cy in ((3, 3), (n - 4, 3), (3, n - 4)):   # finders and separators
            for dy in range(-4, 5):
                for dx in range(-4, 5):
                    x, y = cx + dx, cy + dy
                    if 0 <= x < n and 0 <= y < n:
                        self.put(x, y, max(abs(dx), abs(dy)) not in (2, 4))
        pos = _ALIGN[self.version]
        last = len(pos) - 1
        for i, ay in enumerate(pos):                      # alignment patterns
            for j, ax in enumerate(pos):
                if (i, j) in ((0, 0), (0, last), (last, 0)):
                    continue
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        self.put(ax + dx, ay + dy, max(abs(dx), abs(dy)) != 1)
        self.draw_format(0)                               # reserve; real bits after masking
        if self.version >= 7:
            rem = self.version
            for _ in range(12):
                rem = (rem << 1) ^ ((rem >> 11) * 0x1F25)
            bits = self.version << 12 | rem
            for i in range(18):
                bit = (bits >> i) & 1
                a, b = n - 11 + i % 3, i // 3
                self.put(a, b, bit)
                self.put(b, a, bit)

    def draw_format(self, mask):
        data = _LEVEL_M_BITS << 3 | mask
        rem = data
        for _ in range(10):
            rem = (rem << 1) ^ ((rem >> 9) * 0x537)
        bits = (data << 10 | rem) ^ 0x5412
        bit = lambda i: (bits >> i) & 1
        n = self.size
        for i in range(6):
            self.put(8, i, bit(i))
        self.put(8, 7, bit(6))
        self.put(8, 8, bit(7))
        self.put(7, 8, bit(8))
        for i in range(9, 15):
            self.put(14 - i, 8, bit(i))
        for i in range(8):
            self.put(n - 1 - i, 8, bit(i))
        for i in range(8, 15):
            self.put(8, n - 15 + i, bit(i))
        self.put(8, n - 8, True)                          # the always-dark module

    def draw_data(self, codewords):
        n, i, total = self.size, 0, len(codewords) * 8
        right = n - 1
        while right >= 1:
            if right == 6:
                right = 5
            for vert in range(n):
                for j in range(2):
                    x = right - j
                    upward = ((right + 1) & 2) == 0
                    y = n - 1 - vert if upward else vert
                    if not self.fixed[y][x] and i < total:
                        self.dark[y][x] = bool((codewords[i >> 3] >> (7 - (i & 7))) & 1)
                        i += 1
            right -= 2

    def apply_mask(self, mask):
        test = (
            lambda x, y: (x + y) % 2 == 0,
            lambda x, y: y % 2 == 0,
            lambda x, y: x % 3 == 0,
            lambda x, y: (x + y) % 3 == 0,
            lambda x, y: (x // 3 + y // 2) % 2 == 0,
            lambda x, y: x * y % 2 + x * y % 3 == 0,
            lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
            lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0,
        )[mask]
        for y in range(self.size):
            for x in range(self.size):
                if not self.fixed[y][x] and test(x, y):
                    self.dark[y][x] = not self.dark[y][x]

    def penalty(self):
        n, grid, score = self.size, self.dark, 0
        lines = [row for row in grid] + [[grid[y][x] for y in range(n)] for x in range(n)]
        finder_a = [True, False, True, True, True, False, True, False, False, False, False]
        finder_b = finder_a[::-1]
        for line in lines:
            run, prev = 0, None
            for cell in line:
                if cell == prev:
                    run += 1
                else:
                    if run >= 5:
                        score += run - 2
                    run, prev = 1, cell
            if run >= 5:
                score += run - 2
            for i in range(n - 10):
                window = line[i:i + 11]
                if window == finder_a or window == finder_b:
                    score += 40
        for y in range(n - 1):
            for x in range(n - 1):
                c = grid[y][x]
                if c == grid[y][x + 1] == grid[y + 1][x] == grid[y + 1][x + 1]:
                    score += 3
        dark = sum(map(sum, grid))
        total = n * n
        steps = (abs(dark * 20 - total * 10) + total - 1) // total - 1   # each 5% away from half dark
        return score + max(0, steps) * 10


def matrix(text):
    """The QR code for `text` as rows of booleans (True = dark), without the quiet zone."""
    payload = str(text).encode("utf-8")
    version = _pick_version(len(payload))
    codewords = _codewords(payload, version)
    best = None
    for mask in range(8):
        grid = _Grid(version)
        grid.draw_fixed()
        grid.draw_data(codewords)
        grid.apply_mask(mask)
        grid.draw_format(mask)
        score = grid.penalty()
        if best is None or score < best[0]:
            best = (score, grid)
    return best[1].dark


def rows(text):
    """The code as strings of '1' (dark) and '0', one per row: compact JSON for the browser."""
    return ["".join("1" if c else "0" for c in row) for row in matrix(text)]


def terminal(text, quiet=2):
    """
    The code drawn with block characters for a console window: two rows of
    modules per line of text, light modules drawn as full blocks so it reads on
    a dark terminal. Returns lines; check the console can print them first.
    """
    grid = matrix(text)
    n = len(grid) + 2 * quiet
    cell = lambda x, y: (0 <= y - quiet < len(grid) and 0 <= x - quiet < len(grid)
                         and grid[y - quiet][x - quiet])
    out = []
    for y in range(0, n, 2):
        line = ""
        for x in range(n):
            top, bottom = not cell(x, y), (y + 1 < n and not cell(x, y + 1))
            line += "█" if top and bottom else "▀" if top else "▄" if bottom else " "
        out.append(line)
    return out
