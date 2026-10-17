# Legal Review Viewer

Turns the flat legal-review spreadsheets produced by the review skill into a readable web page.

```bash
pip install -r requirements.txt
python app.py            # http://localhost:5050
```

Drop a `.xlsx` (or `.csv` with the same layout) onto the page. Uploaded reports are kept in `reports/`.

- `report_parser.py` – parses the sheet into JSON (`python report_parser.py file.xlsx` to inspect).
  Header rows are `Label | Value`; each UPPERCASE single-cell row starts a section; a section is
  either key/value rows or a table whose first row is the header.
- `app.py` – Flask API: `GET/POST /api/reports`, `GET/DELETE /api/reports/<file>`.
- `static/` – the front end. Known sections (Parameters, Risks, Conditions, Deadlines, Commercial,
  Line items, Cross-checks, Documents reviewed) get dedicated views; any new section the skill
  adds is shown as a plain table, so the viewer won't break if the format grows.
