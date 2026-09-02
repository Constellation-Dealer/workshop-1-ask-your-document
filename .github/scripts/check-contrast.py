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

NAMED = {'white': (255, 255, 255), 'black': (0, 0, 0)}

def parse_colour(v):
    """-> (r,g,b) opaque, or (r,g,b,a) translucent, or None if not a literal colour."""
    v = v.strip()
    if v.lower() in NAMED:
        return NAMED[v.lower()]
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
def without_negations(sel):
    """A selector with its `:not(...)` groups removed.

    ALWAYS use this before asking a selector what it means. A negation contains the
    literal text of the thing it excludes, so a substring test reads the opposite of
    the truth. This file got that wrong twice: `:root:not([data-theme="light"])` -- the
    standard "dark unless overridden" selector -- classified as a LIGHT block, and
    `.run-btn:hover:not(:disabled)` classified as a DISABLED state and therefore
    skipped as exempt, which made the hover check green by never running.
    """
    prev = None
    while prev != sel:                     # nested negations
        prev = sel
        sel = re.sub(r':not\([^()]*\)', '', sel)
    return sel


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
            # `from`/`to`/`50%` inside @keyframes are animation stops, not selectors, and
            # their `opacity: 0` is not an element being faded. Recursing into them made
            # them look like rules.
            if re.match(r'@(-\w+-)?keyframes\b', head):
                i = j
                continue
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
        bare = without_negations(s)
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

def _value(pal, raw):
    """Resolve a CSS colour value -- a var(), a literal, or a keyword -- for one theme.
    Returns (colour, label) or (None, reason) so an unresolvable value can be REPORTED
    rather than skipped. Skipping is how this check certified a real failure: it only
    understood `color: var(...)`, so `.run-btn { color: #FFFFFF; background: var(--trace) }`
    was invisible, and white on the dark --trace is 2.87:1."""
    raw = raw.strip().rstrip(';').strip()
    m = re.fullmatch(r'var\(--([\w-]+)(?:\s*,.*)?\)', raw)
    if m:
        c = resolve(pal, m.group(1))
        return (c, f'--{m.group(1)}') if c else (None, f'var(--{m.group(1)}) does not resolve')
    if 'gradient(' in raw:
        return None, 'a gradient (cannot be reduced to one colour)'
    c = parse_colour(raw)
    if c:
        return c, raw
    return None, f'unrecognised colour {raw!r}'


MIN_RATIO = 4.5   # WCAG AA, normal-weight text. Every colour here is used at <= 16px.

MIN_RATIO = 4.5   # WCAG AA, normal-weight text. Every colour here is used at <= 16px.

# A state selector that means the control is inactive. WCAG 2.1 SC 1.4.3 exempts text
# in an inactive user-interface component, so a deliberately faded disabled control is
# not a violation. Named here so the exemption is a recorded decision rather than a
# gap: `.run-btn:disabled { opacity: .5 }` is intentional.
INACTIVE = re.compile(r':disabled\b|\[disabled\b|:read-only\b|\[aria-disabled=.true.\]')

# Pseudo-classes, pseudo-elements and state attributes, stripped to get the selector a
# state rule is a state OF. `.run-btn:hover:not(:disabled)` -> `.run-btn`, so its
# `opacity` is associated with the colours `.run-btn` declares. Without this the fade
# was never connected to the foreground it fades.
_STATE = re.compile(r'::?[\w-]+(\([^)]*\))?|\[[^\]]*\]')

def base_selectors(sel):
    out = set()
    for part in sel.split(','):
        part = _STATE.sub('', part).strip()
        if part:
            out.add(re.sub(r'\s+', ' ', part))
    return out


def state_of(sel, base):
    """The state part of a selector -- what is left after its base. `.run-btn:disabled`
    over base `.run-btn` -> `:disabled`; `.run-btn` -> `''`."""
    sel = re.sub(r'\s+', ' ', sel.strip())
    return sel[len(base):] if sel.startswith(base) else sel


def fade_applies(fade_sel, colour_sel, base):
    """Does a fade declared on `fade_sel` apply to the colours declared on `colour_sel`?

    Both are states of the same `base`, which is not enough on its own: applying
    `.run-btn:hover:not(:disabled)`'s opacity to `.run-btn:disabled`'s colours produced
    a failure for a combination that cannot render -- an element is not simultaneously
    hovered-and-not-disabled and disabled. The fade's OWN negation says so, so use it.
    """
    colour_state = state_of(colour_sel, base)
    for negated in re.findall(r':not\(([^()]*)\)', fade_sel):
        if negated.strip() and negated.strip() in colour_state:
            return False
    # The default colours always get the fade; a state's colours only get a fade
    # declared for that same state.
    return colour_state == '' or colour_state == state_of(without_negations(fade_sel), base)


