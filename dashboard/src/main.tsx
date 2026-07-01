import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  CircleDollarSign,
  GitCompareArrows,
  Info,
  LogOut,
  RefreshCw,
  SunMedium,
  WalletCards,
  X,
} from "lucide-react";
import { configureDashboardAccess, loadDashboardData, loadPlantData, loadPlantGranularity } from "./data/supabase";
import { API_URL, APP_MODE, FORECAST_LATITUDE, FORECAST_LONGITUDE, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { moneyFromUah, moneyFromUsd, rowRoiMoney, sumRowsFromUah, sumRowsRoiMoney, type Currency } from "./domain/money";
import { calculateCommercialEndRecovery, calculatePayback } from "./domain/payback";
import { calculateForecast } from "./domain/forecast";
import {
  capacityAdjustedProductionSurplus,
  capacityDeltaPct,
  exportPayout as splitExportPayout,
  exportTotal,
  importCostBreakdown,
  importEnergyCost,
  plantCapacityKwp,
  productionYieldKwhPerKwp,
  regularImportDayPrice,
  regularImportNightPrice,
  type ImportCostBreakdown,
} from "./domain/formulas";
import type { DataState, LoadedData, MonthRow, PlantComparison, PlantMetadata, ProductionProjection, PvMetadata, Tariff } from "./domain/types";
import "./styles.css";

type RangeKey = "all" | "range";
type ViewMode = "monthly" | "daily" | "comparison";
type PlantComparisonMode = "daily" | "monthly";
type Lang = "en" | "uk";
interface PlantComparisonResult {
  readonly mode: PlantComparisonMode;
  readonly month: string;
  readonly year: string;
  readonly plants: readonly PlantComparison[];
}
type InfoModal =
  | "latestRoi"
  | "netPayment"
  | "totalProduction"
  | "totalExport"
  | "totalImport"
  | "usdRate"
  | "importPrice"
  | "roi"
  | "forecast"
  | "investment"
  | "investmentForecast"
  | "plantWorks"
  | "pvgis"
  | {
    readonly kind: "importSplit" | "exportSplit" | "consumedSplit" | "exportPrice" | "netPayment" | "roiCalc" | "utilityMeter";
    readonly row: MonthRow;
  }
  | {
    readonly kind: "comparisonDelta";
    readonly title: string;
    readonly body: React.ReactNode;
  };

interface DashboardDataState extends DataState {
  readonly isRefreshing: boolean;
  readonly refresh: () => Promise<LoadedData | undefined>;
}

type DashboardDataHookState = Omit<DashboardDataState, "refresh">;
type AuthMode = "sign-in" | "sign-up" | "recover" | "reset";
interface PortalSession {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_at?: number;
  readonly user?: PortalUser;
}

interface PortalUser {
  readonly id: string;
  readonly email?: string;
  readonly confirmed_at?: string | null;
  readonly email_confirmed_at?: string | null;
}

interface PortalPlant {
  readonly id: string;
  readonly domain?: string | null;
  readonly metadata?: PlantMetadata | null;
}

interface PortalAuthResponse {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly user?: PortalUser;
  readonly error?: string;
  readonly error_description?: string;
  readonly msg?: string;
}

interface PortalAccessResponse {
  readonly ok: boolean;
  readonly plants?: readonly PortalPlant[];
  readonly message?: string;
}

interface PortalCopy {
  readonly brand: string;
  readonly signIn: string;
  readonly signUp: string;
  readonly email: string;
  readonly password: string;
  readonly newPassword: string;
  readonly enter: string;
  readonly create: string;
  readonly savePassword: string;
  readonly needAccount: string;
  readonly haveAccount: string;
  readonly forgotPassword: string;
  readonly resetPassword: string;
  readonly resetSent: string;
  readonly passwordUpdated: string;
  readonly waitingTitle: string;
  readonly waitingCopy: string;
  readonly noPlantsTitle: string;
  readonly noPlantsCopy: string;
  readonly portalTagline: string;
  readonly open: string;
  readonly signOut: string;
  readonly loading: string;
  readonly switchPlant: string;
  readonly missingDomain: string;
  readonly configMissing: string;
  readonly sessionExpired: string;
  readonly retry: string;
}

const COMMERCIAL_PERIOD_END_DATE = new Date("2030-01-01T00:00:00");

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
    expected: "Expected",
    expectedProduction: "Expected production",
    expectedRoi: "Expected ROI",
    expectedIncome: "Expected income",
    soFar: "so far",
    forecastInfo: "Forecast values use the current month daylight pace plus PVGIS seasonal production data when available. PVGIS gives the expected month shape; recent completed months correct it to this plant's real performance. ROI and income follow the projected production scale. The colored comparison shows the projected value against the previous month's actual value.",
    pvgisInfo: "PVGIS estimates expected solar production from long-term satellite radiation data, not from this year's weather. It models the sun path for the plant location, panel tilt and azimuth, horizon shading, system power, module technology, mounting type, and configured losses. The result is a typical monthly average. Real production can differ because of clouds, fog, snow cover, dust or dirt, temporary shadows, nearby trees or buildings, inverter limits, outages, maintenance, panel degradation, and unusually sunny or gloomy months.",
    pvgisFields: "PV fields",
    power: "Power",
    azimuth: "Azimuth",
    slope: "Slope",
    loss: "Loss",
    mounting: "Mounting",
    location: "Location",
    elevation: "Elevation",
    plantComparison: "Plant comparison",
    compareDaily: "Daily",
    compareMonthly: "Monthly",
    activePlant: "current",
    compare: "Compare",
    compareFirstPlant: "First plant",
    compareSecondPlant: "Second plant",
    compareDate: "Date",
    compareMonth: "Month",
    compareYear: "Year",
    comparisonHint: "Select two plants and a period to compare performance.",
    comparisonUnavailable: "No other assigned plants yet. Ask admin to assign another plant for comparison.",
    latestRoi: "Latest ROI",
    latestRoiInfo: "ROI shows how much investment was effectively recovered during the latest month. It includes the value of electricity consumed from your own solar production plus any export income, minus grid electricity costs. Net payment is only the cash balance for the month: export income minus grid electricity costs.",
    refresh: "Refresh",
    cumulative: "Cumulative",
    production: "Production",
    totalProduction: "Total production",
    totalProductionKpi: "Production",
    totalProductionCostInfoDetails: "This hypothetical value treats every produced kWh as sold at its own month's export price after VAT and military tax. In USD mode, each month is converted using that month's USD/UAH rate.",
    exported: "export",
    export: "Export",
    totalExport: "Total export",
    totalExportKpi: "Export",
    totalExportCostInfoDetails: "The payout is calculated from net exported surplus after the monthly import/export balance, using each month's export price after VAT and military tax.",
    latest: "Latest",
    gridImport: "Import",
    totalImport: "Total import",
    totalImportKpi: "Import",
    totalImportCostInfoDetails: "Day imports are calculated with each month's day import rate, night imports with each month's night import rate.",
    solarCoverage: "solar",
    net: "Net",
    netPayment: "Net payment",
    totalNetPayment: "Total net payment",
    totalNetPaymentKpi: "Net payment",
    electricityCostWithoutSolar: "Electricity cost without solar",
    formulaInputs: "Inputs",
    importPrices: "Import prices",
    exportPriceInput: "Export prices",
    after: "After",
    usdRate: "USD/UAH rate",
    taxes: "Taxes",
    dayCost: "Day cost",
    nightCost: "Night cost",
    electricHeatingTier: "Electric heating tier",
    regularTier: "Regular tier",
    electricHeatingThreshold: "Electric heating threshold",
    exportedOffset: "Export offset",
    beforeCommercialDate: "Before commercial date",
    fromCommercialDate: "From commercial date",
    remainingImport: "Remaining import",
    netSurplus: "Net surplus",
    exportUnpaid: "Export is unpaid before the commercial date",
    netPaymentLogic: "Net payment is the cash result of monthly import/export balancing. Balance is import minus export. If export is larger than import, the balance is negative and the net surplus is paid using the export price after VAT and military tax. Otherwise, export offsets import proportionally between day and night import, then the remaining day/night import is charged at its own rate.",
    netPaymentInfo: "UAH totals are summed directly. In USD mode, each month is converted using that month's USD/UAH rate, then those converted values are summed. It is not the UAH total divided by the latest rate.",
    usdRateInfo: "Monthly USD/UAH is the latest daily USD/UAH rate stored for that month. If a month has no daily rates, the dashboard uses the manually stored monthly USD/UAH fallback.",
    importPriceInfo: "Import prices are shown as day / night. Day is the rate from 7 AM to 11 PM; night is the rate from 11 PM to 7 AM.",
    roiInfo: "ROI is not production multiplied by export price. It is the effective investment recovery for the period: the value of electricity consumed from the solar system plus export payout when commercial export is active, minus grid import costs. Before the commercial date, export is unpaid and does not offset import, so ROI is based only on inferred self-consumed solar energy: production minus export, valued by the weighted day/night import rate.",
    savings: "Savings",
    plantWorks: "Plant works",
    sinceLaunch: "since",
    launchDate: "Launch date",
    commercialDate: "Commercial date",
    commercialEndDate: "Commercial period end",
    plantWorksInfo: "Plant age is counted from the launch date. Paid commercial export runs from the commercial date until the commercial period end. After that, net billing is expected: export money becomes a virtual balance, and kWh prices will vary by hour instead of using one fixed payout rate.",
    investmentRecovered: "investment recovered",
    recoverableByCommercialEnd: "Possible recovery by commercial period end",
    pvgisAdjustedForecast: "PVGIS-adjusted forecast",
    commercialRecoveryCalcInfo: "Forecast uses annual production, fixed annual consumption, current tariff rules, and month rates. Before the commercial date only self-consumption counts. During the commercial period, surplus is paid. After the commercial period, net billing is treated as closing the same 17 MWh/year internally, so electricity is still avoided but surplus has no cash payout.",
    annualProduction: "Annual production",
    annualConsumption: "Annual consumption",
    annualSurplus: "Annual surplus",
    commercialPeriod: "Commercial period",
    commercialPeriodRange: "Commercial period from {from} to {to}.",
    postCommercialAssumption: "Once the commercial period ends, the estimate assumes annual self-sufficiency: peak sun season surplus covers fall and winter import through net billing.",
    paybackForecast: "Payback forecast",
    paybackDate: "Date",
    totalPaybackTime: "Total time",
    remainingPaybackTime: "Time left",
    productionSource: "Source",
    pvgisSource: "PVGIS, no closed years yet",
    closedYearSource: "1 closed year",
    closedYearAverageSource: "closed year average",
    actualFallbackSource: "actual rows fallback",
    consumptionValue: "Value",
    surplusValue: "Payout",
    noCashPayout: "No cash payout after commercial period end",
    expectedPaidExport: "Expected paid export",
    expectedSelfConsumption: "Expected self-consumption",
    expectedPostCommercialSelfConsumption: "Post-commercial self-consumption",
    projectedRoiDate: "Projected ROI date",
    postCommercialNetBilling: "Post-commercial net billing",
    investmentInfo: "The USD value is the stored plant investment. In UAH mode, the dashboard converts that USD investment using the USD/UAH rate from the plant launch month, because that represents the original hryvnia cost basis.",
    payback: "Payback",
    recovered: "recovered",
    remaining: "remaining",
    currentAverage: "at the current pace",
    addInvestment: "Add investment cost",
    investmentHelp: "Set the installed system cost to turn monthly ROI into a payback projection.",
    investment: "Investment",
    roiTrajectory: "ROI trajectory",
    importMix: "Import",
    consumptionMix: "Consumption",
    utilityMeter: "Utility meter",
    dashboardValues: "Dashboard values",
    meterValues: "Meter values",
    usedForCalculations: "Meter values are distributed across existing daily rows before monthly calculations. The adjustment is even while no day goes below zero; otherwise it is proportional to the original daily values.",
    electricityPayment: "Electricity payment",
    payment: "Payment",
    table: "Data table",
    filterMonth: "Filter month",
    range: "Range",
    from: "From",
    to: "To",
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
    militaryTax: "Military",
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
    expected: "Очікувано",
    expectedProduction: "Очікувана генерація",
    expectedRoi: "Очікуване ПІ",
    expectedIncome: "Очікуваний дохід",
    soFar: "зараз",
    forecastInfo: "Прогноз використовує поточний темп світлового дня та сезонні дані PVGIS, якщо вони доступні. PVGIS дає очікувану форму місяця, а останні завершені місяці коригують її під фактичну роботу цієї станції. ПІ та дохід ідуть за масштабом прогнозованої генерації. Кольорове порівняння показує прогноз проти факту попереднього місяця.",
    pvgisInfo: "PVGIS рахує очікувану генерацію за довгостроковими супутниковими даними сонячної радіації, а не за погодою саме цього року. Він моделює шлях сонця для локації станції, нахил і азимут панелей, горизонт, потужність системи, тип модуля, монтаж і задані втрати. Результат — типовий середній місяць. Фактична генерація може відрізнятись через хмари, туман, сніг на панелях, пил чи бруд, тимчасові тіні, дерева або будівлі поруч, обмеження інвертора, відключення, обслуговування, деградацію панелей і нетипово сонячні чи похмурі місяці.",
    pvgisFields: "Фотоелектричні поля",
    power: "Потужність",
    azimuth: "Азимут",
    slope: "Нахил",
    loss: "Втрати",
    mounting: "Монтаж",
    location: "Локація",
    elevation: "Висота",
    plantComparison: "Порівняння станцій",
    compareDaily: "Дні",
    compareMonthly: "Місяці",
    activePlant: "поточна",
    compare: "Порівняти",
    compareFirstPlant: "Перша станція",
    compareSecondPlant: "Друга станція",
    compareDate: "Дата",
    compareMonth: "Місяць",
    compareYear: "Рік",
    comparisonHint: "Оберіть дві станції та період для порівняння показників.",
    comparisonUnavailable: "Інші станції ще не привязані. Попросіть адміна додати ще одну станцію для порівняння.",
    latestRoi: "Останнє ПІ",
    latestRoiInfo: "ПІ показує, скільки інвестиції фактично повернулось за останній місяць. Воно включає вартість електроенергії, спожитої з власної генерації, плюс дохід від експорту, мінус витрати на електроенергію з мережі. Баланс — це лише грошовий результат місяця: дохід від експорту мінус витрати на електроенергію з мережі.",
    refresh: "Оновити",
    cumulative: "Сумарно",
    production: "Генерація",
    totalProduction: "Загальна генерація",
    totalProductionKpi: "Генерація",
    totalProductionCostInfoDetails: "Це умовне значення рахує кожну згенеровану кВт·г як продану за ціною експорту свого місяця після ПДВ і військового збору. У режимі USD кожен місяць конвертується за його курсом USD/UAH.",
    exported: "експорт",
    export: "Експорт",
    totalExport: "Загальний експорт",
    totalExportKpi: "Експорт",
    totalExportCostInfoDetails: "Виплата рахується з чистого експортного надлишку після місячного балансу імпорту/експорту, за ціною експорту кожного місяця після ПДВ і військового збору.",
    latest: "Останнє",
    gridImport: "Імпорт",
    totalImport: "Загальний імпорт",
    totalImportKpi: "Імпорт",
    totalImportCostInfoDetails: "Денний імпорт рахується за денним тарифом кожного місяця, нічний імпорт - за нічним тарифом.",
    solarCoverage: "з сонця",
    net: "Баланс",
    netPayment: "Баланс оплати",
    totalNetPayment: "Загальний баланс оплати",
    totalNetPaymentKpi: "Баланс оплати",
    electricityCostWithoutSolar: "Вартість електрики без сонця",
    formulaInputs: "Вхідні дані",
    importPrices: "Ціни імпорту",
    exportPriceInput: "Ціни експорту",
    after: "Після",
    usdRate: "Курс USD/UAH",
    taxes: "Податки",
    dayCost: "Вартість дня",
    nightCost: "Вартість ночі",
    electricHeatingTier: "Тариф електроопалення",
    regularTier: "Звичайний тариф",
    electricHeatingThreshold: "Ліміт електроопалення",
    exportedOffset: "Покриття експортом",
    beforeCommercialDate: "До комерційної дати",
    fromCommercialDate: "З комерційної дати",
    remainingImport: "Залишок імпорту",
    netSurplus: "Чистий надлишок",
    exportUnpaid: "До комерційної дати експорт не оплачується",
    netPaymentLogic: "Баланс оплати — це грошовий результат місячного балансу імпорту й експорту. Баланс рахується як імпорт мінус експорт. Якщо експорт більший за імпорт, баланс відʼємний і чистий надлишок оплачується за ціною експорту після ПДВ і військового збору. Інакше експорт пропорційно покриває денний і нічний імпорт, а залишок денного/нічного імпорту оплачується за відповідним тарифом.",
    netPaymentInfo: "Суми в гривнях додаються напряму. У режимі USD кожен місяць конвертується за його курсом, а потім конвертовані значення додаються. Це не сума в гривнях, поділена на останній курс.",
    usdRateInfo: "Місячний курс USD/UAH — це останній денний курс USD/UAH, збережений за цей місяць. Якщо в місяці немає денних курсів, дашборд використовує вручну збережений місячний резервний курс USD/UAH.",
    importPriceInfo: "Ціни імпорту показані як день / ніч. День — тариф з 7:00 до 23:00; ніч — тариф з 23:00 до 7:00.",
    roiInfo: "ПІ — це не генерація, помножена на ціну експорту. Це фактичне повернення інвестицій за період: вартість електроенергії, спожитої з сонячної системи, плюс виплата за експорт після початку комерційного експорту, мінус витрати на імпорт з мережі. До комерційної дати експорт не оплачується і не перекриває імпорт, тому ПІ рахується лише з орієнтовно спожитої власної сонячної енергії: генерація мінус експорт, оцінені за зваженим денним/нічним тарифом імпорту.",
    savings: "Економія",
    plantWorks: "Станція працює",
    sinceLaunch: "з",
    launchDate: "Дата запуску",
    commercialDate: "Комерційна дата",
    commercialEndDate: "Кінець комерційного періоду",
    plantWorksInfo: "Вік станції рахується від дати запуску. Оплачений комерційний експорт діє з комерційної дати до кінця комерційного періоду. Після цього очікується net billing: гроші за експорт стають віртуальним балансом, а ціна кВт·г змінюватиметься щогодини замість фіксованої ставки виплати.",
    investmentRecovered: "інвестиції повернуто",
    recoverableByCommercialEnd: "Можливе повернення до кінця комерційного періоду",
    pvgisAdjustedForecast: "прогноз з урахуванням PVGIS",
    commercialRecoveryCalcInfo: "Прогноз використовує річну генерацію, фіксоване річне споживання, поточні правила тарифів і місячні курси. До комерційної дати враховується лише власне споживання. У комерційний період надлишок оплачується. Після кінця комерційного періоду net billing вважається таким, що закриває ті самі 17 МВт·г/рік всередині року, тому витрати на електрику все ще не виникають, але надлишок не має грошової виплати.",
    annualProduction: "Річна генерація",
    annualConsumption: "Річне споживання",
    annualSurplus: "Річний надлишок",
    commercialPeriod: "Комерційний період",
    commercialPeriodRange: "Комерційний період з {from} до {to}.",
    postCommercialAssumption: "Після завершення комерційного періоду прогноз припускає річну самодостатність: надлишок пікового сонячного сезону покриває осінній і зимовий імпорт через net billing.",
    paybackForecast: "Прогноз окупності",
    paybackDate: "Дата",
    totalPaybackTime: "Усього",
    remainingPaybackTime: "Залишилось",
    productionSource: "Джерело",
    pvgisSource: "PVGIS, ще немає закритих років",
    closedYearSource: "1 закритий рік",
    closedYearAverageSource: "середнє закритих років",
    actualFallbackSource: "резерв з фактичних рядків",
    consumptionValue: "Вартість",
    surplusValue: "Виплата",
    noCashPayout: "Після кінця комерційного періоду грошової виплати немає",
    expectedPaidExport: "Очікуваний оплачений експорт",
    expectedSelfConsumption: "Очікуване власне споживання",
    expectedPostCommercialSelfConsumption: "Власне споживання після комерційного періоду",
    projectedRoiDate: "Прогнозована дата окупності",
    postCommercialNetBilling: "Net billing після комерційного періоду",
    investmentInfo: "Значення в USD — це збережена вартість станції. У режимі UAH дашборд конвертує цю суму за курсом USD/UAH з місяця запуску станції, бо саме він відображає початкову вартість у гривні.",
    payback: "Окупність",
    recovered: "повернуто",
    remaining: "залишилось",
    currentAverage: "за поточного темпу",
    addInvestment: "Додайте вартість станції",
    investmentHelp: "Вкажіть вартість системи, щоб бачити прогноз окупності.",
    investment: "Інвестиція",
    roiTrajectory: "Динаміка поверення інвестицій",
    importMix: "Імпорт",
    consumptionMix: "Споживання",
    utilityMeter: "Покази лічильника",
    dashboardValues: "Значення дашборда",
    meterValues: "Значення лічильника",
    usedForCalculations: "Покази лічильника розподіляються по наявних денних рядках перед місячними розрахунками. Корекція рівномірна, доки жоден день не йде нижче нуля; інакше вона пропорційна початковим денним значенням.",
    electricityPayment: "Оплата електрики",
    payment: "Оплата",
    table: "Таблиця даних",
    filterMonth: "Фільтр місяця",
    range: "Діапазон",
    from: "З",
    to: "До",
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

const LANGUAGE_STORAGE_KEY = "solaroid.lang";
const PORTAL_SESSION_KEY = "solaroid.portal.session";
const TOKEN_REFRESH_WINDOW_SECONDS = 90;
const DEFAULT_LANG: Lang = langFromQuery() ?? storedLang() ?? langFromNavigator() ?? "en";
const LanguageContext = React.createContext<Lang>(DEFAULT_LANG);
const portalCopy: Record<Lang, PortalCopy> = {
  en: {
    brand: "Solaroid",
    signIn: "Sign in",
    signUp: "Sign up",
    email: "Email",
    password: "Password",
    newPassword: "New password",
    enter: "Open dashboard",
    create: "Create account",
    savePassword: "Save password",
    needAccount: "Need access?",
    haveAccount: "Already approved?",
    forgotPassword: "Forgot password?",
    resetPassword: "Reset password",
    resetSent: "Password reset link sent. Check your email.",
    passwordUpdated: "Password updated. Opening dashboard.",
    waitingTitle: "Waiting for approval",
    waitingCopy: "Your account exists, but access opens after manual confirmation and plant assignment.",
    noPlantsTitle: "No plants assigned",
    noPlantsCopy: "Account is approved. Ask admin to assign at least one plant.",
    portalTagline: "Private solar ROI cockpit for production, tariffs, payback, and plant access.",
    open: "Open",
    signOut: "Sign out",
    loading: "Loading",
    switchPlant: "Switch plant",
    missingDomain: "Plant domain is missing. Add plants.domain in Supabase.",
    configMissing: "Portal config is missing.",
    sessionExpired: "Session expired. Sign in again.",
    retry: "Retry",
  },
  uk: {
    brand: "Solaroid",
    signIn: "Увійти",
    signUp: "Створити аккаунт",
    email: "Email",
    password: "Пароль",
    newPassword: "Новий пароль",
    enter: "Відкрити дашборд",
    create: "Створити акаунт",
    savePassword: "Зберегти пароль",
    needAccount: "Потрібен доступ?",
    haveAccount: "Доступ уже є?",
    forgotPassword: "Забули пароль?",
    resetPassword: "Скинути пароль",
    resetSent: "Посилання для скидання пароля надіслано. Перевірте email.",
    passwordUpdated: "Пароль оновлено. Відкриваємо дашборд.",
    waitingTitle: "Очікує підтвердження",
    waitingCopy: "Акаунт створено, але доступ відкриється після ручного підтвердження та привязки станції.",
    noPlantsTitle: "Станції не привязані",
    noPlantsCopy: "Акаунт підтверджено. Попросіть адміна привязати хоча б одну станцію.",
    portalTagline: "Приватний дашборд для генерації, тарифів, окупності та доступу до станцій.",
    open: "Відкрити",
    signOut: "Вийти",
    loading: "Завантаження",
    switchPlant: "Змінити станцію",
    missingDomain: "У станції немає домену. Додайте plants.domain у Supabase.",
    configMissing: "Немає конфігурації порталу.",
    sessionExpired: "Сесію завершено. Увійдіть ще раз.",
    retry: "Повторити",
  },
};

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
  if (typeof window === "undefined") return undefined;
  const lang = new URLSearchParams(window.location.search).get("lang");
  return lang === "uk" || lang === "en" ? lang : undefined;
}

