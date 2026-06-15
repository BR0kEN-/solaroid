import { Panel } from './schema.ts'

function normalizeAspect(value: number) {
  if (value > 180) return value - 360
  if (value < -180) return value + 360
  return value
}

function buildPvgisUrl(panel: Solaroid.Supabase.Plant.Pv.Field) {
  const url = new URL('https://re.jrc.ec.europa.eu/api/v5_3/PVcalc')

  url.searchParams.set('lat', String(panel.lat))
  url.searchParams.set('lon', String(panel.lng))
  url.searchParams.set('loss', String(panel.loss))
  url.searchParams.set('angle', String(panel.slope))
  url.searchParams.set('aspect', String(normalizeAspect(panel.azimuth - 180)))
  url.searchParams.set('peakpower', String(panel.power / 1000))
  url.searchParams.set('mountingplace', panel.mounting)
  url.searchParams.set('usehorizon', '1')
  url.searchParams.set('userhorizon', '')
  url.searchParams.set('raddatabase', 'PVGIS-SARAH3')
  url.searchParams.set('pvtechchoice', 'crystSi')
  url.searchParams.set('outputformat', 'json')

  return url
}

async function fetchPvgisProductionProjection(metadata: Solaroid.Supabase.Plant.Metadata): Promise<Solaroid.Supabase.Pvgis.Projection | null> {
  const panels = metadata.pvs?.map((panel) => Panel.parse(panel)) ?? []

  if (!panels.length) return null

  const monthlyKwh = Array.from({ length: 12 }, () => 0)
  const dailyKwh = [...monthlyKwh]

  await Promise.all(
    panels.map(async (panel) => {
      const response = await fetch(buildPvgisUrl(panel))

      if (!response.ok) throw new Error(`PVGIS projection failed: ${response.status}`)

      const data = await response.json() as Solaroid.Supabase.Pvgis.Response

      for (const row of data.outputs?.monthly?.fixed ?? []) {
        const index = row.month - 1
        if (index < 0 || index > 11) continue
        monthlyKwh[index] += row.E_m ?? 0
        dailyKwh[index] += row.E_d ?? 0
      }
    }),
  )

  return { monthlyKwh, dailyKwh }
}

export {
  fetchPvgisProductionProjection,
}
