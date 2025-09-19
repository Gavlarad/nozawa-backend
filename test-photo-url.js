const https = require('https');

// Get first photo URL from your data
const data = JSON.parse(require('fs').readFileSync('./nozawa_places_unified.json', 'utf8'));
const firstPlace = data.places.find(p => p.google_data?.photos?.length > 0);
const testUrl = firstPlace.google_data.photos[0].url;

console.log('Testing URL for:', firstPlace.name);
console.log('URL:', testUrl.substring(0, 100) + '...');

https.get(testUrl, (response) => {
  console.log('Status Code:', response.statusCode);
  console.log('Status Message:', response.statusMessage);
  if (response.headers.location) {
    console.log('Redirect to:', response.headers.location);
  }
}).on('error', (err) => {
  console.error('Error:', err);
});