function langFromNavigator(): Lang | undefined {
  if (typeof navigator === "undefined") return undefined;
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  const lang = languages
    .map((lang) => lang.toLowerCase())
    .find((lang) => lang.startsWith("uk") || lang.startsWith("ru") || lang.startsWith("en"));
  if (!lang) return undefined;
  return lang.startsWith("uk") || lang.startsWith("ru") ? "uk" : "en";
}

function storedLang(): Lang | undefined {
  if (typeof window === "undefined") return undefined;
  const lang = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return lang === "uk" || lang === "en" ? lang : undefined;
}

function useLanguage() {
  return React.useContext(LanguageContext);
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

function formatKwh(value: number, lang: Lang = DEFAULT_LANG) {
  return `${formatNumber(value, 2, 2)} ${lang === "uk" ? "кВт·г" : "kWh"}`;
}

function formatKwp(value: number, lang: Lang = DEFAULT_LANG) {
  return `${formatNumber(value, 2, 2)} ${lang === "uk" ? "кВт·п" : "kWp"}`;
}

function formatYieldKwhPerKwp(value: number, lang: Lang = DEFAULT_LANG) {
  return `${formatNumber(value, 2, 0)} ${lang === "uk" ? "кВт·г/кВт·п" : "kWh/kWp"}`;
}

function formatSignedPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}%`;
}

function formatSignedPercentFromDelta(delta: number, base: number) {
  if (base) return formatSignedPercent((delta / Math.abs(base)) * 100);
  return delta === 0 ? "0%" : "—";
}

function formatMonthlyKpiKwh(value: number, lang: Lang = DEFAULT_LANG) {
  if (Math.abs(value) <= 10_000) return formatKwh(value, lang);
  return `${formatNumber(value / 1000, 2, 2)} ${lang === "uk" ? "МВт·г" : "MWh"}`;
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

function formatSignedValue(value: number, format: (value: number) => string) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${format(value)}`;
}

function formatSignedNumber(value: number, maximumFractionDigits = 2, minimumFractionDigits = 2) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, maximumFractionDigits, minimumFractionDigits)}`;
}

function formatDeltaPct(delta: number, base: number) {
  if (!base) return "";
  const sign = delta > 0 ? "+" : "";
  return ` (${sign}${formatNumber((delta / Math.abs(base)) * 100)}%)`;
}

function formatDeltaPctComma(delta: number, base: number) {
  return `, ${formatSignedPercentFromDelta(delta, base)}`;
}

function chartLevel(value: number, max: number, minVisible = 3) {
  if (value === 0) return 0;
  return Math.max(minVisible, (Math.abs(value) / max) * 100);
}

function deltaTone(value: number) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "muted";
}

function comparisonDeltaTone(value: number, higherIsBetter: boolean) {
  if (value === 0) return "muted";
  if (higherIsBetter) return value > 0 ? "positive" : "negative";
  return value > 0 ? "negative" : "positive";
}

function comparisonDisplayDelta(value: number, invertSign?: boolean) {
  return invertSign ? -value : value;
}

interface PvFieldPair {
  readonly first?: PvMetadata;
  readonly second?: PvMetadata;
}

function azimuthDistance(first: number, second: number) {
  const diff = Math.abs(first - second) % 360;
  return Math.min(diff, 360 - diff);
}

function pairPvFieldsByAzimuth(firstFields: readonly PvMetadata[], secondFields: readonly PvMetadata[]): readonly PvFieldPair[] {
  const firstSorted = [...firstFields].sort((a, b) => a.azimuth - b.azimuth);
  const remainingSecond = [...secondFields].sort((a, b) => a.azimuth - b.azimuth);
  const pairs: PvFieldPair[] = [];

  for (const first of firstSorted) {
    let matchIndex = -1;
    let matchDistance = Number.POSITIVE_INFINITY;

    remainingSecond.forEach((second, index) => {
      const distance = azimuthDistance(first.azimuth, second.azimuth);
      if (distance < matchDistance) {
        matchDistance = distance;
        matchIndex = index;
      }
    });

    const second = matchIndex >= 0 ? remainingSecond.splice(matchIndex, 1)[0] : undefined;
    pairs.push({ first, second });
  }

  remainingSecond.forEach((second) => pairs.push({ second }));

  return pairs.sort((a, b) => (a.first?.azimuth ?? a.second?.azimuth ?? 0) - (b.first?.azimuth ?? b.second?.azimuth ?? 0));
}

function averageCoordinate(fields: readonly PvMetadata[]) {
  const valid = fields.filter((field) => Number.isFinite(field.lat) && Number.isFinite(field.lng));
  if (!valid.length) return undefined;
  return {
    lat: valid.reduce((sum, field) => sum + field.lat, 0) / valid.length,
    lng: valid.reduce((sum, field) => sum + field.lng, 0) / valid.length,
  };
}

function distanceKm(
  first?: { readonly lat: number; readonly lng: number },
  second?: { readonly lat: number; readonly lng: number },
) {
  if (!first || !second) return undefined;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(second.lat - first.lat);
  const dLng = toRad(second.lng - first.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(first.lat)) * Math.cos(toRad(second.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthKm * Math.asin(Math.sqrt(a));
}

function formatPvDistance(firstFields: readonly PvMetadata[], secondFields: readonly PvMetadata[]) {
  const km = distanceKm(averageCoordinate(firstFields), averageCoordinate(secondFields));
  if (km === undefined) return undefined;
  if (km < 1) return `${formatNumber(km * 1000, 0, 0)} m`;
  return `${formatNumber(km, 1, 1)} km`;
}

function formatPvFieldValue(field: PvMetadata | undefined, row: "power" | "mounting" | "azimuth" | "slope" | "location" | "elevation", lang: Lang, allowLocation = true) {
  if (!field) return "—";
  if (row === "power") return formatKwp(field.power / 1000, lang);
  if (row === "mounting") return formatMounting(field.mounting, lang);
  if (row === "azimuth") return `${formatNumber(field.azimuth, 0, 0)}°`;
  if (row === "slope") return `${formatNumber(field.slope, 0, 0)}°`;
  if (row === "location") {
    if (!allowLocation) return "—";

    return (
      <a
        className="production-setup-map-link"
        href={`https://www.google.com/maps?q=${field.lat},${field.lng}`}
        target="_blank"
        rel="noreferrer"
      >
        <span>{formatNumber(field.lat, 6, 4)}</span>
        <span>{formatNumber(field.lng, 6, 4)}</span>
      </a>
    );
  }
  return `${formatNumber(field.elevation, 0, 0)} m`;
}

function hasLocationScope(scopes: readonly string[] | undefined) {
  return scopes?.includes("loc") ?? false;
}

