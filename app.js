const COLLECTIONS = {
  men: {
    label: "男子",
    filter: (record) => record.race_type === "Men",
  },
  womenAll: {
    label: "女子全部",
    filter: (record) => record.category === "Women",
  },
  womenMixed: {
    label: "女子 Mixed / standard",
    filter: (record) =>
      record.category === "Women" && ["Mixed", "Standard"].includes(record.race_type),
  },
  womenOnly: {
    label: "女子 Women-only",
    filter: (record) => record.race_type === "Women only",
  },
};

const ERAS = {
  full: { label: "全部歷史", start: null },
  1970: { label: "1970 至今", start: 1970 },
  1980: { label: "1980 至今", start: 1980 },
  1998: { label: "1998 至今", start: 1998 },
  2010: { label: "2010 至今", start: 2010 },
};

const FORECAST_YEARS = [2030, 2035, 2040];

const state = {
  collection: "men",
  era: "1980",
  payload: null,
  chart: null,
};

const elements = {
  sourceNote: document.querySelector("#source-note"),
  collectionButtons: document.querySelector("#collection-buttons"),
  eraSelect: document.querySelector("#era-select"),
  latestRecord: document.querySelector("#latest-record"),
  latestDetail: document.querySelector("#latest-detail"),
  r2Value: document.querySelector("#r2-value"),
  r2Detail: document.querySelector("#r2-detail"),
  slopeValue: document.querySelector("#slope-value"),
  sampleCount: document.querySelector("#sample-count"),
  sampleDetail: document.querySelector("#sample-detail"),
  insightCopy: document.querySelector("#insight-copy"),
  forecastBody: document.querySelector("#forecast-body"),
  recordsBody: document.querySelector("#records-body"),
  tableCaption: document.querySelector("#table-caption"),
  chartCanvas: document.querySelector("#record-chart"),
};

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(totalSeconds, options = {}) {
  const includeTenths = options.includeTenths ?? false;
  const sign = totalSeconds < 0 ? "-" : "";
  const absSeconds = Math.abs(totalSeconds);
  const hours = Math.floor(absSeconds / 3600);
  const minutes = Math.floor((absSeconds % 3600) / 60);
  const seconds = absSeconds - hours * 3600 - minutes * 60;
  const secondText = includeTenths
    ? seconds.toFixed(1).padStart(4, "0")
    : Math.round(seconds).toString().padStart(2, "0");

  if (hours > 0) {
    return `${sign}${hours}:${minutes.toString().padStart(2, "0")}:${secondText}`;
  }
  return `${sign}${minutes}:${secondText}`;
}

function formatDelta(deltaSeconds) {
  if (Math.abs(deltaSeconds) < 0.5) return "持平";
  const label = deltaSeconds < 0 ? "快" : "慢";
  return `${label} ${formatTime(Math.abs(deltaSeconds))}`;
}

function linearRegression(records) {
  if (records.length < 3) return null;

  const xs = records.map((record) => record.decimal_year);
  const ys = records.map((record) => record.seconds);
  const xMean = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const yMean = ys.reduce((sum, y) => sum + y, 0) / ys.length;
  const numerator = xs.reduce((sum, x, index) => sum + (x - xMean) * (ys[index] - yMean), 0);
  const denominator = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  const slope = numerator / denominator;
  const intercept = yMean - slope * xMean;
  const total = ys.reduce((sum, y) => sum + (y - yMean) ** 2, 0);
  const residual = ys.reduce((sum, y, index) => {
    const predicted = intercept + slope * xs[index];
    return sum + (y - predicted) ** 2;
  }, 0);
  const r2 = total === 0 ? 1 : 1 - residual / total;

  return {
    slope,
    intercept,
    r2,
    predict: (year) => intercept + slope * year,
  };
}

function relationLabel(r2) {
  if (r2 >= 0.85) return "強";
  if (r2 >= 0.6) return "中等";
  return "弱";
}

