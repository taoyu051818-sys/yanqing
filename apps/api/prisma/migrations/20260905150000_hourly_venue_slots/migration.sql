-- Change the seeded retail catalogue, never historical bookings or order prices.
-- Abort unfamiliar configurations instead of guessing their hourly tariff.
BEGIN;
LOCK TABLE "TimeSlot", "PriceRule" IN SHARE ROW EXCLUSIVE MODE;
DO $$
DECLARE
  slot RECORD;
  rule RECORD;
  hour INTEGER;
  count_hours INTEGER;
  child_code TEXT;
  child_id TEXT;
  rule_code TEXT;
BEGIN
  IF (SELECT count(*) FROM "TimeSlot" WHERE code IN ('S01','S02','S03','S04','S05','S06','S07','S08')) NOT IN (0, 8) THEN
    RAISE EXCEPTION 'Hourly migration requires the complete legacy catalogue or an empty installation';
  END IF;
  IF EXISTS (SELECT 1 FROM "TimeSlot" WHERE code IN ('S01','S02','S03','S04','S05','S06','S07','S08')) THEN
    IF EXISTS (SELECT 1 FROM "PriceRule" WHERE "timeSlotId" IS NULL AND enabled) THEN
      RAISE EXCEPTION 'Review global tariffs before converting legacy slot totals to hourly prices';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "TimeSlot" s JOIN (VALUES
        ('S01',420,540),('S02',540,720),('S03',720,840),('S04',840,1020),
        ('S05',1020,1140),('S06',1140,1260),('S07',1260,1380),('S08',1380,1440)
      ) AS expected(code,start_minute,end_minute) ON s.code = expected.code
      WHERE s."startMinutes" <> expected.start_minute OR s."endMinutes" <> expected.end_minute
    ) OR EXISTS (SELECT 1 FROM "TimeSlot" WHERE code NOT IN ('S01','S02','S03','S04','S05','S06','S07','S08') AND enabled) THEN
      RAISE EXCEPTION 'Nonstandard or overlapping catalogue: review before hourly migration';
    END IF;
    FOR slot IN SELECT * FROM "TimeSlot" WHERE code IN ('S01','S02','S03','S04','S05','S06','S07','S08') ORDER BY "startMinutes" LOOP
      count_hours := (slot."endMinutes" - slot."startMinutes") / 60;
      FOR hour IN slot."startMinutes" / 60 .. slot."endMinutes" / 60 - 1 LOOP
        child_code := 'H' || lpad(hour::TEXT, 2, '0');
        child_id := 'hourly-slot-' || child_code;
        INSERT INTO "TimeSlot" (id,code,label,"startMinutes","endMinutes",period,enabled,"sortOrder","updatedAt")
        VALUES (child_id,child_code,lpad(hour::TEXT,2,'0') || ':00–' || lpad((hour+1)::TEXT,2,'0') || ':00',hour*60,(hour+1)*60,slot.period,slot.enabled,hour*60,CURRENT_TIMESTAMP);
        FOR rule IN SELECT * FROM "PriceRule" WHERE "timeSlotId" = slot.id LOOP
          rule_code := CASE WHEN rule.code = 'PRICE_' || slot.code THEN 'PRICE_' || child_code ELSE rule.code || '_' || child_code END;
          -- Allocate any remainder by cumulative rounding, preserving the exact
          -- old total in cents, including newcomer prices and every rule version.
          INSERT INTO "PriceRule" (id,code,version,name,"timeSlotId","weekdayMask","priceCents","newcomerPriceCents","effectiveFrom","effectiveTo",enabled,"creationIdempotencyKey","creationCommandHash","createdById","updatedAt")
          VALUES ('hourly-price-' || md5(rule.id || child_code),rule_code,rule.version,child_code || ' 每小时场地价',child_id,rule."weekdayMask",
            floor(rule."priceCents"::NUMERIC * (hour-slot."startMinutes"/60+1) / count_hours) - floor(rule."priceCents"::NUMERIC * (hour-slot."startMinutes"/60) / count_hours),
            floor(rule."newcomerPriceCents"::NUMERIC * (hour-slot."startMinutes"/60+1) / count_hours) - floor(rule."newcomerPriceCents"::NUMERIC * (hour-slot."startMinutes"/60) / count_hours),
            rule."effectiveFrom",rule."effectiveTo",rule.enabled,'HOURLY_V1:' || rule.id || ':' || child_code,repeat(md5(rule.id || child_code),2),rule."createdById",CURRENT_TIMESTAMP);
        END LOOP;
      END LOOP;
      UPDATE "TimeSlot" SET enabled = false, "updatedAt" = CURRENT_TIMESTAMP WHERE id = slot.id;
    END LOOP;
  END IF;
END $$;
COMMIT;
