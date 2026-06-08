import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarClock,
  CircleDollarSign,
  Info,
  RefreshCw,
  SunMedium,
  WalletCards,
  X,
} from "lucide-react";
import { loadDashboardData, loadPlantDateRange } from "./data/supabase";
import { FORECAST_LATITUDE, FORECAST_LONGITUDE } from "./config";
import type { DataState, LoadedData, MonthRow, PlantComparison } from "./domain/types";
import "./styles.css";

type RangeKey = "all" | "1m" | "3m" | "6m" | "12m";
type ViewMode = "monthly" | "daily" | "comparison";
type Currency = "UAH" | "USD";
type Lang = "en" | "uk";
type InfoModal =
  | "latestRoi"
  | "netPayment"
  | "totalExport"
  | "totalImport"
  | "usdRate"
  | "importPrice"
  | "roi"
  | "forecast"
  | "investment"
  | {
    readonly kind: "importSplit" | "consumedSplit" | "exportPrice" | "netPayment";
    readonly row: MonthRow;
  };

interface DashboardDataState extends DataState {
  readonly isRefreshing: boolean;
  readonly refresh: () => void;
}

type DashboardDataHookState = Omit<DashboardDataState, "refresh">;

const i18n = {
  en: {
    all: "All",
    monthly: "Monthly",
    daily: "Daily",
    comparison: "Comparison",
    total: "Total",
    compareDays: "Compare days",
    firstDay: "First day",
    secondDay: "Second day",
    close: "Close",
    delta: "Delta",
    noDailyData: "No daily data yet",
    updated: "Updated",
    overview: "Overview",
    energy: "Energy",
    finance: "Finance",
    data: "Data",
    forecast: "Forecast",
    expectedProduction: "Expected production",
    expectedRoi: "Expected ROI",
    expectedIncome: "Expected income",
    soFar: "so far",
    forecastInfo: "Forecast values are projected from the current month daylight pace: value so far divided by elapsed daylight this month, then multiplied by total expected daylight for the month. The colored comparison shows the projected value against the previous month's actual value.",
    plantComparison: "Plant comparison",
    activePlant: "current",
    compare: "Compare",
    compareFirstPlant: "First plant",
    compareSecondPlant: "Second plant",
    compareDate: "Date",
    comparisonHint: "Select two plants and two dates to compare daily performance.",
    latestRoi: "Latest ROI",
    latestRoiInfo: "ROI shows how much investment was effectively recovered during the latest month. It includes the value of electricity consumed from your own solar production plus any export income, minus grid electricity costs. Net payment is only the cash balance for the month: export income minus grid electricity costs.",
    refresh: "Refresh",
    cumulative: "Cumulative",
    production: "Production",
    totalProduction: "Total production",
    exported: "exported",
    export: "Export",
    totalExport: "Total export",
    totalExportCostInfoDetails: "The payout is calculated from net exported surplus after the monthly import/export balance, using each month's export price after VAT and military tax.",
    latest: "Latest",
    gridImport: "Import",
    totalImport: "Total import",
    totalImportCostInfoDetails: "Day imports are calculated with each month's day import rate, night imports with each month's night import rate.",
    solarCoverage: "solar coverage",
    net: "Net",
    netPayment: "Net payment",
    electricityCostWithoutSolar: "Electricity cost without solar",
    formulaInputs: "Inputs",
    importPrices: "Import prices",
    exportPriceInput: "Export price",
    usdRate: "USD/UAH rate",
    dayCost: "Day cost",
    nightCost: "Night cost",
    exportedOffset: "Export offset",
    remainingImport: "Remaining import",
    netSurplus: "Net surplus",
    exportUnpaid: "Export is unpaid before the commercial date",
    netPaymentLogic: "Net payment is the cash result of monthly import/export balancing. Balance is import minus export. If export is larger than import, the balance is negative and the net surplus is paid using the export price after VAT and military tax. Otherwise, export offsets import proportionally between day and night import, then the remaining day/night import is charged at its own rate.",
    netPaymentInfo: "UAH totals are summed directly. In USD mode, each month is converted using that month's USD/UAH rate, then those converted values are summed. It is not the UAH total divided by the latest rate.",
    usdRateInfo: "Monthly USD/UAH is the average of the daily USD/UAH rates stored for that month. The dashboard uses this monthly average when converting monthly UAH values to USD.",
    importPriceInfo: "Import prices are shown as day / night. Day is the rate from 7 AM to 11 PM; night is the rate from 11 PM to 7 AM.",
    roiInfo: "ROI is not production multiplied by export price. It is the effective investment recovery for the period: the value of electricity consumed from the solar system plus export payout when commercial export is active, minus grid import costs. Before the commercial date, export is unpaid and does not offset import, so ROI is based only on inferred self-consumed solar energy: production minus export, valued by the weighted day/night import rate.",
    savings: "Savings",
    plantWorks: "Plant works",
    sinceLaunch: "since",
    investmentRecovered: "investment recovered",
    investmentInfo: "The USD value is the stored plant investment. In UAH mode, the dashboard converts that USD investment using the USD/UAH rate from the plant launch month, because that represents the original hryvnia cost basis.",
    payback: "Payback",
    recovered: "recovered",
    remaining: "remaining",
    currentAverage: "at the current daily average",
    addInvestment: "Add investment cost",
    investmentHelp: "Set the installed system cost to turn monthly ROI into a payback projection.",
    investment: "Investment",
    roiTrajectory: "ROI trajectory",
    importMix: "Import",
    consumptionMix: "Consumption",
    electricityPayment: "Electricity payment",
    payment: "Payment",
    table: "Data table",
    filterMonth: "Filter month",
    allMonths: "All months",
    allYears: "All years",
    month: "Month",
    import: "Import",
    consumed: "Consumed",
    balance: "Balance",
    roi: "ROI",
    exportPrice: "Export price",
    netExport: "Export",
    grossExportPrice: "Before taxes",
    netExportPrice: "After taxes",
    vat: "VAT",
    militaryTax: "Military tax",
    importDay: "Import/day",
    importNight: "Import/night",
    consumedDay: "Consumed/day",
    consumedNight: "Consumed/night",
    day: "Day",
    tableDay: "Day",
    night: "Night",
    sourceWarning: "Data fetch failed. Check Supabase access, plant id, and read policies.",
    currency: "Currency",
    tapBar: "Tap a bar to inspect the value",
    tapBarOrDot: "Tap a bar or dot to inspect the value",
  },
  uk: {
    all: "Усі",
    monthly: "Місяці",
    daily: "Дні",
    comparison: "Порівняння",
    total: "Разом",
    compareDays: "Порівняти дні",
    firstDay: "Перший день",
    secondDay: "Другий день",
    close: "Закрити",
    delta: "Різниця",
    noDailyData: "Денних даних ще немає",
    updated: "Оновлено",
    overview: "Огляд",
    energy: "Енергія",
    finance: "Фінанси",
    data: "Дані",
    forecast: "Прогноз",
    expectedProduction: "Очікувана генерація",
    expectedRoi: "Очікуване ПІ",
    expectedIncome: "Очікуваний дохід",
    soFar: "зараз",
    forecastInfo: "Прогноз рахується за поточним темпом світлового часу місяця: значення зараз ділиться на кількість світлового часу, що вже минув у цьому місяці, і множиться на очікуваний світловий час усього місяця. Кольорове порівняння показує прогнозоване значення відносно фактичного значення попереднього місяця.",
    plantComparison: "Порівняння станцій",
    activePlant: "поточна",
    compare: "Порівняти",
    compareFirstPlant: "Перша станція",
    compareSecondPlant: "Друга станція",
    compareDate: "Дата",
    comparisonHint: "Оберіть дві станції та дві дати для порівняння денних показників.",
    latestRoi: "Останнє ПІ",
    latestRoiInfo: "ПІ показує, скільки інвестиції фактично повернулось за останній місяць. Воно включає вартість електроенергії, спожитої з власної генерації, плюс дохід від експорту, мінус витрати на електроенергію з мережі. Баланс — це лише грошовий результат місяця: дохід від експорту мінус витрати на електроенергію з мережі.",
    refresh: "Оновити",
    cumulative: "Сумарно",
    production: "Генерація",
    totalProduction: "Загальна генерація",
    exported: "експортовано",
    export: "Експорт",
    totalExport: "Загальний експорт",
    totalExportCostInfoDetails: "Виплата рахується з чистого експортного надлишку після місячного балансу імпорту/експорту, за ціною експорту кожного місяця після ПДВ і військового збору.",
    latest: "Останнє",
    gridImport: "Імпорт",
    totalImport: "Загальний імпорт",
    totalImportCostInfoDetails: "Денний імпорт рахується за денним тарифом кожного місяця, нічний імпорт - за нічним тарифом.",
    solarCoverage: "покриття сонцем",
    net: "Баланс",
    netPayment: "Баланс оплати",
    electricityCostWithoutSolar: "Вартість електрики без сонця",
    formulaInputs: "Вхідні дані",
    importPrices: "Ціни імпорту",
    exportPriceInput: "Ціна експорту",
    usdRate: "Курс USD/UAH",
    dayCost: "Вартість дня",
    nightCost: "Вартість ночі",
    exportedOffset: "Покриття експортом",
    remainingImport: "Залишок імпорту",
    netSurplus: "Чистий надлишок",
    exportUnpaid: "До комерційної дати експорт не оплачується",
    netPaymentLogic: "Баланс оплати — це грошовий результат місячного балансу імпорту й експорту. Баланс рахується як імпорт мінус експорт. Якщо експорт більший за імпорт, баланс відʼємний і чистий надлишок оплачується за ціною експорту після ПДВ і військового збору. Інакше експорт пропорційно покриває денний і нічний імпорт, а залишок денного/нічного імпорту оплачується за відповідним тарифом.",
    netPaymentInfo: "Суми в гривнях додаються напряму. У режимі USD кожен місяць конвертується за його курсом, а потім конвертовані значення додаються. Це не сума в гривнях, поділена на останній курс.",
    usdRateInfo: "Місячний курс USD/UAH — це середнє значення денних курсів USD/UAH, збережених за цей місяць. Дашборд використовує це середнє для конвертації місячних значень у гривнях в USD.",
    importPriceInfo: "Ціни імпорту показані як день / ніч. День — тариф з 7:00 до 23:00; ніч — тариф з 23:00 до 7:00.",
    roiInfo: "ПІ — це не генерація, помножена на ціну експорту. Це фактичне повернення інвестицій за період: вартість електроенергії, спожитої з сонячної системи, плюс виплата за експорт після початку комерційного експорту, мінус витрати на імпорт з мережі. До комерційної дати експорт не оплачується і не перекриває імпорт, тому ПІ рахується лише з орієнтовно спожитої власної сонячної енергії: генерація мінус експорт, оцінені за зваженим денним/нічним тарифом імпорту.",
    savings: "Економія",
    plantWorks: "Станція працює",
    sinceLaunch: "з",
    investmentRecovered: "інвестиції повернуто",
    investmentInfo: "Значення в USD — це збережена вартість станції. У режимі UAH дашборд конвертує цю суму за курсом USD/UAH з місяця запуску станції, бо саме він відображає початкову вартість у гривні.",
    payback: "Окупність",
    recovered: "повернуто",
    remaining: "залишилось",
    currentAverage: "за поточного середнього денного темпу",
    addInvestment: "Додайте вартість станції",
    investmentHelp: "Вкажіть вартість системи, щоб бачити прогноз окупності.",
    investment: "Інвестиція",
    roiTrajectory: "Динаміка поверення інвестицій",
    importMix: "Імпорт",
    consumptionMix: "Споживання",
    electricityPayment: "Оплата електрики",
    payment: "Оплата",
    table: "Таблиця даних",
    filterMonth: "Фільтр місяця",
    allMonths: "Усі місяці",
    allYears: "Усі роки",
    month: "Місяць",
    import: "Імпорт",
    consumed: "Спожито",
    balance: "Баланс",
    roi: "ПІ",
    exportPrice: "Ціна експорту",
    netExport: "Експорт",
    grossExportPrice: "До податків",
    netExportPrice: "Після податків",
    vat: "ПДВ",
    militaryTax: "Військовий збір",
    importDay: "Імпорт/день",
    importNight: "Імпорт/ніч",
    consumedDay: "Спожито/день",
    consumedNight: "Спожито/ніч",
    day: "День",
    tableDay: "День",
    night: "Ніч",
    sourceWarning: "Не вдалось завантажити дані. Перевірте доступ до Supabase, id станції та політики читання.",
    currency: "Валюта",
    tapBar: "Торкніться стовпчика, щоб побачити значення",
    tapBarOrDot: "Торкніться стовпчика або точки, щоб побачити значення",
  },
} satisfies Record<Lang, Record<string, string>>;

const APP_LANG: Lang = langFromQuery() ?? "en"

const colors = {
  amber: "#e4a11b",
  gold: "#f5c451",
  green: "#18956f",
  mint: "#74c7a6",
  blue: "#3175c7",
  indigo: "#6266c9",
  rose: "#c95b5b",
  ink: "currentColor",
  grid: "#d9dee5",
};

function langFromQuery(): Lang | undefined {
  if (typeof window === "undefined") return 'en';
  const lang = new URLSearchParams(window.location.search).get("lang");
  return lang === "uk" || lang === "en" ? lang : undefined;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatNumber(value: number, maximumFractionDigits = 2, minimumFractionDigits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    minimumFractionDigits,
  }).format(value);
}

