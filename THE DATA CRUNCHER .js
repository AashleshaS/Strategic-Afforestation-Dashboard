// ============================================================
// SCRIPT 1: THE DATA CRUNCHER (ETL & EXPORT)
// PROJECT: Smart City Doctor (Nagpur District)
// ============================================================

// 1. DEFINE NAGPUR DISTRICT AOI
var gaul = ee.FeatureCollection("FAO/GAUL/2015/level2");
var nagpur = gaul.filter(ee.Filter.eq('ADM2_NAME', 'Nagpur'));
var aoi = nagpur.geometry();
Map.centerObject(aoi, 9);

// Show Outline
var outline = ee.Image().byte().paint({featureCollection: nagpur, color: 1, width: 2});
Map.addLayer(outline, {palette: ['#000000']}, 'Nagpur District Boundary', true);

// 2. LST (Landsat 9, Summer 2025)
var lst2025 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')
  .filterBounds(aoi)
  .filterDate('2025-03-01', '2025-05-31')
  .filter(ee.Filter.lt('CLOUD_COVER', 30))
  .map(function(image) {
    var qa = image.select('QA_PIXEL');
    var mask = qa.bitwiseAnd(parseInt('11111', 2)).eq(0);
    var thermal = image.select('ST_B10').multiply(0.00341802).add(149.0); 
    return image.addBands(thermal.subtract(273.15).rename('LST_Celsius')).updateMask(mask);
  })
  .select('LST_Celsius').median().clip(aoi);

Map.addLayer(lst2025, {min: 35, max: 48, palette: ['blue', 'yellow', 'red']}, '1. Raw LST (Celsius)', false);

// 3. NDVI (Sentinel-2, Summer 2025)
var ndvi2025 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(aoi)
  .filterDate('2025-03-01', '2025-05-31')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
  .map(function(image) {
    var scl = image.select('SCL');
    var mask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
    return image.updateMask(mask);
  })
  .median().clip(aoi).normalizedDifference(['B8', 'B4']).rename('NDVI');

Map.addLayer(ndvi2025, {min: 0, max: 0.6, palette: ['white', 'lightgreen', 'darkgreen']}, '2. Raw NDVI', false);

// 4. POPULATION (WorldPop 2020)
var popData = ee.ImageCollection("WorldPop/GP/100m/pop")
  .filter(ee.Filter.eq('country', 'IND'))
  .filter(ee.Filter.eq('year', 2020)).first().clip(aoi);

Map.addLayer(popData, {min: 0, max: 50, palette: ['black', 'purple', 'yellow']}, '3. Population Density', false);

// 5. NORMALIZE CRITERIA (0 to 1 Scale)
function getPct(img, band, scale, low, high) {
  var p = img.reduceRegion({reducer: ee.Reducer.percentile([low, high]), geometry: aoi, scale: scale, maxPixels: 1e13});
  return {low: ee.Number(p.get(band+'_p'+low)), high: ee.Number(p.get(band+'_p'+high))};
}

var lstPct = getPct(lst2025, 'LST_Celsius', 1000, 5, 95);
var Heat_Score = lst2025.clamp(lstPct.low, lstPct.high).unitScale(lstPct.low, lstPct.high).rename('Heat_Score');
Map.addLayer(Heat_Score, {min: 0, max: 1, palette: ['blue', 'yellow', 'red']}, '4. Normalized Heat Score', false);

var ndviPct = getPct(ndvi2025, 'NDVI', 100, 5, 95);
var Green_Need = ee.Image(1).subtract(ndvi2025.clamp(ndviPct.low, ndviPct.high).unitScale(ndviPct.low, ndviPct.high)).rename('Green_Need');
Map.addLayer(Green_Need, {min: 0, max: 1, palette: ['darkgreen', 'lightgreen', 'white', 'red']}, '5. Normalized Green Need', false);

var Pop_Score = popData.clamp(0, 100).unitScale(0, 100).rename('Pop_Score');
Map.addLayer(Pop_Score, {min: 0, max: 1, palette: ['black', 'purple', 'yellow']}, '6. Normalized Pop Score', false);

// 6. SUITABILITY MASK (Ground + Roofs)
var LULC = ee.Image("ESA/WorldCover/v200/2021").select('Map').clip(aoi);
var groundSpace = LULC.eq(20).or(LULC.eq(30)).or(LULC.eq(60)); // Shrubs, Grass, Bare
var buildings = ee.FeatureCollection('GOOGLE/Research/open-buildings/v3/polygons').filterBounds(aoi).filter(ee.Filter.gt('confidence', 0.70));
var roofSpace = buildings.reduceToImage({properties: ['confidence'], reducer: ee.Reducer.first()}).gt(0).unmask(0); 
var Suitability_Mask = groundSpace.or(roofSpace).rename('Suitability_Mask');

Map.addLayer(Suitability_Mask, {min: 0, max: 1, palette: ['black', 'cyan']}, '7. Plantable Mask (Cyan = Yes)', false);

// 7. ASSET EXPORT
var finalExportImage = Heat_Score.addBands(Green_Need).addBands(Pop_Score).addBands(Suitability_Mask);

print('Run the export in the Tasks tab!', finalExportImage);

Export.image.toAsset({
  image: finalExportImage,
  description: 'Export_Nagpur_District_BaseData',
  assetId: 'Nagpur_District_BaseData', // This saves to your GEE Assets
  scale: 10,
  region: aoi,
  maxPixels: 1e13
});
