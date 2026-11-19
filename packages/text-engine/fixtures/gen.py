"""编码测试样本集生成器。

用法（在 packages/text-engine/fixtures 下）：
    PYTHONIOENCODING=utf-8 python gen.py

输出：samples/*（各编码的字节）、expected/*（原文，UTF-8）、manifest.json、README.md。
acceptable 由 compute-acceptable.mjs 用 Node 的 TextDecoder 实际计算，不手填。
本脚本只负责造数据，不含任何编码判断逻辑。随机数种子固定，重复运行结果一致。
"""
import datetime
import json
import random
import shutil
import subprocess
import sys
from pathlib import Path

import corpus as C

HERE = Path(__file__).resolve().parent
SAMPLES = HERE / "samples"
EXPECTED = HERE / "expected"

# Python 编解码器 -> WHATWG 标签
LABEL = {
    "cp932": "shift_jis",
    "shift_jis": "shift_jis",
    "euc_jp": "euc-jp",
    "iso2022_jp": "iso-2022-jp",
    "utf-8": "utf-8",
    "utf-8-sig": "utf-8",
    "ascii": "utf-8",
    "gbk": "gb18030",
    "gb18030": "gb18030",
    "cp950": "big5",
    "big5": "big5",
    "cp1252": "windows-1252",
    "utf-16-le": "utf-16le",
    "utf-16-be": "utf-16be",
}
CJK_LABELS = {"shift_jis", "euc-jp", "gb18030", "big5"}

entries: list[dict] = []
notes: dict[str, str] = {}


def encode(text: str, codec: str, bom: bool = False) -> bytes:
    if codec == "utf-16-le":
        return (b"\xff\xfe" if bom else b"") + text.encode("utf-16-le")
    if codec == "utf-16-be":
        return (b"\xfe\xff" if bom else b"") + text.encode("utf-16-be")
    return text.encode(codec)


def add(name, lang, codec, shape, text, bom=False, ambiguous=False, note=""):
    """写入一个样本。text 为原文（LF 换行；需要 CRLF 时调用前自行替换）。"""
    file = f"{name}.txt"
    data = encode(text, codec, bom)
    (SAMPLES / file).write_bytes(data)
    (EXPECTED / file).write_bytes(text.encode("utf-8"))
    entry = {"file": file, "label": LABEL[codec], "acceptable": [], "lang": lang, "shape": shape}
    if ambiguous:
        entry["ambiguous"] = True
    entries.append(entry)
    notes[file] = note


def sentences(pool, rng, k):
    """从语料中取 k 句（循环 + 打乱），数字各不相同。"""
    out = []
    while len(out) < k:
        batch = pool[:]
        rng.shuffle(batch)
        out.extend(batch)
    return [s.format(n=rng.randint(2, 99999), n2=rng.randint(2, 999), n3=rng.randint(2, 254)) for s in out[:k]]


def paragraph(pool, rng, chars=200, sep=""):
    parts, total = [], 0
    while total < chars:
        s = sentences(pool, rng, 1)[0]
        parts.append(s)
        total += len(s)
    return sep.join(parts)


def body_8kb(pool, rng, codec, sep="", para_every=4, nl="\n"):
    """文本编码后 >= 8192 字节；每 para_every 句换一段。"""
    lines, cur = [], []
    while True:
        cur.append(sentences(pool, rng, 1)[0])
        if len(cur) == para_every:
            lines.append(sep.join(cur))
            cur = []
            text = nl.join(lines) + nl
            if len(encode(text, codec)) >= 8192:
                return text


def ts_iter(rng):
    t = datetime.datetime(2026, 11, 20, 8, 0, 0)
    while True:
        t += datetime.timedelta(seconds=rng.randint(0, 9))
        yield t.strftime("%Y/%m/%d %H:%M:%S") + f".{rng.randint(0, 999):03d}"


def log_text(rng, cjk_pool, lines=400, every=(30, 50), nl="\n", with_level=True):
    """日志型：几乎全 ASCII，每 30-50 行夹一条中日文。"""
    ts = ts_iter(rng)
    out, next_cjk = [], rng.randint(*every)
    for i in range(lines):
        level = rng.choice(C.LOG_LEVELS)
        comp = rng.choice(C.LOG_COMPONENTS)
        if i == next_cjk:
            msg = sentences(cjk_pool, rng, 1)[0]
            next_cjk += rng.randint(*every)
        else:
            msg = sentences(C.LOG_ASCII, rng, 1)[0]
        out.append(f"{next(ts)} [{level}] {comp}: {msg}" if with_level else f"{next(ts)} {msg}")
    return nl.join(out) + nl


