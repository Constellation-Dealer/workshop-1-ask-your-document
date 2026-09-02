#!/usr/bin/env python3
"""Assert every colour this stylesheet uses for TEXT is readable on the surfaces it lands on.

A property check, not a spelling check: the token list is derived from the stylesheet, so a
new `color: var(--x)` rule is covered the moment it is written, and re-tinting a token is
caught even though no rule changed.
"""
import re, sys, colorsys

# ── colour maths (WCAG 2.1 relative luminance + contrast ratio) ─────────────
def _lin(c):
    c /= 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
def _lum(rgb):
    r, g, b = rgb
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)
def contrast(fg, bg):
    a, b = _lum(fg), _lum(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)
def over(fg, bg):
    """Composite an rgba colour over an opaque one."""
    (r, g, b, a) = fg
    return tuple(round(f * a + s * (1 - a)) for f, s in zip((r, g, b), bg))

def parse_colour(v):
    """-> (r,g,b) opaque, or (r,g,b,a) translucent, or None if not a literal colour."""
    v = v.strip()
    m = re.fullmatch(r'#([0-9a-fA-F]{6})', v)
    if m:
        h = m.group(1)
        return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
    m = re.fullmatch(r'rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)', v)
    if m:
        r, g, b = (float(m.group(i)) for i in (1, 2, 3))
        a = float(m.group(4)) if m.group(4) else 1.0
        return (r, g, b) if a >= 1.0 else (r, g, b, a)
    return None

# ── stylesheet parsing ──────────────────────────────────────────────────────
def _blocks(css, depth=0):
    """Yield (selector_or_atrule, body, line, in_dark_media) for each brace block,
    tracking @media nesting so a `prefers-color-scheme: dark` block is not mistaken
    for a bare :root. A flat regex cannot do this, and folding a dark block into the
    light palette makes both themes report the light values -- which looks like a
    passing dark mode that was never checked."""
    i, n = 0, len(css)
    while i < n:
        brace = css.find('{', i)
        if brace < 0:
            return
        head = css[i:brace].strip()
        # find the matching close brace
        depth_, j = 1, brace + 1
        while j < n and depth_:
            if css[j] == '{': depth_ += 1
            elif css[j] == '}': depth_ -= 1
            j += 1
        body = css[brace + 1:j - 1]
        line = css[:brace].count('\n') + 1
        if head.startswith('@'):
            dark = bool(re.search(r'prefers-color-scheme:\s*dark', head))
            for sel, b, ln, d in _blocks(body):
                yield sel, b, ln + line - 1, (d or dark)
        else:
            yield head, body, line, False
        i = j

def rules(css):
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    return [(sel, body, line) for sel, body, line, _ in _blocks(css)]

def palettes(css):
    """theme label -> {token: value}.

    Each root block is its own variant, NOT merged with the others. A stylesheet that
    supports both `@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"]`
    declares the dark palette TWICE, and merging them lets a divergence in whichever copy
    the merge overwrites go unseen -- while the viewer on OS dark mode with no explicit
    choice gets exactly that copy. Checking them separately also means the two copies
    drifting apart shows up here, rather than only when someone toggles the theme.
    """
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    base, variants = {}, []
    for sel, body, line, in_dark_media in _blocks(css):
        decls = dict(re.findall(r'--([\w-]+)\s*:\s*([^;]+)', body))
        if not decls:
            continue
        s = sel.replace(' ', '')
        if not (s.startswith(':root') or s.startswith('html')):
            continue
        # Strip :not(...) BEFORE asking which theme this is. `:root:not([data-theme="light"])`
        # -- the standard "dark unless overridden" selector -- contains the literal text
        # `data-theme="light"`, so a plain substring test reads a dark block as a light one
        # and then reports the light palette twice, once labelled dark. A negated selector
        # means the opposite of what it spells.
        bare = re.sub(r':not\([^)]*\)', '', s)
        explicit_dark = 'data-theme="dark"' in bare or "data-theme='dark'" in bare
        explicit_light = 'data-theme="light"' in bare or "data-theme='light'" in bare
        if explicit_dark or (in_dark_media and not explicit_light):
            label = f'dark@{"media" if in_dark_media else "attr"}:L{line}'
            variants.append((label, decls))
        else:
            base.update(decls)

    out = {'light': dict(base)}
    for label, decls in variants:
        merged = dict(base); merged.update(decls)
        out[label] = merged
    return out

def resolve(pal, token, seen=()):
    """Follow var(--a) chains to a literal colour."""
    if token in seen or token not in pal:
        return None
    v = pal[token].strip()
    m = re.fullmatch(r'var\(--([\w-]+)\)', v)
    if m:
        return resolve(pal, m.group(1), seen + (token,))
    return parse_colour(v)

MIN_RATIO = 4.5   # WCAG AA, normal-weight text. Every colour here is used at <= 16px.

def check(path):
    css = open(path).read()
    pal_by_theme = palettes(css)
    failures, checked = [], 0

    for theme, pal in pal_by_theme.items():
        # The opaque page surfaces a rule can land on when it sets no background of its own.
        surfaces = {t: c for t in ('paper', 'card') if (c := resolve(pal, t)) and len(c) == 3}
        if not surfaces:
            failures.append(f'{theme}: no opaque --paper/--card surface token found')
            continue

        for sel, body, line in rules(css):
            m = re.search(r'(?<![-\w])color:\s*var\(--([\w-]+)\)', body)
            if not m:
                continue
            fg = resolve(pal, m.group(1))
            if not fg or len(fg) != 3:
                continue

            # If the rule paints its own background, that is the surface. Otherwise the text
            # can sit on either page surface, so it must clear the bar on the worse one.
            bgm = re.search(r'background(?:-color)?:\s*(?:[^;]*?)var\(--([\w-]+)\)', body)
            candidates = []
            if bgm and (own := resolve(pal, bgm.group(1))):
                # A translucent own-background composites over whatever is behind it.
                candidates = ([(f'--{bgm.group(1)} over --{n}', over(own, s)) for n, s in surfaces.items()]
                              if len(own) == 4 else [(f'--{bgm.group(1)}', own)])
            if not candidates:
                candidates = [(f'--{n}', s) for n, s in surfaces.items()]

            for bg_name, bg in candidates:
                checked += 1
                ratio = contrast(fg, bg)
                if ratio < MIN_RATIO:
                    failures.append(
                        f'{theme:5s} L{line:<4d} {sel.strip()[:44]:44s} '
                        f'color: var(--{m.group(1)}) on {bg_name:24s} {ratio:4.2f}:1  (needs {MIN_RATIO})')
    return checked, failures

if __name__ == "__main__":
    ok = True
    for path in sys.argv[1:]:
        checked, failures = check(path)
        print(f'########## {path}  —  {checked} colour/surface pairs checked')
        if failures:
            ok = False
            for f in failures:
                print('  FAIL ', f)
        else:
            print('  all pairs meet 4.5:1')
    sys.exit(0 if ok else 1)
