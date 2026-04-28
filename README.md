# Marathon World Record Lab

馬拉松世界紀錄進展資料視覺化，包含：

- 每次世界紀錄刷新時間、日期、選手、國籍與賽事地點
- 男子、女子全部、女子 mixed / standard、女子 women-only 分類切換
- 線性回歸、R² 判讀、年度平均改善秒數
- 2030、2035、2040 成績預測

## Local Preview

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`.

## Refresh Dataset

```bash
python3 scripts/fetch_records.py
```

The generated dataset is written to `data/records.json`.

## Sources

- Wikipedia: Marathon world record progression
- World Athletics: Sawe 1:59:30 / Assefa 2:15:41 London report
- World Athletics: Chepngetich 2:09:56 ratification
- World Athletics: Kiptum 2:00:35 ratification

The 2026 London marks are shown as pending ratification when the source notes that status.