def log_sparse(rng, line, lines=400, at=220, nl="\n"):
    """整份日志只有一行含非 ASCII。"""
    ts = ts_iter(rng)
    out = []
    for i in range(lines):
        msg = line if i == at else sentences(C.LOG_ASCII, rng, 1)[0]
        out.append(f"{next(ts)} [{rng.choice(C.LOG_LEVELS)}] {rng.choice(C.LOG_COMPONENTS)}: {msg}")
    return nl.join(out) + nl


def hw_log(rng, hw_pool, mixed_pool=None, lines=900, nl="\r\n"):
    """旧系统风格日志：ASCII 行中夹纯半角片假名行；可选再夹半角 + 全角混排行。"""
    ts = ts_iter(rng)
    out = []
    for i in range(lines):
        stamp = next(ts)[:19]
        r = rng.random()
        if r < 0.28:
            out.append(f"{stamp} {sentences(hw_pool, rng, 1)[0]}")
        elif mixed_pool and r < 0.38:
            out.append(f"{stamp} {sentences(mixed_pool, rng, 1)[0]}")
        else:
            out.append(f"{stamp} JOB{rng.randint(1, 99):02d} RC={rng.choice(['00', '00', '04', '08'])} STEP={rng.randint(1, 20)}")
    return nl.join(out) + nl


def csv_text(rng, spec, rows=200, nl="\n", money_prefix=""):
    out = [spec["header"]]
    for _ in range(rows):
        out.append(",".join([rng.choice(spec["names"]), rng.choice(spec["depts"]), f"{money_prefix}{rng.randint(1, 999) * 100}", rng.choice(spec["notes"])]))
    return nl.join(out) + nl