def check(path):
    css = open(path).read()
    pal_by_theme = palettes(css)
    all_rules = rules(css)
    failures, unresolved, checked = [], [], 0

    # ── every opacity declaration, indexed by the selector it is a state of ──
    # An element's `opacity` fades the element as a whole, and it is very often
    # declared in a DIFFERENT rule from the colours (a :hover, a :disabled).
    fades = {}            # base selector -> [(state selector, alpha, line)]
    orphan_fades = []     # declarations that no colour-declaring rule can be matched to
    colour_bases = set()
    for sel, body, line in all_rules:
        if re.search(r'(?<![-\w])color:', body):
            colour_bases |= base_selectors(sel)
    for sel, body, line in all_rules:
        m = re.search(r'(?<![-\w])opacity:\s*([\d.]+)', body)
        if not m:
            continue
        alpha = float(m.group(1))
        if alpha >= 1.0:
            continue
        bases = base_selectors(sel)
        if bases & colour_bases:
            for b in bases & colour_bases:
                fades.setdefault(b, []).append((sel.strip(), alpha, line))
        else:
            # Opacity on something that declares no colour of its own fades any text
            # INSIDE it, and following that statically would mean resolving the DOM.
            # Report it rather than pass over it -- an unfollowed fade is exactly the
            # hole this check already had once.
            orphan_fades.append(f'L{line:<4d} {sel.strip()[:44]:44s} opacity: {alpha:g}')

    for theme, pal in pal_by_theme.items():
        surfaces = {t: c for t in ('paper', 'card') if (c := resolve(pal, t)) and len(c) == 3}
        if not surfaces:
            failures.append(f'{theme}: no opaque --paper/--card surface token found')
            continue

        for sel, body, line in all_rules:
            fgm = re.search(r'(?<![-\w])color:\s*([^;}]+)', body)
            if not fgm:
                continue
            fg, fg_label = _value(pal, fgm.group(1))
            if fg is None:
                if not re.match(r'^\s*(inherit|currentColor|transparent|unset|initial)\s*$',
                                fgm.group(1), re.I):
                    unresolved.append(f'{theme:22s} L{line:<4d} {sel.strip()[:40]:40s} color: {fg_label}')
                continue

            bgm = re.search(r'background(?:-color)?:\s*([^;}]+)', body)
            own = None
            own_label = ''
            if bgm and not re.match(r'^\s*(transparent|none|inherit|unset|initial)\s*$',
                                    bgm.group(1), re.I):
                own, own_label = _value(pal, bgm.group(1))
                if own is None:
                    unresolved.append(f'{theme:22s} L{line:<4d} {sel.strip()[:40]:40s} background: {own_label}')

            # The states to evaluate: the plain element, plus every fade that applies
            # to it through a state selector. Inactive controls are exempt (see INACTIVE).
            states = [('', 1.0)]
            for b in base_selectors(sel):
                for state_sel, alpha, _ln in fades.get(b, []):
                    if INACTIVE.search(without_negations(state_sel)):
                        continue                       # inactive control: SC 1.4.3 exempt
                    if not fade_applies(state_sel, sel, b):
                        continue                       # states that cannot co-occur
                    states.append((state_sel, alpha))

            for state_sel, alpha in states:
                for surf_name, surf in surfaces.items():
                    # The element's own background, resolved against the surface behind it.
                    bed = over(own, surf) if (own is not None and len(own) == 4) else (own if own is not None else surf)
                    bed_label = own_label if own is not None else f'--{surf_name}'

                    # `opacity` composites the WHOLE element -- its text AND its own
                    # background -- over what is behind it. Fading only the foreground
                    # into the background (what this used to do) both understates the
                    # text's shift and leaves the background unchanged, so a pair that
                    # renders as failing could be reported as passing.
                    if alpha < 1.0:
                        eff_fg = over((*fg[:3], alpha), surf)
                        eff_bg = over((*bed[:3], alpha), surf)
                    else:
                        eff_fg, eff_bg = fg, bed

                    checked += 1
                    ratio = contrast(eff_fg, eff_bg)
                    if ratio < MIN_RATIO:
                        where = f'{state_sel or sel.strip()}'
                        at = f' at opacity {alpha:g}' if alpha < 1.0 else ''
                        on = (bed_label if own is None or bed_label == f'--{surf_name}'
                              else f'{bed_label} over --{surf_name}')
                        failures.append(
                            f'{theme:22s} L{line:<4d} {where[:44]:44s} '
                            f'color: {fg_label}{at} on {on:26s} '
                            f'{ratio:4.2f}:1  (needs {MIN_RATIO})')

                    if own is not None and len(own) == 3 and alpha >= 1.0:
                        break   # an opaque own background does not depend on the surface

    return checked, failures, unresolved, orphan_fades

if __name__ == "__main__":
    ok = True
    for path in sys.argv[1:]:
        checked, failures, unresolved, orphan_fades = check(path)
        print(f'########## {path}  —  {checked} colour/surface pairs checked')
        for f in failures:
            print('  FAIL ', f)
        for u in unresolved:
            print('  UNREADABLE ', u, '  <- teach check-contrast.py this form, or use a token')
        for o in orphan_fades:
            print('  UNFOLLOWED OPACITY ', o,
                  '\n      This fades any text inside the element, and following that needs the DOM.'
                  '\n      Put the opacity on the element that declares the colour, or check it in a browser.')
        if failures or unresolved or orphan_fades:
            ok = False
        else:
            print('  all pairs meet 4.5:1')
    sys.exit(0 if ok else 1)