function statusClass(status) {
  const normalized = status.toLowerCase();
  if (normalized.includes("pending")) return "pending";
  if (normalized.includes("disputed")) return "disputed";
  return "progression";
}

function statusLabel(record) {
  const type = record.race_type === "Men" ? "Men" : record.race_type;
  return `
    <span class="tag">${escapeHTML(type)}</span>
    <span class="tag ${statusClass(record.status)}">${escapeHTML(record.status)}</span>
  `;
}

function selectedRecords() {
  const collection = COLLECTIONS[state.collection];
  return state.payload.records
    .filter(collection.filter)
    .slice()
    .sort((a, b) => a.decimal_year - b.decimal_year);
}

function selectedModelRecords(records) {
  const era = ERAS[state.era];
  return records.filter((record) => era.start === null || record.decimal_year >= era.start);
}

function renderSummary(records, modelRecords, model) {
  const latest = records[records.length - 1];
  const collectionLabel = COLLECTIONS[state.collection].label;
  const eraLabel = ERAS[state.era].label;

  elements.latestRecord.textContent = latest ? latest.time : "--";
  elements.latestDetail.textContent = latest
    ? `${latest.athlete} · ${latest.date} · ${latest.event}`
    : "沒有資料";

  elements.sampleCount.textContent = `${modelRecords.length} / ${records.length}`;
  elements.sampleDetail.textContent = `${collectionLabel}，${eraLabel}`;

  if (!model) {
    elements.r2Value.textContent = "--";
    elements.r2Detail.textContent = "樣本不足，至少需要 3 筆紀錄。";
    elements.slopeValue.textContent = "--";
    elements.insightCopy.textContent = "目前分類與期間的資料點不足，無法建立可靠線性回歸。";
    return;
  }

  const strength = relationLabel(model.r2);
  const improvement = Math.abs(model.slope);
  elements.r2Value.textContent = model.r2.toFixed(3);
  elements.r2Detail.textContent = `${eraLabel}：${strength}線性關係`;
  elements.slopeValue.textContent = `${improvement.toFixed(1)} 秒 / 年`;
  elements.insightCopy.textContent =
    `${collectionLabel}在「${eraLabel}」的線性關係為${strength}（R² = ${model.r2.toFixed(3)}）。` +
    `模型斜率為每年 ${model.slope.toFixed(1)} 秒，代表歷史趨勢平均每年約變快 ${improvement.toFixed(1)} 秒。` +
    "世界紀錄是階梯式刷新，預測值應視為趨勢參考，不是保證會達成的成績。";
}

function renderForecast(records, model) {
  const latest = records[records.length - 1];
  if (!model || !latest) {
    elements.forecastBody.innerHTML = `
      <tr>
        <td colspan="3">樣本不足，無法預測。</td>
      </tr>
    `;
    return;
  }

  elements.forecastBody.innerHTML = FORECAST_YEARS.map((year) => {
    const prediction = model.predict(year);
    return `
      <tr>
        <td class="mono">${year}</td>
        <td class="mono">${escapeHTML(formatTime(prediction))}</td>
        <td>${escapeHTML(formatDelta(prediction - latest.seconds))}</td>
      </tr>
    `;
  }).join("");
}

function renderTable(records) {
  elements.tableCaption.textContent =
    `${COLLECTIONS[state.collection].label}，共 ${records.length} 筆；表格依日期由早到晚排列。`;
  elements.recordsBody.innerHTML = records
    .map(
      (record) => `
        <tr>
          <td class="mono">${escapeHTML(record.date)}</td>
          <td class="mono">${escapeHTML(record.time)}</td>
          <td>${escapeHTML(record.athlete)}</td>
          <td>${escapeHTML(record.nationality)}</td>
          <td>${escapeHTML(record.event)}</td>
          <td>${statusLabel(record)}</td>
          <td>${record.notes ? escapeHTML(record.notes) : "—"}</td>
        </tr>
      `,
    )
    .join("");
}