def main():
    for d in (SAMPLES, EXPECTED):
        if d.exists():
            shutil.rmtree(d)
        d.mkdir()
    rng = random.Random(20261120)
    JA, JAJ2, JAC, HW, HWM = C.JA, C.JA_JIS2, C.JA_CP932, C.JA_HW, C.JA_HW_MIXED
    JA_ALL = JA + JAJ2  # 第二水準混入的通常语料

    # ============================================================ 日文
    # --- cp932（WHATWG 标签 shift_jis）
    add("ja-sjis-short", "ja", "cp932", "short", "ご確認のほど、よろしくお願いいたします。", note="单行短文本，含平假名")
    add("ja-sjis-short-kana", "ja", "cp932", "short", "ジョブが正常終了しました", note="短文本，片假名+平假名")
    add("ja-sjis-kanji4", "ja", "cp932", "kanji-only", C.KANJI_JA[0], ambiguous=True,
        note="4 个汉字：这 8 个字节同时是合法的 GBK / Big5 / EUC-JP 序列，无假名、无 ASCII，无法从字节判断")
    add("ja-sjis-kanji6", "ja", "cp932", "kanji-only", C.KANJI_JA[2], ambiguous=True,
        note="6 个汉字：同上，GBK / Big5 / EUC-JP 下也都是合法字节")
    add("ja-sjis-paragraph", "ja", "cp932", "paragraph", paragraph(JA, rng, 220), note="约 200 字的段落")
    add("ja-sjis-8kb", "ja", "cp932", "8kb", body_8kb(JA, rng, "cp932", nl="\r\n"), note="约 8KB，CRLF 换行")
    add("ja-sjis-log", "ja", "cp932", "log", log_text(rng, JA, nl="\r\n"), note="400 行日志，几乎全 ASCII，每 30-50 行夹一条日文，CRLF")
    add("ja-sjis-log-sparse", "ja", "cp932", "log-sparse",
        log_sparse(rng, "顧客マスタの更新に失敗しました（ご確認ください）"), note="400 行 ASCII 日志中只有 1 行日文")
    add("ja-sjis-csv", "ja", "cp932", "csv", csv_text(rng, C.CSV_JA, nl="\r\n"), note="CSV：逗号 + 日文人名 / 部门（多数为纯汉字单元格）")
    add("ja-sjis-ext", "ja", "cp932", "cp932-ext", "\n".join(sentences(JAC, rng, 12)) + "\n",
        note="含 ① ㈱ 髙 № Ⅰ ㊤ ㌫ ㎏ 等 cp932 厂商扩展（NEC 选定 IBM 扩展），Shift_JIS 严格子集无法表示")
    add("ja-sjis-jis2", "ja", "cp932", "jis-level2", "\n".join(sentences(JAJ2, rng, 16)) + "\n",
        note="JIS 第二水准汉字（齟齬 鬱 毀 稟 贖 憑 …）")
    add("ja-sjis-plain-paragraph", "ja", "shift_jis", "paragraph", paragraph(JA_ALL, rng, 220, sep=""),
        note="用 Python 严格 shift_jis 编码（仅 JIS X 0208）")
    add("ja-sjis-plain-8kb", "ja", "shift_jis", "8kb", body_8kb(JA_ALL, rng, "shift_jis"), note="严格 shift_jis，约 8KB")
    # 半角片假名
    add("ja-sjis-hw-tiny", "ja", "cp932", "halfwidth-kana", "2026/11/20 10:15:03 ｴﾗｰ ｺｰﾄﾞ=E1023\n",
        note="单行：时间戳 + 半角片假名。0xB4 0xD7 0xB0 同时是 GBK / Big5 的合法首字节，易被误判")
    add("ja-sjis-hw-short", "ja", "cp932", "halfwidth-kana", "2026/11/20 10:15:03 ﾊﾞｯｸｱｯﾌﾟ ｶｲｼ\n2026/11/20 10:21:47 ﾊﾞｯｸｱｯﾌﾟ ｼｭｳﾘｮｳ\n",
        note="两行：纯半角片假名行 + ASCII")
    add("ja-sjis-hw-log", "ja", "cp932", "halfwidth-kana-log", hw_log(rng, HW), note="400 行旧系统风格日志：纯半角片假名行混在 ASCII 行中（无全角日文）")
    add("ja-sjis-hw-mixed-log", "ja", "cp932", "halfwidth-kana-mixed", hw_log(rng, HW, HWM), note="日志中既有纯半角片假名行，也有半角 + 全角日文混排行")
    add("ja-sjis-hw-mixed-text", "ja", "cp932", "halfwidth-kana-mixed", "\n".join(sentences(HWM, rng, 10)) + "\n",
        note="半角片假名与全角日文混排的短文档（无 ASCII 行）")
    add("ja-sjis-hw-only", "ja", "cp932", "halfwidth-kana", "\r\n".join(sentences(HW, rng, 16)) + "\r\n",
        note="只有半角片假名行（含少量 ASCII 数字），无全角字符")
    # --- EUC-JP
    add("ja-eucjp-short", "ja", "euc_jp", "short", "ご確認のほど、よろしくお願いいたします。", note="单行短文本")
    add("ja-eucjp-kanji4", "ja", "euc_jp", "kanji-only", C.KANJI_JA[3], ambiguous=True,
        note="4 个汉字：EUC-JP 的 A1-FE 双字节同时是合法的 GBK / Big5 序列，无法判断")
    add("ja-eucjp-paragraph", "ja", "euc_jp", "paragraph", paragraph(JA, rng, 220), note="约 200 字")
    add("ja-eucjp-8kb", "ja", "euc_jp", "8kb", body_8kb(JA_ALL, rng, "euc_jp"), note="约 8KB，LF")
    add("ja-eucjp-log", "ja", "euc_jp", "log", log_text(rng, JA), note="400 行 ASCII 日志夹日文，LF（Unix 系统常见）")
    add("ja-eucjp-csv", "ja", "euc_jp", "csv", csv_text(rng, C.CSV_JA), note="CSV 逗号 + 日文")
    add("ja-eucjp-jis2", "ja", "euc_jp", "jis-level2", "\n".join(sentences(JAJ2, rng, 16)) + "\n", note="JIS 第二水准汉字")
    add("ja-eucjp-hw-log", "ja", "euc_jp", "halfwidth-kana-log", hw_log(rng, HW, HWM, nl="\n"),
        note="EUC-JP 中半角片假名为 0x8E + 0xA1-0xDF；纯半角行与混排行混在 ASCII 日志中")
    add("ja-eucjp-hw-short", "ja", "euc_jp", "halfwidth-kana", "2026/11/20 10:15:03 ﾊﾞｯｸｱｯﾌﾟ ｶｲｼ\n",
        note="单行 EUC-JP 半角片假名（0x8E 前缀）")
    # --- ISO-2022-JP
    add("ja-jis-short", "ja", "iso2022_jp", "short", "ご確認のほど、よろしくお願いいたします。", note="7 位 JIS，单行（含 ESC 序列）")
    add("ja-jis-paragraph", "ja", "iso2022_jp", "paragraph", paragraph(JA, rng, 220), note="ISO-2022-JP 段落")
    add("ja-jis-8kb", "ja", "iso2022_jp", "8kb", body_8kb(JA_ALL, rng, "iso2022_jp"), note="约 8KB（邮件正文常见）")
    add("ja-jis-log", "ja", "iso2022_jp", "log", log_text(rng, JA, lines=600), note="几乎全 ASCII 的日志夹 ESC $ B ... ESC ( B 日文段")
    # --- UTF-8
    add("ja-utf8-short", "ja", "utf-8", "short", "ご確認のほど、よろしくお願いいたします。", note="单行短文本")
    add("ja-utf8-kanji4", "ja", "utf-8", "kanji-only", C.KANJI_JA[1], note="只有汉字的 UTF-8：非法的旧编码序列，应可判定")
    add("ja-utf8-paragraph", "ja", "utf-8", "paragraph", paragraph(JA, rng, 220), note="约 200 字")
    add("ja-utf8-8kb", "ja", "utf-8", "8kb", body_8kb(JA_ALL, rng, "utf-8"), note="约 8KB")
    add("ja-utf8-log", "ja", "utf-8", "log", log_text(rng, JA), note="日志夹日文")
    add("ja-utf8-csv", "ja", "utf-8", "csv", csv_text(rng, C.CSV_JA), note="CSV")
    add("ja-utf8-hw-log", "ja", "utf-8", "halfwidth-kana-log", hw_log(rng, HW, HWM, nl="\n"), note="UTF-8 中的半角片假名（U+FF61-FF9F）")
    add("ja-utf8bom-paragraph", "ja", "utf-8-sig", "bom", paragraph(JA, rng, 220), bom=True, note="UTF-8 BOM（EF BB BF）")
    add("ja-utf8bom-log", "ja", "utf-8-sig", "bom-log", log_text(rng, JA, lines=500, nl="\r\n"), bom=True, note="UTF-8 BOM + CRLF 日志")
    # --- UTF-16
    add("ja-utf16le-bom-paragraph", "ja", "utf-16-le", "bom", paragraph(JA, rng, 220), bom=True, note="UTF-16LE + BOM")
    add("ja-utf16be-bom-paragraph", "ja", "utf-16-be", "bom", paragraph(JA, rng, 220), bom=True, note="UTF-16BE + BOM")
    add("ja-utf16le-bom-8kb", "ja", "utf-16-le", "bom-8kb", body_8kb(JA_ALL, rng, "utf-16-le", nl="\r\n"), bom=True, note="UTF-16LE + BOM，约 8KB，CRLF")
    add("ja-utf16le-nobom-log", "ja", "utf-16-le", "no-bom-log", log_text(rng, JA, lines=500, nl="\r\n"),
        note="无 BOM 的 UTF-16LE 日志（大量 NUL 字节）")
    add("ja-utf16be-nobom-log", "ja", "utf-16-be", "no-bom-log", log_text(rng, JA, lines=500), note="无 BOM 的 UTF-16BE 日志")
    add("ja-utf16le-nobom-pure", "ja", "utf-16-le", "no-bom-pure-cjk", "".join(sentences(JA, rng, 12)).replace("GB", "ＧＢ").replace("1", "１").replace("2", "２").replace("3", "３").replace("4", "４").replace("5", "５").replace("6", "６").replace("7", "７").replace("8", "８").replace("9", "９").replace("0", "０"),
        note="无 BOM、无 ASCII 的纯日文 UTF-16LE（没有 NUL 字节可作线索，码点都在假名 / CJK 区）")
    add("ja-utf16be-nobom-pure", "ja", "utf-16-be", "no-bom-pure-cjk", "".join(sentences(C.JA_JIS2, rng, 16)),
        note="无 BOM、无 ASCII 的纯日文 UTF-16BE")
    add("ja-utf16le-nobom-pure-8kb", "ja", "utf-16-le", "no-bom-pure-cjk", "".join(s for s in sentences([x for x in JA if "{n}" not in x], rng, 150)),
        note="无 BOM 纯日文 UTF-16LE，约 8KB")

    # ============================================================ 简体中文
    ZH, ZHR = C.ZH_CN, C.ZH_RARE
    ZH_ALL = ZH + ZHR
    add("zh-gbk-short", "zh-CN", "gbk", "short", "请确认后再提交。", note="单行短文本（含标点，无 ASCII）")
    add("zh-gbk-kanji4", "zh-CN", "gbk", "kanji-only", C.KANJI_ZH_CN[0], ambiguous=True,
        note="4 个汉字：GBK 双字节同时是合法的 Big5 / EUC-JP / Shift_JIS 序列，无法判断")
    add("zh-gbk-kanji4b", "zh-CN", "gbk", "kanji-only", C.KANJI_ZH_CN[1], ambiguous=True, note="4 个汉字，同上")
    add("zh-gbk-paragraph", "zh-CN", "gbk", "paragraph", paragraph(ZH, rng, 220), note="约 200 字")
    add("zh-gbk-8kb", "zh-CN", "gbk", "8kb", body_8kb(ZH_ALL, rng, "gbk"), note="约 8KB，含二级字")
    add("zh-gbk-log", "zh-CN", "gbk", "log", log_text(rng, C.LOG_ZH_CN, nl="\r\n"), note="400 行 ASCII 日志夹中文，CRLF")
    add("zh-gbk-log-sparse", "zh-CN", "gbk", "log-sparse", log_sparse(rng, "客户主数据更新失败：连接超时，请联系管理员"), note="全文只有 1 行中文")
    add("zh-gbk-csv", "zh-CN", "gbk", "csv", csv_text(rng, C.CSV_ZH_CN, nl="\r\n"), note="CSV：逗号 + 中文人名 / 部门（Excel 导出常见）")
    add("zh-gbk-rare", "zh-CN", "gbk", "rare-chars", "\n".join(sentences(ZHR, rng, 8)) + "\n", note="较生僻字（殚 亟 濒 …）")
    add("zh-gb18030-4byte", "zh-CN", "gb18030", "gb18030-4byte", "\n".join(sentences(C.ZH_GB18030_4B, rng, 8)) + "\n",
        note="含 GB18030 四字节字符（𠮷 😀 𡈽 …），GBK 无法表示")
    add("zh-gb18030-8kb", "zh-CN", "gb18030", "8kb", body_8kb(ZH_ALL + C.ZH_GB18030_4B, rng, "gb18030"), note="约 8KB，混入四字节字符")
    add("zh-gb18030-log", "zh-CN", "gb18030", "log", log_text(rng, C.LOG_ZH_CN + C.ZH_GB18030_4B[:3]), note="日志夹中文 + 偶有四字节字符")
    add("zh-utf8-short", "zh-CN", "utf-8", "short", "请确认后再提交。", note="单行短文本")
    add("zh-utf8-kanji4", "zh-CN", "utf-8", "kanji-only", C.KANJI_ZH_CN[2], note="4 个汉字的 UTF-8")
    add("zh-utf8-paragraph", "zh-CN", "utf-8", "paragraph", paragraph(ZH, rng, 220), note="约 200 字")
    add("zh-utf8-8kb", "zh-CN", "utf-8", "8kb", body_8kb(ZH_ALL, rng, "utf-8"), note="约 8KB")
    add("zh-utf8-log", "zh-CN", "utf-8", "log", log_text(rng, C.LOG_ZH_CN), note="日志夹中文")
    add("zh-utf8-csv", "zh-CN", "utf-8", "csv", csv_text(rng, C.CSV_ZH_CN), note="CSV")
    add("zh-utf16le-bom-paragraph", "zh-CN", "utf-16-le", "bom", paragraph(ZH, rng, 220), bom=True, note="UTF-16LE + BOM")
    add("zh-utf16le-nobom-pure", "zh-CN", "utf-16-le", "no-bom-pure-cjk", "".join(sentences([x for x in ZH_ALL if "{n}" not in x], rng, 14)),
        note="无 BOM、无 ASCII 的纯中文 UTF-16LE")
    add("zh-utf16be-nobom-pure", "zh-CN", "utf-16-be", "no-bom-pure-cjk", "".join(sentences([x for x in ZH_ALL if "{n}" not in x], rng, 14)),
        note="无 BOM、无 ASCII 的纯中文 UTF-16BE")
    add("zh-utf16le-nobom-log", "zh-CN", "utf-16-le", "no-bom-log", log_text(rng, C.LOG_ZH_CN, lines=500), note="无 BOM UTF-16LE 日志")

    # ============================================================ 繁體中文
    TW, TWR = C.ZH_TW, C.ZH_TW_RARE
    TW_ALL = TW + C.ZH_TW_RARE_LEGACY  # 其他繁体样本沿用旧语料（内容不变）；只有 big5 的 level2 / 8kb 使用真正的二级字 TWR
    add("tw-big5-short", "zh-TW", "cp950", "short", "請確認後再送出。", note="单行短文本")
    add("tw-big5-kanji4", "zh-TW", "cp950", "kanji-only", C.KANJI_ZH_TW[1][:4], ambiguous=True,
        note="4 个汉字：Big5 双字节同时是合法的 GBK / EUC-JP 序列，无法判断")
    add("tw-big5-kanji4b", "zh-TW", "cp950", "kanji-only", C.KANJI_ZH_TW[0][:5], ambiguous=True, note="5 个汉字，同上")
    add("tw-big5-paragraph", "zh-TW", "cp950", "paragraph", paragraph(TW, rng, 220), note="约 200 字")
    # 修复：旧版 TWR 里没有真正的 Big5 二级字。为让其他样本的内容保持不变，先在主 rng 上「重放」旧版的随机数消耗（结果丢弃），
    # 这两个样本改用独立的 rng 与新的二级字语料。
    body_8kb(TW_ALL, rng, "cp950")
    rng_l2 = random.Random(20261121)
    add("tw-big5-8kb", "zh-TW", "cp950", "8kb", body_8kb(TW + TWR, rng_l2, "cp950"), note="约 8KB，含 Big5 二级字（鑫 堙 謾 龕 叡 氘 …）")
    add("tw-big5-log", "zh-TW", "cp950", "log", log_text(rng, C.LOG_ZH_TW, nl="\r\n"), note="400 行 ASCII 日志夹繁体中文，CRLF")
    add("tw-big5-csv", "zh-TW", "cp950", "csv", csv_text(rng, C.CSV_ZH_TW, nl="\r\n"), note="CSV")
    sentences(C.ZH_TW_RARE_LEGACY, rng, 10)  # 重放旧版 level2 样本的随机数消耗（结果丢弃）
    add("tw-big5-level2", "zh-TW", "cp950", "big5-level2", "\n".join(sentences(TWR, rng_l2, 10)) + "\n", note="Big5 二级字（首字节 0xC9-0xF9：鑫 堙 謾 龕 叡 氘 僳 鄯 糴 貘）")
    add("tw-big5-strict-paragraph", "zh-TW", "big5", "paragraph", paragraph(TW, rng, 220), note="Python 严格 big5 编码（不含 cp950 扩展）")
    add("tw-big5-strict-8kb", "zh-TW", "big5", "8kb", body_8kb(TW, rng, "big5"), note="严格 big5，约 8KB")
    add("tw-utf8-short", "zh-TW", "utf-8", "short", "請確認後再送出。", note="单行短文本")
    add("tw-utf8-paragraph", "zh-TW", "utf-8", "paragraph", paragraph(TW, rng, 220), note="约 200 字")
    add("tw-utf8-8kb", "zh-TW", "utf-8", "8kb", body_8kb(TW_ALL, rng, "utf-8"), note="约 8KB")
    add("tw-utf8-log", "zh-TW", "utf-8", "log", log_text(rng, C.LOG_ZH_TW), note="日志夹繁体中文")
    add("tw-utf16le-bom-paragraph", "zh-TW", "utf-16-le", "bom", paragraph(TW, rng, 220), bom=True, note="UTF-16LE + BOM")

    # ============================================================ 英文
    EN, EN1252 = C.EN, C.EN_1252
    add("en-ascii-short", "en", "ascii", "short", "Backup completed successfully.", note="纯 ASCII 单行")
    add("en-ascii-paragraph", "en", "ascii", "paragraph", paragraph(EN, rng, 400, sep=" "), note="纯 ASCII 段落")
    add("en-ascii-8kb", "en", "ascii", "8kb", body_8kb(EN, rng, "ascii", sep=" "), note="纯 ASCII，约 8KB")
    add("en-ascii-log", "en", "ascii", "log", log_text(rng, EN, nl="\r\n"), note="纯 ASCII 日志")
    add("en-ascii-csv", "en", "ascii", "csv", csv_text(rng, {**C.CSV_EN, "names": ["Jose Alvarez", "Anna Mueller", "Chloe Dubois", "Soren Jensen", "Zoe Clark"], "notes": ["ok", "to confirm", "approved"], "depts": ["Sales", "Finance", "Operations"]}),
        note="纯 ASCII CSV")
    add("en-1252-short", "en", "cp1252", "short", "The café’s POS crashed — £{0} lost.".format(rng.randint(100, 999)), note="单行：é 弯引号 — £")
    add("en-1252-short2", "en", "cp1252", "short", "Zoë, please call Müller.", note="极短：只含一个 ë 和一个 ü（0xEB、0xFC）")
    add("en-1252-paragraph", "en", "cp1252", "paragraph", paragraph(EN1252, rng, 300, sep=" "), note="英文段落，含 é ü £ 弯引号 —")
    add("en-1252-8kb", "en", "cp1252", "8kb", body_8kb(EN + EN1252, rng, "cp1252", sep=" "), note="约 8KB，大部分是 ASCII，偶尔有 Windows-1252 符号")
    add("en-1252-log", "en", "cp1252", "log", log_text(rng, C.LOG_EN_1252, nl="\r\n"), note="日志：每 30-50 行夹一条含 é “ ” £ 的消息")
    add("en-1252-log-sparse", "en", "cp1252", "log-sparse", log_sparse(rng, "customer M\xfcller paid \xa3120 — approved"), note="整份日志只有 1 行含 ü £ —")
    add("en-1252-csv", "en", "cp1252", "csv", csv_text(rng, C.CSV_EN, nl="\r\n", money_prefix="£"), note="CSV：逗号 + 带重音的姓名 + £")
    add("en-utf8-short", "en", "utf-8", "short", "The café’s POS crashed — £{0} lost.".format(rng.randint(100, 999)), note="UTF-8 的同一类符号：é ’ — £")
    add("en-utf8-paragraph", "en", "utf-8", "paragraph", paragraph(EN1252, rng, 300, sep=" "), note="UTF-8 段落，含重音与弯引号")
    add("en-utf8-8kb", "en", "utf-8", "8kb", body_8kb(EN + EN1252, rng, "utf-8", sep=" "), note="约 8KB")
    add("en-utf8-log", "en", "utf-8", "log", log_text(rng, C.LOG_EN_1252), note="日志夹 UTF-8 的重音字符")
    add("en-utf8-csv", "en", "utf-8", "csv", csv_text(rng, C.CSV_EN, money_prefix="£"), note="CSV")
    add("en-utf8bom-log", "en", "utf-8-sig", "bom-log", log_text(rng, EN, lines=400), bom=True, note="纯 ASCII 内容 + UTF-8 BOM（PowerShell 5 的 Out-File 常见）")
    add("en-utf16le-bom-log", "en", "utf-16-le", "bom-log", log_text(rng, EN, lines=400, nl="\r\n"), bom=True, note="UTF-16LE + BOM 的英文日志（Windows 命令输出重定向常见）")
    add("en-utf16le-nobom-log", "en", "utf-16-le", "no-bom-log", log_text(rng, EN, lines=400, nl="\r\n"), note="无 BOM 的 UTF-16LE，几乎全是 ASCII 的英文（每个字符后一个 NUL）")
    add("en-utf16be-nobom-log", "en", "utf-16-be", "no-bom-log", log_text(rng, EN, lines=400), note="无 BOM 的 UTF-16BE 英文")
    add("en-utf16le-nobom-short", "en", "utf-16-le", "short", "Backup completed successfully.", note="无 BOM 的 UTF-16LE 极短英文")

    # ============================================================ 混合
    mix_pool = C.LOG_JA + C.LOG_ZH_CN + C.LOG_ZH_TW + C.LOG_EN_1252
    add("mixed-utf8-log", "mixed", "utf-8", "log", log_text(rng, mix_pool, every=(10, 25)), note="多语言日志：日 / 简 / 繁 / 英混合，UTF-8")
    add("mixed-utf8-paragraph", "mixed", "utf-8", "paragraph",
        "\n".join([paragraph(C.JA, rng, 80), paragraph(C.ZH_CN, rng, 80), paragraph(C.ZH_TW, rng, 80), paragraph(C.EN, rng, 80, sep=" ")]) + "\n",
        note="一份文件里日 / 简 / 繁 / 英各一段")
    add("mixed-utf16le-bom-log", "mixed", "utf-16-le", "bom-log", log_text(rng, mix_pool, lines=400, every=(8, 20), nl="\r\n"), bom=True, note="多语言 UTF-16LE + BOM 日志")

    (HERE / "manifest.json").write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    subprocess.run(["node", str(HERE / "compute-acceptable.mjs")], check=True)
    finish()


