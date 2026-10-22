-- Country photographs, not pictures of a delivered physical SIM or tariff guarantees.
-- Add only to products without existing images. Safe to rerun.
BEGIN;
WITH photos(slug, filename, alt) AS (VALUES
 ('esim-orange-poland','96d4d2e2f5d36009fbd484fe3023f7bf.webp','Варшава, Польша: городской пейзаж на закате'),
 ('esim-silknet-georgia','055bf3ab63ae61ee01f9cb77c64d9c23.webp','Тбилиси, Грузия: старый город и мост Мира'),
 ('esim-cellfie-georgia','410b2a24aaf328e3b19d184e7c1fd51c.webp','Побережье рядом с Батуми, Грузия'),
 ('esim-t-mobile-poland','b4678837f7b32f7c11580b47a1ca3854.webp','Краков, Польша: Рыночная площадь'),
 ('esim-plus-poland','ceecb7b2151eea309a005fd0ed92ff41.webp','Гданьск, Польша: историческая набережная'),
 ('esim-vodafone-spain','f5d8ed9e5881427a032130d70a33941b.webp','Барселона, Испания: вид на город и Саграда-Фамилия'),
 ('esim-lyca-mobile-poland-70gb','3f63ef4ca7a1f00c6708007bf0d06322.webp','Вроцлав, Польша: исторические здания у реки')
)
INSERT INTO product_images(product_id,url,alt,sort_order,is_primary)
SELECT p.id,'/uploads/catalog/' || photos.filename,photos.alt,0,true
FROM photos JOIN products p ON p.slug=photos.slug
WHERE NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id=p.id);
COMMIT;