function formatKwh(value: number, lang: Lang = APP_LANG) {
  return `${formatNumber(value, 2, 2)} ${lang === "uk" ? "кВт·г" : "kWh"}`;
}

function energyUnit(lang: Lang) {
  return lang === "uk" ? "кВт·г" : "kWh";
}

function currencyUnit(currency: Currency) {
  return currency === "UAH" ? "₴" : "$";
}

function formatMoney(value: number, currency: Currency, lang: Lang, compact = false) {
  return new Intl.NumberFormat(lang === "uk" ? "uk-UA" : "en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 0 : 2,
  }).format(value);
}

function moneyFromUah(value: number, currency: Currency, usdRate: number) {
  if (currency === "UAH") return value;
  return usdRate ? value / usdRate : 0;
}

function moneyFromUsd(value: number, currency: Currency, usdRate: number) {
  if (currency === "USD") return value;
  return value * usdRate;
}

function rowRoiMoney(row: MonthRow, currency: Currency) {
  if (currency === "UAH") return row.electricitySavings;
  return row.roiUsd || moneyFromUah(row.electricitySavings, currency, row.usdRate);
}

function formatDisplayMoney(value: number, currency: Currency, lang: Lang, compact = false) {
  return formatMoney(value, currency, lang, compact);
}

function formatTableMoney(value: number, currency: Currency, lang: Lang, compact = false) {
  const parts = new Intl.NumberFormat(lang === "uk" ? "uk-UA" : "en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 0 : 2,
  }).formatToParts(value);

  return parts
    .filter((part) => part.type !== "currency")
    .map((part) => part.value)
    .join("")
    .trim();
}

function formatUahMoney(value: number, currency: Currency, lang: Lang, usdRate: number, compact = false) {
  return formatDisplayMoney(moneyFromUah(value, currency, usdRate), currency, lang, compact);
}

function formatUsdMoney(value: number, currency: Currency, lang: Lang, usdRate: number, compact = false) {
  return formatDisplayMoney(moneyFromUsd(value, currency, usdRate), currency, lang, compact);
}

function formatAxisValue(value: number, currency?: Currency) {
  const formatted = formatNumber(value, Math.abs(value) >= 100 ? 0 : 2);
  if (!currency) return formatted;
  return `${currency === "UAH" ? "₴" : "$"}${formatted}`;
}

function formatSignedKwh(value: number, lang: Lang) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatKwh(value, lang)}`;
}

function formatSignedMoney(value: number, currency: Currency, lang: Lang) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatDisplayMoney(value, currency, lang)}`;
}

function formatDeltaPct(delta: number, base: number) {
  if (!base) return "";
  const sign = delta > 0 ? "+" : "";
  return ` (${sign}${formatNumber((delta / Math.abs(base)) * 100)}%)`;
}

function deltaTone(value: number) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "muted";
}

function sumRowsFromUah(rows: readonly MonthRow[], selector: (row: MonthRow) => number, currency: Currency) {
  return rows.reduce((sum, row) => sum + moneyFromUah(selector(row), currency, row.usdRate), 0);
}

function importCostUah(row: MonthRow) {
  return row.importDay * row.importPriceDay + row.importNight * row.importPriceNight;
}

function taxFraction(value: number) {
  return value > 1 ? value / 100 : value;
}

function netExportRate(row: MonthRow) {
  return row.exportPrice * (1 - taxFraction(row.exportVat) - taxFraction(row.exportMilitary));
}

function exportPayoutKwh(row: MonthRow) {
  return Math.max(0, -row.balance);
}

function exportPayoutUah(row: MonthRow) {
  return exportPayoutKwh(row) * netExportRate(row);
}

function sumRowsRoiMoney(rows: readonly MonthRow[], currency: Currency) {
  return rows.reduce((sum, row) => sum + rowRoiMoney(row, currency), 0);
}

function withUsdRate(row: MonthRow, usdRate: number) {
  return {
    ...row,
    usdRate,
    roiUsd: usdRate ? row.electricitySavings / usdRate : 0,
  };
}

function sameMonth(first: Date, second: Date) {
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth();
}

function chartBand(innerWidth: number, count: number, maxBand = 72) {
  return Math.min(innerWidth / Math.max(count, 1), maxBand);
}

function pct(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return `${formatNumber(value)}%`;
}

function monthShort(month: string) {
  if (month.includes("-")) {
    const [, m, d] = month.split("-");
    return `${d}.${m}`;
  }
  const [m, y] = month.split(".");
  return `${m}.${y.slice(2)}`;
}

function formatDayLabel(date: Date, lang: Lang) {
  return new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDayMonthLabel(date: Date, lang: Lang) {
  return new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-US", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatDateTimeLabel(date: Date, lang: Lang) {
  return new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-US", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatMonthYear(date: Date, lang: Lang) {
  return new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-US", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatMonthOnly(date: Date, lang: Lang) {
  return new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-US", {
    month: "long",
  }).format(date);
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatPeriodLabel(row: MonthRow, lang: Lang = APP_LANG) {
  return row.month.includes("-") ? formatDayLabel(row.date, lang) : row.month;
}