def finish():
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    problems = []
    valid = json.loads(subprocess.run(["node", str(HERE / "compute-acceptable.mjs"), "--validity"], check=True, capture_output=True, encoding="utf-8").stdout)
    for e in manifest:
        if e["label"] not in e["acceptable"]:
            problems.append(f"label 不在 acceptable 中: {e['file']} {e['label']} {e['acceptable']}")
        cjk = [l for l in valid[e["file"]] if l in CJK_LABELS]
        data = (SAMPLES / e["file"]).read_bytes()
        if e.get("ambiguous") and len(cjk) < 2:
            problems.append(f"标为 ambiguous 但 CJK 候选少于 2: {e['file']} {valid[e['file']]}")
    for e in manifest:
        if "pure-cjk" in e["shape"] and any(b < 0x80 for b in (EXPECTED / e["file"]).read_bytes()):
            problems.append(f"pure-cjk 样本含 ASCII: {e['file']}")
    total = sum(p.stat().st_size for p in SAMPLES.iterdir()) + sum(p.stat().st_size for p in EXPECTED.iterdir())
    print(f"样本 {len(manifest)} 个，samples+expected 共 {total / 1024:.0f} KB")
    if problems:
        print("\n".join(problems))
        sys.exit(1)
    write_readme(manifest)


