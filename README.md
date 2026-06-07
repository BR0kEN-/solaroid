# Solaroid

`Solar` + `ROI` + `d` to make it a fun word.

## Supabase

### Edge Function

#### Ingest

Receives Home Assistant events and writes them into Supabase:

- upserts `days`
- upserts `months`
- inserts `month_tariffs` once per `(plant_id, date)`

Ingest authorization is based on `access_tokens`. Each token can read and write its own `plant_id`; extra read-only plant access can be added through `access_token_read_scopes`.

Create a token by storing its SHA-256 hash:

```sql
insert into public.access_tokens (plant_id, token_hash)
values ('my_plant', encode(extensions.digest('RAW_TOKEN_VALUE', 'sha256'), 'hex'));
```

## Home Assistant

Sample event + an automation that delivers it.

### Event

Make sure this lives somewhere in your Home Assistant's `configuration.yaml`:

```yaml
rest_command:
  utility_payment_update_supa:
    url: "https://PROJECT_ID.supabase.co/functions/v1/ingest"
    method: post
    timeout: 30
    content_type: "application/json"
    headers:
      Authorization: "Bearer RAW_TOKEN_VALUE"
    payload: >
      {
        "today": {
          "production": {{ states('sensor.inverter_today_production')|float(0) }},
          "export": {{ states('sensor.inverter_today_energy_export')|float(0) }},
          "consumption": {
            "day": {{ states('sensor.deye_sun_20k_lp_electricity_consumed_today_day')|float(0) }},
            "night": {{ states('sensor.deye_sun_20k_lp_electricity_consumed_today_night')|float(0) }}
          },
          "import": {
            "day": {{ states('sensor.deye_sun_20k_lp_grid_import_today_day')|float(0) }},
            "night": {{ states('sensor.deye_sun_20k_lp_grid_import_today_night')|float(0) }}
          },
          "currency": {
            "uahUsd": {{ states('sensor.usd_selling_rate_dnipro')|float(0) }},
            "uahEur": {{ states('sensor.eur_selling_rate_dnipro')|float(0) }}
          }
        },
        "thisMonth": {
          "production": {{ states('sensor.deye_sun_20k_lp_electricity_produced')|float(0) }},
          "export": {{ states('sensor.grid_export')|float(0) }},
          "consumption": {
            "day": {{ states('sensor.electricity_consumed_day')|float(0) }},
            "night": {{ states('sensor.electricity_consumed_night')|float(0) }}
          },
          "import": {
            "day": {{ states('sensor.grid_import_day')|float(0) }},
            "night": {{ states('sensor.grid_import_night')|float(0) }}
          },
          "monetary": {
            "import": {
              "day": {{ states('input_number.electricity_base_rate')|float(0) }},
              "night": {{ states('sensor.electricity_night_rate')|float(0) }}
            },
            "export": {
              "value": {{ states('input_number.electricity_export_rate')|float(0) }},
              "taxes": [
                ["vat", 18],
                ["mil", 5]
              ]
            }
          }
        }
      }
```

### Automation

Runs every 20 mins.

```yaml
mode: single
alias: Update Solaroid
description: ""
triggers:
  - trigger: time_pattern
    minutes: /20
conditions: []
actions:
  - action: rest_command.utility_payment_update_supa
    data: {}
    metadata: {}
    continue_on_error: true
    response_variable: response
  - if:
      - alias: Failed?
        condition: template
        value_template: "{{ response is not defined or response.status != 200 or not response.content.ok }}"
    then:
      - action: notify.notify_admins
        metadata: {}
        data:
          message: Update failed!
          title: 💵 Utility Payment
```
