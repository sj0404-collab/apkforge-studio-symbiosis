#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Превью нового интерфейса.

Цвета не выдуманы: при запуске скрипт читает palette.json, а тот печатает
сам Kotlin-код (patch/android/utils/SymbiosisTheme.kt) — те же константы,
что уедут в APK. Поэтому «на картинке голубой» и «в приложении голубой» —
один и тот же int, а не два похожих на глаз.

Это предпросмотр вёрстки, а не снимок с телефона: эмулятор без KVM здесь не
запускается. Что он доказывает: порядок блоков, переносы длинных подписей,
контраст текста и цвета — то есть всё, что можно проверить до сборки.
"""
import json
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PAL = json.load(open(os.path.join(HERE, "palette.json"), encoding="utf-8"))


def u(v):
    return v & 0xFFFFFFFF


def rgb(v):
    v = u(v)
    return ((v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF)


def soft(v, a, bg=None):
    """
    Подложка «акцент с прозрачностью», уже смешанная с фоном.

    PIL рисует по RGB-картинке и альфу игнорирует: полупрозрачная заливка
    ложится сплошным цветом, а текст того же цвета поверх неё исчезает.
    Поэтому смешиваем сами — ровно так это выглядит и на экране.
    """
    c = v if isinstance(v, tuple) else rgb(v)
    base = bg if bg is not None else BASE
    return mix(base, c, a)


BASE = rgb(PAL["base"])
SURFACE = rgb(PAL["surface"])
CARD = rgb(PAL["card"])
TEXT = rgb(PAL["text"])
DIM = rgb(PAL["textDim"])
OUTLINE = rgb(PAL["outline"])
CYAN = rgb(PAL["cyan"])
LIME = rgb(PAL["lime"])
AMBER = rgb(PAL["amber"])
VIOLET = rgb(PAL["violet"])
PINK = rgb(PAL["pink"])
BLUE = rgb(PAL["blue"])
MINT = rgb(PAL["mint"])
RED = rgb(PAL["red"])
EDEN = rgb(PAL["eden"])

S = 2
W, H = 390 * S, 845 * S

FONT_DIR = "/usr/share/fonts/truetype/dejavu"
REG = os.path.join(FONT_DIR, "DejaVuSans.ttf")
BOLD = os.path.join(FONT_DIR, "DejaVuSans-Bold.ttf")
_f = {}


def F(dp, bold=False):
    k = (dp, bold)
    if k not in _f:
        _f[k] = ImageFont.truetype(BOLD if bold else REG, int(dp * S))
    return _f[k]


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def screen(top_glow):
    """Фон экрана: то же, что bg_sym_screen.xml — свечение сверху в базу."""
    img = Image.new("RGB", (W, H), BASE)
    d = ImageDraw.Draw(img)
    hh = int(H * 0.42)
    for y in range(hh):
        t = y / hh
        d.line([(0, y), (W, y)], fill=mix(top_glow, BASE, t))
    return img, d


def rr(d, box, radius, fill=None, outline=None, width=1):
    d.rounded_rectangle(tuple(int(v) for v in box), radius=int(radius * S),
                        fill=fill, outline=outline, width=int(width * S))


def wrap(s, size, maxw, bold=False):
    f, limit, lines, cur = F(size, bold), maxw * S, [], ""
    for word in s.split(" "):
        probe = (cur + " " + word).strip()
        if f.getlength(probe) <= limit or not cur:
            cur = probe
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def text(d, x, y, s, size=14, color=TEXT, bold=False, maxw=None, lh=None):
    lh = lh or size * 1.38
    if maxw is None:
        d.text((x * S, y * S), s, font=F(size, bold), fill=color, anchor="la")
        return y + lh
    for line in wrap(s, size, maxw, bold):
        d.text((x * S, y * S), line, font=F(size, bold), fill=color, anchor="la")
        y += lh
    return y


def wrap_h(s, size, maxw, bold=False, lh=None):
    return len(wrap(s, size, maxw, bold)) * (lh or size * 1.38)


def tw(s, size, bold=False):
    return F(size, bold).getlength(s) / S


def status_bar(d):
    d.text((18 * S, 12 * S), "19:43", font=F(13, True), fill=TEXT, anchor="la")
    bx, by = W - 44 * S, 13 * S
    d.rounded_rectangle([bx, by, bx + 22 * S, by + 12 * S], radius=3 * S, outline=TEXT, width=int(1.2 * S))
    d.rectangle([bx + 3 * S, by + 3 * S, bx + 13 * S, by + 9 * S], fill=TEXT)
    cx = W - 64 * S
    d.polygon([(cx, 22 * S), (cx + 7 * S, 15 * S), (cx + 14 * S, 22 * S)], outline=TEXT)
    d.arc([cx - 2 * S, 16 * S, cx + 16 * S, 26 * S], 200, 340, fill=TEXT, width=int(1.2 * S))


def pill(d, x, y, label, accent, size=13, h=40, bold=True):
    w = tw(label, size, bold) + 34
    rr(d, (x * S, y * S, (x + w) * S, (y + h) * S), 14, fill=soft(accent, 0.16))
    d.text(((x + w / 2) * S, (y + h / 2 + 0.5) * S), label, font=F(size, bold), fill=accent, anchor="mm")
    return x + w + 8


def badge(d, x, y, label, accent, size=11, h=24):
    w = tw(label, size) + 20
    rr(d, (x * S, y * S, (x + w) * S, (y + h) * S), 10, fill=soft(accent, 0.16))
    d.text(((x + w / 2) * S, (y + h / 2) * S), label, font=F(size), fill=accent, anchor="mm")
    return w


def footer(d):
    s = "предпросмотр вёрстки · цвета из SymbiosisTheme"
    w = tw(s, 9.5) + 20
    x, y = (390 - w) / 2, H / S - 24
    rr(d, (x * S, y * S, (x + w) * S, (y + 16) * S), 8, fill=(24, 26, 33))
    d.text(((x + w / 2) * S, (y + 8) * S), s, font=F(9.5), fill=(140, 140, 152), anchor="mm")


# ── 1. библиотека ──────────────────────────────────────────────────────

def library():
    img, d = screen((22, 34, 60))
    status_bar(d)
    x, y = 18, 46
    rr(d, (x * S, (y - 2) * S, (x + 30) * S, (y + 28) * S), 10, fill=soft(CYAN, 0.20))
    d.text(((x + 15) * S, (y + 13) * S), "S", font=F(16, True), fill=CYAN, anchor="mm")
    d.text(((x + 42) * S, (y + 2) * S), "Symbiosis", font=F(21, True), fill=TEXT, anchor="la")
    d.text(((x + 42) * S, (y + 26) * S), "Библиотека игр", font=F(12.5), fill=DIM, anchor="la")

    y = 96
    bx = 16
    for label, accent in (("Искать игры", CYAN), ("Папки", LIME), ("Конвертер", AMBER)):
        bx = pill(d, bx, y, label, accent)
    # четвёртая кнопка обрезана краем экрана — горизонтальная прокрутка
    rest = [("Ключи", VIOLET), ("Инструменты", PINK)]
    w = tw(rest[0][0], 13, True) + 34
    rr(d, (bx * S, y * S, (bx + w) * S, (y + 40) * S), 14, fill=soft(rest[0][1], 0.10))
    d.text(((bx + w / 2) * S, (y + 20) * S), rest[0][0], font=F(13, True), fill=soft(rest[0][1], 0.55), anchor="mm")

    y = 152
    rr(d, (16 * S, y * S, 374 * S, (y + 48) * S), 16, fill=soft(CYAN, 0.05), outline=soft(CYAN, 0.55), width=1.2)
    d.ellipse([(28 * S), (y + 15) * S, (39 * S), (y + 26) * S], outline=soft(CYAN, 0.8), width=int(1.6 * S))
    d.line([(38 * S, (y + 25) * S), (44 * S, (y + 31) * S)], fill=soft(CYAN, 0.8), width=int(1.6 * S))
    d.text((54 * S, (y + 24) * S), "Поиск: название, Title ID или имя файла", font=F(13), fill=soft(CYAN, 0.75), anchor="lm")

    y = 212
    cx = 16
    for label, checked in (("Все файлы", True), ("Запускается", False), ("Не запускается", False)):
        w = tw(label, 13) + 30
        rr(d, (cx * S, y * S, (cx + w) * S, (y + 32) * S), 10,
           fill=soft(CYAN, 0.22) if checked else CARD)
        d.text(((cx + w / 2) * S, (y + 16) * S), label, font=F(13, checked),
               fill=CYAN if checked else DIM, anchor="mm")
        cx += w + 8

    y = 262
    d.text((18 * S, y * S), "12 игр · 1 на Kenji-NX · 3 сжатых → Конвертер",
           font=F(12.5, True), fill=CYAN, anchor="la")
    y += 26

    note_for = {"Xenoblade Chronicles 3": ("nsz", "сжатый · распакует Конвертер")}
    for i, g in enumerate(PAL["games"]):
        accent = rgb(g["accent"])
        top = rgb(g["top"])
        fmt = ["nsp", "xci", "nsp", "nsz", "xci"][i]
        fmt_col = rgb(PAL["format_" + fmt])
        note = note_for.get(g["title"])
        h = 12 + 42 + (18 if note else 0) + 12
        rr(d, (16 * S, y * S, 374 * S, (y + h) * S), 20, fill=top,
           outline=soft(g["accent"], 0.30), width=1)
        d.rectangle([16 * S, (y + 10) * S, (16 + 4) * S, (y + h - 10) * S], fill=accent)
        rr(d, ((16 + 12) * S, (y + 12) * S, (16 + 54) * S, (y + 54) * S), 14, fill=soft(g["accent"], 0.16))
        d.text(((16 + 33) * S, (y + 33) * S), g["monogram"], font=F(17, True), fill=accent, anchor="mm")

        # чипы справа, заголовок — в оставшейся ширине
        chips = [fmt] + (["kenji"] if i == 0 else [])
        cw = 0
        cx = 374 - 14
        for c in reversed(chips):
            col = PINK if c == "kenji" else fmt_col
            w = tw(c, 11) + 20
            cx -= w
            rr(d, (cx * S, (y + 16) * S, (cx + w) * S, (y + 40) * S), 10, fill=soft(col, 0.16))
            d.text(((cx + w / 2) * S, (y + 28) * S), c, font=F(11), fill=col, anchor="mm")
            cx -= 8
            cw += w + 8
        title_w = (374 - 14) - (16 + 66) - cw - 4
        th = wrap_h(g["title"], 15.5, title_w, True)
        text(d, 16 + 66, y + 12, g["title"], 15.5, TEXT, bold=True, maxw=title_w)
        d.text(((16 + 66) * S, (y + 12 + th + 2) * S), g["id"], font=F(11.5), fill=DIM, anchor="la")
        if note:
            d.text(((16 + 66) * S, (y + 12 + th + 22) * S), note[1], font=F(11.5, True), fill=AMBER, anchor="la")
        y += h + 12
        if y > 780:
            break
    footer(d)
    return img


# ── 2. два ядра ────────────────────────────────────────────────────────

def cores():
    img, d = screen((18, 42, 44))
    status_bar(d)
    x, y = 18, 44
    d.line([(x * S, (y + 4) * S), (x - 8 * S, (y + 12) * S), (x * S, (y + 20) * S)], fill=TEXT, width=int(2 * S))
    d.text(((x + 12) * S, (y - 2) * S), "Два ядра", font=F(26, True), fill=TEXT, anchor="la")
    d.text(((x + 12) * S, (y + 32) * S), "Eden и Kenji-NX в одном приложении", font=F(13), fill=MINT, anchor="la")
    y = 104

    for name, letter, accent, sub, status, status_col, buttons in (
        ("Eden", "E", EDEN, "встроен в приложение", "встроен", MINT,
         [("Проверить", EDEN)]),
        ("Kenji-NX", "K", PINK, "отдельный процесс :kenji", "не скачан", AMBER,
         [("Скачать (55 МБ)", PINK)]),
    ):
        body_h = 44 + 8 + 34 + (44 if buttons else 0) + 28
        h = max(body_h, 96)
        rr(d, (16 * S, y * S, 374 * S, (y + h) * S), 22, fill=mix(CARD, accent, 0.12),
           outline=soft(accent, 0.35), width=1)
        d.rectangle([16 * S, (y + 12) * S, (16 + 4) * S, (y + h - 12) * S], fill=accent)
        rr(d, ((16 + 14) * S, (y + 14) * S, (16 + 58) * S, (y + 58) * S), 14, fill=soft(accent, 0.16))
        d.text(((16 + 36) * S, (y + 36) * S), letter, font=F(19, True), fill=accent, anchor="mm")
        d.text(((16 + 70) * S, (y + 16) * S), name, font=F(17.5, True), fill=TEXT, anchor="la")
        d.text(((16 + 70) * S, (y + 40) * S), sub, font=F(11.5), fill=DIM, anchor="la")
        w = tw(status, 11) + 20
        rr(d, ((374 - 14 - w) * S, (y + 18) * S, (374 - 14) * S, (y + 42) * S), 10, fill=soft(status_col, 0.16))
        d.text(((374 - 14 - w / 2) * S, (y + 30) * S), status, font=F(11), fill=status_col, anchor="mm")

        ty = y + 70
        desc = ("Всегда доступен, ничего скачивать не нужно." if letter == "E"
                else "Не скачан. Нужно 55 МБ один раз: игры, сейвы и ключи общие.")
        ty = text(d, 16 + 16, ty, desc, 12.5, DIM, maxw=374 - 16 - 60)
        if buttons:
            bx = 16 + 16
            for label, col in buttons:
                bx = pill(d, bx, ty + 4, label, col, size=13, h=38)
        y += h + 12

    y += 6
    d.text((16 * S, y * S), "Связь настроек", font=F(19, True), fill=MINT, anchor="la")
    y += 30
    y = text(d, 16, y, "Зелёная точка — значение взято у Eden. Розовая — своё у Kenji. "
                       "Нажмите строку, чтобы переключить значение.", 12.5, DIM, maxw=358) + 8

    rows = [("Память второго ядра", "4 ГБ", False, True),
            ("Масштаб картинки", "1x", True, False),
            ("NCE (нативный код)", "выкл · Dynarmic", True, False)]
    ch = len(rows) * 46 + 8
    rr(d, (16 * S, y * S, 374 * S, (y + ch) * S), 20, fill=SURFACE, outline=OUTLINE, width=1)
    ry = y + 8
    for label, value, from_eden, bold_line in rows:
        dot = MINT if from_eden else PINK
        rr(d, ((16 + 12) * S, (ry + 10) * S, (16 + 20) * S, (ry + 18) * S), 4, fill=dot)
        d.text(((16 + 30) * S, (ry + 6) * S), label, font=F(14.5), fill=TEXT, anchor="la")
        vw = tw(value, 14.5, True)
        d.text(((374 - 12 - vw) * S, (ry + 6) * S), value, font=F(14.5, True), fill=dot, anchor="la")
        d.text(((16 + 30) * S, (ry + 25) * S), ("из Eden" if from_eden else "своё у Kenji") +
               (" · общий с Eden" if from_eden else " · только у Kenji"), font=F(10.5), fill=soft(dot, 0.85), anchor="la")
        ry += 46
    footer(d)
    return img


# ── 3. инструменты ─────────────────────────────────────────────────────

TOOLS = [
    ("Два ядра (гибрид)", "Eden и Kenji-NX в одном приложении: у каждого свои настройки, ядро выбирается на игру", "tools"),
    ("Настройка ФПС", "Профили под Mali-G57: масштаб, док, кэш шейдеров. Подобрано на телефоне.", "20"),
    ("Диагностика", "Журнал запуска, отчёт о драйвере, почему игра не открылась.", "30"),
    ("Папки с играми", "Где приложение ищет файлы NSP, XCI и сжатые NSZ.", "40"),
    ("Ключи и прошивка", "prod.keys и Firmware: без них файлы видны, но не запускаются.", "50"),
    ("Утилиты", "Распаковка сжатых файлов, проверка целостности, перенос сейвов.", "60"),
]


def tools():
    img, d = screen((26, 20, 34))
    status_bar(d)
    x, y = 18, 44
    d.line([(x * S, (y + 4) * S), (x - 8 * S, (y + 12) * S), (x * S, (y + 20) * S)], fill=TEXT, width=int(2 * S))
    d.text(((x + 12) * S, (y - 4) * S), "Инструменты", font=F(24, True), fill=TEXT, anchor="la")
    y = 96
    for title, desc, key in TOOLS:
        accent = rgb(PAL["accent_" + key] if ("accent_" + key) in PAL else (PAL["tool_" + key] if ("tool_" + key) in PAL else PAL["pink"]))
        h = 16 + 40 + 8 + wrap_h(desc, 12.5, 374 - 16 - 60) + 12
        rr(d, (16 * S, y * S, 374 * S, (y + h) * S), 20, fill=SURFACE, outline=soft(accent, 0.30), width=1)
        d.rectangle([16 * S, (y + 10) * S, (16 + 4) * S, (y + h - 10) * S], fill=accent)
        rr(d, ((16 + 16) * S, (y + 16) * S, (16 + 56) * S, (y + 56) * S), 14, fill=soft(accent, 0.16))
        d.text(((16 + 36) * S, (y + 36) * S), title[0], font=F(16, True), fill=accent, anchor="mm")
        text(d, 16 + 68, y + 16, title, 15, TEXT, bold=True, maxw=374 - 16 - 68 - 24)
        text(d, 16 + 68, y + 40, desc, 12.5, DIM, maxw=374 - 16 - 68 - 24)
        cy = (y + h / 2) * S
        d.line([(352 * S, cy - 5 * S), (357 * S, cy), (352 * S, cy + 5 * S)], fill=DIM, width=int(1.8 * S))
        y += h + 10
    footer(d)
    return img


# ── 4. руководство ─────────────────────────────────────────────────────

def guide():
    img, d = screen((16, 26, 52))
    status_bar(d)
    x, y = 18, 44
    d.line([(x * S, (y + 4) * S), (x - 8 * S, (y + 12) * S), (x * S, (y + 20) * S)], fill=TEXT, width=int(2 * S))
    d.text(((x + 12) * S, (y - 4) * S), "Руководство", font=F(24, True), fill=TEXT, anchor="la")
    d.text(((x + 12) * S, (y + 28) * S), "Как пользоваться и где что лежит", font=F(12), fill=DIM, anchor="la")

    y = 92
    rr(d, (16 * S, y * S, 374 * S, (y + 46) * S), 16, fill=soft(BLUE, 0.05), outline=soft(BLUE, 0.5), width=1.2)
    d.ellipse([(28 * S), (y + 14) * S, (39 * S), (y + 25) * S], outline=soft(BLUE, 0.8), width=int(1.6 * S))
    d.line([(38 * S, (y + 24) * S), (44 * S, (y + 30) * S)], fill=soft(BLUE, 0.8), width=int(1.6 * S))
    d.text((54 * S, (y + 23) * S), "Поиск по руководству", font=F(13), fill=soft(BLUE, 0.7), anchor="lm")

    y = 156
    accent = rgb(PAL["section_cores"])
    intro = ("В приложении два ядра — Eden и Kenji-NX. Где одно падает, другое иногда едет, "
             "поэтому ядро выбирается не на всё приложение, а на игру.")
    steps = [
        ("Выбрать ядро для игры",
         "Долгое нажатие на плитке в библиотеке → «Запустить на Eden» или «Запустить на "
         "Kenji-NX». Выбор запомнится за этой игрой, а пометка «kenji» на плитке покажет, "
         "каким ядром она пойдёт."),
        ("Скачать второе ядро",
         "«Инструменты» → «Два ядра» → «Скачать», около 55 МБ один раз. Игры, сейвы и ключи "
         "общие: скачивается только ядро, библиотеку заново не собираете."),
    ]
    h = 3 + 16 + 26 + wrap_h(intro, 12.5, 358 - 32) + 10
    for t, s in steps:
        h += 26 + wrap_h(s, 12, 374 - 16 - 36 - 16) + 10
    h += 54 + 16
    old = accent
    rr(d, (16 * S, y * S, 374 * S, (y + h) * S), 20, fill=SURFACE, outline=soft(old, 0.30), width=1)
    d.rectangle([16 * S, y * S, 374 * S, (y + 3) * S], fill=accent)
    ty = y + 16
    d.text((32 * S, ty * S), "Два ядра: гибрид", font=F(17, True), fill=accent, anchor="la")
    ty += 28
    ty = text(d, 32, ty, intro, 12.5, DIM, maxw=374 - 64) + 8

    for i, (t, s) in enumerate(steps, 1):
        rr(d, ((32) * S, ty * S, (32 + 26) * S, (ty + 26) * S), 13, fill=soft(old, 0.16))
        d.text(((32 + 13) * S, (ty + 13) * S), str(i), font=F(12, True), fill=accent, anchor="mm")
        d.text(((32 + 36) * S, (ty + 3) * S), t, font=F(14, True), fill=TEXT, anchor="la")
        ty = text(d, 32 + 36, ty + 24, s, 12, DIM, maxw=374 - 32 - 36 - 18) + 10
    pill(d, 32, ty, "Открыть два ядра", accent, size=13, h=38)
    footer(d)
    return img


def main():
    shots = [
        ("01-library.png", library, "Библиотека: цвет игры, формат, ядро"),
        ("02-cores.png", cores, "Два ядра: карточки и статус"),
        ("03-tools.png", tools, "Инструменты: цвет у каждого пункта"),
        ("04-guide.png", guide, "Руководство: цвет раздела"),
    ]
    for name, fn, _ in shots:
        img = fn()
        img.save(os.path.join(HERE, name))
        print("wrote", name, img.size)

    cols, gap, cap = 2, 22, 46
    cw, ch = W // 2, H // 2
    sheet = Image.new("RGB", (cols * cw + (cols + 1) * gap, 2 * (ch + cap) + 3 * gap), (10, 11, 14))
    dd = ImageDraw.Draw(sheet)
    for i, (name, _fn, caption) in enumerate(shots):
        im = Image.open(os.path.join(HERE, name)).resize((cw, ch), Image.LANCZOS)
        r, c = divmod(i, cols)
        x = gap + c * (cw + gap)
        y = gap + r * (ch + cap + gap)
        sheet.paste(im, (x, y))
        dd.rounded_rectangle([x, y, x + cw, y + ch], radius=10, outline=(58, 60, 70), width=2)
        dd.text((x + cw / 2, y + ch + 20), caption, font=ImageFont.truetype(REG, 17),
                fill=(198, 200, 210), anchor="mm")
    sheet.save(os.path.join(HERE, "00-overview.png"))
    print("wrote 00-overview.png", sheet.size)


if __name__ == "__main__":
    main()