function renderChart(records, modelRecords, model) {
  const actualData = records.map((record) => ({
    x: record.decimal_year,
    y: record.seconds,
    record,
  }));

  const fitData = model
    ? [
        { x: modelRecords[0].decimal_year, y: model.predict(modelRecords[0].decimal_year) },
        {
          x: modelRecords[modelRecords.length - 1].decimal_year,
          y: model.predict(modelRecords[modelRecords.length - 1].decimal_year),
        },
      ]
    : [];

  const latest = records[records.length - 1];
  const forecastData =
    model && latest
      ? [
          { x: latest.decimal_year, y: model.predict(latest.decimal_year) },
          ...FORECAST_YEARS.map((year) => ({ x: year, y: model.predict(year) })),
        ]
      : [];

  const allY = [...actualData, ...fitData, ...forecastData].map((point) => point.y);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const yPadding = Math.max(60, (maxY - minY) * 0.08);

  const minX = Math.floor(records[0].decimal_year / 5) * 5;
  const maxX = Math.max(2040, Math.ceil(records[records.length - 1].decimal_year));

  if (state.chart) {
    state.chart.destroy();
  }

  state.chart = new Chart(elements.chartCanvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "實際紀錄",
          data: actualData,
          borderColor: "#2563eb",
          backgroundColor: "#2563eb",
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 7,
          tension: 0.18,
        },
        {
          label: "線性回歸",
          data: fitData,
          borderColor: "#047857",
          backgroundColor: "#047857",
          borderWidth: 2,
          pointRadius: 0,
        },
        {
          label: "預測",
          data: forecastData,
          borderColor: "#b45309",
          backgroundColor: "#b45309",
          borderWidth: 2,
          borderDash: [8, 6],
          pointRadius: 3,
        },
      ],
    },
    options: {
      animation: matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 220 },
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      interaction: {
        intersect: false,
        mode: "nearest",
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            title(items) {
              const raw = items[0]?.raw;
              if (raw?.record) return `${raw.record.date} · ${raw.record.athlete}`;
              return `${Number(items[0].parsed.x).toFixed(1)} 年`;
            },
            label(item) {
              const record = item.raw?.record;
              if (record) return `${record.time} · ${record.event}`;
              return `${item.dataset.label}: ${formatTime(item.parsed.y)}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          min: minX,
          max: maxX,
          title: {
            display: true,
            text: "年份",
          },
          grid: {
            color: "#e7edf5",
          },
          ticks: {
            callback: (value) => Math.round(value).toString(),
          },
        },
        y: {
          min: minY - yPadding,
          max: maxY + yPadding,
          title: {
            display: true,
            text: "完賽時間",
          },
          grid: {
            color: "#e7edf5",
          },
          ticks: {
            callback: (value) => formatTime(value),
          },
        },
      },
    },
  });
}

function updateActiveButtons() {
  elements.collectionButtons.querySelectorAll("button").forEach((button) => {
    const active = button.dataset.collection === state.collection;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function render() {
  const records = selectedRecords();
  const modelRecords = selectedModelRecords(records);
  const model = linearRegression(modelRecords);

  updateActiveButtons();
  renderSummary(records, modelRecords, model);
  renderForecast(records, model);
  renderTable(records);
  renderChart(records, modelRecords, model);

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

async function boot() {
  const response = await fetch("data/records.json");
  if (!response.ok) throw new Error(`Unable to load records: ${response.status}`);
  state.payload = await response.json();

  elements.sourceNote.textContent =
    `資料更新日 ${state.payload.generated_at}，共 ${state.payload.records.length} 筆紀錄。` +
    "2026-04-26 London 新紀錄依 World Athletics 報導標示為 pending ratification。";

  elements.collectionButtons.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-collection]");
    if (!button) return;
    state.collection = button.dataset.collection;
    render();
  });

  elements.eraSelect.addEventListener("change", (event) => {
    state.era = event.target.value;
    render();
  });

  render();
}

boot().catch((error) => {
  console.error(error);
  elements.sourceNote.textContent = "資料載入失敗，請確認 data/records.json 是否存在。";
  elements.insightCopy.textContent = error.message;
});
