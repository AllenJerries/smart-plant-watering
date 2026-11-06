-- ============================================================================
-- Optional demo seed for the dashboard (run after schema.sql).
-- Inserts 24 hours of readings at 5-minute intervals for device "plant-01".
-- Safe to re-run: it does nothing if readings already exist for that device.
-- ============================================================================

with series as (
  select generate_series(0, 287) as step
),
computed as (
  select
    step,
    greatest(
      0::numeric,
      least(
        100::numeric,
        52
          + 11 * sin(step::numeric / 14.0)
          - 22 * exp(-power((step - 190)::numeric / 12.0, 2))
          + (random() - 0.5) * 2.5
      )
    ) as moisture
  from series
)
insert into public.sensor_readings
  (device_id, moisture_pct, raw_value, rssi, created_at)
select
  'plant-01',
  round(moisture, 2),
  greatest(0, least(4095, round(3000 - (moisture * 17))::int)),
  -55 - floor(random() * 18)::int,
  now() - (interval '5 minutes' * (287 - step))
from computed
where not exists (
  select 1
  from public.sensor_readings
  where device_id = 'plant-01'
);

insert into public.device_state (device_id, last_alert_type, last_alert_at)
values ('plant-01', 'NORMAL', null)
on conflict (device_id) do nothing;