def write_readme(manifest):
    rows = []
    for e in manifest:
        amb = "是" if e.get("ambiguous") else ""
        rows.append(f"| `{e['file']}` | {e['lang']} | {e['label']} | {e['shape']} | {', '.join(e['acceptable'])} | {amb} | {notes[e['file']]} |")
    text = README_HEAD + "\n".join(rows) + "\n" + README_TAIL
    (HERE / "README.md").write_text(text, encoding="utf-8")


README_HEAD = """# 编码测试样本集

供 `@pch/text-engine` 的编码判断做验收。样本由独立脚本 `gen.py` 用 Python codecs 生成，**不含也不参考任何编码判断实现**，
目的是避免「出题人与答题人是同一个」的偏差。语料在 `corpus.py`：日 / 简 / 繁 / 英各至少 30 句（运维 / 业务 / 日志场景），句子带数字占位符、不逐字重复。

## 重新生成

```bash
cd packages/text-engine/fixtures
PYTHONIOENCODING=utf-8 python gen.py
```

需要 Python 3 与 Node（用于调用 `compute-acceptable.mjs`）。随机数种子固定，重复运行产物一致。生成会：

1. 写 `samples/*`（各编码的字节）与 `expected/*`（原文，UTF-8）；
2. 写 `manifest.json`；
3. 用 Node 的 `TextDecoder` 对每个样本按 9 个标签解码，与原文完全一致的标签写入 `acceptable`（**脚本计算，不手填**）；
4. 自检：`label` 必须在 `acceptable` 中；`ambiguous` 样本的字节必须能被至少 2 个 CJK 标签合法解码（fatal 模式不报错）；无 BOM 纯中日文 UTF-16 样本不得含 ASCII；
5. 重写本 README 的样本表。

## manifest 字段

- `file`：`samples/` 下的文件名；原文在 `expected/` 的同名文件（UTF-8）。
- `label`：真实编码（WHATWG 标签）。Python 的 `cp932` / `shift_jis` 都标 `shift_jis`；`gbk` / `gb18030` 标 `gb18030`；`cp950` / `big5` 标 `big5`；纯 ASCII 样本标 `utf-8`。
- `acceptable`：解码结果与原文完全一致的所有标签。判断结果只要落在其中即算对；`label` 以外的标签（如纯 ASCII 的 `windows-1252`）也算对。
- `lang`：`ja` / `zh-CN` / `zh-TW` / `en` / `mixed`。
- `shape`：形态（short、kanji-only、paragraph、8kb、log、log-sparse、csv、halfwidth-kana*、no-bom-*、bom* 等）。
- `ambiguous`：人也无法从字节判断的样本，只要求判断结果 `confidence: 'guess'`，不要求命中。

## 为什么有些样本是 ambiguous

只有 4-6 个汉字、没有假名也没有 ASCII 的极短文本（`*-kanji4*`、`*-kanji6*`），其字节是双字节序列，首字节落在 0xA1-0xFE（或 0x81-0xFE），
尾字节落在 0xA1-0xFE。这些范围在 GBK / Big5 / EUC-JP（部分在 Shift_JIS）下都是合法字符，只是显示成不同的汉字，**文本是否「说得通」只有懂语言的人才能看出来**。
`acceptable` 在这些样本里只有真实编码（其他编码解出的是另一串汉字），但没有字节层面的证据能排除其他标签；生成时自检保证这些字节能被至少 2 个 CJK 标签合法解码。因此只要求 `confidence: 'guess'`，不要求命中。

## 刻意设置的难点

- **半角片假名**（`*-hw-*`）：模拟旧系统日志，纯半角行混在 ASCII 行中、以及半角与全角混排；Shift_JIS 单字节 0xA1-0xDF 易被当作 GBK / Big5 的首字节。EUC-JP 下是 0x8E + 0xA1-0xDF。
- **cp932 扩展**（`ja-sjis-ext`）：① ㈱ 髙 № 等，严格 Shift_JIS 与 EUC-JP 无法表示。
- **JIS 第二水准、GB18030 四字节、Big5 二级字**：常用字区打分不容易覆盖的字符。
- **日志型**（`*-log`、`*-log-sparse`）：几乎全 ASCII，每 30-50 行才夹一条中日文，甚至整份只有 1 行非 ASCII。
- **CSV**：逗号 + 纯汉字单元格，每个单元格都很短。
- **无 BOM 的 UTF-16**：含 ASCII（大量 NUL）与纯中日文（没有 NUL）两类。
- **BOM**：UTF-8 / UTF-16LE / BE，包括「纯 ASCII 内容 + UTF-8 BOM」。
- **Windows-1252**：英文中偶尔出现 é ü £ 弯引号 —，包括整份日志只有 1 行。
- **ISO-2022-JP**：全部为 7 位字节，含 ESC 序列。
- 同样的内容用不同编码各出一份（日 / 简 / 繁 / 英 × 旧编码 / UTF-8），便于对比。

## 样本表

| 文件 | 语言 | 编码 | 形态 | acceptable | ambiguous | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
"""

README_TAIL = """
## 注意

- 日文语料不使用 〜（U+301C）、－、―、∥ 等 Python 与 WHATWG 映射不同的字符，所以 `shift_jis` / `euc-jp` 样本都能与 `TextDecoder` 往返一致。
- `ja-sjis-*` 实际是 cp932（Windows-31J）：WHATWG 的 `shift_jis` 标签就是 cp932。
- 读取样本用 `src/fixtures.test-helper.ts` 的 `loadFixtures()`（只在测试里使用）。
"""

main()
