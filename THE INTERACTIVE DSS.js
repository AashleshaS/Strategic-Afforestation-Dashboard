// ============================================================
// SCRIPT 2: THE INTERACTIVE DSS (DASHBOARD & POLICY STATS)
// PROJECT: Smart City Doctor (Nagpur District)
// ============================================================

// ------------------------------------------------------------
// 1. LOAD PRE-COMPUTED DATA & SHAPEFILES
// ------------------------------------------------------------
var baseData = ee.Image('projects/pbl-project-474207/assets/Nagpur_District_BaseData');

// REPLACE this with the exact path of your newly uploaded Maharashtra Tehsils ZIP file
var mahaTehsils = ee.FeatureCollection('projects/pbl4nagpurproject/assets/MAHARASHTRA_SUBDISTRICTS');

// Filter the state shapefile to ONLY keep Nagpur Tehsils
var nmcTehsils = mahaTehsils.filter(ee.Filter.eq('dtname', 'Nagpur'));

var heatScore = baseData.select('Heat_Score');
var greenNeed = baseData.select('Green_Need');
var popScore  = baseData.select('Pop_Score');
var plantMask = baseData.select('Suitability_Mask');

// ------------------------------------------------------------
// 2. BUILD THE UI LAYOUT (Split Screen)
// ------------------------------------------------------------
ui.root.clear();

// Right Side: The Map
var mainMap = ui.Map();
mainMap.setCenter(79.0882, 21.1458, 9); 
ui.root.add(mainMap);

// VISUAL UPDATE 1: Darker, thicker Tehsil boundaries (Width 2, Opacity 1.0)
var tehsilOutline = ee.Image().byte().paint({featureCollection: nmcTehsils, color: 0, width: 2});
mainMap.addLayer(tehsilOutline, {palette: ['#000000']}, 'Tehsil Boundaries', true, 1.0);

// Left Side: The Policy Dashboard (Phase 6 Chart)
var leftPane = ui.Panel({style: {width: '450px', padding: '15px', backgroundColor: '#ffffff'}});
var chartTitle = ui.Label('District Budget Priority: Tehsil Rankings', {fontWeight: 'bold', fontSize: '18px', color: '#333333'});
var chartDesc = ui.Label('Calculates total "Critical Need" planting area per Tehsil.', {color: 'gray', fontSize: '12px'});
leftPane.add(chartTitle).add(chartDesc);
leftPane.add(ui.Label('Adjust sliders and click "Calculate" to generate rankings.', {color: 'darkred'})); 
ui.root.insert(0, leftPane); 

// Floating Panel: DSS Sliders (Phase 4)
var controlPanel = ui.Panel({style: {width: '320px', position: 'bottom-right', padding: '15px'}});
controlPanel.add(ui.Label('Interactive MCDA Weights', {fontWeight: 'bold', fontSize: '16px', color: 'darkgreen'}));

function createSlider(label_text, default_val) {
  var label = ui.Label(label_text, {fontWeight: 'bold', fontSize: '12px'});
  var slider = ui.Slider({min: 0, max: 10, value: default_val, step: 1, style: {width: '90%', margin: '0 0 10px 10px'}});
  return {panel: ui.Panel([label, slider]), slider: slider};
}
var wHeat = createSlider('1. Heat Island Weight', 5);
var wGreen = createSlider('2. Lack of Greenery Weight', 3);
var wPop = createSlider('3. Population Density Weight', 2);
controlPanel.add(wHeat.panel).add(wGreen.panel).add(wPop.panel);

// Legend
controlPanel.add(ui.Thumbnail({
  image: ee.Image.pixelLonLat().select(0),
  params: {bbox: [0,0,1,0.1], dimensions: '100x10', format: 'png', min: 0, max: 1, palette: ['#4575b4', '#ffffbf', '#d73027']},
  style: {stretch: 'horizontal', margin: '10px 8px 0px 8px', maxHeight: '15px'}
}));
controlPanel.add(ui.Panel({
  widgets: [ui.Label('Low', {fontSize: '10px', color: 'gray'}), ui.Label('', {stretch: 'horizontal'}), ui.Label('Critical', {fontSize: '10px', color: 'darkred'})],
  layout: ui.Panel.Layout.flow('horizontal'), style: {margin: '0px 8px'}
}));

// ------------------------------------------------------------
// 3. THE CALCULATION ENGINE
// ------------------------------------------------------------
var runButton = ui.Button({label: 'Calculate Priority Map', style: {stretch: 'horizontal', color: 'darkgreen'}});

runButton.onClick(function() {
  var total = wHeat.slider.getValue() + wGreen.slider.getValue() + wPop.slider.getValue();
  if (total === 0) return; 
  
  // A. Generate Map (Phase 4)
  var finalPriority = heatScore.multiply(wHeat.slider.getValue() / total)
    .add(greenNeed.multiply(wGreen.slider.getValue() / total))
    .add(popScore.multiply(wPop.slider.getValue() / total))
    .updateMask(plantMask).rename('Priority');

  mainMap.layers().forEach(function(l) { if (l.getName() === 'Target Zones') mainMap.remove(l); });
  
  // VISUAL UPDATE 2: Added "opacity: 0.65" so underlying city names are visible
  mainMap.addLayer(finalPriority, {min: 0.2, max: 0.8, palette: ['#4575b4', '#ffffbf', '#d73027'], opacity: 0.65}, 'Target Zones');

  // B. Generate Policy Chart (Phase 6)
  leftPane.widgets().set(2, ui.Label('Calculating District Statistics... (This may take a few seconds)', {color: 'gray'}));
  
  var tehsilStats = finalPriority.gt(0.6).rename('Critical_Need').reduceRegions({
    collection: nmcTehsils, 
    reducer: ee.Reducer.sum(), 
    scale: 10, 
    tileScale: 4
  });

  var processedStats = tehsilStats.map(function(feature) {
    var rawPixels = ee.Number(feature.get('sum'));
    var sqKm = rawPixels.multiply(100).divide(1000000); 
    return feature.set('Area_SqKm', sqKm);
  }).sort('Area_SqKm', false); 

  var priorityChart = ui.Chart.feature.byFeature({
    features: processedStats, 
    xProperty: 'sdtname', 
    yProperties: ['Area_SqKm'] 
  })
  .setChartType('BarChart')
  .setOptions({
    hAxis: {title: 'Target Afforestation Zone (Square Kilometers)', minValue: 0}, 
    vAxis: {textStyle: {fontSize: 11}},
    colors: ['#d73027'],
    legend: {position: 'none'},
    height: 550
  });

  leftPane.widgets().set(2, priorityChart);

  // ------------------------------------------------------------
  // THE "WOW FACTOR": CLICKABLE CHART INTERACTIVITY
  // ------------------------------------------------------------
  priorityChart.onClick(function(xValue, yValue, seriesName) {
    if (!xValue) return; 
    
    var clickedTehsil = nmcTehsils.filter(ee.Filter.eq('sdtname', xValue));
    mainMap.centerObject(clickedTehsil, 11); // Zoom in
    
    mainMap.layers().forEach(function(l) { 
      if (l.getName() === 'Selected Tehsil') mainMap.remove(l); 
    });
    
    // Draw a bright cyan outline around the clicked Tehsil
    var highlightLayer = ee.Image().byte().paint(clickedTehsil, 1, 4);
    mainMap.addLayer(highlightLayer, {palette: ['#00FFFF']}, 'Selected Tehsil');
  });
});

controlPanel.add(runButton);
mainMap.add(controlPanel);
