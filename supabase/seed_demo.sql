-- Seed the demo clinic.
--
-- Run this ONCE, right after 0001_receptionist_core.sql. Without it the
-- database is empty and the console has no business to show — which looks
-- like a broken deployment rather than an empty one.
--
-- Everything here is clearly marked `is_demo = true`, so the console keeps
-- showing the "this is a test business" banner. Add real clients as separate
-- rows with is_demo = false.
--
-- Safe to re-run: it does nothing if the demo business already exists.

do $$
declare
  bid uuid;
begin
  select id into bid from businesses where slug = 'demo-clinic';
  if bid is not null then
    raise notice 'Demo clinic already seeded (%). Nothing to do.', bid;
    return;
  end if;

  insert into businesses (
    slug, name, kind, timezone, city, address, phone, currency,
    lead_time_min, slot_step_min, horizon_days, policies, escalation_contact, is_demo
  ) values (
    'demo-clinic',
    'عيادة المثال (تجريبي)',
    'clinic',
    'Asia/Amman',
    'عمّان',
    'شارع المثال، عمّان',
    '+962 7 0000 0000',
    'JOD',
    60,   -- earliest bookable slot is 60 minutes from now
    15,   -- appointments start on a 15-minute grid
    30,   -- bookings accepted up to 30 days ahead
    '{"cancellationHours": 4, "walkIns": false, "parking": "موقف مجاني",
      "escalateTopics": ["تأمين خاص", "حالة طارئة"]}'::jsonb,
    'صاحب العيادة',
    true
  )
  returning id into bid;

  -- The only services the receptionist may quote. Anything else escalates.
  insert into services (business_id, code, name, duration_min, price, currency) values
    (bid, 'check',   'كشفية',        30, 20, 'JOD'),
    (bid, 'clean',   'تنظيف أسنان',  45, 35, 'JOD'),
    (bid, 'filling', 'حشوة',         60, 30, 'JOD');

  -- 0 = Sunday … 6 = Saturday. Friday has no row, so it is closed.
  insert into business_hours (business_id, weekday, open_time, close_time) values
    (bid, 0, '09:00', '17:00'),
    (bid, 1, '09:00', '17:00'),
    (bid, 2, '09:00', '17:00'),
    (bid, 3, '09:00', '17:00'),
    (bid, 4, '09:00', '15:00'),
    (bid, 6, '10:00', '14:00');

  insert into knowledge_items (business_id, question, answer) values
    (bid, 'التأمين', 'بنقبل تأمين طبي، احكي مع الاستقبال قبل الموعد بيوم.'),
    (bid, 'المواقف', 'في موقف سيارات مجاني قدام العيادة.');

  raise notice 'Demo clinic seeded: %', bid;
end $$;
