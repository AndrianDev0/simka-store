ALTER TABLE "products" ALTER COLUMN "price" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "validity_days" DROP NOT NULL;
--> statement-breakpoint
DO $constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_unpriced_unavailable' AND conrelid = 'products'::regclass) THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_unpriced_unavailable"
      CHECK (price IS NOT NULL OR (available = FALSE AND availability_status = 'OUT_OF_STOCK'));
  END IF;
END $constraint$;
