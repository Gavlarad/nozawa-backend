const fs = require('fs');

// Load and check the file structure
const rawData = fs.readFileSync('./nozawa_places_unified.json', 'utf8');
const data = JSON.parse(rawData);

console.log('Type of data:', typeof data);
console.log('Is array?:', Array.isArray(data));
console.log('Root keys:', Object.keys(data));

if (data.places) {
  console.log('Has places property');
  console.log('Type of places:', typeof data.places);
  console.log('Is places an array?:', Array.isArray(data.places));
  console.log('Number of places:', data.places.length);
}

// Show first item structure
if (data.places && data.places[0]) {
  console.log('\nFirst place structure:');
  console.log(JSON.stringify(data.places[0], null, 2).substring(0, 500));
} else if (Array.isArray(data)) {
  console.log('\nFirst item in array:');
  console.log(JSON.stringify(data[0], null, 2).substring(0, 500));
}