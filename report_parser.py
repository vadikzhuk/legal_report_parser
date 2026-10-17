"""Parse the flat legal-review spreadsheet produced by the review skill into structured JSON.

Layout of the source sheet:
  * a header block of "Label | Value" rows (separated into groups by blank rows);
  * sections, each introduced by a row holding a single UPPERCASE label in column A;
  * a section is either key/value rows ("Label | Value") or a table whose first row is the header.
"""
import csv
import datetime as dt
from pathlib import Path

import openpyxl

# Sections that are always key/value even though they look like 2-column tables.
KV_SECTIONS = {"COMMERCIAL"}


def _clean(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (dt.datetime, dt.date)):
        return value.strftime("%d.%m.%Y")
    return str(value).strip()


def _read_rows(path: Path):
    if path.suffix.lower() == ".csv":
        with path.open(newline="", encoding="utf-8-sig") as fh:
            rows = [[_clean(c) for c in row] for row in csv.reader(fh)]
    else:
        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
        ws = wb.worksheets[0]
        rows = [[_clean(c) for c in row] for row in ws.iter_rows(values_only=True)]
        wb.close()
    # Trim trailing empty cells so len(row) == number of meaningful columns.
    out = []
    for row in rows:
        while row and row[-1] == "":
            row.pop()
        out.append(row)
    return out


def _is_section_heading(row):
    return len(row) == 1 and row[0] and row[0].upper() == row[0] and any(ch.isalpha() for ch in row[0])


def _slug(name):
    return "".join(ch.lower() if ch.isalnum() else "_" for ch in name).strip("_")


def _parse_section(name, rows):
    rows = [r for r in rows if any(r)]
    if not rows:
        return {"name": name, "key": _slug(name), "kind": "kv", "items": []}
    is_table = name not in KV_SECTIONS and (len(rows[0]) > 2 or len(rows) == 1)
    if not is_table:
        items = [{"label": r[0], "value": " ".join(c for c in r[1:] if c)} for r in rows]
        return {"name": name, "key": _slug(name), "kind": "kv", "items": items}
    header = rows[0]
    width = max(len(header), *(len(r) for r in rows))
    header = header + [f"Column {i + 1}" for i in range(len(header), width)]
    records = [dict(zip(header, r + [""] * (width - len(r)))) for r in rows[1:]]
    return {"name": name, "key": _slug(name), "kind": "table", "columns": header, "rows": records}


def parse_report(path):
    path = Path(path)
    rows = _read_rows(path)

    header_groups, current = [], []
    sections, section_name, section_rows = [], None, []

    for row in rows:
        if _is_section_heading(row) and row[0] != "LEGAL REVIEW":
            if section_name:
                sections.append(_parse_section(section_name, section_rows))
            section_name, section_rows = row[0], []
            continue
        if section_name:
            section_rows.append(row)
            continue
        # Header block
        if not any(row):
            if current:
                header_groups.append(current)
                current = []
            continue
        current.append({"label": row[0], "value": " ".join(c for c in row[1:] if c)})
    if current:
        header_groups.append(current)
    if section_name:
        sections.append(_parse_section(section_name, section_rows))

    header = {item["label"]: item["value"] for group in header_groups for item in group}
    title = header.pop("LEGAL REVIEW", "") or path.stem
    return {
        "title": title,
        "source_file": path.name,
        "header": header,
        "header_groups": [[i for i in g if i["label"] != "LEGAL REVIEW"] for g in header_groups],
        "sections": sections,
    }


if __name__ == "__main__":
    import json
    import sys

    print(json.dumps(parse_report(sys.argv[1]), indent=2, ensure_ascii=False))
