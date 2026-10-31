#!/usr/bin/env python3
"""
Синтетические дампы для проверки библиотеки: NSP, XCI, NSZ.

Зачем. Проверить «видит ли лаунчер файлы из папки» на настоящем дампе нельзя:
его нет, а без ключей консоли он всё равно не откроется. Но контейнеры можно
сделать корректными по структуре — и тогда проверяется ровно то, что должен
решать лаунчер до всякой криптографии: какой это формат, сколько он весит,
запускается ли он и что показать человеку, если нет.

Форматы повторяют `patch/symbiosis/rom_tools.cpp` этого же репозитория — не
«похоже на», а буквально те смещения, которые читает наш собственный код:

  PFS0   magic "PFS0", u32 count, u32 string_bytes, u32 reserved,
         24-байтовые записи (off u64, size u64, name_off u32, 0 u32)
  HFS0   тот же заголовок, записи по 0x40, имена в таблице
  XCI    "HEAD" по 0x100, конец данных по 0x118 (в единицах по 0x200),
         корневой HFS0 по 0x130 (тоже в единицах), в нём партиция "secure"
  NCZ    0x4000 байт заголовка NCA, затем "NCZSECTN", u64 число секций,
         секции по 64 байта, затем "NCZBLOCK", 24 байта меты (счётчик блоков
         по +12), таблица размеров u32[], затем кадры zstd
  NSZ    PFS0, в котором лежат .ncz вместо .nca

Запуск:  python3 tools/make-fixtures.py [--out fixtures] [--check]
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import struct
import sys
import zstandard

MEDIA_UNIT = 0x200
NCA_HEADER_SIZE = 0x4000

# ── контейнеры ───────────────────────────────────────────────────────────


def pfs0(files: list[tuple[str, bytes]]) -> bytes:
    """PFS0: заголовок, записи по 24 байта, таблица имён, данные."""
    names = b"".join(name.encode() + b"\0" for name, _ in files)
    head = struct.pack("<4sIII", b"PFS0", len(files), len(names), 0)
    offset = 0
    entries = bytearray()
    name_off = 0
    for name, blob in files:
        entries += struct.pack("<QQII", offset, len(blob), name_off, 0)
        offset += len(blob)
        name_off += len(name.encode()) + 1
    return head + bytes(entries) + names + b"".join(b for _, b in files)


def hfs0(partitions: list[tuple[str, bytes]]) -> bytes:
    """HFS0: те же поля, записи по 0x40 (первые 24 значащие, остальное хеш)."""
    names = b"".join(name.encode() + b"\0" for name, _ in partitions)
    head = struct.pack("<4sIII", b"HFS0", len(partitions), len(names), 0)
    offset = 0
    entries = bytearray()
    name_off = 0
    for name, blob in partitions:
        entries += struct.pack("<QQII", offset, len(blob), name_off, 0)
        entries += b"\0" * (0x40 - 24)
        offset += len(blob)
        name_off += len(name.encode()) + 1
    return head + bytes(entries) + names + b"".join(b for _, b in partitions)


def fake_nca(seed: int, body: int = 96 * 1024) -> bytes:
    """
    NCA с валидным магическим числом по 0x200, но без настоящей криптографии.

    Это честная заглушка содержимого: заголовок на месте, поэтому формат
    определяется, а расшифровать его нечем — ровно то, что увидит человек
    с дампом без ключей.
    """
    header = bytearray(NCA_HEADER_SIZE)
    header[0x200:0x204] = b"NCA3"
    struct.pack_into("<I", header, 0x204, 7)  # key generation
    struct.pack_into("<Q", header, 0x208, 0x0100_0000_0000_0000 + seed)
    struct.pack_into("<Q", header, 0x210, 0)
    pattern = bytes(((i * 31 + seed) & 0xFF) for i in range(256))
    return bytes(header) + (pattern * (body // 256 + 1))[:body]


def ncz(seed: int) -> bytes:
    """NCZ: заголовок NCA + NCZBLOCK из четырёх кадров zstd."""
    body = fake_nca(seed, body=4 * 4096)
    header, payload = body[:NCA_HEADER_SIZE], body[NCA_HEADER_SIZE:]
    cctx = zstandard.ZstdCompressor(level=3)
    blocks = [cctx.compress(payload[i : i + 4096]) for i in range(0, len(payload), 4096)]
    sectn = b"NCZSECTN" + struct.pack("<Q", 1) + b"\0" * 64
    meta = bytearray(24)
    meta[0:8] = b"NCZBLOCK"
    struct.pack_into("<I", meta, 12, len(blocks))
    sizes = b"".join(struct.pack("<I", len(b)) for b in blocks)
    return header + sectn + bytes(meta) + sizes + b"".join(blocks)


def xci(title_id: int, content: bytes) -> bytes:
    """
    XCI: заголовок геймкартриджа, корневой HFS0 и партиция "secure".

    `valid data end` ставится ровно по концу файла, чтобы `Inspect()` не
    считал дамп обрезанным или с паддингом.
    """
    secure = hfs0([(f"{title_id:016x}0000000000000000.nca", content)])
    root = hfs0([("update", b"\0" * MEDIA_UNIT), ("secure", secure), ("normal", b"\0" * 64)])
    root_at = 0x4000
    total = root_at + len(root)
    total += (-total) % MEDIA_UNIT

    out = bytearray(total)
    out[0x100:0x104] = b"HEAD"
    struct.pack_into("<I", out, 0x104, total // MEDIA_UNIT)  # размер картриджа
    struct.pack_into("<I", out, 0x108, 0)  # версия
    struct.pack_into("<I", out, 0x10C, 0)  # флаги
    struct.pack_into("<Q", out, 0x110, title_id)  # package id
    struct.pack_into("<Q", out, 0x118, total // MEDIA_UNIT)  # valid data end
    struct.pack_into("<Q", out, 0x120, 0)  # имена партиций
    struct.pack_into("<Q", out, 0x130, root_at // MEDIA_UNIT)  # корневой HFS0
    out[root_at : root_at + len(root)] = root
    return bytes(out)


# ── то, что делает наш rom_tools.cpp ─────────────────────────────────────


def detect_format(name: str, blob: bytes) -> str:
    """Копия RomTools::DetectFormat: расширение, затем магические числа."""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext in ("nsz", "xcz", "ncz"):
        return ext
    if len(blob) > 0x104 and blob[0x100:0x104] == b"HEAD":
        return "xci"
    if blob[:4] in (b"PFS0", b"HFS0"):
        return "nsp"
    if len(blob) > 0x204 and blob[0x200:0x204] in (b"NCA3", b"NCA2"):
        return "nca"
    if len(blob) > 0x14 and blob[0x10:0x14] == b"NRO0":
        return "nro"
    return ext or "unknown"


def unpack_nsz(blob: bytes) -> list[tuple[str, bytes]]:
    """
    Копия UnpackPfs0 + DecompressNczToFile: NSZ → список (имя.nca, байты).

    Если это сходится, наш собственный конвертер тоже справится: он делает
    ровно эти шаги и ничего больше.
    """
    if blob[:4] != b"PFS0":
        raise ValueError("не PFS0")
    magic, count, str_size, _ = struct.unpack_from("<4sIII", blob, 0)
    names_at = 16 + count * 24
    names = blob[names_at : names_at + str_size]
    data_at = names_at + str_size
    out = []
    for i in range(count):
        off, size, name_off, _ = struct.unpack_from("<QQII", blob, 16 + i * 24)
        raw_name = names[name_off : names.index(b"\0", name_off)].decode()
        chunk = blob[data_at + off : data_at + off + size]
        if raw_name.lower().endswith(".ncz"):
            out.append((raw_name[:-4] + ".nca", unpack_ncz(chunk)))
        else:
            out.append((raw_name, chunk))
    return out


def unpack_ncz(blob: bytes) -> bytes:
    header, rest = blob[:NCA_HEADER_SIZE], blob[NCA_HEADER_SIZE:]
    if rest[:8] != b"NCZSECTN":
        return blob  # не сжато — как в C++: копируем как есть
    count = struct.unpack_from("<Q", rest, 8)[0]
    cursor = 16 + count * 64
    if rest[cursor : cursor + 8] != b"NCZBLOCK":
        payload = rest[cursor:]
        return header + zstandard.ZstdDecompressor().decompress(payload)
    block_count = struct.unpack_from("<I", rest, cursor + 12)[0]
    sizes = list(struct.unpack_from(f"<{block_count}I", rest, cursor + 24))
    off = cursor + 24 + block_count * 4
    dec = zstandard.ZstdDecompressor()
    body = b""
    for size in sizes:
        body += dec.decompress(rest[off : off + size])
        off += size
    return header + body


def xci_secure_to_nsp(blob: bytes) -> bytes:
    """Копия RomTools::XciToNsp: найти "secure" в корневом HFS0 и вырезать."""
    units = struct.unpack_from("<Q", blob, 0x130)[0]
    at = units * MEDIA_UNIT
    if blob[at : at + 4] != b"HFS0":
        raise ValueError("корневой HFS0 не найден")
    _, count, str_size, _ = struct.unpack_from("<4sIII", blob, at)
    entries = at + 0x10
    strings_at = entries + count * 0x40
    data_at = strings_at + str_size
    strings = blob[strings_at:data_at]
    for i in range(count):
        off, size, name_off, _ = struct.unpack_from("<QQII", blob, entries + i * 0x40)
        name = strings[name_off : strings.index(b"\0", name_off)].decode()
        if name == "secure":
            return blob[data_at + off : data_at + off + size]
    raise ValueError("партиции secure нет")


# ── сами файлы ───────────────────────────────────────────────────────────

FIXTURES = [
    # (имя, что генерируем, короткое описание для отчёта)
    ("Sonic Mania [01004E300BD5C000][v0].nsp", "nsp", "PFS0 с двумя NCA"),
    ("Metroid Dread [010093801237C000][v0].xci", "xci", "геймкартридж с партицией secure"),
    ("Hollow Knight [0100633007D48000][v0].nsz", "nsz", "PFS0 с NCZ внутри, блоки zstd"),
]


def build(out_dir: str) -> dict:
    games = os.path.join(out_dir, "Games")
    os.makedirs(games, exist_ok=True)
    report = {"generated_by": "tools/make-fixtures.py", "files": []}

    for name, kind, note in FIXTURES:
        title_id = int(name.split("[")[1].split("]")[0], 16)
        if kind == "nsp":
            blob = pfs0(
                [
                    (f"{title_id:016x}0000000000000000.nca", fake_nca(1)),
                    (f"{title_id:016x}0000000000000000.cnmt.nca", fake_nca(2, 8 * 1024)),
                ]
            )
        elif kind == "xci":
            blob = xci(title_id, fake_nca(3))
        else:
            blob = pfs0([(f"{title_id:016x}0000000000000000.ncz", ncz(4))])

        path = os.path.join(games, name)
        with open(path, "wb") as fh:
            fh.write(blob)

        entry = {
            "name": name,
            "path": f"Games/{name}",
            "bytes": len(blob),
            "sha256": hashlib.sha256(blob).hexdigest(),
            "format": detect_format(name, blob),
            "note": note,
            # Что скажет библиотека до всякой криптографии. Строки совпадают
            # с LibraryIndex.kt дословно: скриншот не должен показывать текст,
            # которого приложение не пишет.
            "kind": "compressed" if kind == "nsz" else "unreadable",
            "reason": (
                "сжатый образ · сначала «Распаковать» во вкладке Конвертер"
                if kind == "nsz"
                else "ядро не прочитало заголовок · проверьте ключи или распакуйте файл"
            ),
            "runnable": False,
        }

        # Круговорот, который делает наш конвертер, — здесь и сейчас.
        if kind == "nsz":
            unpacked = pfs0(unpack_nsz(blob))
            nsp_name = name[:-4] + ".nsp"
            with open(os.path.join(out_dir, "converted-" + nsp_name), "wb") as fh:
                fh.write(unpacked)
            entry["converted"] = {
                "name": nsp_name,
                "bytes": len(unpacked),
                "sha256": hashlib.sha256(unpacked).hexdigest(),
                "format": detect_format(nsp_name, unpacked),
            }
        elif kind == "xci":
            nsp = xci_secure_to_nsp(blob)
            nsp_name = name[:-4] + ".nsp"
            with open(os.path.join(out_dir, "converted-" + nsp_name), "wb") as fh:
                fh.write(nsp)
            entry["converted"] = {
                "name": nsp_name,
                "bytes": len(nsp),
                "sha256": hashlib.sha256(nsp).hexdigest(),
                "format": detect_format(nsp_name, nsp),
            }
        report["files"].append(entry)

    report["summary"] = {
        "files": len(report["files"]),
        "bytes": sum(f["bytes"] for f in report["files"]),
    }
    with open(os.path.join(out_dir, "library.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    return report


def check(out_dir: str) -> int:
    """Перечитать то, что записали: формат, круговорот, размеры."""
    failures = 0
    with open(os.path.join(out_dir, "library.json"), encoding="utf-8") as fh:
        report = json.load(fh)
    for entry in report["files"]:
        path = os.path.join(out_dir, entry["path"])
        blob = open(path, "rb").read()
        got = detect_format(entry["name"], blob)
        ok = got == entry["format"] and len(blob) == entry["bytes"]
        print(f"  {'ok  ' if ok else 'FAIL'}  {entry['name']}: {got}, {len(blob)} Б")
        failures += 0 if ok else 1
        if "converted" in entry:
            conv = open(os.path.join(out_dir, "converted-" + entry["converted"]["name"]), "rb").read()
            same = hashlib.sha256(conv).hexdigest() == entry["converted"]["sha256"]
            print(f"  {'ok  ' if same else 'FAIL'}  круговорот → {entry['converted']['name']} "
                  f"({entry['converted']['format']}, {len(conv)} Б)")
            failures += 0 if same else 1
    return failures


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="fixtures")
    ap.add_argument("--check", action="store_true", help="только перечитать готовое")
    args = ap.parse_args()
    if args.check:
        return 1 if check(args.out) else 0
    report = build(args.out)
    print(json.dumps(report["summary"], ensure_ascii=False))
    return 1 if check(args.out) else 0


if __name__ == "__main__":
    sys.exit(main())