function ProductionCapacityInfo({
  firstLabel,
  secondLabel,
  firstProduction,
  secondProduction,
  firstCapacity,
  secondCapacity,
  firstMetadata,
  secondMetadata,
  firstScopes,
  secondScopes,
  lang,
}: {
  readonly firstLabel: string;
  readonly secondLabel: string;
  readonly firstProduction: number;
  readonly secondProduction: number;
  readonly firstCapacity?: number;
  readonly secondCapacity?: number;
  readonly firstMetadata?: PlantMetadata | null;
  readonly secondMetadata?: PlantMetadata | null;
  readonly firstScopes?: readonly string[];
  readonly secondScopes?: readonly string[];
  readonly lang: Lang;
}) {
  if (!firstCapacity || !secondCapacity) {
    return (
      <div className="info-stack">
        <p>{lang === "uk" ? "Деталі за потужністю недоступні: для однієї зі станцій не задана сумарна потужність панелей." : "Capacity details are unavailable because one plant has no total panel capacity."}</p>
      </div>
    );
  }

  const capacityPct = capacityDeltaPct(firstCapacity, secondCapacity);
  const firstYield = productionYieldKwhPerKwp(firstProduction, firstCapacity);
  const secondYield = productionYieldKwhPerKwp(secondProduction, secondCapacity);
  const surplus = capacityAdjustedProductionSurplus(firstProduction, secondProduction, firstCapacity, secondCapacity);
  const expected = secondProduction * (firstCapacity / secondCapacity);
  const productionDelta = firstProduction - secondProduction;
  const yieldDelta = (firstYield ?? 0) - (secondYield ?? 0);
  const productionLabel = lang === "uk" ? "Генерація · кВт·г" : "Production · kWh";
  const capacityLabel = lang === "uk" ? "Потужність · кВт·п" : "Capacity · kWp";
  const yieldLabel = lang === "uk" ? "кВт·г / кВт·п" : "kWh / kWp";
  const yieldNote = lang === "uk"
    ? "кВт·г / кВт·п показує, скільки енергії дала кожна одиниця встановленої потужності."
    : "kWh / kWp shows how much energy each installed unit of capacity produced.";
  const expectedNote = lang === "uk"
    ? "Скільки мала б дати перша станція, якби працювала з ефективністю другої."
    : "What the first plant would produce if it worked with the second plant's efficiency.";
  const surplusNote = lang === "uk"
    ? "Реальна перевага понад саму різницю в потужності."
    : "The real advantage beyond capacity alone.";
  const firstFields = firstMetadata?.pvs ?? [];
  const secondFields = secondMetadata?.pvs ?? [];
  const setupPairs = pairPvFieldsByAzimuth(firstFields, secondFields);
  const canShowFirstLocation = hasLocationScope(firstScopes);
  const canShowSecondLocation = hasLocationScope(secondScopes);
  const setupDistance = canShowFirstLocation && canShowSecondLocation && setupPairs.length ? formatPvDistance(firstFields, secondFields) : undefined;
  const setupRows: readonly (readonly [string, Parameters<typeof formatPvFieldValue>[1]])[] = [
    [lang === "uk" ? "Потужність" : "Capacity", "power"],
    [lang === "uk" ? "Монтаж" : "Mounting", "mounting"],
    [lang === "uk" ? "Азимут" : "Azimuth", "azimuth"],
    [lang === "uk" ? "Нахил" : "Tilt", "slope"],
    [lang === "uk" ? "Висота" : "Elevation", "elevation"],
    ...(canShowFirstLocation || canShowSecondLocation ? [[lang === "uk" ? "Локація" : "Location", "location"] as const] : []),
  ];

  return (
    <div className="info-stack">
      <table className="price-comparison-table production-capacity-table">
        <thead>
          <tr>
            <th />
            <th>{firstLabel}</th>
            <th>{secondLabel}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>{productionLabel}</th>
            <td><span className="production-capacity-value">{formatNumber(firstProduction, 2, 2)}</span></td>
            <td><span className="production-capacity-value">{formatNumber(secondProduction, 2, 2)}</span></td>
          </tr>
          <tr>
            <th>{capacityLabel}</th>
            <td><span className="production-capacity-value">{formatNumber(firstCapacity, 2, 2)}</span></td>
            <td><span className="production-capacity-value">{formatNumber(secondCapacity, 2, 2)}</span></td>
          </tr>
          <tr>
            <th>{yieldLabel}</th>
            <td><span className="production-capacity-value">{formatNumber(firstYield ?? 0, 2, 0)}</span></td>
            <td><span className="production-capacity-value">{formatNumber(secondYield ?? 0, 2, 0)}</span></td>
          </tr>
        </tbody>
      </table>
      <p className="production-capacity-note production-capacity-note-below">{yieldNote}</p>
      <div className="production-capacity-cards">
        <section className="production-capacity-card">
          <strong>{lang === "uk" ? "Різниця" : "Difference"}</strong>
          <div className="production-capacity-card-row">
            <span>{productionLabel}</span>
            <b className={comparisonDeltaTone(productionDelta, true)}>
              <span className="production-capacity-value">
                <span>{formatSignedNumber(productionDelta)}</span>
                <span className="production-capacity-subdelta">, {formatSignedPercentFromDelta(productionDelta, secondProduction)}</span>
              </span>
            </b>
          </div>
          <div className="production-capacity-card-row">
            <span>{capacityLabel}</span>
            <b className={deltaTone(capacityPct ?? 0)}>{formatSignedPercent(capacityPct ?? 0)}</b>
          </div>
          <div className="production-capacity-card-row">
            <span>{yieldLabel}</span>
            <b className={comparisonDeltaTone(yieldDelta, true)}>{formatSignedPercentFromDelta(yieldDelta, secondYield ?? 0)}</b>
          </div>
        </section>
        <section className="production-capacity-card">
          <strong>{lang === "uk" ? "Очікувано від розміру" : "Expected by size"}</strong>
          <span className="production-capacity-note">{expectedNote}</span>
          <div className="production-capacity-card-row">
            <span>{productionLabel}</span>
            <b>{formatNumber(expected, 2, 2)}</b>
          </div>
        </section>
        <section className="production-capacity-card">
          <strong>{lang === "uk" ? "Понад очікування" : "Above expected"}</strong>
          <span className="production-capacity-note">{surplusNote}</span>
          <div className="production-capacity-card-row">
            <span>{productionLabel}</span>
            <b className={comparisonDeltaTone(surplus ?? 0, true)}>
              <span className="production-capacity-value">
                <span>{formatSignedNumber(surplus ?? 0)}</span>
                <span className="production-capacity-subdelta">, {formatSignedPercentFromDelta(surplus ?? 0, expected)}</span>
              </span>
            </b>
          </div>
        </section>
      </div>
      {setupPairs.length > 0 && (
        <section className="production-setup">
          <strong>{lang === "uk" ? "Налаштування масивів" : "Array setup"}</strong>
          <div className="production-setup-scroller">
            {setupPairs.map((pair, index) => (
              <section className="production-setup-card" key={index}>
                <table className="price-comparison-table production-setup-table">
                  <thead>
                    <tr>
                      <th>{lang === "uk" ? `Масив ${index + 1}` : `Array ${index + 1}`}</th>
                      <th>{firstLabel}</th>
                      <th>{secondLabel}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {setupRows.map(([label, row]) => (
                      <tr key={row}>
                        <th>{label}</th>
                        <td>{formatPvFieldValue(pair.first, row, lang, row !== "location" || canShowFirstLocation)}</td>
                        <td>{formatPvFieldValue(pair.second, row, lang, row !== "location" || canShowSecondLocation)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
          {setupDistance && (
            <div className="production-capacity-card-row production-setup-distance">
              <span>{lang === "uk" ? "Відстань між станціями" : "Plant distance"}</span>
              <b>{setupDistance}</b>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function importCostUah(row: MonthRow) {
  return importEnergyCost(row.importDay, row.importNight, tariffFromRow(row));
}

function tariffFromRow(row: MonthRow): Tariff {
  return {
    importDay: row.importPriceDay,
    importNight: row.importPriceNight,
    electricHeatingThresholdKwh: row.electricHeatingThresholdKwh,
    export: row.exportPrice,
    exportNight: row.exportPriceNight,
    exportTaxes: [
      ["vat", row.exportVat],
      ["mil", row.exportMilitary],
    ],
  };
}

function taxFraction(value: number) {
  return value > 1 ? value / 100 : value;
}

function netExportRate(row: MonthRow) {
  return row.exportPrice * (1 - taxFraction(row.exportVat) - taxFraction(row.exportMilitary));
}

function netExportNightRate(row: MonthRow) {
  return row.exportPriceNight * (1 - taxFraction(row.exportVat) - taxFraction(row.exportMilitary));
}

function exportPayoutKwh(row: MonthRow) {
  return Math.max(0, -row.balance);
}

function exportPayoutUah(row: MonthRow) {
  return splitExportPayout(row, tariffFromRow(row));
}

function exportPayoutSplit(row: MonthRow) {
  const surplus = exportPayoutKwh(row);
  const total = exportTotal(row);
  if (!surplus || !total) return { day: 0, night: 0 };

  const day = surplus * (row.exportDay / total);
  return { day, night: surplus - day };
}

function hasSplitExportPrice(row: MonthRow) {
  return Math.abs(netExportPrice(row) - netExportNightPrice(row)) > 0.000001;
}

function productionSoldUah(row: MonthRow) {
  return row.production * netExportRate(row);
}

function sameMonth(first: Date, second: Date) {
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth();
}

function chartBand(innerWidth: number, count: number, maxBand = 72) {
  return Math.min(innerWidth / Math.max(count, 1), maxBand);
}

function pairedChartBarWidth(band: number, minWidth: number, ratio: number) {
  return Math.max(2, Math.min(Math.max(minWidth, band * ratio), band * 0.38));
}

function projectedProduction(row: MonthRow, projection?: ProductionProjection | null) {
  if (!projection) return undefined;

  const monthIndex = row.date.getMonth();
  const value = row.month.includes("-")
    ? projection.dailyKwh[monthIndex]
    : projection.monthlyKwh[monthIndex];

  return value && Number.isFinite(value) ? value : undefined;
}

function formatMounting(value: string, lang: Lang) {
  if (lang !== "uk") return value;
  const mounting: Record<string, string> = {
    building: "на будівлі",
    free: "на землі",
  };
  return mounting[value] ?? value;
}

function pct(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return `${formatNumber(value)}%`;
}

function titleCase(value: string) {
  return value ? `${value[0].toLocaleUpperCase()}${value.slice(1)}` : value;
}

function monthShort(month: string) {
  if (month.includes("-")) {
    const [, , d] = month.split("-");
    return d;
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

function formatDayOnlyLabel(date: Date, lang: Lang) {
  return new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-US", {
    day: "numeric",
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

function formatMonthShortOnly(date: Date, lang: Lang) {
  return new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-US", {
    month: "short",
  }).format(date);
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatPeriodLabel(row: MonthRow, lang: Lang = DEFAULT_LANG) {
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

function forecastProductionValue(
  value: number,
  date: Date,
  asOf: Date,
  projection: ProductionProjection | null | undefined,
  rows: readonly MonthRow[],
) {
  const daylightProjection = forecastMonthValue(value, date, asOf);
  const expected = projection?.monthlyKwh[date.getMonth()];
  if (!expected || expected <= 0) return daylightProjection;

  const performanceFactor = pvgisPerformanceFactor(rows, date, projection);
  if (!performanceFactor) return daylightProjection;

  const pvgisProjection = expected * performanceFactor;
  const elapsedShare = Math.min(1, Math.max(0, elapsedMonthDaylightMinutes(date, asOf) / monthDaylightMinutes(date)));
  const currentPaceWeight = Math.min(0.85, Math.max(0.2, elapsedShare));
  return daylightProjection * currentPaceWeight + pvgisProjection * (1 - currentPaceWeight);
}

function pvgisPerformanceFactor(
  rows: readonly MonthRow[],
  currentDate: Date,
  projection: ProductionProjection,
) {
  const factors = rows
    .filter((row) => row.date < currentDate && !sameMonth(row.date, currentDate))
    .slice(-3)
    .map((row) => {
      const expected = projection.monthlyKwh[row.date.getMonth()];
      return expected && expected > 0 ? row.production / expected : undefined;
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);

  if (!factors.length) return undefined;

  return factors.reduce((sum, value) => sum + value, 0) / factors.length;
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

function formatCompactActiveDuration(duration: { months: number; days: number }, lang: Lang) {
  const years = Math.floor(duration.months / 12);
  const months = duration.months % 12;
  const yearUnit = lang === "uk" ? "р" : "y";
  const monthUnit = lang === "uk" ? "м" : "m";
  const dayUnit = lang === "uk" ? "д" : "d";
  const parts = [
    years ? `${years}${yearUnit}` : "",
    months ? `${months}${monthUnit}` : "",
    duration.days || (!years && !months) ? `${duration.days}${dayUnit}` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

function netExportPrice(row: MonthRow) {
  return netExportRate(row);
}

function netExportNightPrice(row: MonthRow) {
  return netExportNightRate(row);
}

function filteredMonthlyRows(
  sourceRows: readonly MonthRow[],
  range: RangeKey,
  fromMonth: string,
  toMonth: string,
) {
  if (range === "all" || !fromMonth || !toMonth) return sourceRows;
  const [from, to] = fromMonth <= toMonth ? [fromMonth, toMonth] : [toMonth, fromMonth];
  return sourceRows.filter((row) => monthKey(row.date) >= from && monthKey(row.date) <= to);
}

function firstDateKey(rows: readonly MonthRow[]) {
  return rows.length ? dateKey(rows[rows.length - 1].date) : "";
}

function useDashboardData(initialData?: LoadedData): DashboardDataState {
  const [state, setState] = useState<DashboardDataHookState>(() => ({
    rows: initialData?.rows ?? [],
    dailyRows: initialData?.dailyRows ?? [],
    readablePlantIds: initialData?.readablePlantIds ?? [],
    readablePlantScopes: initialData?.readablePlantScopes ?? {},
    scopes: initialData?.scopes ?? [],
    plantId: initialData?.plantId ?? "",
    investmentUsd: initialData?.investmentUsd ?? 0,
    launchDate: initialData?.launchDate,
    commercialDate: initialData?.commercialDate,
    metadata: initialData?.metadata,
    projection: initialData?.projection,
    sheetUpdatedAt: initialData?.sheetUpdatedAt,
    isLoading: !initialData,
    isRefreshing: false,
    updatedAt: new Date(),
  }));

  const refresh = async () => {
    setState((current) => ({ ...current, isRefreshing: true }));
    try {
      const data: LoadedData = await loadDashboardData();
      const refreshedAt = new Date();
      setState({ ...data, isLoading: false, isRefreshing: false, updatedAt: refreshedAt });
      return data;
    } catch (error) {
      setState((current) => ({
        ...current,
        isLoading: false,
        isRefreshing: false,
        updatedAt: new Date(),
        error: error instanceof Error ? error.message : "Could not load Supabase data",
      }));
      return undefined;
    }
  };

  useEffect(() => {
    if (initialData) return;

    void refresh();
  }, [initialData]);

  return {
    ...state,
    refresh,
  };
}

interface PlantComparisonSource {
  readonly plantId: string;
  readonly rows: readonly MonthRow[];
  readonly dailyRows: readonly MonthRow[];
  readonly scopes: readonly string[];
  readonly investmentUsd: number;
  readonly launchDate?: Date;
  readonly commercialDate?: Date;
  readonly metadata?: PlantMetadata | null;
  readonly projection?: ProductionProjection | null;
  readonly sheetUpdatedAt?: Date;
}

function toPlantComparison(source: PlantComparisonSource): PlantComparison {
  return {
    plantId: source.plantId,
    rows: source.rows,
    dailyRows: source.dailyRows,
    scopes: source.scopes,
    investmentUsd: source.investmentUsd,
    launchDate: source.launchDate,
    commercialDate: source.commercialDate,
    metadata: source.metadata,
    projection: source.projection,
    sheetUpdatedAt: source.sheetUpdatedAt,
  };
}

interface RunPlantComparisonOptions {
  readonly forceReload?: boolean;
  readonly activePlant?: PlantComparison;
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

function App({
  initialLang = DEFAULT_LANG,
  initialData,
  footerExtra,
  onLangChange,
}: {
  readonly initialLang?: Lang;
  readonly initialData?: LoadedData;
  readonly footerExtra?: React.ReactNode;
  readonly onLangChange?: (lang: Lang) => void;
}) {
  const dataState = useDashboardData(initialData);
  const [viewMode, setViewMode] = useState<ViewMode>("monthly");
  const [range, setRange] = useState<RangeKey>("all");
  const [rangeFromMonth, setRangeFromMonth] = useState("");
  const [rangeToMonth, setRangeToMonth] = useState("");
  const [currency, setCurrency] = useState<Currency>("UAH");
  const [firstDay, setFirstDay] = useState("");
  const [secondDay, setSecondDay] = useState("");
  const [isDailyCompareOpen, setDailyCompareOpen] = useState(false);
  const [firstPlantId, setFirstPlantId] = useState("");
  const [secondPlantId, setSecondPlantId] = useState("");
  const [plantComparisonMode, setPlantComparisonMode] = useState<PlantComparisonMode>("daily");
  const [plantComparisonMonth, setPlantComparisonMonth] = useState("");
  const [plantComparisonYear, setPlantComparisonYear] = useState("");
  const [comparisonResult, setComparisonResult] = useState<PlantComparisonResult | null>(null);
  const [comparisonPlantCache, setComparisonPlantCache] = useState<Record<string, PlantComparison>>({});
  const [comparisonError, setComparisonError] = useState("");
  const [isPlantComparisonLoading, setPlantComparisonLoading] = useState(false);
  const [infoModal, setInfoModal] = useState<InfoModal | null>(null);
  const [lang, setLang] = useState<Lang>(initialLang);
  const setAppLang = (nextLang: Lang) => {
    setLang(nextLang);
    onLangChange?.(nextLang);
  };
  const t = i18n[lang];
  const monthOptions = useMemo(
    () => dataState.rows.map((row) => [monthKey(row.date), formatMonthYear(row.date, lang)] as const),
    [dataState.rows, lang],
  );

  const dailyRows = useMemo(() => dataState.dailyRows.slice(-30), [dataState.dailyRows]);

  useEffect(() => {
    const latest = dataState.dailyRows.at(-1);
    const previous = dataState.dailyRows.at(-2);
    if (!firstDay && previous) setFirstDay(previous.month);
    if (!secondDay && latest) setSecondDay(latest.month);
    if (!plantComparisonMonth && latest) setPlantComparisonMonth(monthKey(latest.date));
  }, [dataState.dailyRows, firstDay, plantComparisonMonth, secondDay]);

  useEffect(() => {
    const latest = dataState.rows.at(-1);
    if (!plantComparisonYear && latest) setPlantComparisonYear(String(latest.date.getFullYear()));
  }, [dataState.rows, plantComparisonYear]);

  useEffect(() => {
    if (!monthOptions.length) return;
    const firstMonth = monthOptions[0][0];
    const latestMonth = monthOptions.at(-1)?.[0] ?? firstMonth;
    if (!rangeFromMonth || !monthOptions.some(([value]) => value === rangeFromMonth)) setRangeFromMonth(firstMonth);
    if (!rangeToMonth || !monthOptions.some(([value]) => value === rangeToMonth)) setRangeToMonth(latestMonth);
  }, [monthOptions, rangeFromMonth, rangeToMonth]);

  useEffect(() => {
    if (viewMode !== "daily") setDailyCompareOpen(false);
  }, [viewMode]);

  const readablePlantOptions = useMemo(
    () => [dataState.plantId, ...dataState.readablePlantIds].filter((plantId, index, plantIds) => plantId && plantIds.indexOf(plantId) === index),
    [dataState.plantId, dataState.readablePlantIds],
  );
  const viewOptions = ["monthly", "daily", "comparison"] as const;

  const activePlantComparison = useMemo<PlantComparison>(() => toPlantComparison(dataState), [dataState]);

  useEffect(() => {
    if (!readablePlantOptions.length) return;
    if (!firstPlantId) setFirstPlantId(dataState.plantId || readablePlantOptions[0]);
    if (!secondPlantId) setSecondPlantId(readablePlantOptions.find((plantId) => plantId !== (dataState.plantId || readablePlantOptions[0])) ?? readablePlantOptions[0]);
  }, [dataState.plantId, firstPlantId, readablePlantOptions, secondPlantId]);

  const loadComparisonPlant = async (plantId: string, granularity: string) => {
    const cacheKey = `${plantId}:${granularity}`;
    const plant = granularity === "all" ? await loadPlantData(plantId) : await loadPlantGranularity(plantId, granularity);
    const plantWithScopes = {
      ...plant,
      scopes: dataState.readablePlantScopes[plantId] ?? [],
    };
    setComparisonPlantCache((current) => ({
      ...current,
      [cacheKey]: plantWithScopes,
    }));
    return plantWithScopes;
  };

  const ensureComparisonPlant = async (
    plantId: string,
    granularity: string,
    forceReload = false,
    activePlant = activePlantComparison,
  ) => {
    if (!plantId) return undefined;
    if (plantId === activePlant.plantId) return activePlant;
    const cacheKey = `${plantId}:${granularity}`;
    if (!forceReload && comparisonPlantCache[cacheKey]) return comparisonPlantCache[cacheKey];

    return loadComparisonPlant(plantId, granularity);
  };

  useEffect(() => {
    if (!infoModal) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInfoModal(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [infoModal]);

  useEffect(() => {
    document.documentElement.lang = lang;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  }, [lang]);

  useEffect(() => {
    setLang(initialLang);
  }, [initialLang]);

  const rows = useMemo(() => {
    return filteredMonthlyRows(dataState.rows, range, rangeFromMonth, rangeToMonth);
  }, [dataState.rows, range, rangeFromMonth, rangeToMonth]);
  const productionProjection = dataState.projection ?? null;

  const plantComparisonMonthOptions = useMemo(
    () => [...new Map(dataState.dailyRows.map((row) => [monthKey(row.date), formatMonthYear(row.date, lang)])).entries()].reverse(),
    [dataState.dailyRows, lang],
  );

  const plantComparisonYearOptions = useMemo(
    () => [...new Set(dataState.rows.map((row) => String(row.date.getFullYear())))].sort((a, b) => Number(b) - Number(a)),
    [dataState.rows],
  );

  const runPlantComparison = async ({ forceReload = false, activePlant = activePlantComparison }: RunPlantComparisonOptions = {}) => {
    const selectedPlantIds = [firstPlantId, secondPlantId].filter(Boolean);
    const selectedPeriod = plantComparisonMode === "monthly" ? plantComparisonYear : plantComparisonMonth;
    if (selectedPlantIds.length < 2 || !selectedPeriod) return;

    setPlantComparisonLoading(true);
    setComparisonError("");

    try {
      const granularity = plantComparisonMode === "monthly" ? plantComparisonYear : "all";
      const loadedPlants = await Promise.all(
        selectedPlantIds.map((plantId) => ensureComparisonPlant(plantId, granularity, forceReload, activePlant)),
      );
      const plants = loadedPlants.filter((plant): plant is PlantComparison => Boolean(plant));
      const hasSelectedPeriod = plants.every((plant) =>
        plantComparisonMode === "monthly"
          ? plant.rows.some((row) => String(row.date.getFullYear()) === plantComparisonYear)
          : plant.dailyRows.some((row) => monthKey(row.date) === plantComparisonMonth),
      );
      if (!hasSelectedPeriod) {
        throw new Error(
          plantComparisonMode === "monthly"
            ? "Selected year is not available for one of the plants"
            : "Selected month is not available for one of the plants",
        );
      }
      setComparisonResult({
        mode: plantComparisonMode,
        month: plantComparisonMonth,
        year: plantComparisonYear,
        plants,
      });
    } catch (error) {
      setComparisonError(error instanceof Error ? error.message : "Could not load plant comparison");
    } finally {
      setPlantComparisonLoading(false);
    }
  };

  const handleRefresh = async () => {
    const selectedPlantIds = [firstPlantId, secondPlantId].filter(Boolean);
    const selectedPeriod = plantComparisonMode === "monthly" ? plantComparisonYear : plantComparisonMonth;
    const resultPeriod = plantComparisonMode === "monthly" ? comparisonResult?.year : comparisonResult?.month;
    const resultPlantIds = comparisonResult?.plants.map((plant) => plant.plantId) ?? [];
    const isCurrentComparison =
      comparisonResult?.mode === plantComparisonMode &&
      resultPeriod === selectedPeriod &&
      selectedPlantIds.length === resultPlantIds.length &&
      selectedPlantIds.every((plantId, index) => resultPlantIds[index] === plantId);
    const shouldRefreshComparison = viewMode === "comparison" && isCurrentComparison && selectedPlantIds.length >= 2 && Boolean(selectedPeriod);

    const granularity = plantComparisonMode === "monthly" ? plantComparisonYear : "all";
    if (shouldRefreshComparison) {
      setPlantComparisonLoading(true);
      setComparisonPlantCache({});
      setComparisonError("");
    }

    const refreshedDataPromise = dataState.refresh();
    const remotePlantPromises = shouldRefreshComparison
      ? selectedPlantIds.map((plantId) => plantId === dataState.plantId ? Promise.resolve(undefined) : loadComparisonPlant(plantId, granularity))
      : [];

    if (!shouldRefreshComparison) {
      await refreshedDataPromise;
      return;
    }

    try {
      const [refreshedData, remotePlants] = await Promise.all([refreshedDataPromise, Promise.all(remotePlantPromises)]);
      if (!refreshedData) return;

      const activePlant = toPlantComparison(refreshedData);
      const remotePlantById = new Map(remotePlants.filter((plant): plant is PlantComparison => Boolean(plant)).map((plant) => [plant.plantId, plant]));
      const plants = selectedPlantIds
        .map((plantId) => plantId === activePlant.plantId ? activePlant : remotePlantById.get(plantId))
        .filter((plant): plant is PlantComparison => Boolean(plant));
      const hasSelectedPeriod = plants.every((plant) =>
        plantComparisonMode === "monthly"
          ? plant.rows.some((row) => String(row.date.getFullYear()) === plantComparisonYear)
          : plant.dailyRows.some((row) => monthKey(row.date) === plantComparisonMonth),
      );
      if (!hasSelectedPeriod) {
        throw new Error(
          plantComparisonMode === "monthly"
            ? "Selected year is not available for one of the plants"
            : "Selected month is not available for one of the plants",
        );
      }

      setComparisonResult({
        mode: plantComparisonMode,
        month: plantComparisonMonth,
        year: plantComparisonYear,
        plants,
      });
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
    const latestDisplayRow = latestRow;
    const latestPaymentDisplay = latestRow ? moneyFromUah(latestRow.electricityPayment, currency, latestRow.usdRate) : 0;
    const production = rows.reduce((sum, row) => sum + row.production, 0);
    const productionSoldDisplay = sumRowsFromUah(rows, productionSoldUah, currency);
    const exported = rows.reduce((sum, row) => sum + exportTotal(row), 0);
    const exportedDay = rows.reduce((sum, row) => sum + row.exportDay, 0);
    const exportedNight = rows.reduce((sum, row) => sum + row.exportNight, 0);
    const exportPayoutKwhTotal = rows.reduce((sum, row) => sum + exportPayoutKwh(row), 0);
    const exportPayoutDisplay = sumRowsFromUah(rows, exportPayoutUah, currency);
    const imported = rows.reduce((sum, row) => sum + row.importTotal, 0);
    const importedDay = rows.reduce((sum, row) => sum + row.importDay, 0);
    const importedNight = rows.reduce((sum, row) => sum + row.importNight, 0);
    const importCostDisplay = sumRowsFromUah(rows, importCostUah, currency);
    const consumed = rows.reduce((sum, row) => sum + row.consumedTotal, 0);
    const savings = rows.reduce((sum, row) => sum + row.electricitySavings, 0);
    const savingsDisplay = sumRowsFromUah(rows, (row) => row.electricitySavings, currency);
    const payments = rows.reduce((sum, row) => sum + row.electricityPayment, 0);
    const paymentsDisplay = sumRowsFromUah(rows, (row) => row.electricityPayment, currency);
    const covered = consumed ? ((consumed - imported) / consumed) * 100 : 0;
    const launchDate = dataState.launchDate ?? rows[0]?.date;
    const activeDuration = launchDate ? fullDurationBetween(launchDate, new Date()) : { months: 0, days: 0 };
    const usdRate = latest?.usdRate || [...rows].reverse().find((row) => row.usdRate > 0)?.usdRate || 1;
    const launchUsdRate = launchDate ? dataState.rows.find((row) => sameMonth(row.date, launchDate))?.usdRate || usdRate : usdRate;
    return {
      roi,
      roiDisplay,
      latest,
      latestRow,
      latestDisplayRow,
      latestPaymentDisplay,
      production,
      productionSoldDisplay,
      exported,
      exportedDay,
      exportedNight,
      exportPayoutKwhTotal,
      exportPayoutDisplay,
      imported,
      importedDay,
      importedNight,
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
    return calculatePayback({
      rows,
      investmentUsd: dataState.investmentUsd,
      currency,
      launchUsdRate: totals.launchUsdRate,
      launchDate: totals.launchDate,
    });
  }, [currency, dataState.investmentUsd, rows, totals.launchDate, totals.launchUsdRate]);

  const commercialEndRecovery = useMemo(() => {
    if (!payback) return null;
    return calculateCommercialEndRecovery({
      rows: dataState.rows,
      payback,
      currency,
      commercialDate: dataState.commercialDate,
      launchDate: totals.launchDate,
      endDate: COMMERCIAL_PERIOD_END_DATE,
      projection: dataState.projection,
    });
  }, [currency, dataState.commercialDate, dataState.projection, dataState.rows, payback, totals.launchDate]);

  const forecast = useMemo(() => {
    const today = new Date();
    const forecastAsOf = dataState.sheetUpdatedAt ?? today;
    return calculateForecast({
      rows: dataState.rows,
      currency,
      today,
      projectMonthValue: (value, date) => forecastMonthValue(value, date, forecastAsOf),
      projectProductionValue: (value, date) => forecastProductionValue(value, date, forecastAsOf, dataState.projection, dataState.rows),
    });
  }, [currency, dataState.projection, dataState.rows, dataState.sheetUpdatedAt]);

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
    if (typeof infoModal === "object" && infoModal?.kind === "exportSplit") {
      const row = infoModal.row;
      return {
        title: `${t.export} · ${row.month}`,
        body: (
          <SplitInfo
            t={t}
            lang={lang}
            total={exportTotal(row)}
            day={row.exportDay}
            night={row.exportNight}
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
      const grossDayPrice = moneyFromUah(row.exportPriceDay, currency, row.usdRate);
      const grossNightPrice = moneyFromUah(row.exportPriceNight, currency, row.usdRate);
      const netDayPrice = moneyFromUah(netExportPrice(row), currency, row.usdRate);
      const netNightPrice = moneyFromUah(netExportNightPrice(row), currency, row.usdRate);
      return {
        title: `${t.exportPrice} · ${row.month}`,
        body: (
          <ExportPriceInfo
            t={t}
            grossDay={formatDisplayMoney(grossDayPrice, currency, lang)}
            grossNight={formatDisplayMoney(grossNightPrice, currency, lang)}
            netDay={formatDisplayMoney(netDayPrice, currency, lang)}
            netNight={formatDisplayMoney(netNightPrice, currency, lang)}
            vat={`${formatNumber(row.exportVat, 2, 2)}%`}
            military={`${formatNumber(row.exportMilitary, 2, 2)}%`}
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
            commercialDate={dataState.commercialDate}
            dailyRows={dataState.dailyRows}
            t={t}
            currency={currency}
            lang={lang}
          />
        ),
      };
    }
    if (typeof infoModal === "object" && infoModal?.kind === "roiCalc") {
      const row = infoModal.row;
      return {
        title: `${t.roi} · ${row.month}`,
        body: <RoiInfo row={row} t={t} currency={currency} lang={lang} />,
      };
    }
    if (typeof infoModal === "object" && infoModal?.kind === "utilityMeter") {
      const row = infoModal.row;
      if (!row.utilityMeter) return { title: t.utilityMeter, body: "" };
      return {
        title: `${t.utilityMeter} · ${row.month}`,
        body: <UtilityMeterInfo row={row} t={t} lang={lang} />,
      };
    }
    if (typeof infoModal === "object" && infoModal?.kind === "comparisonDelta") {
      return {
        title: infoModal.title,
        body: infoModal.body,
      };
    }
    if (infoModal === "latestRoi") return { title: t.latestRoi, body: t.latestRoiInfo };
    if (infoModal === "netPayment") return { title: t.netPayment, body: t.netPaymentLogic };
    if (infoModal === "usdRate") return { title: "USD/UAH", body: t.usdRateInfo };
    if (infoModal === "importPrice") return { title: `${t.import} ${t.exportPrice}`, body: t.importPriceInfo };
    if (infoModal === "roi") return { title: t.roi, body: t.roiInfo };
    if (infoModal === "forecast") return { title: t.forecast, body: t.forecastInfo };
    if (infoModal === "pvgis") {
      const fields = dataState.metadata?.pvs ?? [];
      return {
        title: `${t.production} · PVGIS`,
        body: (
          <div className="info-stack">
            <p>{t.pvgisInfo}</p>
            {fields.length > 0 && (
              <div className="pv-fields">
                <div className="pv-fields-head">
                  <span>{t.pvgisFields}</span>
                  <strong>{fields.length}</strong>
                </div>
                {fields.map((field, index) => (
                  <section className="pv-field" key={`${field.azimuth}-${field.power}-${index}`}>
                    <h3>{lang === "uk" ? `Поле ${index + 1}` : `Field ${index + 1}`}</h3>
                    <PvSpecList field={field} t={t} lang={lang} showLocation={hasLocationScope(dataState.scopes)} />
                  </section>
                ))}
              </div>
            )}
          </div>
        ),
      };
    }
    if (infoModal === "investment") return { title: t.investment, body: t.investmentInfo };
    if (infoModal === "investmentForecast") {
      const details = commercialEndRecovery?.details;
      const sourceLabel = details?.annualProduction.source === "pvgis"
        ? t.pvgisSource
        : details?.annualProduction.source === "closed-year"
          ? t.closedYearSource
          : details?.annualProduction.source === "closed-year-average"
            ? `${details.annualProduction.closedYearCount} ${t.closedYearAverageSource}`
            : t.actualFallbackSource;
      return {
        title: titleCase(t.investmentRecovered),
        body: (
          <div className="info-stack">
            {commercialEndRecovery ? (
              <MathInfo
                rows={[
                  {
                    label: t.recoverableByCommercialEnd,
                    value: (
                      <>
                        <FormulaResult>{formatDisplayMoney(commercialEndRecovery.recovered, currency, lang)}</FormulaResult>{" "}
                        ({formatNumber(commercialEndRecovery.progress)}%)
                      </>
                    ),
                  },
                  ...(details ? [
                    {
                      label: t.annualProduction,
                      value: (
                        <StackedValues
                          rows={[
                            { label: t.total, value: formatKwh(details.annualProduction.kwh, lang) },
                            { label: t.productionSource, value: sourceLabel },
                          ]}
                        />
                      ),
                    },
                    {
                      label: t.annualConsumption,
                      value: (
                        <StackedValues
                          rows={[
                            {
                              label: t.day,
                              value: `${formatKwh(details.annualConsumption.dayKwh, lang)} · ${formatDisplayMoney(details.annualConsumption.dayValue, currency, lang)}`,
                            },
                            {
                              label: t.night,
                              value: `${formatKwh(details.annualConsumption.nightKwh, lang)} · ${formatDisplayMoney(details.annualConsumption.nightValue, currency, lang)}`,
                            },
                            {
                              label: t.total,
                              value: `${formatKwh(details.annualConsumption.totalKwh, lang)} · ${formatDisplayMoney(details.annualConsumption.totalValue, currency, lang)}`,
                            },
                          ]}
                        />
                      ),
                    },
                    {
                      label: t.annualSurplus,
                      value: (
                        <StackedValues
                          rows={[
                            { label: t.total, value: formatKwh(details.annualSurplus.kwh, lang) },
                            { label: t.surplusValue, value: formatDisplayMoney(details.annualSurplus.value, currency, lang) },
                          ]}
                        />
                      ),
                    },
                    {
                      label: t.commercialPeriod,
                      value: (
                        <span className="math-note-stack">
                          <span>{formatLaunchDate(details.commercialStartDate, lang)} - {formatLaunchDate(details.commercialEndDate, lang)}</span>
                          <span>{t.postCommercialAssumption}</span>
                        </span>
                      ),
                    },
                  ] : []),
                  {
                    label: t.paybackForecast,
                    value: commercialEndRecovery.roiDate ? (
                      <StackedValues
                        rows={[
                          { label: t.paybackDate, value: <FormulaResult>{formatLaunchDate(commercialEndRecovery.roiDate, lang)}</FormulaResult> },
                          ...(commercialEndRecovery.roiDuration ? [
                            { label: t.totalPaybackTime, value: formatActiveDuration(commercialEndRecovery.roiDuration, lang) },
                          ] : []),
                          ...(commercialEndRecovery.roiRemainingDuration ? [
                            { label: t.remainingPaybackTime, value: formatActiveDuration(commercialEndRecovery.roiRemainingDuration, lang) },
                          ] : []),
                        ]}
                      />
                    ) : "-",
                  },
                ]}
              />
            ) : null}
            <p>{t.commercialRecoveryCalcInfo}</p>
          </div>
        ),
      };
    }
    if (infoModal === "plantWorks") {
      return {
        title: t.plantWorks,
        body: (
          <div className="info-stack">
            <p>{t.plantWorksInfo}</p>
            <dl className="info-list">
              <div>
                <dt>{t.launchDate}</dt>
                <dd>{totals.launchDate ? formatLaunchDate(totals.launchDate, lang) : "-"}</dd>
              </div>
              <div>
                <dt>{t.commercialDate}</dt>
                <dd>{dataState.commercialDate ? formatLaunchDate(dataState.commercialDate, lang) : "-"}</dd>
              </div>
              <div>
                <dt>{t.commercialEndDate}</dt>
                <dd>{formatLaunchDate(COMMERCIAL_PERIOD_END_DATE, lang)}</dd>
              </div>
            </dl>
          </div>
        ),
      };
    }
    if (infoModal === "totalProduction") {
      const productionValue = formatKwh(totals.production, lang);
      const soldValue = formatDisplayMoney(totals.productionSoldDisplay, currency, lang);
      const body =
        lang === "uk"
          ? `Якби вся генерація ${productionValue} була продана, вона коштувала б ${soldValue}. ${t.totalProductionCostInfoDetails}`
          : `If the full ${productionValue} production had been sold, it would have been worth ${soldValue}. ${t.totalProductionCostInfoDetails}`;
      return { title: t.totalProduction, body };
    }
    if (infoModal === "totalExport") {
      const exportValue = formatKwh(totals.exported, lang);
      const paidExportValue = formatKwh(totals.exportPayoutKwhTotal, lang);
      const payoutValue = formatDisplayMoney(totals.exportPayoutDisplay, currency, lang);
      return {
        title: t.totalExport,
        body: (
          <div className="info-stack">
            <p>
              {lang === "uk"
                ? `Усього експортовано ${exportValue}. З них ${paidExportValue} чистого надлишку принесли ${payoutValue}. ${t.totalExportCostInfoDetails}`
                : `${exportValue} was exported to the grid. Of that, ${paidExportValue} net surplus earned ${payoutValue}. ${t.totalExportCostInfoDetails}`}
            </p>
            <DayNightInfo t={t} lang={lang} day={totals.exportedDay} night={totals.exportedNight} />
          </div>
        ),
      };
    }
    if (infoModal === "totalImport") {
      const importValue = formatKwh(totals.imported, lang);
      const costValue = formatDisplayMoney(totals.importCostDisplay, currency, lang);
      return {
        title: t.totalImport,
        body: (
          <div className="info-stack">
            <p>
              {lang === "uk"
                ? `Імпортовані з мережі ${importValue} коштували б ${costValue}. ${t.totalImportCostInfoDetails}`
                : `The ${importValue} imported from the grid would have cost ${costValue}. ${t.totalImportCostInfoDetails}`}
            </p>
            <DayNightInfo t={t} lang={lang} day={totals.importedDay} night={totals.importedNight} />
          </div>
        ),
      };
    }
    return null;
  }, [
    currency,
    dataState.commercialDate,
    dataState.dailyRows,
    dataState.metadata,
    infoModal,
    lang,
    t,
    commercialEndRecovery,
    totals.exportPayoutDisplay,
    totals.exportPayoutKwhTotal,
    totals.exported,
    totals.exportedDay,
    totals.exportedNight,
    totals.importCostDisplay,
    totals.imported,
    totals.importedDay,
    totals.importedNight,
    totals.production,
    totals.productionSoldDisplay,
  ]);

  return (
    <LanguageContext.Provider value={lang}>
    <main className="app-shell">
      <section className="content">
        <DashboardToolbar
          t={t}
          currency={currency}
          setCurrency={setCurrency}
          viewMode={viewMode}
          setViewMode={setViewMode}
          viewOptions={viewOptions}
          range={range}
          setRange={setRange}
          monthOptions={monthOptions}
          rangeFromMonth={rangeFromMonth}
          rangeToMonth={rangeToMonth}
          setRangeFromMonth={setRangeFromMonth}
          setRangeToMonth={setRangeToMonth}
          isDailyCompareOpen={isDailyCompareOpen}
          setDailyCompareOpen={setDailyCompareOpen}
          investmentValue={showPlaceholders ? (
            <SkeletonText width="92px" height="1rem" />
          ) : payback ? (
            formatDisplayMoney(moneyFromUsd(payback.investmentUsd, currency, totals.launchUsdRate), currency, lang)
          ) : (
            "-"
          )}
          onInvestmentInfo={() => setInfoModal("investment")}
          isRefreshing={dataState.isRefreshing || isPlantComparisonLoading}
          refresh={handleRefresh}
          isLoading={showPlaceholders}
        />

        {dataState.error && (
          <div className="notice">
            <strong>{t.sourceWarning}</strong>
            <small>{dataState.error}</small>
          </div>
        )}

        {viewMode === "daily" ? (
          showPlaceholders ? (
            <DailyPageSkeleton t={t} />
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
              onExportSplitInfo={(row) => setInfoModal({ kind: "exportSplit", row })}
              onConsumedSplitInfo={(row) => setInfoModal({ kind: "consumedSplit", row })}
              onExportPriceInfo={(row) => setInfoModal({ kind: "exportPrice", row })}
              onNetPaymentInfo={(row) => setInfoModal({ kind: "netPayment", row })}
              onRoiValueInfo={(row) => setInfoModal({ kind: "roiCalc", row })}
            />
          )
        ) : viewMode === "comparison" ? (
          showPlaceholders ? (
            <PlantComparisonPageSkeleton />
          ) : dataState.readablePlantIds.length ? (
            <PlantComparisonSection
              activePlantId={dataState.plantId}
              availablePlantIds={readablePlantOptions}
              firstPlantId={firstPlantId}
              secondPlantId={secondPlantId}
              plantComparisonMode={plantComparisonMode}
              plantComparisonMonth={plantComparisonMonth}
              plantComparisonMonthOptions={plantComparisonMonthOptions}
              plantComparisonYear={plantComparisonYear}
              plantComparisonYearOptions={plantComparisonYearOptions}
              setFirstPlantId={setFirstPlantId}
              setSecondPlantId={setSecondPlantId}
              setPlantComparisonMode={setPlantComparisonMode}
              setPlantComparisonMonth={setPlantComparisonMonth}
              setPlantComparisonYear={setPlantComparisonYear}
              onCompare={runPlantComparison}
              result={comparisonResult}
              isLoading={isPlantComparisonLoading}
              error={comparisonError}
              t={t}
              currency={currency}
              lang={lang}
              onDeltaInfo={(title, body) => setInfoModal({ kind: "comparisonDelta", title, body })}
            />
          ) : (
            <div className="notice">
              <strong>{t.plantComparison}</strong>
              <small>{t.comparisonUnavailable}</small>
            </div>
          )
        ) : (
          <>
        {showPlaceholders ? (
          <KpiSkeletonGrid
            labels={[t.latestRoi, t.totalProductionKpi, t.totalExportKpi, t.totalImportKpi, t.totalNetPaymentKpi, t.plantWorks]}
            showInfoIcons
          />
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
              label={t.totalProductionKpi}
              value={formatMonthlyKpiKwh(totals.production, lang)}
              detail={`${pct((totals.exported / totals.production) * 100)} ${t.exported}`}
              tone="amber"
              infoLabel={t.totalProduction}
              onInfo={() => setInfoModal("totalProduction")}
            />
            <KpiCard
              icon={<ArrowUpFromLine size={20} />}
              label={t.totalExportKpi}
              value={formatMonthlyKpiKwh(totals.exported, lang)}
              detail={`${t.latest} ${formatKwh(totals.latest ? exportTotal(totals.latest) : 0, lang)}`}
              tone="mint"
              infoLabel={t.totalExport}
              onInfo={() => setInfoModal("totalExport")}
            />
            <KpiCard
              icon={<ArrowDownToLine size={20} />}
              label={t.totalImportKpi}
              value={formatMonthlyKpiKwh(totals.imported, lang)}
              detail={`${pct(totals.covered)} ${t.solarCoverage}`}
              tone="blue"
              infoLabel={t.totalImport}
              onInfo={() => setInfoModal("totalImport")}
            />
            <KpiCard
              icon={<WalletCards size={20} />}
              label={t.totalNetPaymentKpi}
              value={formatDisplayMoney(totals.paymentsDisplay, currency, lang)}
              detail={`${t.savings} ${formatDisplayMoney(totals.savingsDisplay, currency, lang)}`}
              tone={totals.payments >= 0 ? "green" : "rose"}
              infoLabel={t.totalNetPayment}
              onInfo={() => setInfoModal("netPayment")}
            />
            <KpiCard
              icon={<CalendarClock size={20} />}
              label={t.plantWorks}
              value={formatCompactActiveDuration(totals.activeDuration, lang)}
              detail={totals.launchDate ? `${t.sinceLaunch} ${formatLaunchDate(totals.launchDate, lang)}` : t.sinceLaunch}
              tone="indigo"
              infoLabel={t.plantWorks}
              onInfo={() => setInfoModal("plantWorks")}
            />
          </section>
        )}

        <section className="payback-band">
          {showPlaceholders ? (
            <>
              <div className="payback-copy">
                <PaybackHeadingSkeleton />
                <span className="payback-lines payback-lines-skeleton">
                  <SkeletonText width="min(620px, 100%)" height="1.35em" />
                  <SkeletonText width="min(560px, 90%)" height="1.35em" />
                  <SkeletonText width="min(430px, 78%)" height="1.35em" />
                </span>
              </div>
              <SkeletonBlock className="progress-track skeleton-track" />
            </>
          ) : (
            <>
              <div className="payback-copy">
                <h2 className="heading-with-info">
                  <span>{payback ? `${formatNumber(payback.progress)}% ${t.investmentRecovered}` : t.addInvestment}</span>
                  <button type="button" className="section-info-button" aria-label={t.investmentRecovered} onClick={() => setInfoModal("investmentForecast")}>
                    <Info size={16} />
                  </button>
                </h2>
                <p>
                  {payback ? (
                    <span className="payback-lines">
                      <span>
                        {formatDisplayMoney(payback.recovered, currency, lang)} {t.recovered},{" "}
                        {formatDisplayMoney(payback.remaining, currency, lang)} {t.remaining}
                        {payback.payoffDuration ? "," : "."}
                      </span>
                      {payback.payoffDuration ? (
                        <span>{formatActiveDuration(payback.payoffDuration, lang)} {t.currentAverage}.</span>
                      ) : null}
                    </span>
                  ) : t.investmentHelp}
                </p>
              </div>
              <div className="progress-track" aria-label="Payback progress">
                <span style={{ width: `${payback?.progress ?? 0}%` }} />
              </div>
            </>
          )}
        </section>

        <section className="forecast-section">
          <div className="section-heading">
            <div>
              <h2 className="heading-with-info">
                <span>
                  {showPlaceholders || !forecast
                    ? t.forecast
                    : `${t.forecast}, ${formatMonthYear(forecast.row.date, lang)}`}
                </span>
                <button type="button" className="section-info-button" aria-label={t.forecast} onClick={() => setInfoModal("forecast")} disabled={showPlaceholders}>
                  <Info size={16} />
                </button>
              </h2>
            </div>
          </div>
          {showPlaceholders ? (
            <ForecastKpiSkeletonGrid t={t} />
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
            infoLabel={`${t.production} PVGIS`}
            onInfo={() => setInfoModal("pvgis")}
            legend={[
              [t.production, colors.amber],
              [t.export, colors.green],
              ...(productionProjection ? [[t.expected, colors.blue] as [string, string]] : []),
            ]}
          >
            {showPlaceholders ? <ChartSkeleton /> : <ProductionExportChart rows={rows} projection={productionProjection} />}
          </ChartPanel>
        </section>

        <section id="data" className="data-section">
          <div className="section-heading">
            <div>
              <h2>{t.table}</h2>
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
              onExportSplitInfo={(row) => setInfoModal({ kind: "exportSplit", row })}
              onConsumedSplitInfo={(row) => setInfoModal({ kind: "consumedSplit", row })}
              onExportPriceInfo={(row) => setInfoModal({ kind: "exportPrice", row })}
              onNetPaymentInfo={(row) => setInfoModal({ kind: "netPayment", row })}
              onRoiValueInfo={(row) => setInfoModal({ kind: "roiCalc", row })}
              onUtilityMeterInfo={(row) => setInfoModal({ kind: "utilityMeter", row })}
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
                <button type="button" className="icon-button info-modal-close-top" onClick={() => setInfoModal(null)} aria-label={t.close}>
                  <X size={18} />
                </button>
              </div>
              <div className="info-modal-body">{infoModalContent.body}</div>
              <div className="info-modal-actions">
                <button type="button" className="icon-button" onClick={() => setInfoModal(null)} aria-label={t.close}>
                  <X size={18} />
                </button>
              </div>
            </section>
          </div>
        )}
        <footer className="dash-footer">
          <span>
            {showPlaceholders ? (
              <SkeletonText width="130px" />
            ) : (
              `${t.updated}: ${dataState.sheetUpdatedAt ? formatDateTimeLabel(dataState.sheetUpdatedAt, lang) : "-"}`
            )}
          </span>
          <span className="dash-footer-controls">
            {footerExtra}
            <LanguageSwitcher lang={lang} setLang={setAppLang} />
          </span>
        </footer>
      </section>
    </main>
    </LanguageContext.Provider>
  );
}

function PortalRoot() {
  const initialSession = useMemo(() => storedPortalSession(), []);
  const recoverySession = useMemo(() => recoverySessionFromHash(), []);
  const [authMode, setAuthMode] = useState<AuthMode>(recoverySession ? "reset" : "sign-in");
  const [busy, setBusy] = useState(Boolean(initialSession) && !recoverySession);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [lang, setLang] = useState<Lang>(DEFAULT_LANG);
  const [plants, setPlants] = useState<readonly PortalPlant[]>([]);
  const [selectedPlantId, setSelectedPlantId] = useState("");
  const [dashboardData, setDashboardData] = useState<LoadedData | undefined>();
  const [session, setSession] = useState<PortalSession | undefined>(recoverySession ?? initialSession);
  const [user, setUser] = useState<PortalUser | undefined>();
  const t = portalCopy[lang];
  const apiUrl = API_URL;
  const selectedPlant = plants.find((plant) => plant.id === selectedPlantId);
  const clearToast = () => {
    setError("");
    setInfo("");
  };

  const savePortalSession = (next: PortalSession) => {
    localStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify(next));
    setSession(next);
  };

  const clearPortalSession = () => {
    localStorage.removeItem(PORTAL_SESSION_KEY);
  };

  const loadAuthedState = async (knownUser?: PortalUser, sessionOverride?: PortalSession) => {
    setBusy(true);
    setError("");
    setInfo("");

    try {
      const activeSession = await validPortalSession(sessionOverride ?? session, t, savePortalSession);
      const activeUser = knownUser ?? confirmedPortalSessionUser(activeSession) ?? await getPortalUser(activeSession.access_token);

      if (!isPortalUserConfirmed(activeUser)) {
        setBusy(false);
        setSession(activeSession);
        setUser(activeUser);
        setPlants([]);
        setSelectedPlantId("");
        return;
      }

      const nextPlants = await getPortalPlants(apiUrl, activeSession.access_token, t);
      const nextSelectedPlantId = nextPlants[0]?.id ?? "";
      const nextDashboardData = nextSelectedPlantId
        ? await preloadPortalDashboard(apiUrl, nextSelectedPlantId, activeSession.access_token)
        : undefined;

      setBusy(false);
      setSession(activeSession);
      setUser(activeUser);
      setPlants(nextPlants);
      setSelectedPlantId(nextSelectedPlantId);
      setDashboardData(nextDashboardData);
    } catch (loadError) {
      clearPortalSession();
      setBusy(false);
      setError(portalErrorMessage(loadError) || t.sessionExpired);
      setSession(undefined);
      setUser(undefined);
      setPlants([]);
      setSelectedPlantId("");
      setDashboardData(undefined);
    }
  };

  useEffect(() => {
    document.documentElement.lang = lang;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  }, [lang]);

  useEffect(() => {
    if (authMode === "reset") return;

    if (!session) {
      setBusy(false);
      return;
    }

    void loadAuthedState();
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const registerServiceWorker = () => {
      void navigator.serviceWorker.register("./sw.js").catch(() => undefined);
    };

    if (document.readyState === "complete") {
      registerServiceWorker();
      return;
    }

    window.addEventListener("load", registerServiceWorker, { once: true });
    return () => window.removeEventListener("load", registerServiceWorker);
  }, []);

  const submitAuth = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(authMode === "sign-in" || authMode === "sign-up");
    setError("");
    setInfo("");

    try {
      const data = new FormData(event.currentTarget);
      const email = String(data.get("email") ?? "");
      const password = String(data.get("password") ?? "");
      if (authMode === "recover") {
        await requestPortalPasswordReset(email);
        setBusy(false);
        setInfo(t.resetSent);
        return;
      }

      if (authMode === "reset") {
        if (!session) throw new Error(t.sessionExpired);
        await updatePortalPassword(password, session.access_token);
        setInfo(t.passwordUpdated);
        savePortalSession(session);
        await loadAuthedState(undefined, session);
        return;
      }

      const response = authMode === "sign-up"
        ? await portalSignUp(email, password)
        : await portalSignIn(email, password);

      if (response.access_token && response.refresh_token) {
        const nextSession = portalSessionFromResponse(response, t);
        savePortalSession(nextSession);
        setSession(nextSession);
        if (authMode === "sign-up" && !isPortalUserConfirmed(response.user)) {
          setBusy(false);
          setUser(response.user);
          setPlants([]);
          setSelectedPlantId("");
          setDashboardData(undefined);
          return;
        }
        await loadAuthedState(response.user, nextSession);
        return;
      }

      setBusy(false);
      setInfo(t.waitingCopy);
      setUser(response.user);
    } catch (authError) {
      const message = portalAuthErrorMessage(authError, t);
      if (authMode === "sign-in" && message.toLowerCase().includes("email not confirmed")) {
        setBusy(false);
        setError("");
        setInfo(t.waitingCopy);
        setSession(undefined);
        setUser(undefined);
        setDashboardData(undefined);
        return;
      }

      setBusy(false);
      setError(message);
      setSession(undefined);
      setUser(undefined);
      setDashboardData(undefined);
    }
  };

  const signOut = async () => {
    const activeSession = session;
    clearPortalSession();

    if (activeSession) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${activeSession.access_token}`,
        },
      }).catch(() => undefined);
    }

    setError("");
    setInfo("");
    setAuthMode("sign-in");
    setPlants([]);
    setSelectedPlantId("");
    setDashboardData(undefined);
    setSession(undefined);
    setUser(undefined);
  };

  const shell = (content: React.ReactNode) => (
    <div className="portal-shell">
      <PortalToast error={error} info={info} onClose={clearToast} />
      {content}
    </div>
  );

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !apiUrl) {
    return shell(<PortalStatusPanel title={t.configMissing} body="VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_PATH" />);
  }

  if (busy) {
    return shell(
      <PortalLoading label={t.loading} lang={lang} />,
    );
  }

  if (!session || !user) {
    const isSignUp = authMode === "sign-up";
    const isRecover = authMode === "recover";
    const isReset = authMode === "reset";
    return shell(
      <main className="portal-auth-layout">
        <strong className="portal-auth-brand">{t.brand}</strong>
        <form className="portal-auth-card" onSubmit={submitAuth}>
          <div className="portal-auth-card-head">
            <h2>{isReset || isRecover ? t.resetPassword : isSignUp ? t.signUp : t.signIn}</h2>
            <LanguageSwitcher lang={lang} setLang={setLang} />
          </div>
          {!isReset ? (
            <input name="email" type="email" autoComplete="email" placeholder={t.email} aria-label={t.email} required />
          ) : null}
          {!isRecover ? (
            <input
              name="password"
              type="password"
              autoComplete={isSignUp || isReset ? "new-password" : "current-password"}
              placeholder={isReset ? t.newPassword : t.password}
              aria-label={isReset ? t.newPassword : t.password}
              minLength={6}
              required
            />
          ) : null}
          <button className="primary-button" type="submit">{isRecover ? t.resetPassword : isReset ? t.savePassword : isSignUp ? t.create : t.enter}</button>
          <div className="portal-auth-links">
            <button
              className="link-button"
              type="button"
              onClick={() => {
                setAuthMode(isSignUp || isRecover || isReset ? "sign-in" : "sign-up");
                clearToast();
              }}
            >
              {isSignUp || isRecover || isReset ? t.haveAccount : t.needAccount}
            </button>
            {!isSignUp && !isRecover && !isReset ? (
              <button
                className="link-button"
                type="button"
                onClick={() => {
                  setAuthMode("recover");
                  clearToast();
                }}
              >
                {t.forgotPassword}
              </button>
            ) : null}
          </div>
        </form>
      </main>,
    );
  }

  if (!isPortalUserConfirmed(user)) {
    return shell(
      <PortalStatusPanel title={t.waitingTitle} body={t.waitingCopy} actionLabel={t.retry} onAction={() => void loadAuthedState()} />,
    );
  }

  if (!plants.length) {
    return shell(
      <PortalStatusPanel title={t.noPlantsTitle} body={t.noPlantsCopy} actionLabel={t.retry} onAction={() => void loadAuthedState()} />,
    );
  }

  if (!selectedPlant) return shell(<PortalLoading label={t.loading} lang={lang} />);

  return shell(
    <div className="portal-dashboard">
      <App
        key={`${selectedPlant.id}:${session.access_token}`}
        initialLang={lang}
        initialData={dashboardData}
        footerExtra={(
          <button className="portal-footer-logout" type="button" onClick={signOut} aria-label={t.signOut} title={t.signOut}>
            <LogOut size={16} />
          </button>
        )}
        onLangChange={setLang}
      />
    </div>,
  );
}

interface DashboardToolbarProps {
  readonly t: Record<string, string>;
  readonly currency: Currency;
  readonly setCurrency?: (currency: Currency) => void;
  readonly viewMode: ViewMode;
  readonly setViewMode?: (viewMode: ViewMode) => void;
  readonly viewOptions: readonly ViewMode[];
  readonly range: RangeKey;
  readonly setRange?: (range: RangeKey) => void;
  readonly monthOptions?: readonly (readonly [string, string])[];
  readonly rangeFromMonth?: string;
  readonly rangeToMonth?: string;
  readonly setRangeFromMonth?: (month: string) => void;
  readonly setRangeToMonth?: (month: string) => void;
  readonly isDailyCompareOpen: boolean;
  readonly setDailyCompareOpen?: (isOpen: boolean) => void;
  readonly investmentValue: React.ReactNode;
  readonly onInvestmentInfo?: () => void;
  readonly isRefreshing: boolean;
  readonly refresh?: () => void;
  readonly isLoading: boolean;
}

function DashboardToolbar({
  t,
  currency,
  setCurrency,
  viewMode,
  setViewMode,
  viewOptions,
  range,
  setRange,
  monthOptions = [],
  rangeFromMonth = "",
  rangeToMonth = "",
  setRangeFromMonth,
  setRangeToMonth,
  isDailyCompareOpen,
  setDailyCompareOpen,
  investmentValue,
  onInvestmentInfo,
  isRefreshing,
  refresh,
  isLoading,
}: DashboardToolbarProps) {
  const [isRangePickerOpen, setRangePickerOpen] = useState(false);
  const rangeToolsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isRangePickerOpen) return undefined;

    const closeOnOutside = (event: PointerEvent) => {
      if (rangeToolsRef.current?.contains(event.target as Node)) return;
      setRangePickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRangePickerOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isRangePickerOpen]);

  return (
    <header className="topbar">
      <div className="dashboard-logo" aria-label="Solaroid">
        <img src={`${import.meta.env.BASE_URL}logo-mark.svg`} alt="Solaroid" />
      </div>
      <div className="toolbar">
        <div className="investment-pill" aria-label={`${t.investment} USD`}>
          <span>{t.investment}</span>
          <strong>{investmentValue}</strong>
          <button type="button" className="investment-info-button" aria-label={t.investment} onClick={onInvestmentInfo} disabled={isLoading || !onInvestmentInfo}>
            <Info size={14} />
          </button>
        </div>
        <div className="segmented currency" aria-label={t.currency}>
          {(["UAH", "USD"] as Currency[]).map((item) => (
            <button key={item} className={currency === item ? "selected" : ""} onClick={() => setCurrency?.(item)} disabled={isLoading}>
              {item}
            </button>
          ))}
        </div>
        <div className={`segmented view view-${viewOptions.length}`} aria-label="View">
          {viewOptions.map((item) => (
            <button key={item} className={viewMode === item ? "selected" : ""} onClick={() => setViewMode?.(item)} disabled={isLoading}>
              {item === "monthly" ? t.monthly : item === "daily" ? t.daily : t.comparison}
            </button>
          ))}
        </div>
        {viewMode === "monthly" ? (
          <div className="range-tools" aria-label="Date range" ref={rangeToolsRef}>
            <div className="segmented range-segmented">
              <button
                className={range === "all" ? "selected" : ""}
                onClick={() => {
                  setRange?.("all");
                  setRangePickerOpen(false);
                }}
                disabled={isLoading}
              >
                {t.all}
              </button>
              <button
                className={range === "range" ? "selected" : ""}
                onClick={() => {
                  setRange?.("range");
                  setRangePickerOpen((current) => !current);
                }}
                disabled={isLoading}
                aria-expanded={isRangePickerOpen}
                aria-haspopup="dialog"
              >
                {t.range}
              </button>
            </div>
            {range === "range" && isRangePickerOpen ? (
              <div className="month-range-controls">
                <label className="month-field">
                  <span>{t.from}</span>
                  <input
                    type="month"
                    value={rangeFromMonth}
                    onChange={(event) => setRangeFromMonth?.(event.target.value)}
                    min={monthOptions[0]?.[0]}
                    max={monthOptions.at(-1)?.[0]}
                    disabled={isLoading}
                  />
                </label>
                <label className="month-field">
                  <span>{t.to}</span>
                  <input
                    type="month"
                    value={rangeToMonth}
                    onChange={(event) => setRangeToMonth?.(event.target.value)}
                    min={monthOptions[0]?.[0]}
                    max={monthOptions.at(-1)?.[0]}
                    disabled={isLoading}
                  />
                </label>
              </div>
            ) : null}
          </div>
        ) : viewMode === "daily" ? (
          <div className="segmented daily-tools" aria-label={t.compareDays}>
            <button type="button" className={isDailyCompareOpen ? "selected" : ""} onClick={() => setDailyCompareOpen?.(true)} disabled={isLoading}>
              {t.compareDays}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className={`icon-button refresh-button${isRefreshing ? " is-refreshing" : ""}`}
          onClick={refresh}
          disabled={isRefreshing}
          aria-label={t.refresh}
          title={t.refresh}
        >
          <RefreshCw size={18} />
        </button>
      </div>
    </header>
  );
}

function PortalLoading({ label, lang }: { readonly label: string; readonly lang: Lang }) {
  const t = i18n[lang];
  return (
    <main className="app-shell portal-loading-app" aria-label={label} aria-busy="true">
      <section className="content">
        <DashboardToolbar
          t={t}
          currency="UAH"
          viewMode="monthly"
          viewOptions={["monthly", "daily", "comparison"]}
          range="all"
          isDailyCompareOpen={false}
          investmentValue={<SkeletonText width="92px" height="1rem" />}
          isRefreshing
          isLoading
        />
        <KpiSkeletonGrid
          labels={[t.latestRoi, t.totalProductionKpi, t.totalExportKpi, t.totalImportKpi, t.totalNetPaymentKpi, t.plantWorks]}
          showInfoIcons
        />
        <section className="payback-band">
          <div className="payback-copy">
            <PaybackHeadingSkeleton />
            <span className="payback-lines payback-lines-skeleton">
              <SkeletonText width="min(620px, 100%)" height="1.35em" />
              <SkeletonText width="min(560px, 90%)" height="1.35em" />
              <SkeletonText width="min(430px, 78%)" height="1.35em" />
            </span>
          </div>
          <SkeletonBlock className="progress-track skeleton-track" />
        </section>
        <section className="forecast-section">
          <div className="section-heading">
            <div>
              <h2 className="heading-with-info">
                <SkeletonText width="124px" height="18px" />
                <DisabledInfoIcon className="section-info-button" />
              </h2>
            </div>
          </div>
          <div className="forecast-grid">
            <ForecastKpiSkeletonGrid t={t} standalone={false} />
          </div>
        </section>
        <MonthlyPageSkeletonTail />
      </section>
    </main>
  );
}

function MonthlyPageSkeletonTail() {
  return (
    <>
      <section id="finance" className="chart-grid">
        <ChartPanelSkeleton />
        <ChartPanelSkeleton />
      </section>
      <section id="energy" className="chart-grid">
        <ChartPanelSkeleton />
        <ChartPanelSkeleton />
      </section>
      <section className="chart-grid chart-grid-single">
        <ChartPanelSkeleton hasInfo />
      </section>
      <section id="data" className="data-section">
        <div className="section-heading">
          <div>
            <SkeletonText width="96px" height="18px" />
          </div>
          <div className="filter-controls">
            <SkeletonText width="132px" height="40px" />
            <SkeletonText width="112px" height="40px" />
          </div>
        </div>
        <DataTableSkeleton />
      </section>
    </>
  );
}

function PaybackHeadingSkeleton() {
  return (
    <h2 className="heading-with-info payback-heading-skeleton">
      <SkeletonText width="230px" height="22px" />
      <DisabledInfoIcon className="section-info-button" />
    </h2>
  );
}

function ForecastKpiSkeletonGrid({ t, standalone = true }: { readonly t: Record<string, string>; readonly standalone?: boolean }) {
  const labels = [t.expectedProduction, t.expectedRoi, t.expectedIncome];
  const icons = [
    <SunMedium size={20} />,
    <CircleDollarSign size={20} />,
    <WalletCards size={20} />,
  ];
  const cards = Array.from({ length: 3 }, (_, index) => (
    <article className="kpi-card kpi-card-loading" key={index}>
      <div className="kpi-icon">{icons[index]}</div>
      <span>{labels[index]}</span>
      <SkeletonText width="120px" height="22px" />
      <SkeletonText width="110px" height="15px" />
      <SkeletonText width="130px" height="15px" />
    </article>
  ));

  return standalone ? <div className="forecast-grid">{cards}</div> : <>{cards}</>;
}

function DailyPageSkeleton({ t }: { readonly t: Record<string, string> }) {
  return (
    <>
      <KpiSkeletonGrid
        count={4}
        className="daily-kpi-grid"
        labels={[t.production, t.export, t.import, t.latestRoi]}
      />
      <section id="energy" className="chart-grid">
        <ChartPanelSkeleton />
        <ChartPanelSkeleton />
      </section>
      <section id="finance" className="chart-grid">
        <ChartPanelSkeleton />
        <ChartPanelSkeleton />
      </section>
      <section id="data" className="data-section">
        <div className="section-heading">
          <div>
            <SkeletonText width="96px" height="18px" />
          </div>
          <div className="filter-controls">
            <SkeletonText width="132px" height="40px" />
          </div>
        </div>
        <DataTableSkeleton />
      </section>
    </>
  );
}

function PlantComparisonPageSkeleton() {
  return (
    <section className="plant-comparison-section" aria-busy="true">
      <div className="section-heading">
        <div>
          <SkeletonText width="168px" height="22px" />
          <SkeletonText width="min(440px, 100%)" height="16px" />
        </div>
        <SkeletonText width="190px" height="42px" />
      </div>
      <div className="plant-comparison-controls">
        <SkeletonText width="100%" height="62px" />
        <SkeletonText width="100%" height="62px" />
        <SkeletonText width="100%" height="62px" />
        <SkeletonText width="116px" height="42px" />
      </div>
    </section>
  );
}

function ChartPanelSkeleton({ hasInfo = false }: { readonly hasInfo?: boolean }) {
  return (
    <article className="chart-panel" aria-busy="true">
      <div className="chart-head">
        <div>
          <h2 className={hasInfo ? "heading-with-info" : undefined}>
            <SkeletonText width="128px" height="18px" />
            {hasInfo ? <DisabledInfoIcon className="section-info-button" /> : null}
          </h2>
        </div>
        <div className="legend">
          <SkeletonText width="72px" height="14px" />
          <SkeletonText width="86px" height="14px" />
        </div>
      </div>
      <ChartSkeleton />
    </article>
  );
}

function PortalStatusPanel({
  title,
  body,
  actionLabel,
  message,
  onAction,
}: {
  readonly title: string;
  readonly body: string;
  readonly actionLabel?: string;
  readonly message?: React.ReactNode;
  readonly onAction?: () => void;
}) {
  return (
    <main className="portal-center-panel">
      <h1>{title}</h1>
      <p>{body}</p>
      {message}
      {actionLabel && onAction ? <button className="primary-button" type="button" onClick={onAction}>{actionLabel}</button> : null}
    </main>
  );
}

function PortalToast({ error, info, onClose }: { readonly error: string; readonly info: string; readonly onClose: () => void }) {
  if (!error && !info) return null;

  const isError = Boolean(error);
  return (
    <div className="portal-toast-region" aria-live={isError ? "assertive" : "polite"}>
      <section className={isError ? "portal-toast error" : "portal-toast"} role={isError ? "alert" : "status"}>
        {isError ? <CircleAlert size={18} /> : <CheckCircle2 size={18} />}
        <p>{error || info}</p>
        <button type="button" onClick={onClose} aria-label="Dismiss">
          <X size={16} />
        </button>
      </section>
    </div>
  );
}

async function portalSignUp(email: string, password: string) {
  return portalAuthRequest<PortalAuthResponse>("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

async function portalSignIn(email: string, password: string) {
  return portalAuthRequest<PortalAuthResponse>("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

async function requestPortalPasswordReset(email: string) {
  const redirectTo = typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`;
  const path = redirectTo ? `/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}` : "/auth/v1/recover";

  return portalAuthRequest<PortalAuthResponse>(path, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

async function updatePortalPassword(password: string, accessToken: string) {
  return portalAuthRequest<PortalAuthResponse>("/auth/v1/user", {
    method: "PUT",
    token: accessToken,
    body: JSON.stringify({ password }),
  });
}

async function refreshPortalSession(refreshToken: string) {
  return portalAuthRequest<PortalAuthResponse>("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

async function getPortalUser(accessToken: string) {
  const response = await portalAuthRequest<PortalUser | { readonly user: PortalUser }>("/auth/v1/user", {
    method: "GET",
    token: accessToken,
  });

  return "user" in response ? response.user : response;
}

async function getPortalPlants(apiUrl: string, accessToken: string, t: PortalCopy) {
  if (!accessToken) throw new Error(t.sessionExpired);

  const url = new URL(apiUrl);
  url.searchParams.set("metadata", "1");

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) throw new Error(await response.text());

  const data = await response.json() as PortalAccessResponse;
  return data.plants ?? [];
}

async function preloadPortalDashboard(apiUrl: string, plantId: string, token: string) {
  configureDashboardAccess({
    apiUrl,
    plantId,
    token,
    tokenKind: "auth",
  });

  return loadDashboardData();
}

async function portalAuthRequest<T>(
  path: string,
  options: { readonly method: string; readonly body?: string; readonly token?: string },
): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: options.method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${options.token ?? SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: options.body,
  });

  const data = await response.json() as PortalAuthResponse;
  if (!response.ok) throw new Error(data.error_description ?? data.msg ?? data.error ?? "Request failed");

  return data as T;
}

async function validPortalSession(
  session: PortalSession | undefined,
  t: PortalCopy,
  saveSession: (session: PortalSession) => void,
) {
  const activeSession = session ?? storedPortalSession();

  if (!activeSession) throw new Error(t.sessionExpired);

  const now = Math.floor(Date.now() / 1000);
  if (activeSession.expires_at && activeSession.expires_at - now > TOKEN_REFRESH_WINDOW_SECONDS) {
    return activeSession;
  }

  const refreshed = await refreshPortalSession(activeSession.refresh_token);
  const next = portalSessionFromResponse(refreshed, t);
  saveSession(next);
  return next;
}

function portalSessionFromResponse(response: PortalAuthResponse, t: PortalCopy): PortalSession {
  if (!response.access_token || !response.refresh_token) {
    throw new Error(t.sessionExpired);
  }

  return {
    access_token: response.access_token,
    refresh_token: response.refresh_token,
    expires_at: response.expires_in
      ? Math.floor(Date.now() / 1000) + response.expires_in
      : undefined,
    user: response.user,
  };
}

function confirmedPortalSessionUser(session: PortalSession) {
  return session.user && isPortalUserConfirmed(session.user) ? session.user : undefined;
}

function storedPortalSession(): PortalSession | undefined {
  const raw = localStorage.getItem(PORTAL_SESSION_KEY);
  if (!raw) return undefined;

  try {
    const session = JSON.parse(raw) as PortalSession;
    return session.access_token && session.refresh_token ? session : undefined;
  } catch {
    return undefined;
  }
}

function recoverySessionFromHash(): PortalSession | undefined {
  if (typeof window === "undefined") return undefined;

  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (params.get("type") !== "recovery") return undefined;

  const accessToken = params.get("access_token") ?? "";
  const refreshToken = params.get("refresh_token") ?? "";
  const expiresIn = Number(params.get("expires_in") ?? 0);
  if (!accessToken || !refreshToken) return undefined;

  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Number.isFinite(expiresIn) && expiresIn > 0
      ? Math.floor(Date.now() / 1000) + expiresIn
      : undefined,
  };
}

function portalErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Unknown error";

  try {
    const parsed = JSON.parse(error.message) as { readonly message?: string };
    return parsed.message ?? error.message;
  } catch {
    return error.message;
  }
}

function portalAuthErrorMessage(error: unknown, t: PortalCopy) {
  return portalErrorMessage(error) || t.sessionExpired;
}

function isPortalUserConfirmed(user: PortalUser | undefined) {
  return Boolean(user?.confirmed_at ?? user?.email_confirmed_at);
}

function LanguageSwitcher({ lang, setLang }: { readonly lang: Lang; readonly setLang: (lang: Lang) => void }) {
  return (
    <div className="language-switcher" aria-label="Language">
      {(["en", "uk"] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={option === lang ? "active" : ""}
          onClick={() => setLang(option)}
          aria-pressed={option === lang}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function SkeletonBlock({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}

function SkeletonText({ width = "100%", height = "1em" }: { width?: string; height?: string }) {
  return <SkeletonBlock className="skeleton-text" style={{ "--skeleton-width": width, "--skeleton-height": height } as React.CSSProperties} />;
}

function DisabledInfoIcon({ className, size = 16 }: { readonly className: string; readonly size?: number }) {
  return (
    <button type="button" className={className} disabled aria-hidden="true" tabIndex={-1}>
      <Info size={size} />
    </button>
  );
}

interface KpiSkeletonGridProps {
  readonly count?: number;
  readonly className?: string;
  readonly labels?: readonly string[];
  readonly showInfoIcons?: boolean;
}

function KpiSkeletonGrid({ count = 6, className = "", labels = [], showInfoIcons = false }: KpiSkeletonGridProps) {
  const icons = [
    <CircleDollarSign size={20} />,
    <SunMedium size={20} />,
    <ArrowUpFromLine size={20} />,
    <ArrowDownToLine size={20} />,
    <WalletCards size={20} />,
    <CalendarClock size={20} />,
  ];

  return (
    <section id="overview" className={`kpi-grid${className ? ` ${className}` : ""}`} aria-busy="true">
      {Array.from({ length: count }).map((_, index) => (
        <article className="kpi-card kpi-card-loading" key={index}>
          {showInfoIcons ? <DisabledInfoIcon className="kpi-info-button" /> : null}
          <div className="kpi-icon">{icons[index % icons.length]}</div>
          {labels[index] ? <span>{labels[index]}</span> : <SkeletonText width="74px" height="22px" />}
          <SkeletonText width="112px" height="22px" />
          <SkeletonText width="138px" height="17px" />
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

interface DataTableSkeletonProps {
  readonly rowCount?: number;
}

function DataTableSkeleton({ rowCount = 12 }: DataTableSkeletonProps) {
  return (
    <div className="table-wrap" aria-busy="true">
      <table>
        <thead>
          <tr>
            {Array.from({ length: 12 }).map((_, index) => (
              <th key={index}>
                <span className={index >= 7 && index <= 10 ? "table-heading" : undefined}>
                  <SkeletonText width={index === 0 ? "54px" : "82px"} height="12px" />
                  {index >= 7 && index <= 10 ? <DisabledInfoIcon className="table-info-button" /> : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }).map((_, rowIndex) => (
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
      {label ? (
        <span className={deltaTone(delta)}>
          {`${formattedDelta} ${formatDeltaPct(delta, base)} ${label}`.replaceAll(" ", "\u00a0")}
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
  plantComparisonMode,
  plantComparisonMonth,
  plantComparisonMonthOptions,
  plantComparisonYear,
  plantComparisonYearOptions,
  setFirstPlantId,
  setSecondPlantId,
  setPlantComparisonMode,
  setPlantComparisonMonth,
  setPlantComparisonYear,
  onCompare,
  result,
  isLoading,
  error,
  t,
  currency,
  lang,
  onDeltaInfo,
}: {
  readonly activePlantId: string;
  readonly availablePlantIds: readonly string[];
  readonly firstPlantId: string;
  readonly secondPlantId: string;
  readonly plantComparisonMode: PlantComparisonMode;
  readonly plantComparisonMonth: string;
  readonly plantComparisonMonthOptions: readonly [string, string][];
  readonly plantComparisonYear: string;
  readonly plantComparisonYearOptions: readonly string[];
  readonly setFirstPlantId: (plantId: string) => void;
  readonly setSecondPlantId: (plantId: string) => void;
  readonly setPlantComparisonMode: (mode: PlantComparisonMode) => void;
  readonly setPlantComparisonMonth: (month: string) => void;
  readonly setPlantComparisonYear: (year: string) => void;
  readonly onCompare: () => void;
  readonly result: PlantComparisonResult | null;
  readonly isLoading: boolean;
  readonly error: string;
  readonly t: Record<string, string>;
  readonly currency: Currency;
  readonly lang: Lang;
  readonly onDeltaInfo: (title: string, body: React.ReactNode) => void;
}) {
  const displayedResult = result?.mode === plantComparisonMode ? result : null;
  const comparisonUpdated = displayedResult?.plants
    .map((plant) => `${plant.plantId} ${plant.sheetUpdatedAt ? formatDateTimeLabel(plant.sheetUpdatedAt, lang) : "-"}`)
    .join(" · ");
  const compareDisabled =
    isLoading ||
    !firstPlantId ||
    !secondPlantId ||
    (plantComparisonMode === "monthly" ? !plantComparisonYear : !plantComparisonMonth);

  return (
    <section className="plant-comparison-section">
      <div className="section-heading">
        <div>
          <h2>{t.plantComparison}</h2>
          <p>{t.comparisonHint}</p>
        </div>
        <div className="segmented plant-comparison-mode" aria-label={t.plantComparison}>
          {(["monthly", "daily"] as PlantComparisonMode[]).map((mode) => (
            <button key={mode} type="button" className={plantComparisonMode === mode ? "selected" : ""} onClick={() => setPlantComparisonMode(mode)}>
              {mode === "daily" ? t.compareDaily : t.compareMonthly}
            </button>
          ))}
        </div>
      </div>
      <div className="plant-comparison-controls">
        {plantComparisonMode === "monthly" ? (
          <label>
            <span>{t.compareYear}</span>
            <select value={plantComparisonYear} onChange={(event) => setPlantComparisonYear(event.target.value)}>
              {plantComparisonYearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            <span>{t.compareMonth}</span>
            <select value={plantComparisonMonth} onChange={(event) => setPlantComparisonMonth(event.target.value)}>
              {plantComparisonMonthOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
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
          className="compare-action-button"
          onClick={onCompare}
          disabled={compareDisabled}
        >
          <GitCompareArrows size={16} />
          <span>{isLoading ? "..." : t.compare}</span>
        </button>
      </div>
      {error ? <small className="negative">{error}</small> : null}
      <PlantPeriodComparisonCharts
        plants={displayedResult?.plants ?? []}
        activePlantId={activePlantId}
        mode={plantComparisonMode}
        period={plantComparisonMode === "monthly" ? displayedResult?.year ?? "" : displayedResult?.month ?? ""}
        t={t}
        currency={currency}
        lang={lang}
        onDeltaInfo={onDeltaInfo}
      />
      {comparisonUpdated ? <small className="plant-comparison-updated">{t.updated}: {comparisonUpdated}</small> : null}
    </section>
  );
}

function PlantPeriodComparisonCharts({
  plants,
  activePlantId,
  mode,
  period,
  t,
  currency,
  lang,
  onDeltaInfo,
}: {
  readonly plants: readonly PlantComparison[];
  readonly activePlantId: string;
  readonly mode: PlantComparisonMode;
  readonly period: string;
  readonly t: Record<string, string>;
  readonly currency: Currency;
  readonly lang: Lang;
  readonly onDeltaInfo: (title: string, body: React.ReactNode) => void;
}) {
  if (!plants.length || !period) return null;

  const periodPlants = plants.map((plant) => ({
    plantId: plant.plantId,
    metadata: plant.metadata,
    scopes: plant.scopes,
    rows:
      mode === "monthly"
        ? plant.rows.filter((row) => String(row.date.getFullYear()) === period)
        : plant.dailyRows.filter((row) => monthKey(row.date) === period),
  }));

  if (!periodPlants.some((plant) => plant.rows.length)) return null;

  const items = [
    {
      title: t.production,
      value: (row: MonthRow) => row.production,
      format: (value: number) => formatKwh(value, lang),
      unit: energyUnit(lang),
      higherIsBetter: true,
      capacityContext: true,
    },
    {
      title: t.export,
      value: (row: MonthRow) => exportTotal(row),
      format: (value: number) => formatKwh(value, lang),
      unit: energyUnit(lang),
      higherIsBetter: true,
    },
    {
      title: t.import,
      value: (row: MonthRow) => row.importTotal,
      format: (value: number) => formatKwh(value, lang),
      unit: energyUnit(lang),
      higherIsBetter: false,
    },
    {
      title: t.consumed,
      value: (row: MonthRow) => row.consumedTotal,
      format: (value: number) => formatKwh(value, lang),
      unit: energyUnit(lang),
      higherIsBetter: false,
    },
    {
      title: t.balance,
      value: (row: MonthRow) => row.balance,
      format: (value: number) => formatKwh(value, lang),
      unit: energyUnit(lang),
      higherIsBetter: false,
      invertDeltaSign: true,
    },
    {
      title: t.roi,
      value: (row: MonthRow) => rowRoiMoney(row, currency),
      format: (value: number) => formatDisplayMoney(value, currency, lang),
      unit: currencyUnit(currency),
      higherIsBetter: true,
    },
    {
      title: t.netPayment,
      value: (row: MonthRow) => moneyFromUah(row.electricityPayment, currency, row.usdRate),
      format: (value: number) => formatDisplayMoney(value, currency, lang),
      unit: currencyUnit(currency),
      higherIsBetter: true,
    },
  ];

  return (
    <div className="plant-comparison-chart-grid">
      {items.map((item) => (
        <article className="plant-comparison-chart chart-panel" key={item.title}>
          <div className="chart-head plant-line-chart-head">
            <h3>{item.title}</h3>
            <div className="legend">
              {periodPlants.map((plant, index) => (
                <span key={plant.plantId}>
                  <i style={{ background: comparisonLineColors[index % comparisonLineColors.length] }} /> {plant.plantId}
                  {plant.plantId === activePlantId ? <em>{t.activePlant}</em> : null}
                </span>
              ))}
            </div>
          </div>
          <PlantPeriodLineChart
            plants={periodPlants}
            mode={mode}
            value={item.value}
            format={item.format}
            unit={item.unit}
            higherIsBetter={item.higherIsBetter}
            invertDeltaSign={item.invertDeltaSign}
            capacityContext={item.capacityContext}
            metricTitle={item.title}
            lang={lang}
            onDeltaInfo={onDeltaInfo}
          />
        </article>
      ))}
    </div>
  );
}

const comparisonLineColors = [colors.amber, colors.blue];

function PlantPeriodLineChart({
  plants,
  mode,
  value,
  format,
  unit,
  higherIsBetter,
  invertDeltaSign,
  capacityContext,
  metricTitle,
  lang,
  onDeltaInfo,
}: {
  readonly plants: readonly { readonly plantId: string; readonly rows: readonly MonthRow[]; readonly scopes: readonly string[]; readonly metadata?: PlantMetadata | null }[];
  readonly mode: PlantComparisonMode;
  readonly value: (row: MonthRow) => number;
  readonly format: (value: number) => string;
  readonly unit: string;
  readonly higherIsBetter: boolean;
  readonly invertDeltaSign?: boolean;
  readonly capacityContext?: boolean;
  readonly metricTitle: string;
  readonly lang: Lang;
  readonly onDeltaInfo: (title: string, body: React.ReactNode) => void;
}) {
  const isMobile = useMediaQuery("(max-width: 820px)");
  const width = 900;
  const height = 280;
  const pad = { left: 56, right: 22, top: 18, bottom: 42 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const periodKeys = useMemo(() => {
    const keys = [...new Set(plants.flatMap((plant) => plant.rows.map((row) => dateKey(row.date))))].sort();
    return isMobile ? keys.reverse() : keys;
  }, [isMobile, plants]);
  const values = plants.flatMap((plant) => plant.rows.map(value)).filter((item) => Number.isFinite(item));
  const rawMin = Math.min(...values, 0);
  const rawMax = Math.max(...values, 1);
  const spread = rawMax - rawMin || 1;
  const min = rawMin < 0 ? rawMin - spread * 0.04 : 0;
  const max = rawMax + spread * 0.04;
  const x = (date: string) => {
    const index = Math.max(0, periodKeys.indexOf(date));
    if (periodKeys.length <= 1) return pad.left + innerW / 2;
    return pad.left + (index / (periodKeys.length - 1)) * innerW;
  };
  const y = (item: number) => pad.top + innerH - ((item - min) / (max - min || 1)) * innerH;
  const rowByPlantAndDay = useMemo(
    () =>
      new Map(
        plants.map((plant) => [
          plant.plantId,
          new Map(plant.rows.map((row) => [dateKey(row.date), row])),
        ]),
    ),
    [plants],
  );
  const capacityByPlant = useMemo(
    () => new Map(plants.map((plant) => [plant.plantId, plantCapacityKwp(plant.metadata)])),
    [plants],
  );
  const deltaByPeriod = useMemo(
    () =>
      new Map(
        periodKeys.map((periodKey) => {
          const [firstPlant, secondPlant] = plants;
          const firstRow = firstPlant ? rowByPlantAndDay.get(firstPlant.plantId)?.get(periodKey) : undefined;
          const secondRow = secondPlant ? rowByPlantAndDay.get(secondPlant.plantId)?.get(periodKey) : undefined;
          if (!firstRow || !secondRow) return [periodKey, null] as const;

          return [periodKey, value(firstRow) - value(secondRow)] as const;
        }),
    ),
    [periodKeys, plants, rowByPlantAndDay, value],
  );
  const inspectors = useMemo(
    () =>
      new Map(
        periodKeys.map((periodKey) => {
          const date = new Date(`${periodKey}T00:00:00`);
          const delta = deltaByPeriod.get(periodKey);
          const [firstPlant, secondPlant] = plants;
          const firstRow = firstPlant ? rowByPlantAndDay.get(firstPlant.plantId)?.get(periodKey) : undefined;
          const secondRow = secondPlant ? rowByPlantAndDay.get(secondPlant.plantId)?.get(periodKey) : undefined;
          const displayDelta = typeof delta === "number" && Number.isFinite(delta) ? comparisonDisplayDelta(delta, invertDeltaSign) : undefined;
          const deltaInfo = capacityContext && typeof delta === "number" && Number.isFinite(delta) && firstPlant && secondPlant && firstRow && secondRow
            ? (
              <ProductionCapacityInfo
                firstLabel={firstPlant.plantId}
                secondLabel={secondPlant.plantId}
                firstProduction={value(firstRow)}
                secondProduction={value(secondRow)}
                firstCapacity={capacityByPlant.get(firstPlant.plantId)}
                secondCapacity={capacityByPlant.get(secondPlant.plantId)}
                firstMetadata={firstPlant.metadata}
                secondMetadata={secondPlant.metadata}
                firstScopes={firstPlant.scopes}
                secondScopes={secondPlant.scopes}
                lang={lang}
              />
            )
            : undefined;
          return [
            periodKey,
            {
              month: mode === "monthly" ? formatMonthYear(date, lang) : formatDayLabel(date, lang),
              delta: typeof displayDelta === "number"
                ? `Δ ${formatSignedValue(displayDelta, format)}${secondRow ? formatDeltaPctComma(displayDelta, value(secondRow)) : ""}`
                : undefined,
              deltaTone: typeof delta === "number" && Number.isFinite(delta) ? comparisonDeltaTone(delta, higherIsBetter) : undefined,
              deltaInfoTitle: deltaInfo ? `${metricTitle} · ${mode === "monthly" ? formatMonthYear(date, lang) : formatDayLabel(date, lang)}` : undefined,
              deltaInfo,
              items: plants.map((plant, index) => {
                const row = rowByPlantAndDay.get(plant.plantId)?.get(periodKey);
                return {
                  label: plant.plantId,
                  value: row ? format(value(row)) : "-",
                  color: comparisonLineColors[index % comparisonLineColors.length],
                };
              }),
            },
          ];
        }),
      ),
    [capacityByPlant, capacityContext, deltaByPeriod, format, higherIsBetter, invertDeltaSign, lang, metricTitle, mode, periodKeys, plants, rowByPlantAndDay, value],
  );
  const latestPeriod = [...periodKeys].sort().at(-1);
  const { selection, target } = useChartInspector(latestPeriod ? inspectors.get(latestPeriod) ?? null : null);
  const selectedPeriod = [...inspectors.entries()].find(([, inspector]) => inspector.month === selection?.month)?.[0];

  return (
    <>
      <div className="chart-scroll plant-line-chart-scroll">
        <svg className="chart plant-line-chart" viewBox={`0 0 ${width} ${height}`} role="img">
          <g className="grid">
            {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
              const tickValue = min + (max - min) * tick;
              const tickY = y(tickValue);
              return (
                <g key={tick}>
                  <line x1={pad.left} x2={width - pad.right} y1={tickY} y2={tickY} />
                  <text x={pad.left - 10} y={tickY + 4} textAnchor="end">
                    {formatAxisValue(tickValue)}
                  </text>
                </g>
              );
            })}
          </g>
          {min < 0 && max > 0 ? <line className="plant-line-zero" x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} /> : null}
          {plants.map((plant, plantIndex) => {
            const points = plant.rows
              .filter((row) => periodKeys.includes(dateKey(row.date)))
              .map((row) => ({ row, x: x(dateKey(row.date)), y: y(value(row)), value: value(row) }))
              .sort((first, second) => periodKeys.indexOf(dateKey(first.row.date)) - periodKeys.indexOf(dateKey(second.row.date)));
            const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
            const color = comparisonLineColors[plantIndex % comparisonLineColors.length];
            return (
              <g key={plant.plantId}>
                <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                {points.map((point) => {
                  const day = dateKey(point.row.date);
                  return (
                    <circle
                      key={`${plant.plantId}-${point.row.month}`}
                      className="plant-line-dot"
                      cx={point.x}
                      cy={point.y}
                      r={selectedPeriod === day ? "5.5" : "4"}
                      fill={color}
                    />
                  );
                })}
              </g>
            );
          })}
          {periodKeys.map((periodKey) => {
            const inspector = inspectors.get(periodKey);
            const date = new Date(`${periodKey}T00:00:00`);
            const xPosition = x(periodKey);
            const targetWidth = Math.max(18, innerW / Math.max(periodKeys.length - 1, 1) * 0.48);
            return (
              <g key={periodKey}>
                {inspector && (
                  <MonthTarget
                    x={xPosition - targetWidth / 2}
                    y={pad.top}
                    width={targetWidth}
                    height={innerH}
                    selection={inspector}
                    active={selectedPeriod === periodKey}
                    target={target}
                  />
                )}
                <text className="plant-line-day-label" x={xPosition} y={height - 14} textAnchor="middle">
                  {mode === "monthly" ? formatMonthShortOnly(date, lang) : formatDayOnlyLabel(date, lang)}
                </text>
              </g>
            );
          })}
          <text x={width - pad.right} y={pad.top + 4} textAnchor="end" className="plant-line-unit">
            {unit}
          </text>
        </svg>
      </div>
      <ChartInspector
        selection={selection}
        hint={i18n[lang].tapBarOrDot}
        onDeltaInfo={capacityContext ? onDeltaInfo : undefined}
      />
    </>
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
      tone: () => "muted",
      barColor: () => colors.amber,
    },
    {
      title: t.export,
      values: plants.map((plant) => (plant.row ? exportTotal(plant.row) : undefined) ?? 0),
      format: (value: number) => formatKwh(value, lang),
      color: colors.green,
      tone: () => "muted",
      barColor: () => colors.green,
    },
    {
      title: t.import,
      values: plants.map((plant) => plant.row?.importTotal ?? 0),
      format: (value: number) => formatKwh(value, lang),
      color: colors.blue,
      tone: () => "muted",
      barColor: () => colors.blue,
    },
    {
      title: t.importDay,
      values: plants.map((plant) => plant.row?.importDay ?? 0),
      format: (value: number) => formatKwh(value, lang),
      color: colors.blue,
      tone: () => "muted",
      barColor: () => colors.blue,
    },
    {
      title: t.importNight,
      values: plants.map((plant) => plant.row?.importNight ?? 0),
      format: (value: number) => formatKwh(value, lang),
      color: colors.indigo,
      tone: () => "muted",
      barColor: () => colors.indigo,
    },
    {
      title: t.consumed,
      values: plants.map((plant) => plant.row?.consumedTotal ?? 0),
      format: (value: number) => formatKwh(value, lang),
      color: colors.mint,
      tone: () => "muted",
      barColor: () => colors.mint,
    },
    {
      title: t.consumedDay,
      values: plants.map((plant) => plant.row?.consumedDay ?? 0),
      format: (value: number) => formatKwh(value, lang),
      color: colors.blue,
      tone: () => "muted",
      barColor: () => colors.blue,
    },
    {
      title: t.consumedNight,
      values: plants.map((plant) => plant.row?.consumedNight ?? 0),
      format: (value: number) => formatKwh(value, lang),
      color: colors.indigo,
      tone: () => "muted",
      barColor: () => colors.indigo,
    },
    {
      title: t.balance,
      values: plants.map((plant) => plant.row?.balance ?? 0),
      format: (value: number) => formatKwh(value, lang),
      color: colors.ink,
      tone: (value: number) => (value < 0 ? "positive" : value > 0 ? "negative" : "muted"),
      barColor: (value: number) => (value < 0 ? colors.green : value > 0 ? colors.rose : colors.ink),
    },
    {
      title: t.roi,
      values: plants.map((plant) => (plant.row ? rowRoiMoney(plant.row, currency) : 0)),
      format: (value: number) => formatDisplayMoney(value, currency, lang),
      color: colors.green,
      tone: (value: number) => (value > 0 ? "positive" : value < 0 ? "negative" : "muted"),
      barColor: (value: number) => (value >= 0 ? colors.green : colors.rose),
    },
    {
      title: t.netPayment,
      values: plants.map((plant) => (plant.row ? moneyFromUah(plant.row.electricityPayment, currency, plant.row.usdRate) : 0)),
      format: (value: number) => formatDisplayMoney(value, currency, lang),
      color: colors.blue,
      tone: (value: number) => (value > 0 ? "positive" : value < 0 ? "negative" : "muted"),
      barColor: (value: number) => (value >= 0 ? colors.blue : colors.rose),
    },
  ];

  return (
    <div className="plant-comparison-chart-grid">
      {items.map((item) => (
        <article className="plant-comparison-chart chart-panel" key={item.title}>
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
                color={item.barColor(item.values[index] ?? 0)}
                tone={item.tone(item.values[index] ?? 0)}
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
  tone,
  isActive,
}: {
  readonly label: string;
  readonly detail: string;
  readonly value: number;
  readonly formattedValue: string;
  readonly max: number;
  readonly color: string;
  readonly tone: string;
  readonly isActive: boolean;
}) {
  const lang = useLanguage();
  const width = `${chartLevel(value, max)}%`;

  return (
    <div className="comparison-bar-row">
      <div className="comparison-bar-label">
        <span className="comparison-bar-name">
          <strong>{label}</strong>
          {isActive ? <i>{i18n[lang].activePlant}</i> : null}
        </span>
        <small>{detail}</small>
      </div>
      <div className="comparison-bar-track">
        <i style={{ width, minWidth: value === 0 ? 0 : undefined, background: color }} />
      </div>
      <b className={tone}>{formattedValue}</b>
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
  infoLabel,
  onInfo,
}: {
  title: string;
  legend: [string, string][];
  children: React.ReactNode;
  infoLabel?: string;
  onInfo?: () => void;
}) {
  return (
    <article className="chart-panel">
      <div className="chart-head">
        <div>
          <h2 className={onInfo ? "heading-with-info" : undefined}>
            <span>{title}</span>
            {onInfo && (
              <button type="button" className="section-info-button" aria-label={infoLabel ?? title} onClick={onInfo}>
                <Info size={16} />
              </button>
            )}
          </h2>
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

function PvSpecList({
  field,
  t,
  lang,
  showLocation,
}: {
  readonly field: PvMetadata;
  readonly t: Record<string, string>;
  readonly lang: Lang;
  readonly showLocation: boolean;
}) {
  const rows = [
    [t.power, formatKwp(field.power / 1000, lang)],
    [t.azimuth, `${formatNumber(field.azimuth, 0, 0)}°`],
    [t.slope, `${formatNumber(field.slope, 0, 0)}°`],
    [t.loss, `${formatNumber(field.loss, 2, 0)}%`],
    [t.mounting, formatMounting(field.mounting, lang)],
    [t.elevation, `${formatNumber(field.elevation, 0, 0)} m`],
    ...(showLocation ? [[
      t.location,
      <a
        className="pv-location-link"
        href={`https://www.google.com/maps?q=${field.lat},${field.lng}`}
        target="_blank"
        rel="noreferrer"
      >
        {formatNumber(field.lat, 6, 4)}, {formatNumber(field.lng, 6, 4)}
      </a>,
    ] as const] : []),
  ] as const;

  return (
    <dl className="info-list pv-spec-list">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
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
  readonly delta?: string;
  readonly deltaTone?: string;
  readonly deltaInfoTitle?: string;
  readonly deltaInfo?: React.ReactNode;
  readonly items: readonly ChartInspectorItem[];
}

function useChartInspector(initialSelection: ChartInspectorSelection | null) {
  const [selection, setSelection] = useState<ChartInspectorSelection | null>(initialSelection);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const previousInitialMonth = useRef(initialSelection?.month ?? null);
  useEffect(() => {
    const initialMonth = initialSelection?.month ?? null;
    setSelection((current) => {
      if (previousInitialMonth.current !== initialMonth) {
        previousInitialMonth.current = initialMonth;
        return initialSelection;
      }

      return current ?? initialSelection;
    });
  }, [initialSelection]);
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

function ChartInspector({
  selection,
  hint,
  onDeltaInfo,
}: {
  selection: ChartInspectorSelection | null;
  hint: string;
  onDeltaInfo?: (title: string, body: React.ReactNode) => void;
}) {
  if (!selection) return <div className="chart-inspector chart-inspector-empty">{hint}</div>;
  return (
    <div className={`chart-inspector${selection.deltaInfo && onDeltaInfo ? " has-delta-info" : ""}`}>
      <strong className="chart-inspector-period">
        <span>{selection.month}</span>
        {selection.delta ? <em className={selection.deltaTone}>{selection.delta}</em> : null}
        {selection.deltaInfo && onDeltaInfo ? (
          <button
            type="button"
            className="table-info-button chart-inspector-info"
            aria-label="Delta details"
            onClick={() => onDeltaInfo(selection.deltaInfoTitle ?? selection.month, selection.deltaInfo)}
          >
            <Info size={12} />
          </button>
        ) : null}
      </strong>
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

function ProductionExportChart({
  rows,
  projection,
}: {
  readonly rows: readonly MonthRow[];
  readonly projection?: ProductionProjection | null;
}) {
  const lang = useLanguage();
  const t = i18n[lang];
  const isMobile = useMediaQuery("(max-width: 820px)");
  const displayRows = useMemo(() => (isMobile ? newestFirst(rows) : rows), [isMobile, rows]);
  const expectedByMonth = useMemo(
    () => new Map(displayRows.map((row) => [row.month, projectedProduction(row, projection)])),
    [displayRows, projection],
  );
  const inspectors = useMemo(
    () =>
      new Map(
        displayRows.map((row) => {
          const expected = expectedByMonth.get(row.month);
          return [
            row.month,
            {
              month: formatPeriodLabel(row, lang),
              items: [
              { label: t.production, value: formatKwh(row.production, lang), color: colors.amber },
              { label: t.export, value: formatKwh(exportTotal(row), lang), color: colors.green },
              ...(expected ? [{ label: t.expected, value: formatKwh(expected, lang), color: colors.blue }] : []),
              ],
            },
          ];
        }),
      ),
    [displayRows, expectedByMonth, lang, t.export, t.expected, t.production],
  );
  const latestRow = rows.at(-1);
  const { selection, target } = useChartInspector(latestRow ? inspectors.get(latestRow.month) ?? null : null);
  const width = 900;
  const height = 300;
  const pad = { left: 48, right: 18, top: 18, bottom: 42 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const expectedValues = displayRows
    .map((row) => expectedByMonth.get(row.month))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  const max = axisMax(displayRows.flatMap((row) => [row.production, exportTotal(row), expectedByMonth.get(row.month) ?? 0]));
  const band = chartBand(innerW, displayRows.length);
  const bar = pairedChartBarWidth(band, 14, 0.24);
  const y = (value: number) => pad.top + innerH - (value / max) * innerH;
  const expectedPoints = displayRows
    .map((row, index) => {
      const expected = expectedByMonth.get(row.month);
      return expected ? `${pad.left + band * index + band / 2},${y(expected)}` : "";
    })
    .filter(Boolean)
    .join(" ");

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
                  x={x - bar}
                  y={y(row.production)}
                  width={bar}
                  height={innerH - (y(row.production) - pad.top)}
                  rx="3"
                  fill={colors.amber}
                />
                <rect
                  x={x}
                  y={y(exportTotal(row))}
                  width={bar}
                  height={innerH - (y(exportTotal(row)) - pad.top)}
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
          {expectedValues.length > 0 && (
            <>
              <polyline
                points={expectedPoints}
                fill="none"
                stroke={colors.blue}
                strokeWidth="3"
                strokeDasharray="8 7"
                strokeLinejoin="round"
                pointerEvents="none"
              />
              {displayRows.map((row, index) => {
                const expected = expectedByMonth.get(row.month);
                if (!expected) return null;
                return (
                  <circle
                    key={`${row.month}-expected`}
                    cx={pad.left + band * index + band / 2}
                    cy={y(expected)}
                    r="4"
                    fill="var(--panel)"
                    stroke={colors.blue}
                    strokeWidth="2"
                    pointerEvents="none"
                  />
                );
              })}
            </>
          )}
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
  const lang = useLanguage();
  const t = i18n[lang];
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
            month: formatPeriodLabel(item.row, lang),
            items: [
              { label: t.roi, value: formatDisplayMoney(item.monthly, currency, lang), color: colors.green },
              {
                label: `${t.cumulative} ${t.roi}`,
                value: `${formatDisplayMoney(item.cumulative, currency, lang)} (${formatNumber(item.cumulativePct)}%)`,
                color: colors.ink,
                wide: true,
              },
            ],
          },
        ]),
      ),
    [currency, displayRows, lang, t.cumulative, t.roi],
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
  const lang = useLanguage();
  const t = i18n[lang];
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
              month: formatPeriodLabel(row, lang),
              items: [
                { label: t.savings, value: formatDisplayMoney(savings, currency, lang), color: colors.mint },
                { label: t.payment, value: formatDisplayMoney(electricityPayment, currency, lang), color: electricityPayment >= 0 ? colors.green : colors.rose },
              ],
            },
          ];
        }),
      ),
    [currency, displayRows, lang, t.payment, t.savings],
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
  const bar = pairedChartBarWidth(band, 13, 0.24);
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
                  x={x - bar}
                  y={Math.min(savingsY, zeroY)}
                  width={bar}
                  height={Math.abs(zeroY - savingsY)}
                  rx="3"
                  fill={colors.mint}
                />
                <rect
                  x={x}
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
  const lang = useLanguage();
  const t = i18n[lang];
  const isMobile = useMediaQuery("(max-width: 820px)");
  const displayRows = useMemo(() => (isMobile ? newestFirst(rows) : rows), [isMobile, rows]);
  const inspectors = useMemo(
    () =>
      new Map(
        displayRows.map((row) => [
          row.month,
          {
            month: `${formatPeriodLabel(row, lang)} · ${formatKwh(row.importDay + row.importNight, lang)}`,
            items: [
              { label: t.day, value: formatKwh(row.importDay, lang), color: colors.blue },
              { label: t.night, value: formatKwh(row.importNight, lang), color: colors.indigo },
            ],
          },
        ]),
      ),
    [displayRows, lang, t.day, t.night],
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
  const lang = useLanguage();
  const t = i18n[lang];
  const isMobile = useMediaQuery("(max-width: 820px)");
  const displayRows = useMemo(() => (isMobile ? newestFirst(rows) : rows), [isMobile, rows]);
  const inspectors = useMemo(
    () =>
      new Map(
        displayRows.map((row) => [
          row.month,
          {
            month: `${formatPeriodLabel(row, lang)} · ${formatKwh(row.consumedDay + row.consumedNight, lang)}`,
            items: [
              { label: t.day, value: formatKwh(row.consumedDay, lang), color: colors.blue },
              { label: t.night, value: formatKwh(row.consumedNight, lang), color: colors.indigo },
            ],
          },
        ]),
      ),
    [displayRows, lang, t.day, t.night],
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
  onExportSplitInfo,
  onConsumedSplitInfo,
  onExportPriceInfo,
  onNetPaymentInfo,
  onRoiValueInfo,
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
  readonly onExportSplitInfo: (row: MonthRow) => void;
  readonly onConsumedSplitInfo: (row: MonthRow) => void;
  readonly onExportPriceInfo: (row: MonthRow) => void;
  readonly onNetPaymentInfo: (row: MonthRow) => void;
  readonly onRoiValueInfo: (row: MonthRow) => void;
}) {
  const monthOptions = useMemo(
    () => [...new Map(allRows.map((row) => [monthKey(row.date), formatMonthYear(row.date, lang)])).entries()].reverse(),
    [allRows, lang],
  );
  const [dailyMonthFilter, setDailyMonthFilter] = useState(monthOptions[0]?.[0] ?? "");
  const effectiveDailyMonthFilter = dailyMonthFilter || (monthOptions[0]?.[0] ?? "");
  const selectedRows = useMemo(
    () => allRows.filter((row) => monthKey(row.date) === effectiveDailyMonthFilter),
    [allRows, effectiveDailyMonthFilter],
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
    if (!dailyMonthFilter || !monthOptions.some(([key]) => key === dailyMonthFilter)) {
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
            value={formatKwh(exportTotal(latest), lang)}
            detail={`${pct((exportTotal(latest) / latest.production) * 100)} ${t.exported}`}
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
              <select value={effectiveDailyMonthFilter} onChange={(event) => setDailyMonthFilter(event.target.value)}>
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
          onExportSplitInfo={onExportSplitInfo}
          onConsumedSplitInfo={onConsumedSplitInfo}
          onExportPriceInfo={onExportPriceInfo}
          onNetPaymentInfo={onNetPaymentInfo}
          onRoiValueInfo={onRoiValueInfo}
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
      first: formatKwh(exportTotal(first), lang),
      second: formatKwh(exportTotal(second), lang),
      delta: formatSignedKwh(exportTotal(second) - exportTotal(first), lang),
      firstValue: exportTotal(first),
      secondValue: exportTotal(second),
      value: exportTotal(second) - exportTotal(first),
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
          "--first-level": `${chartLevel(row.firstValue, chartMax, 8)}%`,
          "--second-level": `${chartLevel(row.secondValue, chartMax, 8)}%`,
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
  onExportSplitInfo,
  onConsumedSplitInfo,
  onExportPriceInfo,
  onNetPaymentInfo,
  onRoiValueInfo,
  onUtilityMeterInfo,
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
  readonly onExportSplitInfo: (row: MonthRow) => void;
  readonly onConsumedSplitInfo: (row: MonthRow) => void;
  readonly onExportPriceInfo: (row: MonthRow) => void;
  readonly onNetPaymentInfo: (row: MonthRow) => void;
  readonly onRoiValueInfo: (row: MonthRow) => void;
  readonly onUtilityMeterInfo?: (row: MonthRow) => void;
}) {
  const newestFirst = [...rows].sort((a, b) => b.date.getTime() - a.date.getTime());
  const kwh = energyUnit(lang);
  const money = currencyUnit(currency);
  const totals = rows.reduce(
    (sum, row) => ({
      production: sum.production + row.production,
      export: sum.export + exportTotal(row),
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
              <th>
                {period === "monthly" && row.utilityMeter && onUtilityMeterInfo ? (
                  <TableValueInfo value={row.month} label={t.utilityMeter} onInfo={() => onUtilityMeterInfo(row)} />
                ) : (
                  period === "daily" ? formatDayMonthLabel(row.date, lang) : row.month
                )}
              </th>
              <td>{formatNumber(row.production, 2, 2)}</td>
              <td>
                <TableValueInfo value={formatNumber(exportTotal(row), 2, 2)} label={t.export} onInfo={() => onExportSplitInfo(row)} />
              </td>
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
                  value={
                    hasSplitExportPrice(row)
                      ? `${formatTableMoney(moneyFromUah(netExportPrice(row), currency, row.usdRate), currency, lang)} / ${formatTableMoney(moneyFromUah(netExportNightPrice(row), currency, row.usdRate), currency, lang)}`
                      : formatTableMoney(moneyFromUah(netExportPrice(row), currency, row.usdRate), currency, lang)
                  }
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
              <td className="positive">
                <TableValueInfo
                  value={formatTableMoney(rowRoiMoney(row, currency), currency, lang)}
                  label={t.roi}
                  onInfo={() => onRoiValueInfo(row)}
                />
              </td>
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

function DayNightInfo({
  t,
  lang,
  day,
  night,
}: {
  readonly t: Record<string, string>;
  readonly lang: Lang;
  readonly day: number;
  readonly night: number;
}) {
  return (
    <dl className="split-info">
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

function ExportPriceInfo({
  t,
  grossDay,
  grossNight,
  netDay,
  netNight,
  vat,
  military,
}: {
  readonly t: Record<string, string>;
  readonly grossDay: string;
  readonly grossNight: string;
  readonly netDay: string;
  readonly netNight: string;
  readonly vat: string;
  readonly military: string;
}) {
  return (
    <StackedValues
      rows={[
        { label: t.day, value: grossDay, tone: "day" as const },
        { label: t.night, value: grossNight, tone: "night" as const },
        {
          label: t.taxes,
          value: (
            <span className="tax-inline-values">
              <span>{vat} {t.vat}</span>
              {", "}
              <span>{military} {t.militaryTax}</span>
            </span>
          ),
        },
        { label: t.day, value: netDay, tone: "day" as const },
        { label: t.night, value: netNight, tone: "night" as const },
      ]}
    />
  );
}

function UtilityMeterInfo({
  row,
  t,
  lang,
}: {
  readonly row: MonthRow;
  readonly t: Record<string, string>;
  readonly lang: Lang;
}) {
  const meter = row.utilityMeter;
  if (!meter) return null;
  const diff = {
    importDay: meter.utility.importDay - meter.ha.importDay,
    importNight: meter.utility.importNight - meter.ha.importNight,
    exportDay: meter.utility.exportDay - meter.ha.exportDay,
    exportNight: meter.utility.exportNight - meter.ha.exportNight,
  };
  const signedKwh = (value: number) => `${value > 0 ? "+" : ""}${formatKwh(value, lang)}`;

  return (
    <div className="info-stack">
      <MathInfo
        rows={[
          {
            label: t.dashboardValues,
            value: (
              <UtilitySplitTable t={t} lang={lang} values={meter.ha} />
            ),
          },
          {
            label: t.meterValues,
            value: (
              <UtilitySplitTable t={t} lang={lang} values={meter.utility} />
            ),
          },
          {
            label: t.delta,
            value: (
              <UtilitySplitTable t={t} lang={lang} values={diff} formatValue={signedKwh} colorDeltas />
            ),
          },
        ]}
      />
      <p>{t.usedForCalculations}</p>
    </div>
  );
}

function UtilitySplitTable({
  t,
  lang,
  values,
  formatValue = (value: number) => formatKwh(value, lang),
  colorDeltas = false,
}: {
  readonly t: Record<string, string>;
  readonly lang: Lang;
  readonly values: {
    readonly importDay: number;
    readonly importNight: number;
    readonly exportDay: number;
    readonly exportNight: number;
  };
  readonly formatValue?: (value: number) => string;
  readonly colorDeltas?: boolean;
}) {
  const deltaClass = (value: number, higherIsBetter: boolean) => colorDeltas ? comparisonDeltaTone(value, higherIsBetter) : undefined;

  return (
    <table className="price-comparison-table">
      <thead>
        <tr>
          <th aria-label={t.utilityMeter} />
          <th>{t.day}</th>
          <th>{t.night}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th>{t.import}</th>
          <td className={deltaClass(values.importDay, false)}>{formatValue(values.importDay)}</td>
          <td className={deltaClass(values.importNight, false)}>{formatValue(values.importNight)}</td>
        </tr>
        <tr>
          <th>{t.export}</th>
          <td className={deltaClass(values.exportDay, true)}>{formatValue(values.exportDay)}</td>
          <td className={deltaClass(values.exportNight, true)}>{formatValue(values.exportNight)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function RoiInfo({
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
  const costWithoutSolar = moneyFromUah(row.consumedPayment, currency, row.usdRate);
  const netPayment = moneyFromUah(row.electricityPayment, currency, row.usdRate);
  const roi = rowRoiMoney(row, currency);
  const tariff = tariffFromRow(row);
  const breakdown = importCostBreakdown(row.consumedDay, row.consumedNight, tariff);
  const costRows: StackedValueRow[] = [];
  const costParts: number[] = [];
  const pushCostRow = (label: string, kwh: number, price: number, tone?: "day" | "night", showZero = false) => {
    if (kwh <= 0 && !showZero) return;
    const cost = kwh * price;
    costParts.push(cost);
    costRows.push({
      label,
      tone,
      value: (
        <>
          {displayMoney(cost)} = {displayMoney(price)} × {formatKwh(kwh, lang)}
        </>
      ),
    });
  };

  if (row.electricHeatingThresholdKwh) {
    pushCostRow(t.day, breakdown.discountedDay, row.importPriceDay, "day", true);
    pushCostRow(t.night, breakdown.discountedNight, row.importPriceNight, "night", true);
    costRows.push({ label: t.after, value: formatKwh(row.electricHeatingThresholdKwh, lang) });
    pushCostRow(t.day, breakdown.regularDay, regularImportDayPrice(tariff), "day", true);
    pushCostRow(t.night, breakdown.regularNight, regularImportNightPrice(tariff), "night", true);
  } else {
    pushCostRow(t.day, breakdown.regularDay, row.importPriceDay, "day");
    pushCostRow(t.night, breakdown.regularNight, row.importPriceNight, "night");
  }

  costRows.push({
    label: t.total,
    value: costParts.length > 1 ? (
      <>
        {displayMoney(row.consumedPayment)} = {costParts.map((part, index) => (
          <React.Fragment key={index}>
            {index > 0 ? " + " : ""}
            {displayMoney(part)}
          </React.Fragment>
        ))}
      </>
    ) : (
      displayMoney(row.consumedPayment)
    ),
  });

  return (
    <MathInfo
      rows={[
        { label: t.electricityCostWithoutSolar, value: <StackedValues rows={costRows} /> },
        { label: t.netPayment, value: displayMoney(row.electricityPayment) },
        {
          label: t.roi,
          value: (
            <>
              <FormulaResult>{formatDisplayMoney(roi, currency, lang)}</FormulaResult> = {formatDisplayMoney(costWithoutSolar, currency, lang)} + {formatDisplayMoney(netPayment, currency, lang)}
            </>
          ),
        },
      ]}
      className="net-payment-math"
    />
  );
}

function NetPaymentInfo({
  row,
  commercialDate,
  dailyRows,
  t,
  currency,
  lang,
}: {
  readonly row: MonthRow;
  readonly commercialDate?: Date;
  readonly dailyRows: readonly MonthRow[];
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
  const tariff = tariffFromRow(row);
  const importCostRows = (
    breakdown: ImportCostBreakdown,
    { totalLabel = t.total, totalMultiplier = 1 }: { readonly totalLabel?: string; readonly totalMultiplier?: number } = {},
  ) => {
    const rows: StackedValueRow[] = [];
    const costParts: number[] = [];
    const displayCostPart = (value: number) => formatDisplayMoney(moneyFromUah(value, currency, row.usdRate), currency, lang, value === 0);
    const pushCostRow = (label: string, kwh: number, price: number, tone?: "day" | "night", showZero = false) => {
      if (kwh <= 0 && !showZero) return;
      const cost = kwh * price;
      costParts.push(cost);
      rows.push({
        label,
        tone,
        value: (
          <>
            {displayMoneyMath(cost)} = {displayMoney(price)} × {formatKwh(kwh, lang)}
          </>
        ),
      });
    };

    if (row.electricHeatingThresholdKwh) {
      pushCostRow(t.day, breakdown.discountedDay, row.importPriceDay, "day", true);
      pushCostRow(t.night, breakdown.discountedNight, row.importPriceNight, "night", true);
      rows.push({ label: t.after, value: formatKwh(row.electricHeatingThresholdKwh, lang) });
      pushCostRow(t.day, breakdown.regularDay, regularImportDayPrice(tariff), "day", true);
      pushCostRow(t.night, breakdown.regularNight, regularImportNightPrice(tariff), "night", true);
    } else {
      pushCostRow(t.day, breakdown.discountedDay, row.importPriceDay, "day");
      pushCostRow(t.night, breakdown.discountedNight, row.importPriceNight, "night");
      pushCostRow(t.day, breakdown.regularDay, regularImportDayPrice(tariff), "day");
      pushCostRow(t.night, breakdown.regularNight, regularImportNightPrice(tariff), "night");
    }

    rows.push({
      label: totalLabel,
      value: costParts.length > 1 ? (
        <>
          {displayMoneyMath(breakdown.total * totalMultiplier)} = {costParts.map((part, index) => (
            <React.Fragment key={index}>
              {index > 0 ? " + " : ""}
              {displayCostPart(part)}
            </React.Fragment>
          ))}
        </>
      ) : (
        displayMoneyMath(breakdown.total * totalMultiplier)
      ),
    });

    if (totalMultiplier < 0) {
      rows[rows.length - 1] = {
        label: totalLabel,
        value: (
          <>
            {displayMoneyMath(breakdown.total * totalMultiplier)} = -({costParts.length > 1 ? costParts.map((part, index) => (
              <React.Fragment key={index}>
                {index > 0 ? " + " : ""}
                {displayCostPart(part)}
              </React.Fragment>
            )) : displayMoney(breakdown.total)})
          </>
        ),
      };
    }
    return rows;
  };
  const importTotalValue = Math.max(row.importTotal, 0);
  const transitionRows = commercialTransitionRows(row, commercialDate, dailyRows);
  const inputRows: MathInfoRow[] = [
    {
      label: t.formulaInputs,
      value: (
        <InputValues
          rows={[
            { label: t.import, total: row.importTotal, day: row.importDay, night: row.importNight },
            { label: t.export, total: exportTotal(row), day: row.exportDay, night: row.exportNight },
            {
              label: t.balance,
              value: (
                <span className={row.balance < 0 ? "positive" : row.balance > 0 ? "negative" : "muted"}>
                  {formatKwh(row.balance, lang)}
                </span>
              ),
            },
          ]}
          lang={lang}
        />
      ),
    },
    {
      label: t.importPrices,
      value: (
        <StackedValues
          rows={[
            { label: t.day, value: `${displayMoney(row.importPriceDay)} / ${energyUnit(lang)}`, tone: "day" as const },
            { label: t.night, value: `${displayMoney(row.importPriceNight)} / ${energyUnit(lang)}`, tone: "night" as const },
            ...(row.electricHeatingThresholdKwh ? [
              { label: t.after, value: formatKwh(row.electricHeatingThresholdKwh, lang) },
              { label: t.day, value: `${displayMoney(regularImportDayPrice(tariff))} / ${energyUnit(lang)}`, tone: "day" as const },
              { label: t.night, value: `${displayMoney(regularImportNightPrice(tariff))} / ${energyUnit(lang)}`, tone: "night" as const },
            ] : []),
          ]}
        />
      ),
    },
    {
      label: t.exportPriceInput,
      value: (
        <ExportPriceInfo
          t={t}
          grossDay={displayMoney(row.exportPriceDay)}
          grossNight={displayMoney(row.exportPriceNight)}
          netDay={displayMoney(netExportPrice(row))}
          netNight={displayMoney(netExportNightPrice(row))}
          vat={`${formatNumber(row.exportVat, 2, 2)}%`}
          military={`${formatNumber(row.exportMilitary, 2, 2)}%`}
        />
      ),
    },
  ];
  const rows: MathInfoRow[] = [...inputRows];

  if (transitionRows) {
    const beforeExport = transitionRows.before.reduce((sum, current) => sum + exportTotal(current), 0);
    const afterExport = transitionRows.after.reduce((sum, current) => sum + exportTotal(current), 0);
    const beforeImportDay = transitionRows.before.reduce((sum, current) => sum + current.importDay, 0);
    const beforeImportNight = transitionRows.before.reduce((sum, current) => sum + current.importNight, 0);
    const beforePayment = transitionRows.before.reduce((sum, current) => sum + current.electricityPayment, 0);
    const afterPayment = transitionRows.after.reduce((sum, current) => sum + current.electricityPayment, 0);
    const beforeImportCostBreakdown = importCostBreakdown(beforeImportDay, beforeImportNight, tariff);
    const beforeImportCost = beforeImportCostBreakdown.total;
    const beforeImportCostParts = row.electricHeatingThresholdKwh ? [
      beforeImportCostBreakdown.discountedDay * row.importPriceDay,
      beforeImportCostBreakdown.discountedNight * row.importPriceNight,
      beforeImportCostBreakdown.regularDay * regularImportDayPrice(tariff),
      beforeImportCostBreakdown.regularNight * regularImportNightPrice(tariff),
    ] : [
      beforeImportCostBreakdown.regularDay * row.importPriceDay,
      beforeImportCostBreakdown.regularNight * row.importPriceNight,
    ];
    const displayCostPart = (value: number) => formatDisplayMoney(moneyFromUah(value, currency, row.usdRate), currency, lang, value === 0);
    const afterPaidExport = transitionRows.after.reduce(
      (sum, current) => {
        const paid = exportPayoutSplit(current);
        return { day: sum.day + paid.day, night: sum.night + paid.night };
      },
      { day: 0, night: 0 },
    );
    const afterPaidExportTotal = afterPaidExport.day + afterPaidExport.night;
    rows.push(
      {
        label: t.exportedOffset,
        value: (
          <StackedValues
            rows={[
              {
                label: t.beforeCommercialDate,
                value: (
                  <>
                    {displayMoney(0)} = {formatKwh(beforeExport, lang)} × {displayMoney(0)} ({t.exportUnpaid})
                  </>
                ),
              },
              {
                label: t.fromCommercialDate,
                value: hasSplitExportPrice(row) ? (
                  <StackedValues
                    rows={[
                      {
                        label: t.day,
                        value: `${displayMoney(afterPaidExport.day * netExportPrice(row))} = ${formatKwh(afterPaidExport.day, lang)} × ${displayMoney(netExportPrice(row))}`,
                        tone: "day" as const,
                      },
                      {
                        label: t.night,
                        value: `${displayMoney(afterPaidExport.night * netExportNightPrice(row))} = ${formatKwh(afterPaidExport.night, lang)} × ${displayMoney(netExportNightPrice(row))}`,
                        tone: "night" as const,
                      },
                      { label: t.total, value: displayMoneyMath(afterPayment) },
                    ]}
                  />
                ) : (
                  <>
                    {displayMoneyMath(afterPayment)} = {formatKwh(afterPaidExportTotal, lang)} × {displayMoney(netExportPrice(row))}
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
          <StackedValues
            rows={[
              {
                label: t.beforeCommercialDate,
                value: (
                  <>
                    {displayMoneyMath(beforePayment)} = -({beforeImportCostParts.map((part, index) => (
                      <React.Fragment key={index}>
                        {index > 0 ? " + " : ""}
                        {displayCostPart(part)}
                      </React.Fragment>
                    ))})
                  </>
                ),
              },
              { label: t.fromCommercialDate, value: displayMoneyMath(afterPayment) },
              {
                label: t.total,
                value: (
                  <>
                    {displayMoneyMath(row.electricityPayment)} = {displayMoney(beforePayment)} + {displayMoney(afterPayment)}
                  </>
                ),
              },
            ]}
          />
        ),
      },
    );
  } else if (!row.isCommercial) {
    rows.push(
      {
        label: t.exportedOffset,
        value: `${t.exportUnpaid}: ${formatKwh(exportTotal(row), lang)} → ${displayMoney(0)}`,
      },
      {
        label: t.netPayment,
        value: (
          <StackedValues rows={importCostRows(importCostBreakdown(row.importDay, row.importNight, tariff), { totalLabel: t.netPayment, totalMultiplier: -1 })} />
        ),
      },
    );
  } else if (row.balance < 0) {
    const surplus = Math.abs(row.balance);
    const paidSurplus = exportPayoutSplit(row);
    rows.push(
      {
        label: t.netSurplus,
        value: (
          <>
            <FormulaResult>{formatKwh(surplus, lang)}</FormulaResult> = {formatKwh(exportTotal(row), lang)} - {formatKwh(row.importTotal, lang)}
          </>
        ),
      },
      {
        label: t.netPayment,
        value: hasSplitExportPrice(row) ? (
          <StackedValues
            rows={[
              {
                label: t.day,
                value: `${displayMoney(paidSurplus.day * netExportPrice(row))} = ${formatKwh(paidSurplus.day, lang)} × ${displayMoney(netExportPrice(row))}`,
              },
              {
                label: t.night,
                value: `${displayMoney(paidSurplus.night * netExportNightPrice(row))} = ${formatKwh(paidSurplus.night, lang)} × ${displayMoney(netExportNightPrice(row))}`,
              },
              { label: t.total, value: displayMoneyMath(row.electricityPayment) },
            ]}
          />
        ) : (
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
    const coveredDay = exportTotal(row) * dayShare;
    const coveredNight = exportTotal(row) * nightShare;
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
                    <FormulaResult>{formatKwh(coveredDay, lang)}</FormulaResult> = {formatKwh(exportTotal(row), lang)} × {formatNumber(dayShare * 100, 2, 2)}% ({formatKwh(row.importDay, lang)} / {formatKwh(row.importTotal, lang)})
                  </>
                ),
              },
              {
                label: t.night,
                value: (
                  <>
                    <FormulaResult>{formatKwh(coveredNight, lang)}</FormulaResult> = {formatKwh(exportTotal(row), lang)} × {formatNumber(nightShare * 100, 2, 2)}% ({formatKwh(row.importNight, lang)} / {formatKwh(row.importTotal, lang)})
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
          <StackedValues rows={importCostRows(importCostBreakdown(remainingDay, remainingNight, tariff), { totalLabel: t.netPayment, totalMultiplier: -1 })} />
        ),
      },
    );
  }

  return <MathInfo rows={rows} className="net-payment-math" />;
}

function commercialTransitionRows(row: MonthRow, commercialDate: Date | undefined, dailyRows: readonly MonthRow[]) {
  if (!commercialDate) return undefined;
  if (!sameMonth(row.date, commercialDate) || row.date >= commercialDate) return undefined;

  const rows = dailyRows.filter((current) => sameMonth(current.date, row.date));
  if (!rows.length) return undefined;

  return {
    before: rows.filter((current) => current.date < commercialDate),
    after: rows.filter((current) => current.date >= commercialDate),
  };
}

function MathInfo({
  rows,
  className,
}: {
  readonly rows: readonly MathInfoRow[];
  readonly className?: string;
}) {
  return (
    <dl className={["math-info", className ?? ""].filter(Boolean).join(" ")}>
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
  readonly rows: readonly StackedValueRow[];
}) {
  return (
    <span className="stacked-values">
      {rows.map((row) => (
        <span key={row.label} className={row.wide ? "stacked-values-wide" : undefined}>
          {row.wide ? (
            <>
              <b aria-hidden="true" />
              <span>{row.value ?? row.label}</span>
            </>
          ) : (
            <>
              <b>{row.label}</b>
              <span className={row.tone ? `stacked-values-${row.tone}` : undefined}>{row.value}</span>
            </>
          )}
        </span>
      ))}
    </span>
  );
}

interface StackedValueRow {
  readonly label: string
  readonly value?: React.ReactNode
  readonly tone?: "day" | "night"
  readonly wide?: boolean
}

interface InputValueRow {
  readonly label: string
  readonly total?: number
  readonly day?: number
  readonly night?: number
  readonly value?: React.ReactNode
}

interface InputValuesProps {
  readonly rows: readonly InputValueRow[]
  readonly lang: Lang
}

function InputValues({ rows, lang }: InputValuesProps) {
  return (
    <span className="input-values">
      {rows.map((row) => (
        <span key={row.label}>
          <b>{row.label}:</b>
          <span>
            {row.value ?? (
              <>
                <FormulaResult>{formatKwh(row.total ?? 0, lang)}</FormulaResult>
                {" = "}
                <span className="input-values-day">{formatKwh(row.day ?? 0, lang)}</span>
                {" + "}
                <span className="input-values-night">{formatKwh(row.night ?? 0, lang)}</span>
              </>
            )}
          </span>
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
    {APP_MODE === "portal" ? <PortalRoot /> : <App />}
  </React.StrictMode>,
);