function formatLaunchDate(date: Date, lang: Lang) {
  return new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDuration(months: number, lang: Lang) {
  if (months <= 0) return lang === "uk" ? "0 місяців" : "0 months";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (!years) return lang === "uk" ? `${months} міс.` : `${months} months`;
  const yearText = lang === "uk" ? `${years} р.` : `${years} ${years === 1 ? "year" : "years"}`;
  const monthText = rest ? (lang === "uk" ? `${rest} міс.` : `${rest} ${rest === 1 ? "month" : "months"}`) : "";
  return [yearText, monthText].filter(Boolean).join(" ");
}

function fullDurationBetween(start: Date, end: Date) {
  let months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
  if (end.getDate() < start.getDate()) months -= 1;
  months = Math.max(0, months);

  const monthAnchor = new Date(start);
  monthAnchor.setMonth(start.getMonth() + months);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const days = Math.max(0, Math.floor((startOfDay(end).getTime() - startOfDay(monthAnchor).getTime()) / millisecondsPerDay));
  return { months, days };
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(start: Date, end: Date) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((startOfDay(end).getTime() - startOfDay(start).getTime()) / millisecondsPerDay);
}

function addDays(date: Date, days: number) {
  const next = startOfDay(date);
  next.setDate(next.getDate() + days);
  return next;
}

function daysInMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function dayOfYear(date: Date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((startOfDay(date).getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

function daylightMinutes(date: Date, latitude = FORECAST_LATITUDE) {
  const latitudeRad = (latitude * Math.PI) / 180;
  const declination = 0.409 * Math.sin(((2 * Math.PI) / 365) * dayOfYear(date) - 1.39);
  const hourAngleValue = -Math.tan(latitudeRad) * Math.tan(declination);
  const hourAngle = Math.acos(Math.min(1, Math.max(-1, hourAngleValue)));
  return (24 * 60 * hourAngle) / Math.PI;
}

function daylightWindow(date: Date, latitude = FORECAST_LATITUDE, longitude = FORECAST_LONGITUDE) {
  const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const timezoneOffsetHours = -noon.getTimezoneOffset() / 60;
  const solarNoonHour = 12 + timezoneOffsetHours - longitude / 15;
  const daylightHours = daylightMinutes(date, latitude) / 60;
  return {
    start: new Date(date.getFullYear(), date.getMonth(), date.getDate(), solarNoonHour - daylightHours / 2),
    end: new Date(date.getFullYear(), date.getMonth(), date.getDate(), solarNoonHour + daylightHours / 2),
  };
}

function elapsedDaylightMinutes(date: Date, asOf: Date) {
  if (asOf < startOfDay(date)) return 0;
  const { start, end } = daylightWindow(date);
  if (asOf >= end) return daylightMinutes(date);
  if (asOf <= start) return 0;
  return Math.max(0, (asOf.getTime() - start.getTime()) / (60 * 1000));
}

function monthDaylightMinutes(date: Date) {
  return Array.from({ length: daysInMonth(date) }, (_, index) =>
    daylightMinutes(new Date(date.getFullYear(), date.getMonth(), index + 1)),
  ).reduce((sum, minutes) => sum + minutes, 0);
}

function elapsedMonthDaylightMinutes(date: Date, asOf: Date) {
  if (!sameMonth(date, asOf)) return monthDaylightMinutes(date);
  return Array.from({ length: asOf.getDate() }, (_, index) => {
    const currentDate = new Date(date.getFullYear(), date.getMonth(), index + 1);
    return index + 1 === asOf.getDate() ? elapsedDaylightMinutes(currentDate, asOf) : daylightMinutes(currentDate);
  }).reduce((sum, minutes) => sum + minutes, 0);
}

function forecastMonthValue(value: number, date: Date, asOf = new Date()) {
  const totalDaylight = monthDaylightMinutes(date);
  const elapsedDaylight = Math.max(60, elapsedMonthDaylightMinutes(date, asOf));
  return (value / elapsedDaylight) * totalDaylight;
}

function formatActiveDuration(duration: { months: number; days: number }, lang: Lang) {
  if (duration.months === 0) {
    return lang === "uk" ? `${duration.days} дн.` : `${duration.days} ${duration.days === 1 ? "day" : "days"}`;
  }
  const parts = [formatDuration(duration.months, lang)];
  if (duration.days > 0) {
    parts.push(lang === "uk" ? `${duration.days} дн.` : `${duration.days} ${duration.days === 1 ? "day" : "days"}`);
  }
  return parts.join(" ");
}

function netExportPrice(row: MonthRow) {
  return netExportRate(row);
}

function filteredMonthlyRows(
  sourceRows: readonly MonthRow[],
  range: RangeKey,
  monthFilter: string,
  yearFilter: string,
) {
  const rangeMonths: Record<Exclude<RangeKey, "all">, number> = {
    "1m": 1,
    "3m": 3,
    "6m": 6,
    "12m": 12,
  };
  const base = range === "all" ? sourceRows : sourceRows.slice(-rangeMonths[range]);
  return base.filter((row) => {
    const monthMatches = monthFilter === "all" || String(row.date.getMonth() + 1) === monthFilter;
    const yearMatches = yearFilter === "all" || String(row.date.getFullYear()) === yearFilter;
    return monthMatches && yearMatches;
  });
}

function firstDateKey(rows: readonly MonthRow[]) {
  return rows.length ? dateKey(rows[rows.length - 1].date) : "";
}

function useDashboardData(): DashboardDataState {
  const [state, setState] = useState<DashboardDataHookState>(() => ({
    rows: [],
    dailyRows: [],
    readablePlantIds: [],
    plantId: "",
    investmentUsd: 0,
    isLoading: true,
    isRefreshing: false,
    updatedAt: new Date(),
  }));

  const refresh = async () => {
    setState((current) => ({ ...current, isRefreshing: true }));
    try {
      const data: LoadedData = await loadDashboardData();
      const refreshedAt = new Date();
      setState({ ...data, isLoading: false, isRefreshing: false, updatedAt: refreshedAt });
    } catch (error) {
      setState((current) => ({
        ...current,
        isLoading: false,
        isRefreshing: false,
        updatedAt: new Date(),
        error: error instanceof Error ? error.message : "Could not load Supabase data",
      }));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return {
    ...state,
    refresh: () => {
      void refresh();
    },
  };
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => (typeof window === "undefined" ? false : window.matchMedia(query).matches));

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function App() {
  const dataState = useDashboardData();
  const [viewMode, setViewMode] = useState<ViewMode>("monthly");
  const [range, setRange] = useState<RangeKey>("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [currency, setCurrency] = useState<Currency>("UAH");
  const [firstDay, setFirstDay] = useState("");
  const [secondDay, setSecondDay] = useState("");
  const [isDailyCompareOpen, setDailyCompareOpen] = useState(false);
  const [firstPlantId, setFirstPlantId] = useState("");
  const [secondPlantId, setSecondPlantId] = useState("");
  const [plantComparisonDate, setPlantComparisonDate] = useState("");
  const [comparisonPlants, setComparisonPlants] = useState<readonly PlantComparison[]>([]);
  const [comparisonPlantCache, setComparisonPlantCache] = useState<Record<string, PlantComparison>>({});
  const [comparisonError, setComparisonError] = useState("");
  const [isPlantComparisonLoading, setPlantComparisonLoading] = useState(false);
  const [infoModal, setInfoModal] = useState<InfoModal | null>(null);
  const lang = APP_LANG;
  const t = i18n[lang];
  const monthNames = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) =>
        new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-US", { month: "short" }).format(new Date(2026, index, 1)),
      ),
    [lang],
  );
  const yearOptions = useMemo(
    () => [...new Set(dataState.rows.map((row) => String(row.date.getFullYear())))].sort((a, b) => Number(b) - Number(a)),
    [dataState.rows],
  );

  const dailyRows = useMemo(() => dataState.dailyRows.slice(-30), [dataState.dailyRows]);

  useEffect(() => {
    const latest = dataState.dailyRows.at(-1);
    const previous = dataState.dailyRows.at(-2);
    if (!firstDay && previous) setFirstDay(previous.month);
    if (!secondDay && latest) setSecondDay(latest.month);
    if (!plantComparisonDate) setPlantComparisonDate(dateKey(new Date()));
  }, [dataState.dailyRows, firstDay, plantComparisonDate, secondDay]);

  useEffect(() => {
    if (viewMode !== "daily") setDailyCompareOpen(false);
  }, [viewMode]);

  const readablePlantOptions = useMemo(
    () => [dataState.plantId, ...dataState.readablePlantIds].filter((plantId, index, plantIds) => plantId && plantIds.indexOf(plantId) === index),
    [dataState.plantId, dataState.readablePlantIds],
  );

  const activePlantComparison = useMemo<PlantComparison>(() => ({
    plantId: dataState.plantId,
    rows: dataState.rows,
    dailyRows: dataState.dailyRows,
    investmentUsd: dataState.investmentUsd,
    launchDate: dataState.launchDate,
    commercialDate: dataState.commercialDate,
    sheetUpdatedAt: dataState.sheetUpdatedAt,
  }), [
    dataState.commercialDate,
    dataState.dailyRows,
    dataState.investmentUsd,
    dataState.launchDate,
    dataState.plantId,
    dataState.rows,
    dataState.sheetUpdatedAt,
  ]);

  useEffect(() => {
    if (!readablePlantOptions.length) return;
    if (!firstPlantId) setFirstPlantId(dataState.plantId || readablePlantOptions[0]);
    if (!secondPlantId) setSecondPlantId(readablePlantOptions.find((plantId) => plantId !== (dataState.plantId || readablePlantOptions[0])) ?? readablePlantOptions[0]);
  }, [dataState.plantId, firstPlantId, readablePlantOptions, secondPlantId]);

  const ensureComparisonPlant = async (plantId: string, from: string, to = from) => {
    if (!plantId) return undefined;
    if (plantId === dataState.plantId) return activePlantComparison;
    const cacheKey = `${plantId}:${from}:${to}`;
    if (comparisonPlantCache[cacheKey]) return comparisonPlantCache[cacheKey];

    const plant = await loadPlantDateRange(plantId, from, to);
    setComparisonPlantCache((current) => ({
      ...current,
      [cacheKey]: plant,
    }));
    return plant;
  };

  useEffect(() => {
    if (!infoModal) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInfoModal(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [infoModal]);

  const rows = useMemo(() => {
    return filteredMonthlyRows(dataState.rows, range, monthFilter, yearFilter);
  }, [dataState.rows, monthFilter, range, yearFilter]);

  const plantComparisonDateOptions = useMemo(
    () => [...dataState.dailyRows].reverse(),
    [dataState.dailyRows],
  );

  const runPlantComparison = async () => {
    const selectedPlantIds = [firstPlantId, secondPlantId].filter(Boolean);
    if (selectedPlantIds.length < 2 || !plantComparisonDate) return;

    setPlantComparisonLoading(true);
    setComparisonError("");

    try {
      const loadedPlants = await Promise.all(
        selectedPlantIds.map((plantId) => ensureComparisonPlant(plantId, plantComparisonDate)),
      );
      const plants = loadedPlants.filter((plant): plant is PlantComparison => Boolean(plant));
      if (!plants.every((plant) => plant.dailyRows.some((row) => dateKey(row.date) === plantComparisonDate))) {
        throw new Error("Selected date is not available for one of the plants");
      }
      setComparisonPlants(plants);
    } catch (error) {
      setComparisonError(error instanceof Error ? error.message : "Could not load plant comparison");
    } finally {
      setPlantComparisonLoading(false);
    }
  };

  const totals = useMemo(() => {
    const roi = rows.reduce((sum, row) => sum + row.roiUsd, 0);
    const roiDisplay = sumRowsRoiMoney(rows, currency);
    const latest = rows.at(-1);
    const latestRow = dataState.rows.at(-1);
    const latestDailyRow = dataState.dailyRows.at(-1);
    const latestDailyUsdRate = latestDailyRow?.usdRate || [...dataState.dailyRows].reverse().find((row) => row.usdRate > 0)?.usdRate;
    const latestDisplayUsdRate = latestRow && latestDailyRow && sameMonth(latestRow.date, latestDailyRow.date) && latestDailyUsdRate ? latestDailyUsdRate : latestRow?.usdRate;
    const latestDisplayRow = latestRow && latestDisplayUsdRate ? withUsdRate(latestRow, latestDisplayUsdRate) : latestRow;
    const latestPaymentDisplay = latestDisplayRow ? moneyFromUah(latestDisplayRow.electricityPayment, currency, latestDisplayRow.usdRate) : 0;
    const production = rows.reduce((sum, row) => sum + row.production, 0);
    const exported = rows.reduce((sum, row) => sum + row.export, 0);
    const exportPayoutKwhTotal = rows.reduce((sum, row) => sum + exportPayoutKwh(row), 0);
    const exportPayoutDisplay = sumRowsFromUah(rows, exportPayoutUah, currency);
    const imported = rows.reduce((sum, row) => sum + row.importTotal, 0);
    const importCostDisplay = sumRowsFromUah(rows, importCostUah, currency);
    const consumed = rows.reduce((sum, row) => sum + row.consumedTotal, 0);
    const savings = rows.reduce((sum, row) => sum + row.electricitySavings, 0);
    const savingsDisplay = sumRowsFromUah(rows, (row) => row.electricitySavings, currency);
    const payments = rows.reduce((sum, row) => sum + row.electricityPayment, 0);
    const paymentsDisplay = sumRowsFromUah(rows, (row) => row.electricityPayment, currency);
    const covered = consumed ? ((consumed - imported) / consumed) * 100 : 0;
    const launchDate = dataState.launchDate ?? rows[0]?.date;
    const activeDuration = launchDate ? fullDurationBetween(launchDate, new Date()) : { months: 0, days: 0 };
    const usdRate = latestDailyUsdRate || latest?.usdRate || [...rows].reverse().find((row) => row.usdRate > 0)?.usdRate || 1;
    const launchUsdRate = launchDate ? dataState.rows.find((row) => sameMonth(row.date, launchDate))?.usdRate || usdRate : usdRate;
    return {
      roi,
      roiDisplay,
      latest,
      latestRow,
      latestDisplayRow,
      latestPaymentDisplay,
      production,
      exported,
      exportPayoutKwhTotal,
      exportPayoutDisplay,
      imported,
      importCostDisplay,
      consumed,
      savings,
      savingsDisplay,
      payments,
      paymentsDisplay,
      covered,
      launchDate,
      activeDuration,
      usdRate,
      launchUsdRate,
    };
  }, [currency, dataState.dailyRows, dataState.launchDate, dataState.rows, rows]);

  const payback = useMemo(() => {
    const investmentUsd = dataState.investmentUsd;
    if (!investmentUsd) return null;
    const investment = moneyFromUsd(investmentUsd, currency, totals.launchUsdRate);
    const recovered = totals.roiDisplay;
    const progress = Math.min(100, Math.max(0, (recovered / investment) * 100));
    const remaining = Math.max(0, investment - recovered);
    const today = startOfDay(new Date());
    const launchDate = totals.launchDate ?? rows[0]?.date;
    const elapsedDays = launchDate ? Math.max(1, daysBetween(launchDate, today) + 1) : 0;
    const dailyAverage = elapsedDays ? recovered / elapsedDays : 0;
    const daysLeft = remaining <= 0 ? 0 : dailyAverage > 0 ? Math.ceil(remaining / dailyAverage) : null;
    const payoffDuration = daysLeft === null ? null : fullDurationBetween(today, addDays(today, daysLeft));
    return { recovered, progress, dailyAverage, remaining, daysLeft, payoffDuration, investment, investmentUsd };
  }, [currency, dataState.investmentUsd, rows, totals.launchDate, totals.launchUsdRate, totals.roiDisplay]);

  const forecast = useMemo(() => {
    const today = new Date();
    const forecastAsOf = dataState.sheetUpdatedAt ?? today;
    const currentMonthRow = dataState.rows.find((row) => sameMonth(row.date, today)) ?? dataState.rows.at(-1);
    if (!currentMonthRow) return null;
    const currentIndex = dataState.rows.findIndex((row) => sameMonth(row.date, currentMonthRow.date));
    const previousMonthRow = currentIndex > 0 ? dataState.rows[currentIndex - 1] : undefined;

    const production = forecastMonthValue(currentMonthRow.production, currentMonthRow.date, forecastAsOf);
    const roi = forecastMonthValue(rowRoiMoney(currentMonthRow, currency), currentMonthRow.date, forecastAsOf);
    const income = forecastMonthValue(moneyFromUah(currentMonthRow.electricityPayment, currency, currentMonthRow.usdRate), currentMonthRow.date, forecastAsOf);
    const previousRoi = previousMonthRow ? rowRoiMoney(previousMonthRow, currency) : 0;
    const previousIncome = previousMonthRow ? moneyFromUah(previousMonthRow.electricityPayment, currency, previousMonthRow.usdRate) : 0;

    return {
      row: currentMonthRow,
      previousRow: previousMonthRow,
      production,
      productionDelta: previousMonthRow ? production - previousMonthRow.production : 0,
      roi,
      roiDelta: previousMonthRow ? roi - previousRoi : 0,
      income,
      incomeDelta: previousMonthRow ? income - previousIncome : 0,
    };
  }, [currency, dataState.rows, dataState.sheetUpdatedAt]);

  const showPlaceholders = dataState.isLoading;
  const infoModalContent = useMemo(() => {
    if (typeof infoModal === "object" && infoModal?.kind === "importSplit") {
      const row = infoModal.row;
      return {
        title: `${t.import} · ${row.month}`,
        body: (
          <SplitInfo
            t={t}
            lang={lang}
            total={row.importTotal}
            day={row.importDay}
            night={row.importNight}
          />
        ),
      };
    }
    if (typeof infoModal === "object" && infoModal?.kind === "consumedSplit") {
      const row = infoModal.row;
      return {
        title: `${t.consumed} · ${row.month}`,
        body: (
          <SplitInfo
            t={t}
            lang={lang}
            total={row.consumedTotal}
            day={row.consumedDay}
            night={row.consumedNight}
          />
        ),
      };
    }
    if (typeof infoModal === "object" && infoModal?.kind === "exportPrice") {
      const row = infoModal.row;
      const grossPrice = moneyFromUah(row.exportPrice, currency, row.usdRate);
      const netPrice = moneyFromUah(netExportPrice(row), currency, row.usdRate);
      return {
        title: `${t.exportPrice} · ${row.month}`,
        body: (
          <PriceInfo
            rows={[
              { label: t.grossExportPrice, value: `${formatDisplayMoney(grossPrice, currency, lang)} / ${energyUnit(lang)}` },
              { label: t.vat, value: `${formatNumber(row.exportVat, 2, 2)}%` },
              { label: t.militaryTax, value: `${formatNumber(row.exportMilitary, 2, 2)}%` },
              { label: t.netExportPrice, value: `${formatDisplayMoney(netPrice, currency, lang)} / ${energyUnit(lang)}` },
            ]}
          />
        ),
      };
    }
    if (typeof infoModal === "object" && infoModal?.kind === "netPayment") {
      const row = infoModal.row;
      return {
        title: `${t.netPayment} · ${row.month}`,
        body: (
          <NetPaymentInfo
            row={row}
            t={t}
            currency={currency}
            lang={lang}
          />
        ),
      };
    }
    if (infoModal === "latestRoi") return { title: t.latestRoi, body: t.latestRoiInfo };
    if (infoModal === "netPayment") return { title: t.netPayment, body: t.netPaymentLogic };
    if (infoModal === "usdRate") return { title: "USD/UAH", body: t.usdRateInfo };
    if (infoModal === "importPrice") return { title: `${t.import} ${t.exportPrice}`, body: t.importPriceInfo };
    if (infoModal === "roi") return { title: t.roi, body: t.roiInfo };
    if (infoModal === "forecast") return { title: t.forecast, body: t.forecastInfo };
    if (infoModal === "investment") return { title: t.investment, body: t.investmentInfo };
    if (infoModal === "totalExport") {
      const exportValue = formatKwh(totals.exported, lang);
      const paidExportValue = formatKwh(totals.exportPayoutKwhTotal, lang);
      const payoutValue = formatDisplayMoney(totals.exportPayoutDisplay, currency, lang);
      const body =
        lang === "uk"
          ? `Усього експортовано ${exportValue}. З них ${paidExportValue} чистого надлишку принесли ${payoutValue}. ${t.totalExportCostInfoDetails}`
          : `${exportValue} was exported to the grid. Of that, ${paidExportValue} net surplus earned ${payoutValue}. ${t.totalExportCostInfoDetails}`;
      return { title: t.totalExport, body };
    }
    if (infoModal === "totalImport") {
      const importValue = formatKwh(totals.imported, lang);
      const costValue = formatDisplayMoney(totals.importCostDisplay, currency, lang);
      const body =
        lang === "uk"
          ? `Імпортовані з мережі ${importValue} коштували б ${costValue}. ${t.totalImportCostInfoDetails}`
          : `The ${importValue} imported from the grid would have cost ${costValue}. ${t.totalImportCostInfoDetails}`;
      return { title: t.totalImport, body };
    }
    return null;
  }, [
    currency,
    infoModal,
    lang,
    t,
    totals.exportPayoutDisplay,
    totals.exportPayoutKwhTotal,
    totals.exported,
    totals.importCostDisplay,
    totals.imported,
  ]);

  return (
    <main className="app-shell">
      <section className="content">
        <header className="topbar">
          <div className="toolbar">
            <div className="investment-pill" aria-label={`${t.investment} USD`}>
              <span>{t.investment}</span>
              <strong>
                {showPlaceholders ? (
                  <SkeletonText width="92px" />
                ) : payback ? (
                  formatDisplayMoney(moneyFromUsd(payback.investmentUsd, currency, totals.launchUsdRate), currency, lang)
                ) : (
                  "-"
                )}
              </strong>
              <button type="button" className="investment-info-button" aria-label={t.investment} onClick={() => setInfoModal("investment")}>
                <Info size={14} />
              </button>
            </div>
            <div className="segmented currency" aria-label={t.currency}>
              {(["UAH", "USD"] as Currency[]).map((item) => (
                <button key={item} className={currency === item ? "selected" : ""} onClick={() => setCurrency(item)}>
                  {item}
                </button>
              ))}
            </div>
            <div className="segmented view" aria-label="View">
              {(["monthly", "daily", "comparison"] as ViewMode[]).map((item) => (
                <button key={item} className={viewMode === item ? "selected" : ""} onClick={() => setViewMode(item)}>
                  {item === "monthly" ? t.monthly : item === "daily" ? t.daily : t.comparison}
                </button>
              ))}
            </div>
            {viewMode === "monthly" ? (
              <div className="segmented" aria-label="Date range">
                {(["all", "12m", "6m", "3m", "1m"] as RangeKey[]).map((item) => (
                  <button
                    key={item}
                    className={range === item ? "selected" : ""}
                    onClick={() => setRange(item)}
                  >
                    {item === "all" ? t.all : item.toUpperCase()}
                  </button>
                ))}
              </div>
            ) : viewMode === "daily" ? (
              <div className="segmented daily-tools" aria-label={t.compareDays}>
                <button type="button" className={isDailyCompareOpen ? "selected" : ""} onClick={() => setDailyCompareOpen(true)}>
                  {t.compareDays}
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className={`icon-button refresh-button${dataState.isRefreshing ? " is-refreshing" : ""}`}
              onClick={dataState.refresh}
              disabled={dataState.isRefreshing}
              aria-label={t.refresh}
              title={t.refresh}
            >
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        {dataState.error && (
          <div className="notice">
            <strong>{t.sourceWarning}</strong>
            <small>{dataState.error}</small>
          </div>
        )}

        {viewMode === "daily" ? (
          showPlaceholders ? (
            <>
              <KpiSkeletonGrid />
              <ChartSkeleton />
            </>
          ) : (
            <DailyDashboard
              rows={dailyRows}
              allRows={dataState.dailyRows}
              firstDay={firstDay}
              secondDay={secondDay}
              setFirstDay={setFirstDay}
              setSecondDay={setSecondDay}
              isCompareOpen={isDailyCompareOpen}
              setCompareOpen={setDailyCompareOpen}
              t={t}
              currency={currency}
              lang={lang}
              onUsdRateInfo={() => setInfoModal("usdRate")}
              onImportPriceInfo={() => setInfoModal("importPrice")}
              onNetPaymentHeaderInfo={() => setInfoModal("netPayment")}
              onRoiInfo={() => setInfoModal("roi")}
              onImportSplitInfo={(row) => setInfoModal({ kind: "importSplit", row })}
              onConsumedSplitInfo={(row) => setInfoModal({ kind: "consumedSplit", row })}
              onExportPriceInfo={(row) => setInfoModal({ kind: "exportPrice", row })}
              onNetPaymentInfo={(row) => setInfoModal({ kind: "netPayment", row })}
            />
          )
        ) : viewMode === "comparison" ? (
          showPlaceholders ? (
            <KpiSkeletonGrid />
          ) : dataState.readablePlantIds.length ? (
            <PlantComparisonSection
              activePlantId={dataState.plantId}
              availablePlantIds={readablePlantOptions}
              firstPlantId={firstPlantId}
              secondPlantId={secondPlantId}
              plantComparisonDate={plantComparisonDate}
              plantComparisonDateOptions={plantComparisonDateOptions}
              setFirstPlantId={setFirstPlantId}
              setSecondPlantId={setSecondPlantId}
              setPlantComparisonDate={setPlantComparisonDate}
              onCompare={runPlantComparison}
              plants={comparisonPlants}
              isLoading={isPlantComparisonLoading}
              error={comparisonError}
              t={t}
              currency={currency}
              lang={lang}
            />
          ) : (
            <div className="notice">
              <strong>{t.plantComparison}</strong>
              <small>{t.comparisonHint}</small>
            </div>
          )
        ) : (
          <>
        {showPlaceholders ? (
          <KpiSkeletonGrid />
        ) : (
          <section id="overview" className="kpi-grid">
            <KpiCard
              icon={<CircleDollarSign size={20} />}
              label={t.latestRoi}
              value={formatDisplayMoney(totals.latestDisplayRow ? rowRoiMoney(totals.latestDisplayRow, currency) : 0, currency, lang)}
              detail={`${t.net} ${formatDisplayMoney(totals.latestPaymentDisplay, currency, lang)}`}
              tone="green"
              infoLabel={t.latestRoi}
              onInfo={() => setInfoModal("latestRoi")}
            />
            <KpiCard
              icon={<SunMedium size={20} />}
              label={t.totalProduction}
              value={formatKwh(totals.production, lang)}
              detail={`${pct((totals.exported / totals.production) * 100)} ${t.exported}`}
              tone="amber"
            />
            <KpiCard
              icon={<ArrowUpFromLine size={20} />}
              label={t.totalExport}
              value={formatKwh(totals.exported, lang)}
              detail={`${t.latest} ${formatKwh(totals.latest?.export ?? 0, lang)}`}
              tone="mint"
              infoLabel={t.totalExport}
              onInfo={() => setInfoModal("totalExport")}
            />
            <KpiCard
              icon={<ArrowDownToLine size={20} />}
              label={t.totalImport}
              value={formatKwh(totals.imported, lang)}
              detail={`${pct(totals.covered)} ${t.solarCoverage}`}
              tone="blue"
              infoLabel={t.totalImport}
              onInfo={() => setInfoModal("totalImport")}
            />
            <KpiCard
              icon={<WalletCards size={20} />}
              label={t.netPayment}
              value={formatDisplayMoney(totals.paymentsDisplay, currency, lang)}
              detail={`${t.savings} ${formatDisplayMoney(totals.savingsDisplay, currency, lang)}`}
              tone={totals.payments >= 0 ? "green" : "rose"}
              infoLabel={t.netPayment}
              onInfo={() => setInfoModal("netPayment")}
            />
            <KpiCard
              icon={<CalendarClock size={20} />}
              label={t.plantWorks}
              value={formatActiveDuration(totals.activeDuration, lang)}
              detail={totals.launchDate ? `${t.sinceLaunch} ${formatLaunchDate(totals.launchDate, lang)}` : t.sinceLaunch}
              tone="indigo"
            />
          </section>
        )}

        <section className="forecast-section">
          <div className="section-heading">
            <div>
              <h2 className="heading-with-info">
                <span>
                  {showPlaceholders || !forecast
                    ? t.forecast
                    : `${t.forecast}, ${formatMonthYear(forecast.row.date, lang)}`}
                </span>
                <button type="button" className="section-info-button" aria-label={t.forecast} onClick={() => setInfoModal("forecast")}>
                  <Info size={16} />
                </button>
              </h2>
            </div>
          </div>
          {showPlaceholders ? (
            <div className="forecast-grid">
              {Array.from({ length: 3 }, (_, index) => (
                <article className="kpi-card" key={index}>
                  <SkeletonBlock className="kpi-icon" />
                  <SkeletonText width="90px" height="12px" />
                  <SkeletonText width="120px" height="22px" />
                  <SkeletonText width="110px" height="12px" />
                </article>
              ))}
            </div>
          ) : forecast ? (
            <div className="forecast-grid">
              <KpiCard
                icon={<SunMedium size={20} />}
                label={t.expectedProduction}
                value={formatKwh(forecast.production, lang)}
                detail={
                  <ForecastDetail
                    current={`${formatKwh(forecast.row.production, lang)} ${t.soFar}`}
                    delta={forecast.productionDelta}
                    formattedDelta={formatSignedKwh(forecast.productionDelta, lang)}
                    base={forecast.previousRow?.production ?? 0}
                    label={forecast.previousRow ? `${lang === "uk" ? "до" : "vs"} ${formatMonthOnly(forecast.previousRow.date, lang)}` : ""}
                  />
                }
                tone="amber"
              />
              <KpiCard
                icon={<CircleDollarSign size={20} />}
                label={t.expectedRoi}
                value={formatDisplayMoney(forecast.roi, currency, lang)}
                detail={
                  <ForecastDetail
                    current={`${formatDisplayMoney(rowRoiMoney(forecast.row, currency), currency, lang)} ${t.soFar}`}
                    delta={forecast.roiDelta}
                    formattedDelta={formatSignedMoney(forecast.roiDelta, currency, lang)}
                    base={forecast.previousRow ? rowRoiMoney(forecast.previousRow, currency) : 0}
                    label={forecast.previousRow ? `${lang === "uk" ? "до" : "vs"} ${formatMonthOnly(forecast.previousRow.date, lang)}` : ""}
                  />
                }
                tone="green"
              />
              <KpiCard
                icon={<WalletCards size={20} />}
                label={t.expectedIncome}
                value={formatDisplayMoney(forecast.income, currency, lang)}
                detail={
                  <ForecastDetail
                    current={`${formatDisplayMoney(moneyFromUah(forecast.row.electricityPayment, currency, forecast.row.usdRate), currency, lang)} ${t.soFar}`}
                    delta={forecast.incomeDelta}
                    formattedDelta={formatSignedMoney(forecast.incomeDelta, currency, lang)}
                    base={forecast.previousRow ? moneyFromUah(forecast.previousRow.electricityPayment, currency, forecast.previousRow.usdRate) : 0}
                    label={forecast.previousRow ? `${lang === "uk" ? "до" : "vs"} ${formatMonthOnly(forecast.previousRow.date, lang)}` : ""}
                  />
                }
                tone={forecast.income >= 0 ? "green" : "rose"}
              />
            </div>
          ) : null}
        </section>

        <section className="payback-band">
          {showPlaceholders ? (
            <>
              <div>
                <SkeletonText width="230px" height="24px" />
                <SkeletonText width="min(620px, 100%)" height="16px" />
              </div>
              <SkeletonBlock className="progress-track skeleton-track" />
            </>
          ) : (
            <>
              <div>
                <h2>{payback ? `${formatNumber(payback.progress)}% ${t.investmentRecovered}` : t.addInvestment}</h2>
                <p>
                  {payback
                    ? `${formatDisplayMoney(payback.recovered, currency, lang)} ${t.recovered}, ${formatDisplayMoney(payback.remaining, currency, lang)} ${t.remaining}${
                        payback.payoffDuration ? `, ${formatActiveDuration(payback.payoffDuration, lang)} ${t.currentAverage}` : ""
                      }.`
                    : t.investmentHelp}
                </p>
              </div>
              <div className="progress-track" aria-label="Payback progress">
                <span style={{ width: `${payback?.progress ?? 0}%` }} />
              </div>
            </>
          )}
        </section>

        <section id="finance" className="chart-grid">
          <ChartPanel
            title={t.roiTrajectory}
            legend={[
              [t.roi, colors.green],
              [`${t.cumulative} %`, colors.ink],
            ]}
          >
            {showPlaceholders ? (
              <ChartSkeleton />
            ) : (
              <RoiChart
                rows={rows}
                currency={currency}
                investment={payback ? payback.investment : 0}
              />
            )}
          </ChartPanel>
          <ChartPanel
            title={t.finance}
            legend={[
              [t.savings, colors.mint],
              [t.payment, colors.green],
            ]}
          >
            {showPlaceholders ? <ChartSkeleton /> : <MoneyChart rows={rows} currency={currency} />}
          </ChartPanel>
        </section>

        <section id="energy" className="chart-grid">
          <ChartPanel
            title={t.consumptionMix}
            legend={[
              [t.day, colors.blue],
              [t.night, colors.indigo],
            ]}
          >
            {showPlaceholders ? <ChartSkeleton /> : <ConsumptionMixChart rows={rows} />}
          </ChartPanel>
          <ChartPanel
            title={t.importMix}
            legend={[
              [t.day, colors.blue],
              [t.night, colors.indigo],
            ]}
          >
            {showPlaceholders ? <ChartSkeleton /> : <ImportMixChart rows={rows} />}
          </ChartPanel>
        </section>

        <section className="chart-grid chart-grid-single">
          <ChartPanel
            title={t.production}
            legend={[
              [t.production, colors.amber],
              [t.export, colors.green],
            ]}
          >
            {showPlaceholders ? <ChartSkeleton /> : <ProductionExportChart rows={rows} />}
          </ChartPanel>
        </section>

        <section id="data" className="data-section">
          <div className="section-heading">
            <div>
              <h2>{t.table}</h2>
            </div>
            <div className="filter-controls" aria-label={t.filterMonth}>
              <label className="filter-box">
                <select value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
                  <option value="all">{t.allMonths}</option>
                  {monthNames.map((label, index) => (
                    <option key={label} value={String(index + 1)}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-box">
                <select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}>
                  <option value="all">{t.allYears}</option>
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {showPlaceholders ? (
            <DataTableSkeleton />
          ) : (
            <DataTable
              rows={rows}
              period="monthly"
              t={t}
              currency={currency}
              lang={lang}
              onUsdRateInfo={() => setInfoModal("usdRate")}
              onImportPriceInfo={() => setInfoModal("importPrice")}
              onNetPaymentHeaderInfo={() => setInfoModal("netPayment")}
              onRoiInfo={() => setInfoModal("roi")}
              onImportSplitInfo={(row) => setInfoModal({ kind: "importSplit", row })}
              onConsumedSplitInfo={(row) => setInfoModal({ kind: "consumedSplit", row })}
              onExportPriceInfo={(row) => setInfoModal({ kind: "exportPrice", row })}
              onNetPaymentInfo={(row) => setInfoModal({ kind: "netPayment", row })}
            />
          )}
        </section>
          </>
        )}
        {infoModalContent && (
          <div className="modal-backdrop" role="presentation" onMouseDown={() => setInfoModal(null)}>
            <section
              className="info-modal modal-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="kpi-info-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="section-heading modal-heading">
                <div>
                  <h2 id="kpi-info-title">{infoModalContent.title}</h2>
                </div>
                <button type="button" className="icon-button" onClick={() => setInfoModal(null)} aria-label={t.close}>
                  <X size={18} />
                </button>
              </div>
              <div className="info-modal-body">{infoModalContent.body}</div>
            </section>
          </div>
        )}
        <footer className="dash-footer">
          {showPlaceholders ? (
            <SkeletonText width="130px" />
          ) : (
            `${t.updated}: ${dataState.sheetUpdatedAt ? formatDateTimeLabel(dataState.sheetUpdatedAt, lang) : "-"}`
          )}
        </footer>
      </section>
    </main>
  );
}

function SkeletonBlock({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}

function SkeletonText({ width = "100%", height = "1em" }: { width?: string; height?: string }) {
  return <SkeletonBlock className="skeleton-text" style={{ "--skeleton-width": width, "--skeleton-height": height } as React.CSSProperties} />;
}

function KpiSkeletonGrid() {
  return (
    <section id="overview" className="kpi-grid" aria-busy="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <article className="kpi-card" key={index}>
          <SkeletonBlock className="skeleton-icon" />
          <SkeletonText width="74px" height="13px" />
          <SkeletonText width="112px" height="26px" />
          <SkeletonText width="138px" height="14px" />
        </article>
      ))}
    </section>
  );
}

function ChartSkeleton() {
  return (
    <>
      <div className="chart-skeleton" aria-busy="true">
        {Array.from({ length: 8 }).map((_, index) => (
          <SkeletonBlock key={index} className={`skeleton-bar skeleton-bar-${index + 1}`} />
        ))}
      </div>
      <SkeletonBlock className="chart-readout skeleton-readout" />
    </>
  );
}

function DataTableSkeleton() {
  return (
    <div className="table-wrap" aria-busy="true">
      <table>
        <thead>
          <tr>
            {Array.from({ length: 12 }).map((_, index) => (
              <th key={index}>
                <SkeletonText width={index === 0 ? "54px" : "82px"} height="12px" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 5 }).map((_, rowIndex) => (
            <tr key={rowIndex}>
              {Array.from({ length: 12 }).map((_, cellIndex) =>
                cellIndex === 0 ? (
                  <th key={cellIndex}>
                    <SkeletonText width="58px" height="14px" />
                  </th>
                ) : (
                  <td key={cellIndex}>
                    <SkeletonText width="72px" height="14px" />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ForecastDetail({
  current,
  delta,
  formattedDelta,
  base,
  label,
}: {
  readonly current: string;
  readonly delta: number;
  readonly formattedDelta: string;
  readonly base: number;
  readonly label: string;
}) {
  return (
    <span className="forecast-detail">
      <span>{current}</span>
      {base ? (
        <span className={deltaTone(delta)}>
          {formattedDelta}
          {formatDeltaPct(delta, base)} {label}
        </span>
      ) : null}
    </span>
  );
}

function PlantComparisonSection({
  activePlantId,
  availablePlantIds,
  firstPlantId,
  secondPlantId,
  plantComparisonDate,
  plantComparisonDateOptions,
  setFirstPlantId,
  setSecondPlantId,
  setPlantComparisonDate,
  onCompare,
  plants,
  isLoading,
  error,
  t,
  currency,
  lang,
}: {
  readonly activePlantId: string;
  readonly availablePlantIds: readonly string[];
  readonly firstPlantId: string;
  readonly secondPlantId: string;
  readonly plantComparisonDate: string;
  readonly plantComparisonDateOptions: readonly MonthRow[];
  readonly setFirstPlantId: (plantId: string) => void;
  readonly setSecondPlantId: (plantId: string) => void;
  readonly setPlantComparisonDate: (date: string) => void;
  readonly onCompare: () => void;
  readonly plants: readonly PlantComparison[];
  readonly isLoading: boolean;
  readonly error: string;
  readonly t: Record<string, string>;
  readonly currency: Currency;
  readonly lang: Lang;
}) {
  const comparedPlants = plants.map((plant) => ({
    ...plant,
    selectedDate: plantComparisonDate,
    row: plant.dailyRows.find((item) => dateKey(item.date) === plantComparisonDate),
  }));

  return (
    <section className="plant-comparison-section">
      <div className="section-heading">
        <div>
          <h2>{t.plantComparison}</h2>
          <p>{t.comparisonHint}</p>
        </div>
      </div>
      <div className="plant-comparison-controls">
        <label>
          <span>{t.compareDate}</span>
          <input
            type="date"
            value={plantComparisonDate}
            min={firstDateKey(plantComparisonDateOptions)}
            max={dateKey(new Date())}
            onChange={(event) => setPlantComparisonDate(event.target.value)}
          />
        </label>
        <label>
          <span>{t.compareFirstPlant}</span>
          <select value={firstPlantId} onChange={(event) => setFirstPlantId(event.target.value)}>
            {availablePlantIds.map((plantId) => (
              <option key={plantId} value={plantId}>
                {plantId}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.compareSecondPlant}</span>
          <select value={secondPlantId} onChange={(event) => setSecondPlantId(event.target.value)}>
            {availablePlantIds.map((plantId) => (
              <option key={plantId} value={plantId}>
                {plantId}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onCompare}
          disabled={isLoading || !firstPlantId || !secondPlantId || !plantComparisonDate}
        >
          {isLoading ? "..." : t.compare}
        </button>
      </div>
      {error ? <small className="negative">{error}</small> : null}
      <PlantComparisonCharts plants={comparedPlants} activePlantId={activePlantId} t={t} currency={currency} lang={lang} />
    </section>
  );
}

function PlantComparisonCharts({
  plants,
  activePlantId,
  t,
  currency,
  lang,
}: {
  readonly plants: readonly {
    readonly plantId: string;
    readonly selectedDate: string;
    readonly row?: MonthRow;
  }[];
  readonly activePlantId: string;
  readonly t: Record<string, string>;
  readonly currency: Currency;
  readonly lang: Lang;
}) {
  if (!plants.length) return null;

  const items = [
    {
      title: t.production,
      values: plants.map((plant) => plant.row?.production ?? 0),
      format: (value: number) => formatKwh(value, lang),
      color: colors.amber,
    },
    {
      title: t.roi,
      values: plants.map((plant) => (plant.row ? rowRoiMoney(plant.row, currency) : 0)),
      format: (value: number) => formatDisplayMoney(value, currency, lang),
      color: colors.green,
    },
    {
      title: t.net,
      values: plants.map((plant) => (plant.row ? moneyFromUah(plant.row.electricityPayment, currency, plant.row.usdRate) : 0)),
      format: (value: number) => formatDisplayMoney(value, currency, lang),
      color: colors.blue,
    },
  ];

  return (
    <div className="plant-comparison-chart-grid">
      {items.map((item) => (
        <article className="plant-comparison-chart" key={item.title}>
          <h3>{item.title}</h3>
          <div className="comparison-bars">
            {plants.map((plant, index) => (
              <ComparisonBar
                key={`${item.title}-${plant.plantId}-${plant.selectedDate}-${index}`}
                label={plant.plantId}
                detail={plant.row ? formatDayLabel(plant.row.date, lang) : plant.selectedDate || "-"}
                value={item.values[index] ?? 0}
                formattedValue={item.format(item.values[index] ?? 0)}
                max={Math.max(...item.values.map((value) => Math.abs(value)), 1)}
                color={item.color}
                isActive={plant.plantId === activePlantId}
              />
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function ComparisonBar({
  label,
  detail,
  value,
  formattedValue,
  max,
  color,
  isActive,
}: {
  readonly label: string;
  readonly detail: string;
  readonly value: number;
  readonly formattedValue: string;
  readonly max: number;
  readonly color: string;
  readonly isActive: boolean;
}) {
  const width = `${Math.max(3, (Math.abs(value) / max) * 100)}%`;

  return (
    <div className="comparison-bar-row">
      <div className="comparison-bar-label">
        <span className="comparison-bar-name">
          <strong>{label}</strong>
          {isActive ? <i>{i18n[APP_LANG].activePlant}</i> : null}
        </span>
        <small>{detail}</small>
      </div>
      <div className="comparison-bar-track">
        <i style={{ width, background: value >= 0 ? color : colors.rose }} />
      </div>
      <b className={value >= 0 ? "positive" : "negative"}>{formattedValue}</b>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  detail,
  tone,
  infoLabel,
  onInfo,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: React.ReactNode;
  tone: string;
  infoLabel?: string;
  onInfo?: () => void;
}) {
  return (
    <article className={`kpi-card ${tone}`}>
      {onInfo && (
        <button type="button" className="kpi-info-button" onClick={onInfo} aria-label={infoLabel}>
          <Info size={16} />
        </button>
      )}
      <div className="kpi-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function ChartPanel({
  title,
  legend,
  children,
}: {
  title: string;
  legend: [string, string][];
  children: React.ReactNode;
}) {
  return (
    <article className="chart-panel">
      <div className="chart-head">
        <div>
          <h2>{title}</h2>
        </div>
        <div className="legend">
          {legend.map(([label, color]) => (
            <span key={label}>
              <i style={{ background: color }} /> {label}
            </span>
          ))}
        </div>
      </div>
      {children}
    </article>
  );
}

function axisMax(values: number[]) {
  const max = Math.max(...values.filter((value) => Number.isFinite(value)), 0);
  if (max <= 0) return 1;
  const buffered = max * 1.02;
  const magnitude = 10 ** Math.floor(Math.log10(buffered));
  const step = magnitude / 10;
  return Math.ceil(buffered / step) * step;
}

interface ChartInspectorItem {
  readonly label: string;
  readonly value: string;
  readonly color: string;
  readonly wide?: boolean;
}

interface ChartInspectorSelection {
  readonly month: string;
  readonly items: readonly ChartInspectorItem[];
}

function useChartInspector(initialSelection: ChartInspectorSelection | null) {
  const [selection, setSelection] = useState<ChartInspectorSelection | null>(initialSelection);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => setSelection(initialSelection), [initialSelection]);
  const target = (nextSelection: ChartInspectorSelection) => ({
    role: "button",
    tabIndex: 0,
    className: "chart-hit chart-month-target",
    "aria-label": `${nextSelection.month}: ${nextSelection.items.map((item) => `${item.label} ${item.value}`).join(", ")}`,
    onPointerDown: (event: React.PointerEvent<SVGElement>) => {
      pointerStart.current = { x: event.clientX, y: event.clientY };
    },
    onPointerUp: (event: React.PointerEvent<SVGElement>) => {
      const start = pointerStart.current;
      pointerStart.current = null;
      if (!start) return;
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (moved <= 8) setSelection(nextSelection);
    },
    onPointerCancel: () => {
      pointerStart.current = null;
    },
    onKeyDown: (event: React.KeyboardEvent<SVGElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setSelection(nextSelection);
      }
    },
  });
  return { selection, target };
}

function MonthTarget({
  x,
  y,
  width,
  height,
  selection,
  active,
  target,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  selection: ChartInspectorSelection;
  active: boolean;
  target: (selection: ChartInspectorSelection) => React.SVGProps<SVGRectElement>;
}) {
  return (
    <rect
      {...target(selection)}
      className={`chart-hit chart-month-target${active ? " active" : ""}`}
      x={x}
      y={y}
      width={width}
      height={height}
      rx="5"
    />
  );
}

function ChartInspector({ selection, hint }: { selection: ChartInspectorSelection | null; hint: string }) {
  if (!selection) return <div className="chart-inspector chart-inspector-empty">{hint}</div>;
  return (
    <div className="chart-inspector">
      <strong>{selection.month}</strong>
      <div className="chart-inspector-items">
        {selection.items.map((item) => (
          <React.Fragment key={`${item.label}-${item.color}`}>
            <span className="chart-inspector-label">
              <i style={{ background: item.color }} /> {item.label}
            </span>
            <b>{item.value}</b>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function newestFirst(rows: readonly MonthRow[]) {
  return [...rows].reverse();
}

function ProductionExportChart({ rows }: { readonly rows: readonly MonthRow[] }) {
  const t = i18n[APP_LANG];
  const isMobile = useMediaQuery("(max-width: 820px)");
  const displayRows = useMemo(() => (isMobile ? newestFirst(rows) : rows), [isMobile, rows]);
  const inspectors = useMemo(
    () =>
      new Map(
        displayRows.map((row) => [
          row.month,
          {
            month: formatPeriodLabel(row),
            items: [
              { label: t.production, value: formatKwh(row.production), color: colors.amber },
              { label: t.export, value: formatKwh(row.export), color: colors.green },
            ],
          },
        ]),
      ),
    [displayRows, t.export, t.production],
  );
  const latestRow = rows.at(-1);
  const { selection, target } = useChartInspector(latestRow ? inspectors.get(latestRow.month) ?? null : null);
  const width = 900;
  const height = 300;
  const pad = { left: 48, right: 18, top: 18, bottom: 42 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = axisMax(displayRows.flatMap((row) => [row.production, row.export]));
  const band = chartBand(innerW, displayRows.length);
  const bar = Math.max(14, band * 0.24);
  const y = (value: number) => pad.top + innerH - (value / max) * innerH;

  return (
    <>
      <div className="chart-scroll">
        <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img">
          <Grid width={width} height={height} pad={pad} max={max} />
          {displayRows.map((row, index) => {
            const x = pad.left + band * index + band / 2;
            const inspector = inspectors.get(row.month);
            return (
              <g key={row.month}>
                <rect
                  x={x - bar - 3}
                  y={y(row.production)}
                  width={bar}
                  height={innerH - (y(row.production) - pad.top)}
                  rx="3"
                  fill={colors.amber}
                />
                <rect
                  x={x + 3}
                  y={y(row.export)}
                  width={bar}
                  height={innerH - (y(row.export) - pad.top)}
                  rx="3"
                  fill={colors.green}
                />
                {inspector && (
                  <MonthTarget
                    x={x - band / 2}
                    y={pad.top}
                    width={band}
                    height={innerH}
                    selection={inspector}
                    active={selection?.month === inspector.month}
                    target={target}
                  />
                )}
                <text x={x} y={height - 14} textAnchor="middle">
                  {monthShort(row.month)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <ChartInspector selection={selection} hint={t.tapBar} />
    </>
  );
}

function RoiChart({
  rows,
  currency,
  investment,
}: {
  readonly rows: readonly MonthRow[];
  readonly currency: Currency;
  readonly investment: number;
}) {
  const t = i18n[APP_LANG];
  const isMobile = useMediaQuery("(max-width: 820px)");
  const chronologicalRows = useMemo(
    () =>
      rows.reduce<Array<{ row: MonthRow; cumulative: number; cumulativePct: number; monthly: number }>>((items, row) => {
      const monthly = rowRoiMoney(row, currency);
      const cumulative = (items.at(-1)?.cumulative ?? 0) + monthly;
      const cumulativePct = investment > 0 ? (cumulative / investment) * 100 : 0;
      items.push({ row, monthly, cumulative, cumulativePct });
      return items;
    }, []),
    [currency, investment, rows],
  );
  const displayRows = useMemo(() => (isMobile ? [...chronologicalRows].reverse() : chronologicalRows), [chronologicalRows, isMobile]);
  const inspectors = useMemo(
    () =>
      new Map(
        displayRows.map((item) => [
          item.row.month,
          {
            month: formatPeriodLabel(item.row),
            items: [
              { label: t.roi, value: formatDisplayMoney(item.monthly, currency, APP_LANG), color: colors.green },
              {
                label: `${t.cumulative} ${t.roi}`,
                value: `${formatDisplayMoney(item.cumulative, currency, APP_LANG)} (${formatNumber(item.cumulativePct)}%)`,
                color: colors.ink,
                wide: true,
              },
            ],
          },
        ]),
      ),
    [currency, displayRows, t.cumulative, t.roi],
  );
  const latestRow = rows.at(-1);
  const { selection, target } = useChartInspector(latestRow ? inspectors.get(latestRow.month) ?? null : null);
  const width = 900;
  const height = 300;
  const pad = { left: 48, right: 24, top: 18, bottom: 42 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const monthly = displayRows.map((item) => item.monthly);
  const cumulativePct = displayRows.map((item) => item.cumulativePct);
  const moneyMax = axisMax(monthly);
  const pctMax = axisMax(cumulativePct);
  const band = chartBand(innerW, displayRows.length);
  const bar = Math.max(16, band * 0.44);
  const moneyY = (value: number) => pad.top + innerH - (value / moneyMax) * innerH;
  const pctY = (value: number) => pad.top + innerH - (value / pctMax) * innerH;
  const points = cumulativePct
    .map((value, index) => `${pad.left + band * index + band / 2},${pctY(value)}`)
    .join(" ");

  return (
    <>
      <div className="chart-scroll">
        <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img">
          <Grid width={width} height={height} pad={pad} max={moneyMax} currency={currency} />
          {displayRows.map(({ row, monthly: value }, index) => {
            const x = pad.left + band * index + band / 2;
            const inspector = inspectors.get(row.month);
            return (
              <g key={row.month}>
                <rect
                  x={x - bar / 2}
                  y={moneyY(value)}
                  width={bar}
                  height={innerH - (moneyY(value) - pad.top)}
                  rx="4"
                  fill={colors.green}
                />
                {inspector && (
                  <MonthTarget
                    x={x - band / 2}
                    y={pad.top}
                    width={band}
                    height={innerH}
                    selection={inspector}
                    active={selection?.month === inspector.month}
                    target={target}
                  />
                )}
                <text x={x} y={height - 14} textAnchor="middle">
                  {monthShort(row.month)}
                </text>
              </g>
            );
          })}
          <polyline
            points={points}
            fill="none"
            stroke={colors.ink}
            strokeWidth="3"
            strokeLinejoin="round"
            pointerEvents="none"
          />
          {displayRows.map(({ row, cumulativePct: value }, index) => (
            <React.Fragment key={`${row.month}-${value}`}>
              <circle
                cx={pad.left + band * index + band / 2}
                cy={pctY(value)}
                r="5"
                fill="var(--panel)"
                stroke={colors.ink}
                strokeWidth="2"
                pointerEvents="none"
              />
            </React.Fragment>
          ))}
        </svg>
      </div>
      <ChartInspector selection={selection} hint={t.tapBarOrDot} />
    </>
  );
}

function MoneyChart({ rows, currency }: { readonly rows: readonly MonthRow[]; readonly currency: Currency }) {
  const t = i18n[APP_LANG];
  const isMobile = useMediaQuery("(max-width: 820px)");
  const displayRows = useMemo(() => (isMobile ? newestFirst(rows) : rows), [isMobile, rows]);
  const inspectors = useMemo(
    () =>
      new Map(
        displayRows.map((row) => {
          const electricityPayment = moneyFromUah(row.electricityPayment, currency, row.usdRate);
          const savings = moneyFromUah(row.electricitySavings, currency, row.usdRate);
          return [
            row.month,
            {
              month: formatPeriodLabel(row),
              items: [
                { label: t.savings, value: formatDisplayMoney(savings, currency, APP_LANG), color: colors.mint },
                { label: t.payment, value: formatDisplayMoney(electricityPayment, currency, APP_LANG), color: electricityPayment >= 0 ? colors.green : colors.rose },
              ],
            },
          ];
        }),
      ),
    [currency, displayRows, t.payment, t.savings],
  );
  const latestRow = rows.at(-1);
  const { selection, target } = useChartInspector(latestRow ? inspectors.get(latestRow.month) ?? null : null);
  const width = 900;
  const height = 300;
  const pad = { left: 70, right: 18, top: 18, bottom: 42 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const values = displayRows.flatMap((row) => [
    moneyFromUah(row.electricityPayment, currency, row.usdRate),
    moneyFromUah(row.electricitySavings, currency, row.usdRate),
  ]);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const min = minValue < 0 ? -axisMax(values.filter((value) => value < 0).map(Math.abs)) : 0;
  const max = maxValue > 0 ? axisMax(values.filter((value) => value > 0)) : 1;
  const band = chartBand(innerW, displayRows.length);
  const bar = Math.max(13, band * 0.24);
  const y = (value: number) => pad.top + ((max - value) / (max - min || 1)) * innerH;
  const zeroY = y(0);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((tick) => min + (max - min) * tick);

  return (
    <>
      <div className="chart-scroll">
        <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img">
          <g className="grid">
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
                <text x={pad.left - 10} y={y(tick) + 4} textAnchor="end">
                  {formatAxisValue(tick, currency)}
                </text>
              </g>
            ))}
          </g>
          <line x1={pad.left} x2={width - pad.right} y1={zeroY} y2={zeroY} stroke={colors.ink} strokeWidth="1.5" />
          {displayRows.map((row, index) => {
            const x = pad.left + band * index + band / 2;
            const electricityPayment = moneyFromUah(row.electricityPayment, currency, row.usdRate);
            const savings = moneyFromUah(row.electricitySavings, currency, row.usdRate);
            const savingsY = y(savings);
            const paymentY = y(electricityPayment);
            const inspector = inspectors.get(row.month);
            return (
              <g key={row.month}>
                <rect
                  x={x - bar - 3}
                  y={Math.min(savingsY, zeroY)}
                  width={bar}
                  height={Math.abs(zeroY - savingsY)}
                  rx="3"
                  fill={colors.mint}
                />
                <rect
                  x={x + 3}
                  y={Math.min(paymentY, zeroY)}
                  width={bar}
                  height={Math.abs(zeroY - paymentY)}
                  rx="3"
                  fill={electricityPayment >= 0 ? colors.green : colors.rose}
                />
                {inspector && (
                  <MonthTarget
                    x={x - band / 2}
                    y={pad.top}
                    width={band}
                    height={innerH}
                    selection={inspector}
                    active={selection?.month === inspector.month}
                    target={target}
                  />
                )}
                <text x={x} y={height - 14} textAnchor="middle">
                  {monthShort(row.month)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <ChartInspector selection={selection} hint={t.tapBar} />
    </>
  );
}

function ImportMixChart({ rows }: { readonly rows: readonly MonthRow[] }) {
  const t = i18n[APP_LANG];
  const isMobile = useMediaQuery("(max-width: 820px)");
  const displayRows = useMemo(() => (isMobile ? newestFirst(rows) : rows), [isMobile, rows]);
  const inspectors = useMemo(
    () =>
      new Map(
        displayRows.map((row) => [
          row.month,
          {
            month: `${formatPeriodLabel(row)} · ${formatKwh(row.importDay + row.importNight)}`,
            items: [
              { label: t.day, value: formatKwh(row.importDay), color: colors.blue },
              { label: t.night, value: formatKwh(row.importNight), color: colors.indigo },
            ],
          },
        ]),
      ),
    [displayRows, t.day, t.night],
  );
  const latestRow = rows.at(-1);
  const { selection, target } = useChartInspector(latestRow ? inspectors.get(latestRow.month) ?? null : null);
  const width = 900;
  const height = 300;
  const pad = { left: 48, right: 18, top: 18, bottom: 42 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = axisMax(displayRows.map((row) => row.importDay + row.importNight));
  const band = chartBand(innerW, displayRows.length);
  const bar = Math.max(18, band * 0.48);
  return (
    <>
      <div className="chart-scroll">
        <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img">
          <Grid width={width} height={height} pad={pad} max={max} />
          {displayRows.map((row, index) => {
            const x = pad.left + band * index + band / 2 - bar / 2;
            const dayH = (row.importDay / max) * innerH;
            const nightH = (row.importNight / max) * innerH;
            const base = pad.top + innerH;
            const inspector = inspectors.get(row.month);
            return (
              <g key={row.month}>
                <rect
                  x={x}
                  y={base - dayH}
                  width={bar}
                  height={dayH}
                  rx="3"
                  fill={colors.blue}
                />
                <rect
                  x={x}
                  y={base - dayH - nightH}
                  width={bar}
                  height={nightH}
                  rx="3"
                  fill={colors.indigo}
                />
                {inspector && (
                  <MonthTarget
                    x={x + bar / 2 - band / 2}
                    y={pad.top}
                    width={band}
                    height={innerH}
                    selection={inspector}
                    active={selection?.month === inspector.month}
                    target={target}
                  />
                )}
                <text x={x + bar / 2} y={height - 14} textAnchor="middle">
                  {monthShort(row.month)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <ChartInspector selection={selection} hint={t.tapBar} />
    </>
  );
}

function ConsumptionMixChart({ rows }: { readonly rows: readonly MonthRow[] }) {
  const t = i18n[APP_LANG];
  const isMobile = useMediaQuery("(max-width: 820px)");
  const displayRows = useMemo(() => (isMobile ? newestFirst(rows) : rows), [isMobile, rows]);
  const inspectors = useMemo(
    () =>
      new Map(
        displayRows.map((row) => [
          row.month,
          {
            month: `${formatPeriodLabel(row)} · ${formatKwh(row.consumedDay + row.consumedNight)}`,
            items: [
              { label: t.day, value: formatKwh(row.consumedDay), color: colors.blue },
              { label: t.night, value: formatKwh(row.consumedNight), color: colors.indigo },
            ],
          },
        ]),
      ),
    [displayRows, t.day, t.night],
  );
  const latestRow = rows.at(-1);
  const { selection, target } = useChartInspector(latestRow ? inspectors.get(latestRow.month) ?? null : null);
  const width = 900;
  const height = 300;
  const pad = { left: 48, right: 18, top: 18, bottom: 42 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = axisMax(displayRows.map((row) => row.consumedDay + row.consumedNight));
  const band = chartBand(innerW, displayRows.length);
  const bar = Math.max(18, band * 0.48);
  return (
    <>
      <div className="chart-scroll">
        <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img">
          <Grid width={width} height={height} pad={pad} max={max} />
          {displayRows.map((row, index) => {
            const x = pad.left + band * index + band / 2 - bar / 2;
            const dayH = (row.consumedDay / max) * innerH;
            const nightH = (row.consumedNight / max) * innerH;
            const base = pad.top + innerH;
            const inspector = inspectors.get(row.month);
            return (
              <g key={row.month}>
                <rect
                  x={x}
                  y={base - dayH}
                  width={bar}
                  height={dayH}
                  rx="3"
                  fill={colors.blue}
                />
                <rect
                  x={x}
                  y={base - dayH - nightH}
                  width={bar}
                  height={nightH}
                  rx="3"
                  fill={colors.indigo}
                />
                {inspector && (
                  <MonthTarget
                    x={x + bar / 2 - band / 2}
                    y={pad.top}
                    width={band}
                    height={innerH}
                    selection={inspector}
                    active={selection?.month === inspector.month}
                    target={target}
                  />
                )}
                <text x={x + bar / 2} y={height - 14} textAnchor="middle">
                  {monthShort(row.month)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <ChartInspector selection={selection} hint={t.tapBar} />
    </>
  );
}

function Grid({
  width,
  height,
  pad,
  max,
  currency,
}: {
  width: number;
  height: number;
  pad: { left: number; right: number; top: number; bottom: number };
  max: number;
  currency?: Currency;
}) {
  const innerH = height - pad.top - pad.bottom;
  return (
    <g className="grid">
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
        const y = pad.top + innerH - tick * innerH;
        return (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} />
            <text x={pad.left - 10} y={y + 4} textAnchor="end">
              {formatAxisValue(max * tick, currency)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function DailyDashboard({
  rows,
  allRows,
  firstDay,
  secondDay,
  setFirstDay,
  setSecondDay,
  isCompareOpen,
  setCompareOpen,
  t,
  currency,
  lang,
  onUsdRateInfo,
  onImportPriceInfo,
  onNetPaymentHeaderInfo,
  onRoiInfo,
  onImportSplitInfo,
  onConsumedSplitInfo,
  onExportPriceInfo,
  onNetPaymentInfo,
}: {
  readonly rows: readonly MonthRow[];
  readonly allRows: readonly MonthRow[];
  readonly firstDay: string;
  readonly secondDay: string;
  readonly setFirstDay: React.Dispatch<React.SetStateAction<string>>;
  readonly setSecondDay: React.Dispatch<React.SetStateAction<string>>;
  readonly isCompareOpen: boolean;
  readonly setCompareOpen: React.Dispatch<React.SetStateAction<boolean>>;
  readonly t: Record<string, string>;
  readonly currency: Currency;
  readonly lang: Lang;
  readonly onUsdRateInfo: () => void;
  readonly onImportPriceInfo: () => void;
  readonly onNetPaymentHeaderInfo: () => void;
  readonly onRoiInfo: () => void;
  readonly onImportSplitInfo: (row: MonthRow) => void;
  readonly onConsumedSplitInfo: (row: MonthRow) => void;
  readonly onExportPriceInfo: (row: MonthRow) => void;
  readonly onNetPaymentInfo: (row: MonthRow) => void;
}) {
  const monthOptions = useMemo(
    () => [...new Map(allRows.map((row) => [monthKey(row.date), formatMonthYear(row.date, lang)])).entries()].reverse(),
    [allRows, lang],
  );
  const [dailyMonthFilter, setDailyMonthFilter] = useState(monthOptions[0]?.[0] ?? "all");
  const selectedRows = useMemo(
    () => allRows.filter((row) => dailyMonthFilter === "all" || monthKey(row.date) === dailyMonthFilter),
    [allRows, dailyMonthFilter],
  );
  const latest = selectedRows.at(-1);
  const chartRows = selectedRows.length ? selectedRows : rows.length ? rows : allRows.slice(-30);
  const dayOptions = useMemo(() => [...selectedRows].reverse(), [selectedRows]);
  const first = selectedRows.find((row) => row.month === firstDay) ?? selectedRows.at(-2) ?? selectedRows.at(-1);
  const second = selectedRows.find((row) => row.month === secondDay) ?? selectedRows.at(-1);
  const paymentDisplay = latest ? moneyFromUah(latest.electricityPayment, currency, latest.usdRate) : 0;
  const roiDisplay = latest ? rowRoiMoney(latest, currency) : 0;

  useEffect(() => {
    if (!monthOptions.length) return;
    if (dailyMonthFilter !== "all" && !monthOptions.some(([key]) => key === dailyMonthFilter)) {
      setDailyMonthFilter(monthOptions[0][0]);
    }
  }, [dailyMonthFilter, monthOptions]);

  useEffect(() => {
    if (!isCompareOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCompareOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isCompareOpen]);

  if (!allRows.length) {
    return (
      <div className="notice">
        <strong>{t.noDailyData}</strong>
      </div>
    );
  }

  return (
    <>
      {latest && (
        <section className="kpi-grid daily-kpi-grid">
          <KpiCard
            icon={<SunMedium size={20} />}
            label={t.production}
            value={formatKwh(latest.production, lang)}
            detail={formatDayLabel(latest.date, lang)}
            tone="amber"
          />
          <KpiCard
            icon={<ArrowUpFromLine size={20} />}
            label={t.export}
            value={formatKwh(latest.export, lang)}
            detail={`${pct((latest.export / latest.production) * 100)} ${t.exported}`}
            tone="mint"
          />
          <KpiCard
            icon={<ArrowDownToLine size={20} />}
            label={t.import}
            value={formatKwh(latest.importTotal, lang)}
            detail={`${t.day} ${formatKwh(latest.importDay, lang)} · ${t.night} ${formatKwh(latest.importNight, lang)}`}
            tone="blue"
          />
          <KpiCard
            icon={<WalletCards size={20} />}
            label={t.latestRoi}
            value={formatDisplayMoney(roiDisplay, currency, lang)}
            detail={`${t.net} ${formatDisplayMoney(paymentDisplay, currency, lang)}`}
            tone={paymentDisplay >= 0 ? "green" : "rose"}
          />
        </section>
      )}

      {isCompareOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setCompareOpen(false)}>
          <section
            className="daily-compare modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="daily-compare-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="section-heading modal-heading">
              <div>
                <h2 id="daily-compare-title">{t.compareDays}</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setCompareOpen(false)} aria-label={t.close}>
                <X size={18} />
              </button>
            </div>
            <div className="filter-controls daily-selects">
              <label className="filter-box">
                <select value={first?.month ?? ""} onChange={(event) => setFirstDay(event.target.value)} aria-label={t.firstDay}>
                  {dayOptions.map((row) => (
                    <option key={row.month} value={row.month}>
                      {formatDayLabel(row.date, lang)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-box">
                <select value={second?.month ?? ""} onChange={(event) => setSecondDay(event.target.value)} aria-label={t.secondDay}>
                  {dayOptions.map((row) => (
                    <option key={row.month} value={row.month}>
                      {formatDayLabel(row.date, lang)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {first && second && <DailyCompareTable first={first} second={second} t={t} currency={currency} lang={lang} />}
          </section>
        </div>
      )}

      <section id="energy" className="chart-grid">
        <ChartPanel
          title={t.production}
          legend={[
            [t.production, colors.amber],
            [t.export, colors.green],
          ]}
        >
          <ProductionExportChart rows={chartRows} />
        </ChartPanel>
        <ChartPanel
          title={t.finance}
          legend={[
            [t.savings, colors.mint],
            [t.payment, colors.green],
          ]}
        >
          <MoneyChart rows={chartRows} currency={currency} />
        </ChartPanel>
      </section>

      <section id="finance" className="chart-grid">
        <ChartPanel
          title={t.consumptionMix}
          legend={[
            [t.day, colors.blue],
            [t.night, colors.indigo],
          ]}
        >
          <ConsumptionMixChart rows={chartRows} />
        </ChartPanel>
        <ChartPanel
          title={t.importMix}
          legend={[
            [t.day, colors.blue],
            [t.night, colors.indigo],
          ]}
        >
          <ImportMixChart rows={chartRows} />
        </ChartPanel>
      </section>

      <section id="data" className="data-section">
        <div className="section-heading">
          <div>
            <h2>{t.table}</h2>
          </div>
          <div className="filter-controls" aria-label={t.filterMonth}>
            <label className="filter-box">
              <select value={dailyMonthFilter} onChange={(event) => setDailyMonthFilter(event.target.value)}>
                <option value="all">{t.allMonths}</option>
                {monthOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <DataTable
          rows={selectedRows}
          period="daily"
          t={t}
          currency={currency}
          lang={lang}
          onUsdRateInfo={onUsdRateInfo}
          onImportPriceInfo={onImportPriceInfo}
          onNetPaymentHeaderInfo={onNetPaymentHeaderInfo}
          onRoiInfo={onRoiInfo}
          onImportSplitInfo={onImportSplitInfo}
          onConsumedSplitInfo={onConsumedSplitInfo}
          onExportPriceInfo={onExportPriceInfo}
          onNetPaymentInfo={onNetPaymentInfo}
        />
      </section>
    </>
  );
}

function DailyCompareTable({
  first,
  second,
  t,
  currency,
  lang,
}: {
  first: MonthRow;
  second: MonthRow;
  t: Record<string, string>;
  currency: Currency;
  lang: Lang;
}) {
  const firstPayment = moneyFromUah(first.electricityPayment, currency, first.usdRate);
  const secondPayment = moneyFromUah(second.electricityPayment, currency, second.usdRate);
  const rows = [
    {
      label: t.production,
      first: formatKwh(first.production, lang),
      second: formatKwh(second.production, lang),
      delta: formatSignedKwh(second.production - first.production, lang),
      firstValue: first.production,
      secondValue: second.production,
      value: second.production - first.production,
      higherIsBetter: true,
    },
    {
      label: t.export,
      first: formatKwh(first.export, lang),
      second: formatKwh(second.export, lang),
      delta: formatSignedKwh(second.export - first.export, lang),
      firstValue: first.export,
      secondValue: second.export,
      value: second.export - first.export,
      higherIsBetter: true,
    },
    {
      label: t.import,
      first: formatKwh(first.importTotal, lang),
      second: formatKwh(second.importTotal, lang),
      delta: formatSignedKwh(second.importTotal - first.importTotal, lang),
      firstValue: first.importTotal,
      secondValue: second.importTotal,
      value: second.importTotal - first.importTotal,
      higherIsBetter: false,
    },
    {
      label: t.consumed,
      first: formatKwh(first.consumedTotal, lang),
      second: formatKwh(second.consumedTotal, lang),
      delta: formatSignedKwh(second.consumedTotal - first.consumedTotal, lang),
      firstValue: first.consumedTotal,
      secondValue: second.consumedTotal,
      value: second.consumedTotal - first.consumedTotal,
      higherIsBetter: false,
    },
    {
      label: t.netPayment,
      first: formatDisplayMoney(firstPayment, currency, lang),
      second: formatDisplayMoney(secondPayment, currency, lang),
      delta: formatSignedMoney(secondPayment - firstPayment, currency, lang),
      firstValue: firstPayment,
      secondValue: secondPayment,
      value: secondPayment - firstPayment,
      higherIsBetter: true,
    },
    {
      label: t.roi,
      first: formatDisplayMoney(rowRoiMoney(first, currency), currency, lang),
      second: formatDisplayMoney(rowRoiMoney(second, currency), currency, lang),
      delta: formatSignedMoney(rowRoiMoney(second, currency) - rowRoiMoney(first, currency), currency, lang),
      firstValue: rowRoiMoney(first, currency),
      secondValue: rowRoiMoney(second, currency),
      value: rowRoiMoney(second, currency) - rowRoiMoney(first, currency),
      higherIsBetter: true,
    },
  ];

  return (
    <div className="compare-cards">
      {rows.map((row) => {
        const tone =
          row.value === 0 ? "muted" : row.higherIsBetter ? (row.value > 0 ? "positive" : "negative") : row.value < 0 ? "positive" : "negative";
        const chartMax = Math.max(Math.abs(row.firstValue), Math.abs(row.secondValue), 1);
        const chartStyle = {
          "--first-level": `${Math.max(8, (Math.abs(row.firstValue) / chartMax) * 100)}%`,
          "--second-level": `${Math.max(8, (Math.abs(row.secondValue) / chartMax) * 100)}%`,
        } as React.CSSProperties;
        return (
          <article className="compare-card" key={row.label} style={chartStyle}>
            <div className="compare-card-chart" aria-hidden="true">
              <i />
              <i />
            </div>
            <div className="compare-card-head">
              <h3>{row.label}</h3>
              <b className={tone}>
                <span>Δ</span>
                {row.delta}
                {formatDeltaPct(row.value, row.firstValue)}
              </b>
            </div>
            <div className="compare-card-values">
              <span>
                <b>{row.first}</b>
                <small>{formatDayLabel(first.date, lang)}</small>
              </span>
              <span>
                <b>{row.second}</b>
                <small>{formatDayLabel(second.date, lang)}</small>
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function DataTable({
  rows,
  period,
  t,
  currency,
  lang,
  onUsdRateInfo,
  onImportPriceInfo,
  onNetPaymentHeaderInfo,
  onRoiInfo,
  onImportSplitInfo,
  onConsumedSplitInfo,
  onExportPriceInfo,
  onNetPaymentInfo,
}: {
  readonly rows: readonly MonthRow[];
  readonly period: "monthly" | "daily";
  readonly t: Record<string, string>;
  readonly currency: Currency;
  readonly lang: Lang;
  readonly onUsdRateInfo: () => void;
  readonly onImportPriceInfo: () => void;
  readonly onNetPaymentHeaderInfo: () => void;
  readonly onRoiInfo: () => void;
  readonly onImportSplitInfo: (row: MonthRow) => void;
  readonly onConsumedSplitInfo: (row: MonthRow) => void;
  readonly onExportPriceInfo: (row: MonthRow) => void;
  readonly onNetPaymentInfo: (row: MonthRow) => void;
}) {
  const newestFirst = [...rows].sort((a, b) => b.date.getTime() - a.date.getTime());
  const kwh = energyUnit(lang);
  const money = currencyUnit(currency);
  const totals = rows.reduce(
    (sum, row) => ({
      production: sum.production + row.production,
      export: sum.export + row.export,
      importTotal: sum.importTotal + row.importTotal,
      consumedTotal: sum.consumedTotal + row.consumedTotal,
      balance: sum.balance + row.balance,
      electricityPayment: sum.electricityPayment + moneyFromUah(row.electricityPayment, currency, row.usdRate),
      roi: sum.roi + rowRoiMoney(row, currency),
    }),
    {
      production: 0,
      export: 0,
      importTotal: 0,
      consumedTotal: 0,
      balance: 0,
      electricityPayment: 0,
      roi: 0,
    },
  );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <Th label={period === "daily" ? t.tableDay : t.month} />
            <Th label={`${t.production} (${kwh})`} />
            <Th label={`${t.export} (${kwh})`} />
            <Th label={`${t.import} (${kwh})`} />
            <Th label={`${t.consumed} (${kwh})`} />
            <Th label={`${t.balance} (${kwh})`} />
            <Th label={`${t.netExport} (${money}/${kwh})`} />
            <Th label={`${t.import} (${money}/${kwh})`} infoLabel={t.import} onInfo={onImportPriceInfo} />
            <Th label={`${t.netPayment} (${money})`} infoLabel={t.netPayment} onInfo={onNetPaymentHeaderInfo} />
            <Th label={`${t.roi} (${money})`} infoLabel={t.roi} onInfo={onRoiInfo} />
            <Th label="USD/UAH" infoLabel="USD/UAH" onInfo={onUsdRateInfo} />
          </tr>
        </thead>
        <tbody>
          {newestFirst.map((row) => (
            <tr key={row.month}>
              <th>{period === "daily" ? formatDayMonthLabel(row.date, lang) : row.month}</th>
              <td>{formatNumber(row.production, 2, 2)}</td>
              <td>{formatNumber(row.export, 2, 2)}</td>
              <td>
                <TableValueInfo value={formatNumber(row.importTotal, 2, 2)} label={t.import} onInfo={() => onImportSplitInfo(row)} />
              </td>
              <td>
                <TableValueInfo value={formatNumber(row.consumedTotal, 2, 2)} label={t.consumed} onInfo={() => onConsumedSplitInfo(row)} />
              </td>
              <td className={row.balance < 0 ? "positive" : row.balance > 0 ? "negative" : "muted"}>
                {formatNumber(row.balance, 2, 2)}
              </td>
              <td>
                <TableValueInfo
                  value={formatTableMoney(moneyFromUah(netExportPrice(row), currency, row.usdRate), currency, lang)}
                  label={t.exportPrice}
                  onInfo={() => onExportPriceInfo(row)}
                />
              </td>
              <td>{formatTableMoney(moneyFromUah(row.importPriceDay, currency, row.usdRate), currency, lang)} / {formatTableMoney(moneyFromUah(row.importPriceNight, currency, row.usdRate), currency, lang)}</td>
              <td className={row.electricityPayment >= 0 ? "positive" : "negative"}>
                <TableValueInfo
                  value={formatTableMoney(moneyFromUah(row.electricityPayment, currency, row.usdRate), currency, lang)}
                  label={t.netPayment}
                  onInfo={() => onNetPaymentInfo(row)}
                />
              </td>
              <td className="positive">{formatTableMoney(rowRoiMoney(row, currency), currency, lang)}</td>
              <td>{formatNumber(row.usdRate, 2, 2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>{t.total}</th>
            <td>{formatNumber(totals.production, 2, 2)}</td>
            <td>{formatNumber(totals.export, 2, 2)}</td>
            <td>{formatNumber(totals.importTotal, 2, 2)}</td>
            <td>{formatNumber(totals.consumedTotal, 2, 2)}</td>
            <td className={totals.balance < 0 ? "positive" : totals.balance > 0 ? "negative" : "muted"}>
              {formatNumber(totals.balance, 2, 2)}
            </td>
            <td className="muted">-</td>
            <td className="muted">-</td>
            <td className={totals.electricityPayment >= 0 ? "positive" : "negative"}>
              {formatTableMoney(totals.electricityPayment, currency, lang)}
            </td>
            <td className="positive">{formatTableMoney(totals.roi, currency, lang)}</td>
            <td className="muted">-</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function TableValueInfo({
  value,
  label,
  onInfo,
}: {
  readonly value: string;
  readonly label: string;
  readonly onInfo: () => void;
}) {
  return (
    <span className="table-value-info">
      {value}
      <button type="button" className="table-info-button" aria-label={label} onClick={onInfo}>
        <Info size={14} />
      </button>
    </span>
  );
}

function SplitInfo({
  t,
  lang,
  total,
  day,
  night,
}: {
  readonly t: Record<string, string>;
  readonly lang: Lang;
  readonly total: number;
  readonly day: number;
  readonly night: number;
}) {
  return (
    <dl className="split-info">
      <div>
        <dt>{t.total}</dt>
        <dd>{formatKwh(total, lang)}</dd>
      </div>
      <div>
        <dt>{t.day}</dt>
        <dd>{formatKwh(day, lang)}</dd>
      </div>
      <div>
        <dt>{t.night}</dt>
        <dd>{formatKwh(night, lang)}</dd>
      </div>
    </dl>
  );
}

function PriceInfo({
  rows,
}: {
  readonly rows: readonly {
    readonly label: string;
    readonly value: string;
  }[];
}) {
  return (
    <dl className="split-info">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function NetPaymentInfo({
  row,
  t,
  currency,
  lang,
}: {
  readonly row: MonthRow;
  readonly t: Record<string, string>;
  readonly currency: Currency;
  readonly lang: Lang;
}) {
  const displayMoney = (value: number) => formatDisplayMoney(moneyFromUah(value, currency, row.usdRate), currency, lang);
  const displayMoneyMath = (value: number): React.ReactNode => {
    const converted = displayMoney(value);
    if (currency === "UAH") return <FormulaResult>{converted}</FormulaResult>;
    return (
      <>
        {formatMoney(value, "UAH", lang)} / {formatNumber(row.usdRate, 2, 2)} = <FormulaResult>{converted}</FormulaResult>
      </>
    );
  };
  const importTotalValue = Math.max(row.importTotal, 0);
  const dayCost = row.consumedDay * row.importPriceDay;
  const nightCost = row.consumedNight * row.importPriceNight;
  const inputRows: MathInfoRow[] = [
    {
      label: t.formulaInputs,
      value: (
        <StackedValues
          rows={[
            { label: t.import, value: `${formatKwh(row.importTotal, lang)} (${formatKwh(row.importDay, lang)} / ${formatKwh(row.importNight, lang)})` },
            { label: t.export, value: formatKwh(row.export, lang) },
            { label: t.balance, value: formatKwh(row.balance, lang) },
            { label: t.consumed, value: `${formatKwh(row.consumedTotal, lang)} (${formatKwh(row.consumedDay, lang)} / ${formatKwh(row.consumedNight, lang)})` },
          ]}
        />
      ),
    },
    {
      label: t.importPrices,
      value: (
        <StackedValues
          rows={[
            { label: t.day, value: `${displayMoney(row.importPriceDay)} / ${energyUnit(lang)}` },
            { label: t.night, value: `${displayMoney(row.importPriceNight)} / ${energyUnit(lang)}` },
          ]}
        />
      ),
    },
    {
      label: t.exportPriceInput,
      value: (
        <StackedValues
          rows={[
            { label: t.grossExportPrice, value: `${displayMoney(row.exportPrice)} / ${energyUnit(lang)}` },
            { label: t.vat, value: `${formatNumber(row.exportVat, 2, 2)}%` },
            { label: t.militaryTax, value: `${formatNumber(row.exportMilitary, 2, 2)}%` },
            { label: t.netExportPrice, value: `${displayMoney(netExportPrice(row))} / ${energyUnit(lang)}` },
          ]}
        />
      ),
    },
  ];
  const rows: MathInfoRow[] = [
    ...inputRows,
    {
      label: t.electricityCostWithoutSolar,
      value: (
        <StackedValues
          rows={[
            {
              label: t.day,
              value: (
                <>
                  {displayMoneyMath(dayCost)} = {formatKwh(row.consumedDay, lang)} × {displayMoney(row.importPriceDay)}
                </>
              ),
            },
            {
              label: t.night,
              value: (
                <>
                  {displayMoneyMath(nightCost)} = {formatKwh(row.consumedNight, lang)} × {displayMoney(row.importPriceNight)}
                </>
              ),
            },
            {
              label: t.total,
              value: (
                <>
                  {displayMoneyMath(row.consumedPayment)} = {displayMoney(dayCost)} + {displayMoney(nightCost)}
                </>
              ),
            },
          ]}
        />
      ),
    },
  ];

  if (!row.isCommercial) {
    rows.push(
      {
        label: t.exportedOffset,
        value: `${t.exportUnpaid}: ${formatKwh(row.export, lang)} → ${displayMoney(0)}`,
      },
      {
        label: t.netPayment,
        value: (
          <>
            {displayMoneyMath(row.electricityPayment)} = -({formatKwh(row.importDay, lang)} × {displayMoney(row.importPriceDay)} + {formatKwh(row.importNight, lang)} × {displayMoney(row.importPriceNight)})
          </>
        ),
      },
    );
  } else if (row.balance < 0) {
    const surplus = Math.abs(row.balance);
    rows.push(
      {
        label: t.netSurplus,
        value: (
          <>
            <FormulaResult>{formatKwh(surplus, lang)}</FormulaResult> = {formatKwh(row.export, lang)} - {formatKwh(row.importTotal, lang)}
          </>
        ),
      },
      {
        label: t.netPayment,
        value: (
          <>
            {displayMoneyMath(row.electricityPayment)} = {formatKwh(surplus, lang)} × {displayMoney(netExportPrice(row))}
          </>
        ),
      },
    );
  } else if (importTotalValue <= 0) {
    rows.push({
      label: t.netPayment,
      value: displayMoneyMath(row.electricityPayment),
    });
  } else {
    const dayShare = row.importDay / importTotalValue;
    const nightShare = row.importNight / importTotalValue;
    const coveredDay = row.export * dayShare;
    const coveredNight = row.export * nightShare;
    const coveredTotal = coveredDay + coveredNight;
    const remainingDay = row.importDay - coveredDay;
    const remainingNight = row.importNight - coveredNight;
    const remainingTotal = remainingDay + remainingNight;
    rows.push(
      {
        label: t.exportedOffset,
        value: (
          <StackedValues
            rows={[
              {
                label: t.day,
                value: (
                  <>
                    <FormulaResult>{formatKwh(coveredDay, lang)}</FormulaResult> = {formatKwh(row.export, lang)} × {formatNumber(dayShare * 100, 2, 2)}% ({formatKwh(row.importDay, lang)} / {formatKwh(row.importTotal, lang)})
                  </>
                ),
              },
              {
                label: t.night,
                value: (
                  <>
                    <FormulaResult>{formatKwh(coveredNight, lang)}</FormulaResult> = {formatKwh(row.export, lang)} × {formatNumber(nightShare * 100, 2, 2)}% ({formatKwh(row.importNight, lang)} / {formatKwh(row.importTotal, lang)})
                  </>
                ),
              },
              {
                label: t.total,
                value: (
                  <>
                    <FormulaResult>{formatKwh(coveredTotal, lang)}</FormulaResult> = {formatKwh(coveredDay, lang)} + {formatKwh(coveredNight, lang)}
                  </>
                ),
              },
            ]}
          />
        ),
      },
      {
        label: t.remainingImport,
        value: (
          <StackedValues
            rows={[
              {
                label: t.day,
                value: (
                  <>
                    <FormulaResult>{formatKwh(remainingDay, lang)}</FormulaResult> = {formatKwh(row.importDay, lang)} - {formatKwh(coveredDay, lang)}
                  </>
                ),
              },
              {
                label: t.night,
                value: (
                  <>
                    <FormulaResult>{formatKwh(remainingNight, lang)}</FormulaResult> = {formatKwh(row.importNight, lang)} - {formatKwh(coveredNight, lang)}
                  </>
                ),
              },
              {
                label: t.total,
                value: (
                  <>
                    <FormulaResult>{formatKwh(remainingTotal, lang)}</FormulaResult> = {formatKwh(remainingDay, lang)} + {formatKwh(remainingNight, lang)}
                  </>
                ),
              },
            ]}
          />
        ),
      },
      {
        label: t.netPayment,
        value: (
          <>
            {displayMoneyMath(row.electricityPayment)} = -({formatKwh(remainingDay, lang)} × {displayMoney(row.importPriceDay)} + {formatKwh(remainingNight, lang)} × {displayMoney(row.importPriceNight)})
          </>
        ),
      },
    );
  }

  return <MathInfo rows={rows} />;
}

function MathInfo({
  rows,
}: {
  readonly rows: readonly MathInfoRow[];
}) {
  return (
    <dl className="math-info">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface MathInfoRow {
  readonly label: string;
  readonly value: React.ReactNode;
}

function StackedValues({
  rows,
}: {
  readonly rows: readonly {
    readonly label: string;
    readonly value: React.ReactNode;
  }[];
}) {
  return (
    <span className="stacked-values">
      {rows.map((row) => (
        <span key={row.label}>
          <b>{row.label}</b>
          <span>{row.value}</span>
        </span>
      ))}
    </span>
  );
}

function FormulaResult({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return <mark className="formula-result">{children}</mark>;
}

function Th({
  label,
  infoLabel,
  onInfo,
}: {
  readonly label: string;
  readonly infoLabel?: string;
  readonly onInfo?: () => void;
}) {
  return (
    <th>
      <span className="table-heading">
        {label}
        {onInfo ? (
          <button type="button" className="table-info-button" aria-label={infoLabel ?? label} onClick={onInfo}>
            <Info size={14} />
          </button>
        ) : null}
      </span>
    </th>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
