UPDATE "vast_inspector"."inspections" AS inspection
SET "max_severity" = COALESCE((
  SELECT finding."severity"::text
  FROM "vast_inspector"."findings" AS finding
  WHERE finding."inspection_id" = inspection."id"
  ORDER BY finding."severity" DESC
  LIMIT 1
), 'none')
WHERE inspection."max_severity" IS NULL;
